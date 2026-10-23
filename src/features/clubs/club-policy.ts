import {
  canEditTeamByRoleOrCaptain,
  canManageTeamMembers,
  getTeamStaffIdentity,
} from './data/team-detail-model';
import type { ClubViewer as ClubMemberViewer, TeamDoc } from './data/types';

/** M-119：俱樂部詳情是否要求登入（照 A js/modules/team/team-detail.js:997-1000）；改成 false 即開放訪客。 */
export const CLUB_DETAIL_REQUIRES_LOGIN = true;

/** M-117：加入申請「審核中」與「被拒絕」冷卻毫秒數（照 A js/modules/team/team-form-join.js _TEAM_JOIN_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000）。 */
export const JOIN_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** 只取判斷需要的最小欄位，與 useViewer() 的 ViewerView 相容（uid 為 null 代表訪客）。 */
export interface ClubViewer {
  readonly uid: string | null;
}

/**
 * 訪客是否可開啟俱樂部詳情。
 * - requiresLogin 預設取 CLUB_DETAIL_REQUIRES_LOGIN；參數存在只為了單元測試可覆蓋兩種設定。
 * - requiresLogin 為 false：任何人（含訪客）可看。
 * - requiresLogin 為 true：uid 為非空字串（trim 後長度 > 0）才可看；null、undefined、空字串、純空白都視為訪客。
 * - 身分只看 uid（R-ID-002），不看 displayName。
 */
export function canViewClubDetail(
  viewer: ClubViewer | null | undefined,
  requiresLogin: boolean = CLUB_DETAIL_REQUIRES_LOGIN,
): boolean {
  if (!requiresLogin) {
    return true;
  }

  const uid = viewer?.uid;
  return typeof uid === 'string' && uid.trim().length > 0;
}

/** 詳情存取判定：allowed＝可載入並顯示；pending＝登入狀態尚未到位，只顯示載入中、不載入資料也不要求登入；login-required＝已確定是訪客且政策要求登入，顯示閘門。 */
export type ClubDetailAccess = 'allowed' | 'pending' | 'login-required';

/**
 * @param viewer useViewer() 的目前值（只看 uid）。
 * @param authUid 登入狀態的同步讀值：undefined＝尚未確定、null＝確定是訪客、字串＝確定已登入（來源 getLastKnownAuthUid()，本檔不 import 它，由呼叫端傳入）。
 * @param requiresLogin 預設取 CLUB_DETAIL_REQUIRES_LOGIN，參數只為了測試可覆蓋。
 */
export function resolveClubDetailAccess(
  viewer: ClubViewer | null | undefined,
  authUid: string | null | undefined,
  requiresLogin: boolean = CLUB_DETAIL_REQUIRES_LOGIN,
): ClubDetailAccess {
  if (canViewClubDetail(viewer, requiresLogin)) {
    return 'allowed';
  }

  return authUid === null ? 'login-required' : 'pending';
}

/** 申請是否仍在「審核中」冷卻期內（照 A：now - sentAt < 冷卻）。sentAt 非有限正數、或比 now 晚超過一個冷卻期（時鐘錯亂／損毀資料）視為否。 */
export function isJoinRequestPending(sentAtMs: number, nowMs: number = Date.now()): boolean {
  return Number.isFinite(sentAtMs)
    && sentAtMs > 0
    && nowMs - sentAtMs < JOIN_REQUEST_COOLDOWN_MS
    && sentAtMs - nowMs <= JOIN_REQUEST_COOLDOWN_MS;
}

/** 剩餘小時，照 A：Math.max(1, Math.ceil((冷卻 - (now - sentAt)) / 3600000))。 */
export function getJoinRequestHoursLeft(sentAtMs: number, nowMs: number = Date.now()): number {
  return Math.max(1, Math.ceil((JOIN_REQUEST_COOLDOWN_MS - (nowMs - sentAtMs)) / 3600000));
}

/** 檢查登入 UID；保留資料層既有的 UID 比對語意，不以顯示名稱辨識身分。 */
function isMemberViewerLoggedIn(
  viewer: ClubMemberViewer | null | undefined,
): viewer is ClubMemberViewer & { uid: string } {
  return typeof viewer?.uid === 'string' && viewer.uid.trim().length > 0;
}

/**
 * 成員管理入口與 handler 共用守衛。
 * 對應 A `_canManageTeamMembers`（js/modules/team/team-list-helpers.js:245-254）。
 * 僅球經、領隊陣列與教練陣列可管理，不退回 legacy leaderUid。
 */
export function canManageMembers(
  viewer: ClubMemberViewer | null | undefined,
  team: TeamDoc | null | undefined,
): boolean {
  if (!team || !isMemberViewerLoggedIn(viewer)) return false;
  return canManageTeamMembers(team, viewer);
}

/**
 * 只有球經、建立者、擁有者或具 team.manage_all 權限者可調整角色。
 * 對應 A `_canQuickPromoteTeamMember`（js/modules/team/team-detail.js）
 * → `_canEditTeamByRoleOrCaptain`（js/modules/team/team-list-helpers.js:229-232）。
 */
