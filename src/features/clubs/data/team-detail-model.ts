/**
 * 俱樂部詳情純函式（移植 A `js/modules/team/team-detail-render.js`）。
 *
 * 本層只實作**唯讀**規則：幹部身分、名單列、區塊可見性、未來活動、主要按鈕、權限 helper。
 * 不產生 HTML、不寫入文件、不呼叫 Callable。
 *
 * 教育學員來源（A `_getTeamDetailActiveStudents` / `_addTeamStudentIdentityKeys`）本版不做，
 * 詳見 buildTeamRoster 的 TODO。
 */

import { eventEndOfDayMs, parseEventDate, parseEventStartMs } from '@/core/event-time';
import type { EventDoc } from '@/features/events/data/types';
import { getEventLimitedTeamIds } from '@/features/events/data/visibility';

import {
  isTeamTeachingTagged,
  isUserInTeam,
} from './team-list-model';
import type {
  ClubViewer,
  TeamDoc,
  TeamMember,
  TeamPrimaryAction,
  TeamRosterRow,
} from './types';

/* i18n role keys（A 原文：球經 / 領隊 / 教練）。 */
const ROLE_KEY_CAPTAIN = 'clubs.role.captain';
const ROLE_KEY_LEADER = 'clubs.role.leader';
const ROLE_KEY_COACH = 'clubs.role.coach';

/* i18n roster keys（A 原文：隊員；本版僅成員身分）。 */
const ROSTER_MEMBER_LABEL_KEY = 'clubs.roster.member';

/* ── 幹部身分 ────────────────────────────────────── */

export interface TeamStaffIdentity {
  captainUids: ReadonlySet<string>;
  leaderUids: ReadonlySet<string>;
  coachUids: ReadonlySet<string>;
}

