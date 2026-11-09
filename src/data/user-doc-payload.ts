// 會員文件寫入 payload（照 A `FirebaseService.createOrUpdateUser`）與 Rules 對照守門；純函式，無 I/O。
// 由 user-doc-sync.ts 使用；A 對照測試 user-doc-payload.oracle.test.ts、Rules 對照測試 user-doc-payload.rules-parity.test.ts。

import { assertAllowedFields } from './write-guard';

/** A 新會員文件的欄位（順序照 A `userData`）；必須是 Rules `userRootCreateAllowedKeys()` 的子集合。 */
export const USER_DOC_CREATE_FIELDS = [
  'uid', 'lineUserId', 'displayName', 'pictureUrl', 'email',
  'role', 'exp', 'level',
  'gender', 'birthday', 'region', 'sports', 'teamId', 'teamName', 'phone', 'titleBig', 'titleNormal',
  'totalGames', 'completedGames', 'attendanceRate', 'badgeCount',
  'createdAt', 'lastLogin',
] as const;

/** 逐字對照 FC firestore.rules `userRootCreateAllowedKeys()`（legacy 遷移是建立文件，受這份清單限制）。 */
export const USER_ROOT_CREATE_RULES_FIELDS = [
  'uid', 'lineUserId', 'displayName', 'photoURL', 'pictureUrl', 'phone', 'email',
  'role', 'exp', 'level',
  'gender', 'birthday', 'region', 'sports',
  'teamId', 'teamName', 'teamIds', 'teamNames',
  'titleBig', 'titleNormal',
  'totalGames', 'completedGames', 'attendanceRate', 'badgeCount',
  'profileCompleted',
  'createdAt', 'lastLogin', 'updatedAt',
  'termsAcceptedAt', 'privacyAcceptedAt', 'termsVersion', 'privacyVersion', 'legalAcceptedSource',
  'favorites', 'socialLinks', 'lineNotify', 'companions', 'eduChildren', 'stealth',
] as const;

/** 已存在文件的登入更新欄位；逐字對照 Rules `isSafeLoginUpdate()` 的 hasOnly。 */
export const USER_DOC_LOGIN_UPDATE_FIELDS = ['displayName', 'pictureUrl', 'lastLogin'] as const;

/** 照 A：距上次 lastLogin 超過 10 分鐘才更新。 */
export const LAST_LOGIN_REFRESH_MS = 10 * 60 * 1000;

export interface LineLoginProfile {
  userId: string;
  displayName: string | null;
  pictureUrl: string | null;
  email: string | null;
  /** 名稱頭像來源：getProfile＝LINE 回傳的真資料；idToken＝退回 ID token（名稱可能是預設值）。省略視為 getProfile。 */
  source?: 'getProfile' | 'idToken';
}

export class UserDocSyncError extends Error {
  readonly reason: string;
  readonly cause: unknown;
  constructor(reason: string, cause?: unknown) {
    super(`[user-doc-sync] ${reason}`);
    this.name = 'UserDocSyncError';
    this.reason = reason;
    this.cause = cause;
  }
}

type Data = Record<string, unknown>;

/** 照 A：LINE 名稱 trim 後為空就用 userId；pictureUrl／email 假值一律 null。 */
export function normalizeLineProfile(profile: LineLoginProfile): {
  displayName: string;
  pictureUrl: string | null;
  email: string | null;
} {
  const name = typeof profile.displayName === 'string' ? profile.displayName.trim() : '';
  return {
    displayName: name || profile.userId,
    pictureUrl: profile.pictureUrl || null,
    email: profile.email || null,
  };
}

/** A 新建分支的 payload（createdAt／lastLogin 為 serverTimestamp）。 */
export function buildNewUserDoc(uid: string, profile: LineLoginProfile, ts: unknown): Data {
  const n = normalizeLineProfile(profile);
  return {
    uid, lineUserId: profile.userId,
    displayName: n.displayName, pictureUrl: n.pictureUrl, email: n.email,
    role: 'user', exp: 0, level: 1,
    gender: null, birthday: null, region: null, sports: null,
    teamId: null, teamName: null, phone: null, titleBig: null, titleNormal: null,
    totalGames: 0, completedGames: 0, attendanceRate: 0, badgeCount: 0,
    createdAt: ts, lastLogin: ts,
  };
}