export function canChangeMemberRole(
  viewer: ClubMemberViewer | null | undefined,
  team: TeamDoc | null | undefined,
): boolean {
  if (!team || !isMemberViewerLoggedIn(viewer)) return false;
  return canEditTeamByRoleOrCaptain(team, viewer);
}

/**
 * 設定彈窗、封面與頭像共用守衛。
 * 對應 A `_canEditTeamByRoleOrCaptain`（js/modules/team/team-list-helpers.js:229-232）。
 */
export function canEditTeamSettings(
  viewer: ClubMemberViewer | null | undefined,
  team: TeamDoc | null | undefined,
): boolean {
  if (!team || !isMemberViewerLoggedIn(viewer)) return false;
  return canEditTeamByRoleOrCaptain(team, viewer);
}

/**
 * 備註編輯沿用成員管理權限。
 * 對應 A `editTeamMemberNote`（js/modules/team/team-detail.js）的
 * `_canManageTeamMembers` 守衛（js/modules/team/team-list-helpers.js:245-254）。
 */
export function canEditMemberNote(
  viewer: ClubMemberViewer | null | undefined,
  team: TeamDoc | null | undefined,
): boolean {
  return canManageMembers(viewer, team);
}

/**
 * 可管理成員者、建立者與擁有者可看私人備註；建立者與擁有者 UID 去除前後空白後比對。
 * 對應 A `_canViewTeamMemberPrivateNotes`（js/modules/team/team-detail-render.js:1654-1693）。
 * 移除名稱比對與 legacy leaderUid 回退，身分只採 UID。
 */
export function canViewMemberNote(
  viewer: ClubMemberViewer | null | undefined,
  team: TeamDoc | null | undefined,
): boolean {
  if (!team || !isMemberViewerLoggedIn(viewer)) return false;
  if (canManageMembers(viewer, team)) return true;
  const uid = viewer.uid.trim();
  return String(team.creatorUid ?? '').trim() === uid
    || String(team.ownerUid ?? '').trim() === uid;
}

/**
 * 邀請 QR 入口與 handler 共用守衛，沿用 B `canInviteToTeam`
 * （src/features/clubs/components/legacy/TeamDetailV2Header.tsx:63-76）。
 * 附件未提供對應 A 函式名稱；依指定 B 契約判斷球經、教練或允許邀請的成員。
 */
export function canShowInviteQr(
  viewer: ClubMemberViewer | null | undefined,
  team: TeamDoc | null | undefined,
): boolean {
  if (!team || !isMemberViewerLoggedIn(viewer)) return false;
  const uid = viewer.uid;
  const teamId = String(team.id ?? '').trim();
  const isMember = Boolean(teamId && viewer.teamIds.has(teamId));
  const isCaptain = String(team.captainUid ?? '').trim() === uid;
  const isCoach = Array.isArray(team.coachUids)
    && team.coachUids.some((id: unknown) => String(id ?? '').trim() === uid);
  return isCaptain
    || isCoach
    || (isMember && (team as Record<string, unknown>)['allowMemberInvite'] !== false);
}

/**
 * 僅計算是否可剔除一般隊員，不接 UI、不寫入文件。
 * 對應 A `_canManageTeamMembers`（js/modules/team/team-list-helpers.js:245-254）
 * 與 `_getTeamStaffIdentity`（js/modules/team/team-detail.js:158-167）的幹部保護規則。
 * 不允許剔除球經、領隊、教練或自己。
 */
export function canKickMember(
  viewer: ClubMemberViewer | null | undefined,
  team: TeamDoc | null | undefined,
  targetUid: string,
): boolean {
  if (!team || !isMemberViewerLoggedIn(viewer) || !canManageMembers(viewer, team)) {
    return false;
  }
  const uid = targetUid.trim();
  if (!uid || uid === viewer.uid.trim()) return false;
  const staff = getTeamStaffIdentity(team);
  return !staff.captainUids.has(uid)
    && !staff.leaderUids.has(uid)
    && !staff.coachUids.has(uid);
}

/** A 角色目標設定的 UID 版角色鍵，不包含不可升降的球經。 */
export type MemberRoleKey = 'member' | 'coach' | 'leader';

/** A `_getTeamMemberRoleActionTarget` 的升降方向。 */
export type MemberRoleDirection = 'promote' | 'demote';

/** A `_getTeamMemberRoleActionTarget` 的純資料結果。 */
export interface MemberRoleTarget {
  key: MemberRoleKey;
  level: 0 | 1 | 2;
  direction: MemberRoleDirection;
}

