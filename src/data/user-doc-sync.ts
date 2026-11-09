// 登入後同步 users/{uid} 會員文件（照 A `FirebaseService.createOrUpdateUser`，js/firebase-crud.js）。
//
// 2026-11-09 P1：B 登入流程原本不建會員文件，換站後的新會員報名名字變「用戶」、個人頁「找不到用戶資料」。
// - 不存在：先找 legacy（where lineUserId == uid limit 1），沒有就照 A 新建欄位建立；有就照 A 合併遷移。
// - 已存在：只更新 A 會更新的 displayName／pictureUrl，lastLogin 超過 10 分鐘才更新（Rules isSafeLoginUpdate）。
//   role、exp、level、lineNotify 等其他欄位一律不寫。
// - auth uid 與 LINE userId 不一致：照 A 拒絕寫入。
// - 只是 Auth 還原的進站（沒有 LINE profile）：文件存在只補 lastLogin（超過 10 分鐘，同 A）；文件不存在才初始化 LIFF 取 profile 建檔。
// - 失敗不阻斷登入：宿主（InboxStoreHost，登入後才載入的延遲 chunk）只記錄結構化警告；成功才寫本機記號，
//   沒寫記號的下次進站會再試一次（不做批次回填，受影響的人下次登入／進站自動建檔）。
// - 本檔只能被延遲 chunk 靜態引用，不得進首頁靜態圖（entry-graph.test.ts 管制）。

import type { Firestore } from 'firebase/firestore';

import { emit } from '@/core/events';

import { getFirebase } from './firebase';
import { ensureLiffInit, getReadyLiff } from './liff-init';
import { users } from './paths';
import {
  assertUserRootCreate,
  buildLastLoginUpdate,
  buildLegacyMigration,
  buildLoginUpdate,
  buildNewUserDoc,
  isNoopLoginUpdate,
  LAST_LOGIN_REFRESH_MS,
  USER_DOC_CREATE_FIELDS,
  USER_DOC_LOGIN_UPDATE_FIELDS,
  USER_ROOT_CREATE_RULES_FIELDS,
  UserDocSyncError,
  type LineLoginProfile,
} from './user-doc-payload';
import { assertAllowedFields } from './write-guard';

type Data = Record<string, unknown>;

/** 照 A `LineAuth` 的 getProfile 8 秒上限。 */
const PROFILE_TIMEOUT_MS = 8000;
/** 成功同步的本機記號（前綴 toosterx:auth，登出時隨帳號資料一併清掉）。 */
export const USER_DOC_SYNCED_KEY = 'toosterx:auth:user-doc';

export type UserDocSyncResult = 'created' | 'migrated' | 'updated' | 'unchanged' | 'skipped';