/** A legacy 遷移分支的 payload（set merge）。 */
export function buildLegacyMigration(legacy: Data, uid: string, profile: LineLoginProfile, ts: unknown): Data {
  const n = normalizeLineProfile(profile);
  const payload: Data = {
    ...legacy,
    uid, lineUserId: profile.userId,
    displayName: n.displayName || legacy.displayName || uid,
    pictureUrl: n.pictureUrl, email: n.email,
    lastLogin: ts,
  };
  if (!legacy.createdAt) payload.createdAt = ts;
  return payload;
}

function toMillis(value: unknown): number {
  const fn = (value as { toMillis?: unknown } | null | undefined)?.toMillis;
  return typeof fn === 'function' ? Number((fn as () => number).call(value)) || 0 : 0;
}

/** A 已存在分支的 payload：displayName、pictureUrl 一律帶；lastLogin 超過 10 分鐘才帶。 */
export function buildLoginUpdate(existing: Data, profile: LineLoginProfile, nowMs: number, ts: unknown): Data {
  const n = normalizeLineProfile(profile);
  const updates: Data = { displayName: n.displayName, pictureUrl: n.pictureUrl };
  if (nowMs - toMillis(existing.lastLogin) > LAST_LOGIN_REFRESH_MS) updates.lastLogin = ts;
  return updates;
}

/**
 * B 已存在分支實際送出的更新（審查 P3-2，與 A 的刻意差異）：名稱頭像只用真的 getProfile 結果更新；
 * 退回 ID token（名稱可能是 'LINE User' 預設值）時只補 lastLogin；getProfile 名稱空白時保留既有名稱，不用 uid 覆寫。
 * 其餘照 A `buildLoginUpdate`。新建時的後備仍照 A。
 */
export function buildExistingLoginUpdate(existing: Data, profile: LineLoginProfile, nowMs: number, ts: unknown): Data {
  if (profile.source === 'idToken') return buildLastLoginUpdate(existing, nowMs, ts);
  const updates = buildLoginUpdate(existing, profile, nowMs, ts);
  if (!(typeof profile.displayName === 'string' && profile.displayName.trim())) delete updates.displayName;
  return updates;
}

/** 沒有 LINE profile 的進站（Auth 還原）：只補 lastLogin，條件同 A（超過 10 分鐘）。 */
export function buildLastLoginUpdate(existing: Data, nowMs: number, ts: unknown): Data {
  return nowMs - toMillis(existing.lastLogin) > LAST_LOGIN_REFRESH_MS ? { lastLogin: ts } : {};
}

/** A 這時仍會送一次內容相同的 update；B 省掉這次寫入（結果相同）。 */
export function isNoopLoginUpdate(existing: Data, updates: Data): boolean {
  return Object.keys(updates).every(
    (key) => key !== 'lastLogin' && Object.prototype.hasOwnProperty.call(existing, key) && existing[key] === updates[key],
  );
}

/**
 * 寫入前對照 Rules `isSafeUserRootCreate()`：欄位白名單＋值限制；不符就不送（避免必被拒的寫入）。
 * createdAt 必填且必須是本次 serverTimestamp（審查 P3-5）：文件若其實已存在（例如離線快取誤判不存在），
 * setDoc 會變成 update，而改動 createdAt 被所有 update 路徑拒絕（含 super_admin 的 isSafeSuperAdminUserUpdate），
 * 所以「只建立、不覆寫」由這條斷言明確保證，不靠呼叫端剛好帶了 createdAt。
 */
export function assertUserRootCreate(payload: Data, uid: string, ts: unknown, allowed: readonly string[]): void {
  try {
    assertAllowedFields('users.create', payload, allowed);
  } catch (err) {
    throw new UserDocSyncError('create-fields-not-allowed', err);
  }
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(payload, key);
  const bad: string[] = [];
  if (payload.uid !== uid) bad.push('uid');
  if (typeof payload.displayName !== 'string' || !payload.displayName) bad.push('displayName');
  if (has('lineUserId') && payload.lineUserId !== uid) bad.push('lineUserId');
  if (has('role') && payload.role !== 'user') bad.push('role');
  if (has('exp') && payload.exp !== 0) bad.push('exp');
  if (has('level') && payload.level !== 1) bad.push('level');
  if (payload.createdAt !== ts) bad.push('createdAt');
  for (const key of ['lastLogin', 'updatedAt']) {
    if (has(key) && payload[key] !== ts) bad.push(key);
  }
  if (bad.length > 0) throw new UserDocSyncError(`create-values-not-allowed:${bad.join(',')}`);
}
