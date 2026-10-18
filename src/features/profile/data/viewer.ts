/**
 * FC-B Viewer 資料層。
 *
 * V 階段：
 * - teamIds 由 computeVisibleTeamIds 計算，保留 leaderUids 優先序。
 * - 私密列表 roleLevel 僅使用內建角色，不讀 customRoles。
 * - R-ID-002：adminUsers 僅允許 UID 精確匹配，不比對 name。
 *
 * 既有 hasPermission 與 capabilities 的載入行為保持原樣；
 * 本次不實作或擴充 rolePermissions / userPermissionGrants 規則。
 * ViewerContext 與 useViewer() 簽名不變。
 */

import { useEffect, useState } from 'preact/hooks';
import type { Firestore, Query } from 'firebase/firestore';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import { getCurrentUser } from '@/data/auth';
import { emit, on } from '@/core/events';
import type { ViewerContext } from '@/features/events/data/types';

import { createPermissionChecker, normalizePermissionCode } from './permissions';
import {
  computeVisibleTeamIds,
  getPrivateListRoleLevel,
  type VisibilityTeamDoc,
  type VisibilityUserDoc,
} from './viewer-visibility';

export interface ViewerView extends ViewerContext {
  role: string;
  displayName: string | null;
  pictureUrl: string | null;
  capabilities: readonly string[];
}

const EMPTY_TEAM_IDS: ReadonlySet<string> = new Set<string>();
const EMPTY_CAPABILITIES: readonly string[] = Object.freeze([]);

function alwaysFalse(): boolean {
  return false;
}

export function createGuestViewer(): ViewerView {
  return {
    uid: null,
    teamIds: EMPTY_TEAM_IDS,
    hasPermission: alwaysFalse,
    roleLevel: getPrivateListRoleLevel('guest'),
    role: 'guest',
    displayName: null,
    pictureUrl: null,
    capabilities: EMPTY_CAPABILITIES,
  };
}

export function createMinimalViewer(uid: string): ViewerView {
  return {
    uid,
    teamIds: EMPTY_TEAM_IDS,
    hasPermission: alwaysFalse,
    roleLevel: getPrivateListRoleLevel('user'),
    role: 'user',
    displayName: null,
    pictureUrl: null,
    capabilities: EMPTY_CAPABILITIES,
  };
}

const warnedKeys = new Set<string>();