/** 只用到的 LIFF 介面（getProfile、ID token）。 */
export interface LiffProfileSource {
  isLoggedIn(): boolean;
  getProfile(): Promise<{ userId?: string; displayName?: string; pictureUrl?: string }>;
  getDecodedIDToken(): { sub?: string; name?: string; picture?: string; email?: string } | null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[user-doc-sync] getProfile 逾時（${ms}ms）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** 照 A `LineAuth` 取 LINE profile：getProfile，失敗退回 ID token；email 一律取自 ID token。 */
export async function readLineProfile(liff: LiffProfileSource): Promise<LineLoginProfile | null> {
  let idToken: ReturnType<LiffProfileSource['getDecodedIDToken']> = null;
  try {
    idToken = liff.getDecodedIDToken();
  } catch {
    idToken = null;
  }
  const email = idToken?.email || null;
  try {
    const p = await withTimeout(liff.getProfile(), PROFILE_TIMEOUT_MS);
    if (p?.userId) {
      return { userId: p.userId, displayName: p.displayName ?? null, pictureUrl: p.pictureUrl || null, email };
    }
  } catch {
    // 退回 ID token（照 A Fallback 2）。
  }
  if (idToken?.sub) {
    return { userId: idToken.sub, displayName: idToken.name || 'LINE User', pictureUrl: idToken.picture || null, email };
  }
  return null;
}

function loggedIn(liff: unknown): LiffProfileSource | null {
  const source = liff as LiffProfileSource | null;
  try {
    return source && source.isLoggedIn() ? source : null;
  } catch {
    return null;
  }
}

/** 本機記號 `${uid}|${ms}`：同一帳號 10 分鐘內同步過、又沒有 LINE profile 可更新時不再讀（lastLogin 也還不到更新時間）。 */
function recentlySynced(uid: string, nowMs: number): boolean {
  try {
    const [markUid, markMs] = (localStorage.getItem(USER_DOC_SYNCED_KEY) ?? '').split('|');
    return markUid === uid && nowMs - Number(markMs) < LAST_LOGIN_REFRESH_MS;
  } catch {
    return false;
  }
}

function markSynced(uid: string, nowMs: number): void {
  try {
    localStorage.setItem(USER_DOC_SYNCED_KEY, `${uid}|${nowMs}`);
  } catch {
    // 寫不進去只代表下次進站會再確認一次。
  }
}

async function requireProfile(liff: LiffProfileSource | null, uid: string): Promise<LineLoginProfile> {
  const profile = liff ? await readLineProfile(liff) : null;
  if (!profile) throw new UserDocSyncError('line-profile-unavailable');
  // 照 A：auth uid 必須等於 LINE userId，否則拒絕寫入。
  if (profile.userId !== uid) throw new UserDocSyncError('line-uid-mismatch');
  return profile;
}

async function runSync(uid: string): Promise<UserDocSyncResult> {
  if (!uid) throw new UserDocSyncError('no-uid');
  const nowMs = Date.now();
  // 剛用 LINE 登入（或 Mini App 已初始化 LIFF）時照 A 帶 LINE profile 同步；
  // 只是 Auth 還原的進站沒有 profile，只補 lastLogin（照 A 每次進站超過 10 分鐘更新）。
  const readyLiff = loggedIn(getReadyLiff());
  if (!readyLiff && recentlySynced(uid, nowMs)) return 'skipped';

  const [fs, ctx] = await Promise.all([import('firebase/firestore'), getFirebase()]);
  const assertAuthUid = (): void => {
    if (ctx.auth.currentUser?.uid !== uid) throw new UserDocSyncError('auth-uid-mismatch');
  };
  assertAuthUid();
  const db = ctx.db as unknown as Firestore;
  const ref = fs.doc(db, users, uid);
  const snap = await fs.getDoc(ref);
  const ts = fs.serverTimestamp();

  let result: UserDocSyncResult;
  // 只有畫面看得到的資料變了（新建／遷移、名稱或頭像改變）才通知重讀 viewer；只補 lastLogin 不通知（省重讀）。
  let visibleChange = true;
  if (snap.exists()) {
    const existing = (snap.data() ?? {}) as Data;
    const profile = readyLiff ? await requireProfile(readyLiff, uid) : null;
    const updates = profile
      ? buildLoginUpdate(existing, profile, nowMs, ts)
      : buildLastLoginUpdate(existing, nowMs, ts);
    visibleChange = (['displayName', 'pictureUrl'] as const).some((key) => key in updates && existing[key] !== updates[key]);
    if (isNoopLoginUpdate(existing, updates)) {
      result = 'unchanged';
    } else {
      assertAllowedFields('users.loginUpdate', updates, USER_DOC_LOGIN_UPDATE_FIELDS);
      assertAuthUid();
      await fs.updateDoc(ref, updates);
      result = 'updated';
    }
  } else {
    let liff = readyLiff;
    if (!liff) {
      try {
        liff = loggedIn(await ensureLiffInit());
      } catch (err) {
        throw new UserDocSyncError('liff-init-failed', err);
      }
    }
    const profile = await requireProfile(liff, uid);
    const legacy = await fs.getDocs(
      fs.query(fs.collection(db, users), fs.where('lineUserId', '==', uid), fs.limit(1)),
    );
    const legacyDoc = legacy.docs[0];
    assertAuthUid();
    if (!legacyDoc) {
      const payload = buildNewUserDoc(uid, profile, ts);
      assertUserRootCreate(payload, uid, ts, USER_DOC_CREATE_FIELDS);
      await fs.setDoc(ref, payload);
      result = 'created';
    } else {
      // A 用 set merge；目標文件不存在，Rules 走 create，必須通過 isSafeUserRootCreate。
      const payload = buildLegacyMigration((legacyDoc.data() ?? {}) as Data, uid, profile, ts);
      assertUserRootCreate(payload, uid, ts, USER_ROOT_CREATE_RULES_FIELDS);
      await fs.setDoc(ref, payload, { merge: true });
      result = 'migrated';
    }
  }
  markSynced(uid, nowMs);
  if (result !== 'unchanged' && visibleChange) emit('viewer:refresh', {});
  return result;
}

const inflight = new Map<string, Promise<UserDocSyncResult>>();

/** 同一 uid 同時只跑一次；失敗會拋錯（不偽裝成功）。 */
export function syncUserDoc(uid: string): Promise<UserDocSyncResult> {
  const running = inflight.get(uid);
  if (running) return running;
  const run = runSync(uid).finally(() => {
    if (inflight.get(uid) === run) inflight.delete(uid);
  });
  inflight.set(uid, run);
  return run;
}

/** 宿主用：不阻斷登入，失敗只留結構化警告（不含 uid），下次進站重試。 */
export function startUserDocSync(uid: string): Promise<UserDocSyncResult | null> {
  return syncUserDoc(uid).catch((err: unknown) => {
    const cause = err instanceof UserDocSyncError ? err.cause : err;
    console.warn('[user-doc-sync] 會員文件同步失敗，下次進站重試', {
      reason: err instanceof UserDocSyncError ? err.reason : 'firestore-failed',
      code: (cause as { code?: unknown } | null | undefined)?.code ?? null,
      message: cause instanceof Error ? cause.message : String(cause ?? ''),
    });
    return null;
  });
}

export function _resetUserDocSyncForTest(): void {
  inflight.clear();
}
