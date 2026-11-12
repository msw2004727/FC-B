/**
 * FC-B Viewer 資料層。
 *
 * V 階段：
 * - teamIds 由 computeVisibleTeamIds 計算，保留 leaderUids 優先序。
 * - 私密列表 roleLevel 僅使用內建角色，不讀 customRoles。
 * - teamIds 來自 users/{uid} 與隊伍查詢（computeVisibleTeamIds）。不查 adminUsers：Rules 沒有 match，查了一定被拒。
 *
 * P 階段：
 * - 透過 buildPermissionCheckerInput + createPermissionChecker 對齊 A 的完整後台權限語意。
 * - 角色非 user 時讀 rolePermissions/{role}（meta 的 defaultPermissions 也在同一份文件）；文件不存在時用預設，有文件且 permissions: [] 為明確全關。
 * - 角色非內建角色時讀 customRoles。
 * ViewerContext 與 useViewer() 簽名不變。
 * - M-038：暴露 isRestricted 供底部分頁與換頁攔截「帳號限制中」。
 * - 全站 useViewer（含 App 的 ViewerAccessBridge 與各頁）共用一份模組快取與 inflight，不各打一輪讀取。
 */

import { useEffect, useState } from 'preact/hooks';
import type { DocumentSnapshot, Firestore, Query } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import { getCurrentUser } from '@/data/auth';
import { emit, on } from '@/core/events';
import type { ViewerContext } from '@/features/events/data/types';
import { getStaffTeams, type StaffTeamCandidate, type StaffTeamOption } from '@/features/events/data/team-staff';

import {
  buildPermissionCheckerInput,
  createPermissionChecker,
  getDefaultRoleActivityCapabilities,
  isBuiltinRole,
  type CustomRole,
} from './permissions';
import {
  computeVisibleTeamIds,
  getPrivateListRoleLevel,
  type VisibilityUserDoc,
} from './viewer-visibility';

/** 動作層（例如建立活動）需要的原始權限來源；與 hasPermission 同一份資料。 */
export interface ViewerPermissionSources {
  /** null＝角色權限文件不存在（用預設）；[]＝文件存在但全關。 */
  rolePermissions: readonly string[] | null;
  /** 已驗證 uid／enabled 的個別授權碼。 */
  userGrants: readonly string[];
  customRoles: readonly CustomRole[];
}

export interface ViewerView extends ViewerContext {
  /** T-074：重用四個既有 teams 查詢；缺省時視為無職員俱樂部。 */
  staffTeams?: readonly StaffTeamOption[];
  role: string;
  displayName: string | null;
  pictureUrl: string | null;
  capabilities: readonly string[];
  /** M-038：帳號是否受限（照 A `user.isRestricted === true`）。 */
  isRestricted?: boolean;
  /** 選填：測試替身可省略，使用端視為「無任何權限來源」。 */
  permissionSources?: ViewerPermissionSources;
  /**
   * L-43：true＝開頁時登入狀態還在還原（Auth 尚未判定），uid 為 null 不代表訪客，頁面要顯示載入中、不得顯示「尚未登入」。
   * 確定是訪客或已有 uid 時省略；測試替身省略＝已判定。
   */
  authPending?: boolean;
}

const EMPTY_PERMISSION_SOURCES: ViewerPermissionSources = Object.freeze({
  rolePermissions: null,
  userGrants: Object.freeze([]) as readonly string[],
  customRoles: Object.freeze([]) as readonly CustomRole[],
});

const EMPTY_TEAM_IDS: ReadonlySet<string> = new Set<string>();
const EMPTY_CAPABILITIES: readonly string[] = Object.freeze([]);

function alwaysFalse(): boolean {
  return false;
}

export function createGuestViewer(): ViewerView {
  return {
    uid: null,
    teamIds: EMPTY_TEAM_IDS,
    staffTeams: [],
    hasPermission: alwaysFalse,
    roleLevel: getPrivateListRoleLevel('guest'),
    role: 'guest',
    displayName: null,
    pictureUrl: null,
    capabilities: EMPTY_CAPABILITIES,
    isRestricted: false,
    permissionSources: EMPTY_PERMISSION_SOURCES,
  };
}

