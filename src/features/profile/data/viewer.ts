/**
 * FC-B Viewer 資料層。
 *
 * 規則對照：
 *  - R-IAM-008：權限判定必須與 A 前端一致（透過 createPermissionChecker）。
 *  - R-EVT-018：admin.repair.event_blocklist 可由有效個別授權授予，但 rolePermissions/user 固定不授予。
 *  - R-CAP-006～008：capabilities 儲存格式不得改寫；本檔只回傳正規化後的唯讀陣列。
 *  - R-ID-002：俱樂部幹部身分只用 UID 比對；A 以 name 對照的部分不移植（契約修正）。
 *  - L-02／L-04：hook 請求序號防舊結果覆蓋；訂閱後補讀一次目前值。
 *  - L-07：不使用無 catch 的 floating promise。
 *  - L-09：只有同一 UID 的重新整理失敗才保留上一份資料；新 UID 失敗維持最小權限暫態。
 *
 * Firestore 存取集中在此檔。
 */

import { useEffect, useState } from 'preact/hooks';
import type { Firestore, Query } from 'firebase/firestore';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import { getCurrentUser } from '@/data/auth';
import { on } from '@/core/events';
import type { ViewerContext } from '@/features/events/data/types';

import {
  createPermissionChecker,
  getRoleLevel,
  normalizePermissionCode,
  type CustomRole,
} from './permissions';

/** 對外公開的 Viewer 快照（含 role 與顯示欄位）。 */
export interface ViewerView extends ViewerContext {
  role: string;
  displayName: string | null;
  pictureUrl: string | null;
  capabilities: readonly string[];
}

const EMPTY_TEAM_IDS: ReadonlySet<string> = new Set<string>();
const EMPTY_CAPABILITIES: readonly string[] = Object.freeze([]) as readonly string[];

function alwaysFalse(): boolean {
  return false;
}

/** 訪客（未登入）快照。 */
export function createGuestViewer(): ViewerView {
  return {
    uid: null,
    teamIds: EMPTY_TEAM_IDS,
    hasPermission: alwaysFalse,
    roleLevel: 0,
    role: 'guest',
    displayName: null,
    pictureUrl: null,
    capabilities: EMPTY_CAPABILITIES,
  };
}

/** 新 UID 的最小權限暫態：在完整資料載入前不得沿用前一身分。 */
export function createMinimalViewer(uid: string): ViewerView {
  return {
    uid,
    teamIds: EMPTY_TEAM_IDS,
    hasPermission: alwaysFalse,
    roleLevel: 0,
    role: 'user',
    displayName: null,
    pictureUrl: null,
    capabilities: EMPTY_CAPABILITIES,
  };
}