function normalizeUid(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

/**
 * A `_getTeamStaffIdentity`（team-detail.js:158-167）的 UID 版本。
 *
 * 規則（是優先序而非聯集）：
 *   - captainUid → captainUids
 *   - leaderUids 為陣列 → 僅採用陣列（即使為空，也不退回 leaderUid）
 *   - 否則 → 退回 leaderUid
 *   - coachUids 為陣列 → coachUids
 *
 * R-ID-002 drift：不移植名稱比對與 `_buildTeamStaffIdentity` 的 names 集合。
 */
export function getTeamStaffIdentity(
  team: TeamDoc | null | undefined,
): TeamStaffIdentity {
  const captainUids = new Set<string>();
  const leaderUids = new Set<string>();
  const coachUids = new Set<string>();
  if (!team) return { captainUids, leaderUids, coachUids };

  const captain = normalizeUid(team.captainUid);
  if (captain) captainUids.add(captain);

  if (Array.isArray(team.leaderUids)) {
    for (const id of team.leaderUids) {
      const uid = normalizeUid(id);
      if (uid) leaderUids.add(uid);
    }
  } else {
    const legacy = normalizeUid(team.leaderUid);
    if (legacy) leaderUids.add(legacy);
  }

  if (Array.isArray(team.coachUids)) {
    for (const id of team.coachUids) {
      const uid = normalizeUid(id);
      if (uid) coachUids.add(uid);
    }
  }

  return { captainUids, leaderUids, coachUids };
}

/* ── 名單 ────────────────────────────────────────── */

// A `_getTeamDetailPersonName` 的欄位優先序。
const PERSON_NAME_FIELDS: readonly string[] = [
  'displayName',
  'name',
  'nickname',
  'nickName',
  'lineName',
  'profileName',
  'userName',
  'realName',
  'studentName',
  'selfName',
  'childName',
];

// A `_isTeamDetailUidLike`：`U` + 20+ hex 視為 UID 而非名稱。
function isUidLike(value: string): boolean {
  const text = String(value ?? '').trim();
  if (!text) return false;
  return /^U[0-9a-f]{20,}$/i.test(text);
}

function getPersonName(
  source: Record<string, unknown> | null | undefined,
  fallback: string,
): string {
  if (!source || typeof source !== 'object') return fallback;
  for (const field of PERSON_NAME_FIELDS) {
    const value = String(source[field] ?? '').trim();
    if (value && !isUidLike(value)) return value;
  }
  return fallback;
}

interface RosterDraft {
  uid: string;
  name: string;
  isMember: boolean;
  roles: Set<string>;
  user: TeamMember | null;
}

/**
 * A `_getTeamDetailRoster`（team-detail-render.js:665-756）的 UID-only 版本。
 *
 * 移植保留：
 *   - 幹部排前、成員次之、再依名稱排序（`zh-Hant`）。
 *   - 角色標記（球經/領隊/教練）以 i18n key 輸出。
 *
 * 刻意改寫（R-ID-002 drift）：
 *   - A 以 `_findTeamDetailUserByUidOrName` 對「幹部 UID 對不到 user 時改用名稱比對」。
 *     本版**只**以 UID 對應使用者；同名不同 uid 不會被合併。
 *   - A 會再以 `_getTeamDetailActiveStudents` 併入教育學員；本版不做。
 *     TODO(p46-edu-students): 待教育學員資料層上線後再移植 `_addTeamStudentIdentityKeys`。
 *   - A 會計算 activity/course/match/joinTime 統計；本層不做（需 events/attendance/edu）。
 */
export function buildTeamRoster(
  team: TeamDoc | null | undefined,
  users: readonly TeamMember[],
): TeamRosterRow[] {
  if (!team) return [];
  const teamId = team.id ? String(team.id) : '';

  const staff = getTeamStaffIdentity(team);
  const staffRoles = new Map<string, Set<string>>();
  const addStaffRole = (uid: string, roleKey: string): void => {
    if (!uid) return;
    const set = staffRoles.get(uid) ?? new Set<string>();
    set.add(roleKey);
    staffRoles.set(uid, set);
  };
  for (const uid of staff.captainUids) addStaffRole(uid, ROLE_KEY_CAPTAIN);
  for (const uid of staff.leaderUids) addStaffRole(uid, ROLE_KEY_LEADER);
  for (const uid of staff.coachUids) addStaffRole(uid, ROLE_KEY_COACH);

  const drafts = new Map<string, RosterDraft>();
  const ensureDraft = (uid: string): RosterDraft => {
    let draft = drafts.get(uid);
    if (!draft) {
      draft = { uid, name: '', isMember: false, roles: new Set(), user: null };
      drafts.set(uid, draft);
    }
    return draft;
  };

  // R-ID-002 drift：A 也以名稱比對 `_findTeamDetailUserByUidOrName`；本層僅用 UID。
  for (const user of users) {
    const uidRaw = user.uid ?? user._docId;
    const uid = uidRaw ? String(uidRaw).trim() : '';
    if (!uid) continue;

    const inTeam = teamId ? isUserInTeam(user, teamId) : false;
    const roles = staffRoles.get(uid);
    if (!inTeam && !roles) continue;

    const draft = ensureDraft(uid);
    draft.user = user;
    if (!draft.name) draft.name = getPersonName(user, '');
    if (inTeam) draft.isMember = true;
    if (roles) {
      for (const role of roles) draft.roles.add(role);
      draft.isMember = true;
    }
  }

  // 幹部 UID 若無 user doc 也需顯示為列（避免 roster 遺漏）。
  for (const [uid, roles] of staffRoles) {
    const draft = ensureDraft(uid);
    draft.isMember = true;
    for (const role of roles) draft.roles.add(role);
  }

  const rows: TeamRosterRow[] = [];
  for (const draft of drafts.values()) {
    const rawName = draft.name;
    const isMissingName = !rawName || isUidLike(rawName);
    rows.push({
      uid: draft.uid,
      name: isMissingName ? '' : rawName,
      isMember: draft.isMember,
      roles: [...draft.roles],
      user: draft.user,
      labelKey: ROSTER_MEMBER_LABEL_KEY,
      isMissingName,
    });
  }

  return rows.sort((a, b) => {
    const rankA = a.roles.length ? 0 : a.isMember ? 1 : 2;
    const rankB = b.roles.length ? 0 : b.isMember ? 1 : 2;
    if (rankA !== rankB) return rankA - rankB;
    return a.name.localeCompare(b.name, 'zh-Hant');
  });
}

/* ── 區塊可見性 ──────────────────────────────────── */

interface ResolvedVisibility {
  events: boolean;
  courses: boolean;
  matches: boolean;
  info: boolean;
  bio: boolean;
  record: boolean;
  members: boolean;
}

/** A `_getTeamDetailVisibility`（team-detail-render.js:345-358）。 */
export function getTeamDetailVisibility(
  team: TeamDoc | null | undefined,
): ResolvedVisibility {
  const source = team?.detailVisibility;
  const view = source && typeof source === 'object' ? source : {};
  return {
    events: view.events !== false,
    courses: view.courses !== false,
    matches: view.matches !== false,
    info: view.info !== false,
    bio: view.bio !== false,
    record: view.record !== false,
    members: view.members !== false,
  };
}

/**
 * A `_isTeamDetailSectionVisible`（team-detail-render.js:360-364）。
 * `courses` 需要教學標籤開啟才可見。
 */
export function isTeamDetailSectionVisible(
  team: TeamDoc | null | undefined,
  key: keyof ResolvedVisibility,
): boolean {
  const visibility = getTeamDetailVisibility(team);
  if (key === 'courses' && !isTeamTeachingTagged(team)) return false;
  return visibility[key] !== false;
}

/* ── 未來活動 ────────────────────────────────────── */

/**
 * A `_isTeamEventForTeam`（team-detail-render.js）：只有 `teamOnly` 的俱樂部限定活動才算該隊活動；
 * 隊伍 ID 來源用與 A `_getEventLimitedTeamIds` 相同的 `getEventLimitedTeamIds`。
 */
export function isTeamEventForTeam(
  event: EventDoc | null | undefined,
  teamId: string | null | undefined,
): boolean {
  if (!event || !event.teamOnly) return false;
  const target = String(teamId ?? '').trim();
  if (!target) return false;
  return getEventLimitedTeamIds(event).includes(target);
}

/** 無結束時間時保留當天 23:59:59；明確結束不套跨日。 */
function parseEventEndMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.includes('/')) return null;
  const parsed = parseEventDate(value);
  return parsed === null ? null : parsed.explicitEndMs ?? eventEndOfDayMs(parsed.startMs);
}