/** 登入狀態尚未判定時的快照：權限同訪客，但標記 authPending，頁面不得把它當成「確定未登入」。 */
function createAuthPendingViewer(): ViewerView {
  return { ...createGuestViewer(), authPending: true };
}

export function createMinimalViewer(uid: string): ViewerView {
  return {
    uid,
    teamIds: EMPTY_TEAM_IDS,
    staffTeams: [],
    hasPermission: alwaysFalse,
    roleLevel: getPrivateListRoleLevel('user'),
    role: 'user',
    displayName: null,
    pictureUrl: null,
    capabilities: EMPTY_CAPABILITIES,
    isRestricted: false,
    permissionSources: EMPTY_PERMISSION_SOURCES,
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
  isRestricted: boolean;
}

function defaultUserInfo(): UserInfo {
  return { role: 'user', displayName: null, pictureUrl: null, isRestricted: false };
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

  const isRestricted = data.isRestricted === true;

  return { role, displayName, pictureUrl, isRestricted };
}

/**
 * T-090：對齊 A `ApiService.getRoleActivityCapabilities` 與 viewer-operate.ts：
 * 只有 role=user 才有前台活動能力；讀取失敗＝空（fail-closed，不顯示入口）；
 * 文件不存在或 capabilities 不是陣列＝預設清單（取代原本文件不存在回 []，與 A／Rules／Functions 預設不一致）。
 */
function parseCapabilities(role: string, res: DocResult): string[] {
  if (role !== 'user' || !res.ok) return [];
  const data = res.data;
  if (!data || !Array.isArray(data.capabilities)) {
    return getDefaultRoleActivityCapabilities('user');
  }
  const raw: unknown[] = data.capabilities;
  const out: string[] = [];
  for (const code of raw) {
    if (typeof code !== 'string' || !code) continue;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

/**
 * Firestore SDK 用到時才載入：viewer 在 App 首屏的靜態引用鏈上，靜態 import 會讓首屏等整包 SDK（壓縮後約 160KB）下載與執行完。
 * 2026-10-20 由頂層 import 改為 loadViewer 內動態載入。
 */
type FirestoreApi = typeof import('firebase/firestore');

type DocResult =
  | { ok: true; data: Record<string, unknown> | null }
  | { ok: false; error: unknown };

function safeGetDoc(promise: Promise<DocumentSnapshot>): Promise<DocResult> {
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
  fs: FirestoreApi,
  db: Firestore,
  role: string,
): Promise<Record<string, unknown>[]> {
  const { collection, getDocs } = fs;
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
async function loadTeamsForUser(
  fs: FirestoreApi,
  db: Firestore,
  uid: string,
  userDoc: VisibilityUserDoc | null,
): Promise<{ teamIds: Set<string>; staffTeams: StaffTeamOption[] }> {
  const { collection, getDocs, query, where } = fs;
  if (!userDoc) return { teamIds: computeVisibleTeamIds(uid, null, []), staffTeams: [] };

  const runTeamQuery = async (
    label: string,
    teamQuery: Query,
  ): Promise<StaffTeamCandidate[]> => {
    try {
      const snap = await getDocs(teamQuery);
      return snap.docs.map((snapshot): StaffTeamCandidate => {
        const data = snapshot.data() as Record<string, unknown>;
        return {
          // 保留 public id；沒有 id 欄位時才使用 Firestore document ID。
          id: data.id ?? snapshot.id,
          name: data.name,
          teamName: data.teamName,
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

  const [captains, legacyLeaders, leaders, coaches] = await Promise.all([
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
  ]);

  const candidates = [...captains, ...legacyLeaders, ...leaders, ...coaches];
  const ids = computeVisibleTeamIds(
    uid,
    userDoc,
    candidates,
  );
  return { teamIds: ids, staffTeams: getStaffTeams(uid, candidates) };
}

/**
 * uid 為空時視為訪客。
 * 角色非 user 時讀 rolePermissions/{role}（含 defaultPermissions）；
 * 角色非內建角色時讀 customRoles。
 * 可見性 roleLevel 用 getPrivateListRoleLevel(role, customRoles)，與 A 的 ROLE_LEVEL_MAP Proxy 一致。
 */
export async function loadViewer(uid: string): Promise<ViewerView> {
  if (!uid) return createGuestViewer();

  const [firebase, fs] = await Promise.all([getFirebase(), import('firebase/firestore')]);
  const db = firebase.db as unknown as Firestore;
  const { doc, getDoc } = fs;

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
    : loadCustomRolesForRole(fs, db, role);

  const [roleRes, grantRes, capRes, customRoles, teams] = await Promise.all([
    roleDocPromise,
    safeGetDoc(getDoc(doc(db, 'userPermissionGrants', uid))),
    capDocPromise,
    customRolesPromise,
    loadTeamsForUser(fs, db, uid, visibilityUser),
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
  const capabilities = parseCapabilities(role, capRes);

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
    teamIds: teams.teamIds,
    staffTeams: teams.staffTeams,
    hasPermission,
    roleLevel: getPrivateListRoleLevel(role, checkerInput.customRoles),
    role,
    displayName: userInfo.displayName,
    pictureUrl: userInfo.pictureUrl,
    capabilities,
    isRestricted: userInfo.isRestricted,
    permissionSources: {
      rolePermissions: checkerInput.rolePermissions?.[role] ?? null,
      userGrants: checkerInput.userGrants ?? [],
      customRoles: checkerInput.customRoles ?? [],
    },
  };
}

/**
 * 只有最新請求可以提交。
 * UID 改變立即送出最小權限；同 UID 載入失敗保留上一份快照。
 * useViewer 不再各建一條 loader；全站共用作下方模組快取。此函式保留給自訂 load 與測試。
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

/**
 * 全站一份 viewer。做法是模組層單例加 inflight，不是 React context：
 * 各頁與 ViewerAccessBridge 仍呼叫 useViewer，但不各開一輪 Firestore。
 *
 * L-43：uid 一變立刻改送該 uid 的最小權限（清掉前一個人的權限），序號對不上的結果丟棄。
 * L-08：這次請求成功或失敗都清掉 inflight；失敗不留被拒絕的 Promise，下次才能重試。
 * 同 uid 已在飛的非強制讀取合併成同一筆；viewer:refresh 只有這一個 listener，所以只重讀一次。
 * 同 uid 重讀失敗保留上一份完整快照；換 uid 後失敗則停在最小權限。
 */
type ViewerListener = (viewer: ViewerView) => void;

interface ViewerSubscription {
  authVersion: number;
  /** undefined＝登入狀態尚未確定，此時 viewer:refresh 不讀。 */
  knownUid: string | null | undefined;
  stop: () => void;
}

const viewerListeners = new Set<ViewerListener>();
let viewerSnapshot: ViewerView = createAuthPendingViewer();
let viewerUid: string | null = null;
let viewerGeneration = 0;
let viewerInflight: Promise<void> | null = null;
let viewerInflightUid: string | null = null;
let viewerLoadFailed = false;
let viewerLive: ViewerSubscription | null = null;

function publishViewer(next: ViewerView): void {
  viewerSnapshot = next;
  viewerUid = next.uid;
  for (const listener of [...viewerListeners]) listener(next);
}

function settleViewerInflight(run: Promise<void>): void {
  if (viewerInflight === run) {
    viewerInflight = null;
    viewerInflightUid = null;
  }
}

function beginViewerLoad(uid: string | null, force: boolean): void {
  if (!uid) {
    viewerGeneration += 1;
    viewerInflight = null;
    viewerInflightUid = null;
    viewerLoadFailed = false;
    // 判定未登入：之前是別人或還在「尚未判定」都要發一次確定的訪客快照，頁面才會從載入中換成未登入畫面。
    if (viewerUid !== null || viewerSnapshot.authPending) publishViewer(createGuestViewer());
    return;
  }

  if (uid !== viewerUid) {
    viewerLoadFailed = false;
    publishViewer(createMinimalViewer(uid));
  }

  // 同一 uid 已在讀：後到的掛載／補讀合併，不再開一輪。refresh 必須重讀，不合併。
  if (!force && viewerInflight && viewerInflightUid === uid) return;

  const generation = ++viewerGeneration;
  viewerLoadFailed = false;
  const run = loadViewer(uid).then(
    (next) => {
      settleViewerInflight(run);
      if (generation !== viewerGeneration) return;
      if (!viewerLive || viewerLive.knownUid !== uid) return;
      if (next.uid !== uid) return;
      viewerLoadFailed = false;
      publishViewer(next);
    },
    (err: unknown) => {
      // L-08：失敗路徑也要清，且只能清掉自己這筆，不能清掉較新的請求。
      settleViewerInflight(run);
      if (generation !== viewerGeneration) return;
      viewerLoadFailed = true;
      // eslint-disable-next-line no-console
      console.warn('[viewer] load failed', err);
    },
  );
  viewerInflight = run;
  viewerInflightUid = uid;
}

/** Auth 還原的等待上限（同 data/firebase.ts 首頁暫緩 Auth 的整體上限）；逾時視為訪客，頁面不會永遠停在載入中。 */
const AUTH_SETTLE_MAX_MS = 10_000;

/**
 * 「確定」的登入 uid。currentUser 有值就是它；為 null 時可能只是 Auth 還在還原
 * （有登入旗標但還原超過 data/firebase.ts 的 3 秒閘門），要等 authStateReady() 之後才算確定是訪客（L-43）。
 */
async function readSettledAuthUid(): Promise<string | null> {
  const current = await getCurrentUser();
  if (current) return current.uid;
  const { auth } = await getFirebase();
  const restorable = auth as (typeof auth & { authStateReady?: () => Promise<void> }) | undefined;
  if (typeof restorable?.authStateReady !== 'function') return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      restorable.authStateReady(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, AUTH_SETTLE_MAX_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return restorable.currentUser?.uid ?? null;
}

function ensureViewerSubscription(): void {
  if (viewerLive) return;
  const state: ViewerSubscription = {
    authVersion: 0,
    knownUid: undefined,
    stop: () => undefined,
  };
  viewerLive = state;

  const offAuth = on('auth:changed', ({ uid }) => {
    state.authVersion += 1;
    state.knownUid = uid;
    beginViewerLoad(uid, false);
  });
  // 全站只掛一次：N 個 useViewer 收到同一個 viewer:refresh 也只重讀一次。
  const offRefresh = on('viewer:refresh', () => {
    if (state.knownUid !== undefined) beginViewerLoad(state.knownUid, true);
  });

  const initialVersion = state.authVersion;
  readSettledAuthUid()
    .then((uid) => {
      if (viewerLive !== state) return;
      if (state.authVersion !== initialVersion) return;
      state.knownUid = uid;
      beginViewerLoad(state.knownUid, false);
    })
    .catch(() => {
      if (viewerLive !== state) return;
      if (state.authVersion !== initialVersion) return;
      state.knownUid = null;
      beginViewerLoad(null, false);
    });

  state.stop = () => {
    offAuth();
    offRefresh();
    if (viewerLive === state) viewerLive = null;
    viewerGeneration += 1;
    viewerInflight = null;
    viewerInflightUid = null;
    viewerLoadFailed = false;
  };
}

function resetViewerIdle(): void {
  viewerLive?.stop();
  viewerSnapshot = createAuthPendingViewer();
  viewerUid = null;
  viewerLoadFailed = false;
}

function releaseViewerSubscription(): void {
  if (viewerListeners.size > 0) return;
  resetViewerIdle();
}

/** 測試用：清掉共用快取、inflight 與登入訂閱，避免案例互相殘留權限。 */
export function resetViewerCacheForTest(): void {
  viewerListeners.clear();
  resetViewerIdle();
}

/** 先訂閱再補讀目前快照（L-04）。登入訂閱全站一份；沒有訂閱者時卸下並還原訪客。 */
export function useViewer(): ViewerView {
  const [viewer, setViewer] = useState<ViewerView>(() => viewerSnapshot);

  useEffect(() => {
    viewerListeners.add(setViewer);
    // render 與 effect 之間快照可能已換人，訂閱後再讀一次。
    setViewer(viewerSnapshot);
    ensureViewerSubscription();
    if (viewerLoadFailed && viewerLive?.knownUid && viewerInflight === null) {
      beginViewerLoad(viewerLive.knownUid, false);
    }
    return () => {
      viewerListeners.delete(setViewer);
      releaseViewerSubscription();
    };
  }, []);

  return viewer;
}