/* ── warnOnce：每次載入最多記錄一次（避免洗版） ── */
const warnedKeys = new Set<string>();
function warnOnce(key: string, err: unknown): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[viewer] failed to read ${key}`, err);
}

/* ── 從 Firestore 文件資料解析各欄位（純函式，方便測試） ── */

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') out.push(item);
  }
  return out;
}

interface UserInfo {
  role: string;
  displayName: string | null;
  pictureUrl: string | null;
  teamIds: string[];
}

function defaultUserInfo(): UserInfo {
  return { role: 'user', displayName: null, pictureUrl: null, teamIds: [] };
}

function parseUserInfo(data: Record<string, unknown> | null | undefined): UserInfo {
  if (!data) return defaultUserInfo();
  const rawRole = data.role;
  const role = typeof rawRole === 'string' && rawRole.trim() ? rawRole.trim() : 'user';

  let displayName: string | null = null;
  if (typeof data.displayName === 'string') displayName = data.displayName;
  else if (typeof data.name === 'string') displayName = data.name;

  let pictureUrl: string | null = null;
  if (typeof data.pictureUrl === 'string') pictureUrl = data.pictureUrl;
  else if (typeof data.picture === 'string') pictureUrl = data.picture;

  const teamIds: string[] = [];
  if (Array.isArray(data.teamIds)) {
    for (const raw of data.teamIds) {
      if (raw) teamIds.push(String(raw));
    }
  }
  if (data.teamId) teamIds.push(String(data.teamId));

  return { role, displayName, pictureUrl, teamIds };
}

function sanitizePermissionCodeList(codes: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(codes)) return out;
  for (const code of codes) {
    const normalized = normalizePermissionCode(code);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/** A34：rolePermissions/{roleKey} 儲存欄位 permissions。 */
function parseRolePermissions(data: Record<string, unknown> | null): string[] {
  if (!data) return [];
  return sanitizePermissionCodeList(data.permissions);
}

/**
 * A36：userPermissionGrants/{uid} 儲存欄位 uid / permissions / enabled。
 * A getCurrentUserPermissionGrants 停用條件：enabled === false、grant.uid trim 後不符、permissions 非陣列。
 */
function parseUserGrantCodes(data: Record<string, unknown> | null, uid: string): string[] {
  if (!data) return [];
  if (data.enabled === false) return [];
  if (String(data.uid || '').trim() !== uid) return [];
  const raw = Array.isArray(data.permissions) ? data.permissions : [];
  const out: string[] = [];
  for (const code of raw) {
    if (typeof code !== 'string') continue;
    const trimmed = code.trim();
    if (!trimmed) continue;
    if (normalizePermissionCode(trimmed) !== trimmed) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/** A35：roleActivityCapabilities/{roleKey} 儲存欄位 capabilities。 */
function parseCapabilities(data: Record<string, unknown> | null): string[] {
  if (!data) return [];
  const raw = Array.isArray(data.capabilities) ? data.capabilities : [];
  const out: string[] = [];
  for (const code of raw) {
    if (typeof code !== 'string' || !code) continue;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

/* ── 安全讀取單一文件：不存在或無權限皆視為 null，不丟錯 ── */

type DocResult =
  | { ok: true; data: Record<string, unknown> | null }
  | { ok: false; error: unknown };

function safeGetDoc(promise: Promise<Awaited<ReturnType<typeof getDoc>>>): Promise<DocResult> {
  return promise.then(
    (snap): DocResult => {
      if (!snap.exists()) return { ok: true, data: null };
      const data = snap.data() as Record<string, unknown> | undefined;
      return { ok: true, data: data ?? null };
    },
    (error: unknown): DocResult => ({ ok: false, error }),
  );
}

/* ── 俱樂部範圍：照 A _getVisibleTeamIdsForLimitedEvents，但只以 UID 比對 ── */

async function loadTeamIdsForUser(
  db: Firestore,
  uid: string,
  baseTeamIds: readonly string[],
): Promise<Set<string>> {
  const ids = new Set<string>(baseTeamIds);

  const addTeamId = (raw: unknown): void => {
    if (raw) ids.add(String(raw));
  };

  const addAdminUserDoc = (data: Record<string, unknown> | undefined): void => {
    if (!data) return;
    if (Array.isArray(data.teamIds)) {
      for (const id of data.teamIds) addTeamId(id);
    }
    addTeamId(data.teamId);
  };

  const runTeamQuery = async (label: string, q: Query): Promise<void> => {
    try {
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        ids.add(d.id);
      }
    } catch (err) {
      warnOnce(label, err);
    }
  };

  const runAdminUserQuery = async (): Promise<void> => {
    try {
      const snap = await getDocs(query(collection(db, 'adminUsers'), where('uid', '==', uid)));
      for (const d of snap.docs) {
        addAdminUserDoc(d.data() as Record<string, unknown> | undefined);
      }
    } catch (err) {
      warnOnce('adminUsers', err);
    }
  };

  await Promise.all([
    runTeamQuery('teams.captainUid', query(collection(db, 'teams'), where('captainUid', '==', uid))),
    runTeamQuery('teams.leaderUid', query(collection(db, 'teams'), where('leaderUid', '==', uid))),
    runTeamQuery(
      'teams.leaderUids',
      query(collection(db, 'teams'), where('leaderUids', 'array-contains', uid)),
    ),
    runTeamQuery(
      'teams.coachUids',
      query(collection(db, 'teams'), where('coachUids', 'array-contains', uid)),
    ),
    runAdminUserQuery(),
  ]);

  return ids;
}

/* ── 自訂角色：A _getCustomRoles() 的 cache.customRoles 來源 ── */

async function loadCustomRoles(db: Firestore): Promise<CustomRole[]> {
  try {
    const snap = await getDocs(collection(db, 'customRoles'));
    const roles: CustomRole[] = [];
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const key = data.key;
      if (typeof key !== 'string' || !key) continue;
      roles.push({
        key,
        afterRole: typeof data.afterRole === 'string' ? data.afterRole : undefined,
        label: typeof data.label === 'string' ? data.label : undefined,
        color: typeof data.color === 'string' ? data.color : undefined,
      });
    }
    return roles;
  } catch (err) {
    warnOnce('customRoles', err);
    return [];
  }
}

/* ── 主入口 ── */

/**
 * 依 uid 載入 Viewer。uid 為空字串視同訪客。
 * rolePermissions 路徑：role === 'user' 時不讀取（A getRolePermissions('user') 固定回 []）。
 * roleActivityCapabilities 路徑：A35 的 docId 是 roleKey，使用者 capability 固定讀 roleActivityCapabilities/user。
 */
export async function loadViewer(uid: string): Promise<ViewerView> {
  if (!uid) return createGuestViewer();

  const firebase = await getFirebase();
  const db = firebase.db as unknown as Firestore;

  // 1. users/{uid}（找不到或失敗都以預設處理；不擋瀏覽）
  let userInfo = defaultUserInfo();
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) {
      userInfo = parseUserInfo(userSnap.data() as Record<string, unknown> | undefined);
    }
  } catch (err) {
    warnOnce('users', err);
  }

  const role = userInfo.role;

  // 2~5. rolePermissions / userPermissionGrants / roleActivityCapabilities / customRoles / teams
  const roleDocPromise: Promise<DocResult> = role === 'user'
    ? Promise.resolve({ ok: true, data: null })
    : safeGetDoc(getDoc(doc(db, 'rolePermissions', role)));

  const capDocPromise: Promise<DocResult> = role === 'user'
    ? safeGetDoc(getDoc(doc(db, 'roleActivityCapabilities', 'user')))
    : Promise.resolve({ ok: true, data: null });

  const [roleRes, grantRes, capRes, customRoles, teamIds] = await Promise.all([
    roleDocPromise,
    safeGetDoc(getDoc(doc(db, 'userPermissionGrants', uid))),
    capDocPromise,
    loadCustomRoles(db),
    loadTeamIdsForUser(db, uid, userInfo.teamIds),
  ]);

  if (!roleRes.ok) warnOnce('rolePermissions', roleRes.error);
  if (!grantRes.ok) warnOnce('userPermissionGrants', grantRes.error);
  if (!capRes.ok) warnOnce('roleActivityCapabilities', capRes.error);

  const rolePermList = parseRolePermissions(roleRes.ok ? roleRes.data : null);
  const grants = parseUserGrantCodes(grantRes.ok ? grantRes.data : null, uid);
  const capabilities = parseCapabilities(capRes.ok ? capRes.data : null);

  const hasPermission = createPermissionChecker({
    role,
    rolePermissions: { [role]: rolePermList },
    userGrants: grants,
  });
  const roleLevel = getRoleLevel(role, customRoles);

  return {
    uid,
    teamIds,
    hasPermission,
    roleLevel,
    role,
    displayName: userInfo.displayName,
    pictureUrl: userInfo.pictureUrl,
    capabilities,
  };
}

/* ── 可測試的請求序號防護 ── */

/**
 * 建立依序號守衛的載入器。回傳的函式可重複呼叫，只有最新一次呼叫的結果會被 `onChange`。
 *
 * UID 改變：立即送出 createMinimalViewer(nextUid)，再載入完整資料；新 UID 失敗時維持最小權限暫態。
 * 同一 UID 重新整理：不先清空，失敗時保留上一份完整資料。
 */
export function createViewerLoader(
  load: (uid: string) => Promise<ViewerView>,
  onChange: (viewer: ViewerView) => void,
): (uid: string | null) => void {
  let seq = 0;
  let lastUid: string | null = null;

  return (uid: string | null): void => {
    const current = ++seq;
    if (!uid) {
      lastUid = null;
      onChange(createGuestViewer());
      return;
    }

    if (uid !== lastUid) {
      lastUid = uid;
      onChange(createMinimalViewer(uid));
    }

    load(uid)
      .then((next) => {
        if (current !== seq) return; // stale：舊結果直接丟棄
        onChange(next);
      })
      .catch((err: unknown) => {
        if (current !== seq) return;
        // 新 UID：最小權限暫態已送出，維持不動。
        // 同一 UID：保留上一份完整資料。
        // eslint-disable-next-line no-console
        console.warn('[viewer] load failed', err);
      });
  };
}

/* ── Preact hook ── */

/**
 * 訂閱 `auth:changed` 並依序號防護載入 Viewer。
 * 初始化補讀 getCurrentUser 與 auth:changed 共用 authVersion；較舊的補讀回應不得覆蓋較新事件。
 */
export function useViewer(): ViewerView {
  const [viewer, setViewer] = useState<ViewerView>(() => createGuestViewer());

  useEffect(() => {
    const loader = createViewerLoader(loadViewer, setViewer);
    let authVersion = 0;

    // L-04：先訂閱，避免 render→effect 之間的 auth 變更漏接。
    const off = on('auth:changed', ({ uid }) => {
      authVersion += 1;
      loader(uid);
    });

    // L-04：訂閱後補讀一次目前值；若補讀期間已有較新 auth 事件，忽略本次回應。
    const initialVersion = authVersion;
    getCurrentUser()
      .then((current) => {
        if (authVersion !== initialVersion) return;
        loader(current ? current.uid : null);
      })
      .catch(() => {
        if (authVersion !== initialVersion) return;
        loader(null);
      });

    return () => {
      off();
    };
  }, []);

  return viewer;
}