/**
 * A `_isTeamEventInFuture`（team-detail-render.js）：ended／cancelled 不算；
 * 以開始時間（無則結束時間）為基準，**兩者都解析不出時視為未來**（照 A，避免日期格式異常的活動消失）。
 */
export function isTeamEventInFuture(
  event: EventDoc | null | undefined,
  now: Date,
): boolean {
  if (!event || event.status === 'ended' || event.status === 'cancelled') return false;
  const anchor = parseEventStartMs(event.date) ?? parseEventEndMs(event.date);
  return anchor === null || anchor >= now.getTime();
}

/**
 * A `_getTeamFutureEvents`（team-detail-render.js:96-118）。
 *
 * 刻意不含的 A 檢查：`_canListPrivateEvent`、`_isEventVisibleToUser`（依賴 viewer / 列表快取）。
 * 呼叫端若需要，應在傳入 `events` 前先以可見性邏輯篩選。
 */
export function getTeamFutureEvents(
  teamId: string | null | undefined,
  events: readonly EventDoc[],
  now: Date = new Date(),
): EventDoc[] {
  if (!teamId) return [];
  return events
    .filter((e) => isTeamEventForTeam(e, teamId) && isTeamEventInFuture(e, now))
    .sort((a, b) => {
      const da = parseEventStartMs(a.date);
      const db = parseEventStartMs(b.date);
      if (da !== null && db !== null) {
        const diff = da - db;
        if (diff !== 0) return diff;
      } else if (da !== null && db === null) {
        return -1;
      } else if (da === null && db !== null) {
        return 1;
      }
      return String(a.date ?? '').localeCompare(String(b.date ?? ''));
    });
}

