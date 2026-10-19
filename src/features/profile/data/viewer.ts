/**
 * FC-B Viewer 資料層。
 *
 * V 階段：
 * - teamIds 由 computeVisibleTeamIds 計算，保留 leaderUids 優先序。
 * - 私密列表 roleLevel 僅使用內建角色，不讀 customRoles。
 * - R-ID-002：adminUsers 僅允許 UID 精確匹配，不比對 name。
 *
 * P 階段：
 * - 透過 buildPermissionCheckerInput + createPermissionChecker 對齊 A 的完整後台權限語意。
 * - 角色非 user 時讀 rolePermissions/{role}（meta 的 defaultPermissions 也在同一份文件）；文件不存在時用預設，有文件且 permissions: [] 為明確全關。
 * - 角色非內建角色時讀 customRoles。
 * ViewerContext 與 useViewer() 簽名不變。
 */

import { useEffect, useState } from 'preact/hooks';
import type { Firestore, Query } from 'firebase/firestore';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import { getCurrentUser } from '@/data/auth';
import { emit, on } from '@/core/events';
import type { ViewerContext } from '@/features/events/data/types';

import {
  buildPermissionCheckerInput,
  createPermissionChecker,
  isBuiltinRole,
} from './permissions';
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

// ASSUMPTION: A 的 FirebaseService 讀取 customRoles 集合路徑為 'customRoles'（與 _cache.customRoles 對應）。
async function loadCustomRolesForRole(
  db: Firestore,
  role: string,
): Promise<Record<string, unknown>[]> {
  if (isBuiltinRole(role)) return [];
  try {
    const snap = await getDocs(collection(db, 'customRoles'));
    return snap.docs.map((snapshot): Record<string, unknown> => {
      const data = snapshot.data() as Record<string, unknown>;
      return {
        _docId: snapshot.id,
        id: data.id ?? snapshot.id,
        key: data.key ?? data.roleKey ?? snapshot.id,
        ...data,
      };
    });
  } catch (err) {
    warnOnce('customRoles', err);
    return [];
  }
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
 * 角色非 user 時讀 rolePermissions/{role}（含 defaultPermissions）；
 * 角色非內建角色時讀 customRoles。
 * 可見性 roleLevel 維持使用內建角色 getPrivateListRoleLevel(role)。
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

  const customRolesPromise: Promise<Record<string, unknown>[]> = isBuiltinRole(role)
    ? Promise.resolve([])
    : loadCustomRolesForRole(db, role);

  const [roleRes, grantRes, capRes, customRoles, teamIds] = await Promise.all([
    roleDocPromise,
    safeGetDoc(getDoc(doc(db, 'userPermissionGrants', uid))),
    capDocPromise,
    customRolesPromise,
    loadTeamIdsForUser(db, uid, visibilityUser),
  ]);

  if (!roleRes.ok) warnOnce('rolePermissions', roleRes.error);
  if (!grantRes.ok) warnOnce('userPermissionGrants', grantRes.error);
  if (!capRes.ok) warnOnce('roleActivityCapabilities', capRes.error);

  const rolePermissionDocs = roleRes.ok && roleRes.data !== null
    ? { [role]: roleRes.data }
    : {};
  // A 沒有獨立的 rolePermissionMeta 集合：FirebaseService 從 rolePermissions 文件（defaultPermissions 欄位）整理出 meta，這裡沿用同一份文件。
  const rolePermissionMetaDocs = rolePermissionDocs;
  const grantDoc = grantRes.ok ? grantRes.data : null;
  const capabilities = parseCapabilities(capRes.ok ? capRes.data : null);

  const checkerInput = buildPermissionCheckerInput({
    role,
    rolePermissionDocs,
    rolePermissionMetaDocs,
    grantDoc,
    uid,
    customRoles,
  });
  const hasPermission = createPermissionChecker(checkerInput);

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