function warnOnce(key: string, err: unknown): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[viewer] failed to read ${key}`, err);
}

interface UserInfo {
  role: string;
  displayName: string | null;
  pictureUrl: string | null;
}

function defaultUserInfo(): UserInfo {
  return { role: 'user', displayName: null, pictureUrl: null };
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

  return { role, displayName, pictureUrl };
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

function parseRolePermissions(data: Record<string, unknown> | null): string[] {
  return data ? sanitizePermissionCodeList(data.permissions) : [];
}

function parseUserGrantCodes(data: Record<string, unknown> | null, uid: string): string[] {
  if (!data || data.enabled === false) return [];
  if (String(data.uid || '').trim() !== uid) return [];
  const raw = Array.isArray(data.permissions) ? data.permissions : [];
  const out: string[] = [];
  for (const code of raw) {
    if (typeof code !== 'string') continue;
    const trimmed = code.trim();
    if (!trimmed || normalizePermissionCode(trimmed) !== trimmed) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

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

/**
 * 查詢僅取得候選隊伍，不能直接將命中文件 ID 視為可見：
 * leaderUid 查詢可能命中具有不同 leaderUids 陣列的舊文件。
 * 必須保留完整幹部欄位，交給純函式再次判定。
 */
async function loadTeamIdsForUser(
  db: Firestore,
  uid: string,
  userDoc: VisibilityUserDoc | null,
): Promise<Set<string>> {
  if (!userDoc) return computeVisibleTeamIds(uid, null, []);

  const runTeamQuery = async (
    label: string,
    teamQuery: Query,
  ): Promise<VisibilityTeamDoc[]> => {
    try {
      const snap = await getDocs(teamQuery);
      return snap.docs.map((snapshot): VisibilityTeamDoc => {
        const data = snapshot.data() as Record<string, unknown>;
        return {
          // 保留 public id；沒有 id 欄位時才使用 Firestore document ID。
          id: data.id ?? snapshot.id,
          captainUid: data.captainUid,
          leaderUids: data.leaderUids,
          leaderUid: data.leaderUid,
          coachUids: data.coachUids,
        };
      });
    } catch (err) {
      warnOnce(label, err);
      return [];
    }
  };

  const loadAdminUser = async (): Promise<VisibilityUserDoc | null> => {
    try {
      const snap = await getDocs(
        query(collection(db, 'adminUsers'), where('uid', '==', uid)),
      );
      // A 使用 find，只取第一個相符文件；不得聯集所有重複 UID 文件。
      for (const snapshot of snap.docs) {
        const data = snapshot.data() as Record<string, unknown>;
        if (data.uid !== uid) continue;
        return {
          uid: data.uid,
          teamIds: data.teamIds,
          teamId: data.teamId,
        };
      }
      return null;
    } catch (err) {
      warnOnce('adminUsers', err);
      return null;
    }
  };

  const [captains, legacyLeaders, leaders, coaches, adminUser] = await Promise.all([
    runTeamQuery(
      'teams.captainUid',
      query(collection(db, 'teams'), where('captainUid', '==', uid)),
    ),
    runTeamQuery(
      'teams.leaderUid',
      query(collection(db, 'teams'), where('leaderUid', '==', uid)),
    ),
    runTeamQuery(
      'teams.leaderUids',
      query(collection(db, 'teams'), where('leaderUids', 'array-contains', uid)),
    ),
    runTeamQuery(
      'teams.coachUids',
      query(collection(db, 'teams'), where('coachUids', 'array-contains', uid)),
    ),
    loadAdminUser(),
  ]);

  const ids = computeVisibleTeamIds(
    uid,
    userDoc,
    [...captains, ...legacyLeaders, ...leaders, ...coaches],
  );

  // R-ID-002：僅補入 UID 精確匹配的 adminUsers 文件，不比對名稱。
  for (const id of computeVisibleTeamIds(uid, adminUser, [])) ids.add(id);
  return ids;
}

/**
 * uid 為空時視為訪客。
 * 既有 permission / capability 載入維持原行為。
 * 可見性不使用 customRoles，因此不再為 roleLevel 讀取 customRoles。
 */
export async function loadViewer(uid: string): Promise<ViewerView> {
  if (!uid) return createGuestViewer();

  const firebase = await getFirebase();
  const db = firebase.db as unknown as Firestore;

  let userData: Record<string, unknown> | null = null;
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) {
      userData = (userSnap.data() as Record<string, unknown> | undefined) ?? null;
    }
  } catch (err) {
    warnOnce('users', err);
  }

  const userInfo = parseUserInfo(userData);
  const visibilityUser: VisibilityUserDoc | null = userData
    ? { uid, teamIds: userData.teamIds, teamId: userData.teamId }
    : null;
  const role = userInfo.role;

  const roleDocPromise: Promise<DocResult> = role === 'user'
    ? Promise.resolve({ ok: true, data: null })
    : safeGetDoc(getDoc(doc(db, 'rolePermissions', role)));

  const capDocPromise: Promise<DocResult> = role === 'user'
    ? safeGetDoc(getDoc(doc(db, 'roleActivityCapabilities', 'user')))
    : Promise.resolve({ ok: true, data: null });

  const [roleRes, grantRes, capRes, teamIds] = await Promise.all([
    roleDocPromise,
    safeGetDoc(getDoc(doc(db, 'userPermissionGrants', uid))),
    capDocPromise,
    loadTeamIdsForUser(db, uid, visibilityUser),
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

  return {
    uid,
    teamIds,
    hasPermission,
    roleLevel: getPrivateListRoleLevel(role),
    role,
    displayName: userInfo.displayName,
    pictureUrl: userInfo.pictureUrl,
    capabilities,
  };
}

/**
 * 只有最新請求可以提交。
 * UID 改變立即送出最小權限；同 UID 載入失敗保留上一份快照。
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
        if (current !== seq) return;
        onChange(next);
      })
      .catch((err: unknown) => {
        if (current !== seq) return;
        // eslint-disable-next-line no-console
        console.warn('[viewer] load failed', err);
      });
  };
}

/** 通知所有 useViewer 重讀目前使用者（例如加入／退出俱樂部後更新 teamIds）。 */
export function requestViewerRefresh(): void {
  emit('viewer:refresh', {});
}

/** 先訂閱再補讀；舊補讀結果不得覆蓋新登入事件。 */
export function useViewer(): ViewerView {
  const [viewer, setViewer] = useState<ViewerView>(() => createGuestViewer());

  useEffect(() => {
    const loader = createViewerLoader(loadViewer, setViewer);
    let authVersion = 0;
    // 最後已知的登入 uid（undefined = 尚未確定），供 viewer:refresh 重讀同一帳號。
    let knownUid: string | null | undefined;

    const off = on('auth:changed', ({ uid }) => {
      authVersion += 1;
      knownUid = uid;
      loader(uid);
    });

    const initialVersion = authVersion;
    getCurrentUser()
      .then((current) => {
        if (authVersion !== initialVersion) return;
        knownUid = current ? current.uid : null;
        loader(knownUid);
      })
      .catch(() => {
        if (authVersion !== initialVersion) return;
        knownUid = null;
        loader(null);
      });

    // 重讀目前登入者；同一個 loader 的序號保護確保較舊的結果不會覆蓋較新的。
    // 登入狀態尚未確定時忽略（初次讀取完成後自然會載入）。
    const offRefresh = on('viewer:refresh', () => {
      if (knownUid !== undefined) loader(knownUid);
    });

    return () => {
      off();
      offRefresh();
    };
  }, []);

  return viewer;
}