/* ── 主要按鈕狀態 ────────────────────────────────── */

export type TeamJoinStatus = 'pending' | 'clear' | 'rejectedCooldown' | (string & {});

export interface TeamJoinState {
  status?: TeamJoinStatus;
}

/**
 * A `_buildTeamDetailPrimaryAction`（team-detail-render.js）的列舉版，只有三態：
 * 非成員且申請審核中 → 'pending'；成員（含幹部）→ 'leave'；其他（含訪客，按下後由 handler 要求登入）→ 'join'。
 * 管理入口是另一個元素，由 `canEditTeamByRoleOrCaptain`／`canManageTeamMembers` 決定，不取代退出。
 * joinState 由呼叫端（收件匣）提供；undefined 代表無申請。
 */
export function getTeamPrimaryAction(
  team: TeamDoc | null | undefined,
  viewer: ClubViewer | null | undefined,
  joinState: TeamJoinState | null | undefined,
): TeamPrimaryAction {
  const teamId = team?.id ? String(team.id) : '';
  const isMember = !!(teamId && viewer?.uid && viewer.teamIds.has(teamId));
  if (!isMember && joinState?.status === 'pending') return 'pending';
  return isMember ? 'leave' : 'join';
}

/* ── 權限 helper ─────────────────────────────────── */

/**
 * A `_canEditTeamByRoleOrCaptain`（team-list-helpers.js:229-232）。
 * 幹部判斷只用 uid（不看 _docId、不看名稱）。
 */
export function canEditTeamByRoleOrCaptain(
  team: TeamDoc | null | undefined,
  viewer: ClubViewer | null | undefined,
): boolean {
  if (!team || !viewer || !viewer.uid) return false;
  const myUid = viewer.uid;
  const ownerFields: ReadonlyArray<'captainUid' | 'creatorUid' | 'ownerUid'> = [
    'captainUid',
    'creatorUid',
    'ownerUid',
  ];
  for (const field of ownerFields) {
    const id = String(team[field] ?? '').trim();
    if (id && id === myUid) return true;
  }
  return viewer.hasPermission('team.manage_all');
}

/**
 * A `_canManageTeamMembers`（team-list-helpers.js:245-254）。
 * 注意：A 僅看 leaderUids 陣列，不退回 legacy leaderUid。
 */
export function canManageTeamMembers(
  team: TeamDoc | null | undefined,
  viewer: ClubViewer | null | undefined,
): boolean {
  if (!team || !viewer || !viewer.uid) return false;
  const myUid = viewer.uid;
  if (String(team.captainUid ?? '') === myUid) return true;
  if (Array.isArray(team.leaderUids) && team.leaderUids.includes(myUid)) return true;
  if (Array.isArray(team.coachUids) && team.coachUids.includes(myUid)) return true;
  return false;
}

/* ── 人數 ────────────────────────────────────────── */

/**
 * 顯示用成員數。
 *
 * 決策：直接顯示 `team.members`（A 最後寫入的快取）；
 * 不得自行重算寫回——人數由伺服器 Callable `recountTeamMembers` 維護。
 * A `_getTeamDetailMemberCount` 會重算 roster，本版刻意改寫以免與伺服器競態。
 */
export function getTeamMemberCount(team: TeamDoc | null | undefined): number {
  if (!team) return 0;
  const value = Number(team.members ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/* 保留 buildTeamRoster 的呼叫者以檢查 user roster 但不重算人數。 */
void buildTeamRoster;
