/**
 * T-073a：A event-manage-noshow.js:277-387、445-453 的名單讀取演算法。
 * 只使用 Functions 寫回的統計，不重算出席、不查活動日期、不寫資料。
 * 所有 key 都是文件 ID（UID）；不使用資料內 uid／lineUserId，也不以名字反查。
 */
import type { UserNoShowStats } from '@/data/user-roles';
import type { ConfirmedRosterPerson } from './attendance-roster-model';

/** 與 A js/config.js 的同名旗標一致（R-STAT-004）。 */
export const NO_SHOW_FEATURE_ENABLED = true;

export type UserNoShowStatsByUid = Readonly<Record<string, UserNoShowStats>>;
/** 值為 userCorrections/{uid}.noShow.adjustment，於合併時照 A 轉數字及取整。 */
export type NoShowAdjustmentsByUid = ReadonlyMap<string, unknown>;

export interface AttendanceFill {
  pct: number;
  color: string;
  ended: number;
  noShow: number;
}

export type NoShowParticipant = Pick<
  ConfirmedRosterPerson,
  'uid' | 'isCompanion' | 'proxyOnly' | 'isProxyOnly'
  | 'isTeamPlaceholder' | 'isTeamHeader' | 'isTeamGeneralSeparator'
>;

/** A _buildNoShowCountByUid：raw > 0；有限且非零補正取整，總數最低為 0。 */
export function buildNoShowCountByUid(
  users: UserNoShowStatsByUid,
  adjustments: NoShowAdjustmentsByUid = new Map(),
  featureEnabled = NO_SHOW_FEATURE_ENABLED,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!featureEnabled) return counts;
  for (const [uid, user] of Object.entries(users)) {
    const count = Number(user.noShowCount || 0);
    if (uid && count > 0) counts.set(uid, count);
  }
  for (const [uid, raw] of adjustments) {
    if (!uid) continue;
    const adjustment = Number(raw || 0);
    if (!Number.isFinite(adjustment) || adjustment === 0) continue;
    counts.set(uid, Math.max(0, (counts.get(uid) || 0) + Math.trunc(adjustment)));
  }
  return counts;
}

/** A _buildEndedRegCountByUid：只收正數分母。 */
export function buildEndedRegCountByUid(
  users: UserNoShowStatsByUid,
  featureEnabled = NO_SHOW_FEATURE_ENABLED,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!featureEnabled) return counts;
  for (const [uid, user] of Object.entries(users)) {
    const ended = Number(user.endedRegCount || 0);
    if (uid && ended > 0) counts.set(uid, ended);
  }
  return counts;
}

/** A _buildLastNoShowSet：最近一場旗標獨立於補正後的累計次數。 */
export function buildLastNoShowSet(
  users: UserNoShowStatsByUid,
  featureEnabled = NO_SHOW_FEATURE_ENABLED,
): Set<string> {
  const uids = new Set<string>();
  if (!featureEnabled) return uids;
  for (const [uid, user] of Object.entries(users)) {
    if (uid && user.lastEventWasNoShow) uids.add(uid);
  }
  return uids;
}

/**
 * 合併 A _getParticipantNoShowCount 與表格的僅代報排除條件。
 * null 代表不適用；空 Map 仍回 0（A 的 Map 物件為 truthy）。
 * 同行者依模型旗標排除，不從 UID 字串猜身分，不做名字 fallback。
 */
export function participantNoShowCount(
  person: NoShowParticipant | null | undefined,
  counts: ReadonlyMap<string, number> | null | undefined,
  featureEnabled = NO_SHOW_FEATURE_ENABLED,
): number | null {
  if (!featureEnabled || !person || !counts
    || person.isCompanion || person.proxyOnly || person.isProxyOnly
    || person.isTeamPlaceholder || person.isTeamHeader || person.isTeamGeneralSeparator) return null;
  const uid = person.uid.trim();
  if (!uid) return null;
  return counts.get(uid) || 0;
}

/**
 * A _getParticipantAttendanceFill；回傳型別可直接給 UserTag.attendanceFill。
 * 呼叫端仍須依 canViewNoShow 與列型別排除同行者、僅代報及保留席位。
 */
export function attendanceFill(
  uid: string,
  noShowCounts: ReadonlyMap<string, number>,
  endedRegCounts: ReadonlyMap<string, number>,
  featureEnabled = NO_SHOW_FEATURE_ENABLED,
): AttendanceFill | null {
  if (!featureEnabled) return null;
  const safeUid = uid.trim();
  if (!safeUid) return null;
  const ended = Number(endedRegCounts.get(safeUid) || 0);
  if (ended < 3) return null;
  const noShow = Number(noShowCounts.get(safeUid) || 0);
  if (noShow <= 0) return null;
  const ratio = Math.min(1, noShow / ended);
  const pct = Math.round(ratio * 100);
  const color = ratio >= 0.5 ? 'rgba(220,38,38,.55)'
    : ratio >= 0.2 ? 'rgba(239,68,68,.45)'
      : 'rgba(251,146,60,.45)';
  return { pct, color, ended, noShow };
}