/** 將陣列去除空值、前後空白並保序去重；顯示名稱可選擇以小寫去重。 */
function uniqueMemberRoleValues(values: unknown, ignoreCase = false): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values as unknown[]) {
    const text = String(value || '').trim();
    const key = ignoreCase ? text.toLowerCase() : text;
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

/**
 * 依 team 文件中的 UID 計算升降目標，不使用名單列的角色字串。
 * 對應 A `_getTeamMemberRoleActionTarget`（js/modules/team/team-detail.js:1209-1239）
 * 與同檔 `_getCurrentTeamRoleLevel`；不允許自我升降或調整球經。
 */
export function getMemberRoleChangeTarget(
  viewer: ClubMemberViewer | null | undefined,
  team: TeamDoc | null | undefined,
  targetUid: string,
  direction: MemberRoleDirection,
): MemberRoleTarget | null {
  if (!team || !isMemberViewerLoggedIn(viewer) || !canChangeMemberRole(viewer, team)) {
    return null;
  }
  const uid = targetUid.trim();
  if (!uid || uid === viewer.uid.trim()) return null;
  if (String(team.captainUid ?? '').trim() === uid) return null;

  const currentLevel = uniqueMemberRoleValues(team.leaderUids).includes(uid)
    ? 2
    : uniqueMemberRoleValues(team.coachUids).includes(uid)
      ? 1
      : 0;
  const actorLevel = viewer.hasPermission('team.manage_all') ? 4 : 3;
  let target: MemberRoleTarget;
  if (direction === 'promote' && currentLevel === 0) {
    target = { key: 'coach', level: 1, direction };
  } else if (direction === 'promote' && currentLevel === 1) {
    target = { key: 'leader', level: 2, direction };
  } else if (direction === 'demote' && currentLevel === 2) {
    target = { key: 'coach', level: 1, direction };
  } else if (direction === 'demote' && currentLevel === 1) {
    target = { key: 'member', level: 0, direction };
  } else {
    return null;
  }

  // 前面的權限守衛保證操作者至少為 3；仍保留 A 的目標層級限制。
  if (target.level >= actorLevel) return null;
  return target;
}

/** teams 角色更新專用欄位，不包含伺服器維護的 members 或球經欄位。 */
export interface MemberRoleUpdates {
  leaderUids: string[];
  leaders: string[];
  leaderNames: string[];
  leaderUid: string | null;
  leader: string;
  coachUids: string[];
  coaches: string[];
  coachNames: string[];
}

/**
 * 純計算角色欄位，不執行 Firestore 寫入，也不取代呼叫端的權限守衛。
 * 對應 A `_buildTeamRoleLevelUpdates`（js/modules/team/team-detail.js:1241-1326）。
 * UID 決定身分；名稱僅同步顯示快取，以小寫比對刪除並保序去重。
 * 顯示名稱空白時使用目標 UID；members 由 recountTeamMembers 維護。
 */
export function buildMemberRoleUpdates(
  team: TeamDoc | null | undefined,
  targetUid: string,
  targetKey: MemberRoleKey,
  displayName: string,
): MemberRoleUpdates | null {
  if (!team) return null;
  const uid = targetUid.trim();
  if (!uid || (targetKey !== 'leader' && targetKey !== 'coach' && targetKey !== 'member')) {
    return null;
  }
  const name = displayName.trim() || uid;
  const normalizedName = name.toLowerCase();
  const source = team as Record<string, unknown>;
  const rawLeaders = source['leaders'];
  const rawLeaderNames = source['leaderNames'];
  const rawCoaches = source['coaches'];
  const rawCoachNames = source['coachNames'];

  let leaderUids = uniqueMemberRoleValues(
    Array.isArray(team.leaderUids)
      ? team.leaderUids
      : team.leaderUid ? [team.leaderUid] : [],
  );
  let leaders = uniqueMemberRoleValues(
    Array.isArray(rawLeaders)
      ? rawLeaders
      : Array.isArray(rawLeaderNames)
        ? rawLeaderNames
        : team.leader ? [team.leader] : [],
    true,
  );
  let coachUids = uniqueMemberRoleValues(team.coachUids);
  let coaches = uniqueMemberRoleValues(
    Array.isArray(rawCoaches) ? rawCoaches : rawCoachNames,
    true,
  );

  const removePerson = (
    uids: readonly string[],
    names: readonly string[],
  ): { uids: string[]; names: string[] } => ({
    uids: uids.filter((itemUid) => itemUid !== uid),
    names: names.filter((itemName) => itemName.toLowerCase() !== normalizedName),
  });
  const addPerson = (
    uids: readonly string[],
    names: readonly string[],
  ): { uids: string[]; names: string[] } => ({
    uids: [...uids, uid],
    names: [...names, name],
  });

  // 先從兩邊移除，確保重複指派時目標僅保留一次並移至尾端。
  const removedLeader = removePerson(leaderUids, leaders);
  const removedCoach = removePerson(coachUids, coaches);
  leaderUids = removedLeader.uids;
  leaders = removedLeader.names;
  coachUids = removedCoach.uids;
  coaches = removedCoach.names;

  if (targetKey === 'leader') {
    const added = addPerson(leaderUids, leaders);
    leaderUids = added.uids;
    leaders = added.names;
  } else if (targetKey === 'coach') {
    const added = addPerson(coachUids, coaches);
    coachUids = added.uids;
    coaches = added.names;
  }

  return {
    leaderUids,
    leaders,
    leaderNames: [...leaders],
    leaderUid: leaderUids[0] ?? null,
    leader: leaders[0] ?? '',
    coachUids,
    coaches,
    coachNames: [...coaches],
  };
}
