// 權限顯示規則（契約 §4）。前端只決定按鈕出不出現，擋不住的操作仍由伺服器拒絕。
// 沒有 creator 角色。主辦方＝staff 的 host／coHost，或俱樂部賽事的目前代表，或管理員。

import type { CompetitionStatus, EntryStatus, HostType, StaffRole } from './data/types';

export interface CpClub {
  id: string;
  name: string;
}

/** claims 的 role。ASSUMPTION: 與 useViewer().role 相同，admin／super_admin 算管理員。 */
export function isCpAdmin(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

export interface InAppGateInput {
  /** 沒有 launch 文件視為尚未對外。 */
  isPublic: boolean | null;
  isTester: boolean;
  isAdmin: boolean;
}

/**
 * 站內賽事整區要不要出現。
 * 對外公開：所有人。內部期：測試者或管理員。沒有開賽設定：只有管理員。
 */
export function canSeeInAppSection(input: InAppGateInput): boolean {
  if (input.isAdmin) return true;
  if (input.isPublic === true) return true;
  if (input.isPublic === false) return input.isTester;
  return false;
}

export interface ManageInput {
  staffRoles: readonly StaffRole[];
  hostType: HostType;
  hostTeamId: string | null;
  repClubIds: readonly string[];
  isAdmin: boolean;
}

/**
 * 俱樂部賽事的目前代表。對齊後端 context.ts hostAccess 的俱樂部分支：
 * hostType 為 club、hostTeamId 在我的代表俱樂部清單（文件路徑 id）裡。前代表換人後清單就沒有這隊。
 */
export function isCurrentClubRep(input: Pick<ManageInput, 'hostType' | 'hostTeamId' | 'repClubIds'>): boolean {
  return input.hostType === 'club' && !!input.hostTeamId && input.repClubIds.includes(input.hostTeamId);
}

/**
 * 主辦或共同主辦。對齊後端 context.ts hostAccess（assertHostOrCo、hostComp、staff-host openHost 都走它）：
 * 管理員；俱樂部賽事的目前代表；staff 的 host／coHost。不看 hidden：下架時後端另回 COMPETITION_HIDDEN。
 * 排賽程、賽程管理、人員與指派、邀請、審核與編輯都用這一條。
 */
export function canHostOrCo(input: ManageInput): boolean {
  if (input.isAdmin) return true;
  if (isCurrentClubRep(input)) return true;
  return input.staffRoles.includes('host') || input.staffRoles.includes('coHost');
}

/** 審核、鎖定、解鎖、編輯、發布、標示繳費。與 canHostOrCo 同一條（後端都是 assertHostOrCo／isHostOrCo）。 */
export function canManageCompetition(input: ManageInput): boolean {
  return canHostOrCo(input);
}

/**
 * 「編輯賽事」入口與編輯頁。對齊後端 updateCompetition：主辦或共同主辦（canHostOrCo）；
 * 已結束／已取消一律不行（後端 COMPETITION_CLOSED，只准移除封面，報隊管理的封面欄另外處理）；
 * 下架只留管理員（COMPETITION_HIDDEN）；刪到一半（deletingAt）不給改。
 */
export function canEditCompetition(
  doc: { status: CompetitionStatus; endedAt: number | null; hidden: boolean; deletingAt?: number | null },
  input: { canHost: boolean; isAdmin: boolean },
): boolean {
  if (!input.canHost) return false;
  if (doc.status === 'cancelled' || doc.endedAt != null) return false;
  if (doc.deletingAt != null) return false;
  return !doc.hidden || input.isAdmin;
}

export interface RegisterInput {
  repClubIds: readonly string[];
  status: CompetitionStatus;
  hidden: boolean;
  rostersLockedAt: number | null;
  endedAt: number | null;
  regOpenAt: number;
  regCloseAt: number;
  now: number;
}

/**
 * 結束賽事。只有 status 為 published、而且還沒寫 endedAt 才顯示。
 * 草稿、延期、整場取消都不顯示。主辦賽程頁還要已有場次。
 * 前端只藏按鈕，伺服器仍會拒絕。
 */
export function canEndCompetition(doc: { status: CompetitionStatus; endedAt: number | null }): boolean {
  if (doc.endedAt != null) return false;
  return doc.status === 'published';
}

/** 後端 match-host.ts SCHEDULE_LIMITS.endedGraceMs：末場確認造成的結束，主辦還有 3 天可以改場次。 */
export const ENDED_GRACE_MS = 3 * 86_400_000;

/**
 * 結束後主辦還能不能動場次、順延對調、指派人員。對齊後端 match-host.ts assertNotEnded
 * （staff-host.ts openHost 也走它）：沒結束、管理員，或末場確認（endedBy confirm）結束後 3 天內。
 * 主辦手動結束與自動結束沒有寬限。
 */
export function hostEditsOpen(
  doc: { endedAt: number | null; endedBy: 'confirm' | 'host' | 'auto' | null },
  isAdmin: boolean,
  now: number,
): boolean {
  if (doc.endedAt == null || isAdmin) return true;
  return doc.endedBy === 'confirm' && now < doc.endedAt + ENDED_GRACE_MS;
}

/**
 * 整天順延與兩場對調。比照結束賽事：只有已發布才顯示。
 * 結束後照 hostEditsOpen（末場確認 3 天寬限、管理員不受限）；下架時只留管理員（後端 hostComp COMPETITION_HIDDEN）。
 * 賽程頁還要已有場次。前端只藏卡片，伺服器仍會拒絕。
 */
export function canShowFlexSchedule(
  doc: { status: CompetitionStatus; endedAt: number | null; endedBy: 'confirm' | 'host' | 'auto' | null; hidden: boolean },
  isAdmin: boolean,
  now: number,
): boolean {
  if (doc.status !== 'published') return false;
  if (doc.hidden && !isAdmin) return false;
  return hostEditsOpen(doc, isAdmin, now);
}

/**
 * 恢復賽事只給管理員，而且結束方式是主辦或自動。
 * endedBy 為 confirm 時不顯示（伺服器回 RESTORE_NOT_ALLOWED）。
 */
export function canRestoreCompetition(
  doc: { endedAt: number | null; endedBy: 'confirm' | 'host' | 'auto' | null },
  isAdmin: boolean,
): boolean {
  if (!isAdmin || doc.endedAt == null) return false;
  return doc.endedBy === 'host' || doc.endedBy === 'auto';
}

/**
 * 「以俱樂部報隊」：我是某俱樂部代表，且賽事公開招募中、正在報名期間。
 * 對齊後端 entry.ts registerEntry：assertRosterPhase（名單未鎖、未結束）、
 * REG_NOT_OPEN（now < regOpenAt）、REG_CLOSED（now >= regCloseAt，截止那一毫秒就不收）。
 */
export function canRegisterClubEntry(input: RegisterInput): boolean {
  if (input.repClubIds.length === 0) return false;
  if (input.hidden || input.status !== 'published') return false;
  if (input.rostersLockedAt != null || input.endedAt != null) return false;
  return input.now >= input.regOpenAt && input.now < input.regCloseAt;
}

/**
 * 登錄表單能不能出現。
 * 自己登錄要是該隊成員；代填要是代表。
 * 報隊須為 pending 或 approved、名單未鎖、首場前。
 * ENTRY_STATUS 不是伺服器代碼，畫面改顯示「這份報隊已被拒絕或已退出，不能登錄名單」。
 */
export function rosterFormBlock(input: {
  kind: 'self' | 'rep';
  isMember: boolean;
  isRep: boolean;
  status: EntryStatus | null;
  locked: boolean;
  started: boolean;
}): 'NOT_CLUB_MEMBER' | 'NOT_CLUB_REP' | 'ROSTERS_LOCKED' | 'COMPETITION_STARTED' | 'ENTRY_STATUS' | null {
  if (input.kind === 'rep') {
    if (!input.isRep) return 'NOT_CLUB_REP';
  } else if (!input.isMember) {
    return 'NOT_CLUB_MEMBER';
  }
  if (input.status !== 'pending' && input.status !== 'approved') return 'ENTRY_STATUS';
  if (input.locked) return 'ROSTERS_LOCKED';
  if (input.started) return 'COMPETITION_STARTED';
  return null;
}

/** 首場前主辦可解鎖；首場之後只留管理員。未鎖定不顯示。 */
export function canUnlockRosters(input: {
  locked: boolean;
  canManage: boolean;
  isAdmin: boolean;
  firstMatchAt: number;
  now: number;
}): boolean {
  if (!input.locked) return false;
  if (input.isAdmin) return true;
  return input.canManage && input.now < input.firstMatchAt;
}

/** 名單還能改：對齊後端 entry.ts assertRosterPhase。 */
export function rosterPhaseOpen(
  competition: { status: string; hidden: boolean; endedAt: number | null; rostersLockedAt: number | null; firstMatchAt: number },
  now: number,
): boolean {
  return competition.status === 'published'
    && !competition.hidden
    && competition.endedAt == null
    && competition.rostersLockedAt == null
    && now < competition.firstMatchAt;
}
