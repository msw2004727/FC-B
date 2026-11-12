/**
 * 活動詳情報名卡計量條（2026-11-12 站長選定方案 C：膠囊分段＋色點圖例）。
 *
 * 只用活動文件既有欄位，不新增 Firestore 讀取：
 *   - confirmedCount：實際正取（detail-model#actualConfirmedCount，不含團隊未報）
 *   - reservedRemainingCount：Σ teamReservationSummaries[].remainingSlots（participant-stats）
 *   - 團隊已報：Σ min(usedSlots, reservedSlots)。Functions `_rebuildOccupancy` 的 usedSlots
 *     ＝該團隊正取人數，已含在 realCurrent；超出保留額的團隊報名占一般名額，算一般。
 */

export type RegBarSegmentKey = 'general' | 'team' | 'team-open';

export interface RegBarSegment {
  key: RegBarSegmentKey;
  count: number;
  /** 占主條寬度的百分比。 */
  pct: number;
}

export interface RegBarLegendItem {
  key: RegBarSegmentKey | 'wait';
  label: string;
  count: number;
}

export interface RegBarModel {
  segments: RegBarSegment[];
  waitlist: number;
  /** 主條與候補膠囊各占整列的百分比（候補為 0 時主條 100）。 */
  mainBasis: number;
  waitBasis: number;
  /** 只有一般已報一種時不出圖例，讓「N/M」與條自己說明。 */
  legend: RegBarLegendItem[];
}

/** 候補膠囊最多占整列 30%，避免候補很多時把主條擠到看不清；確切人數看圖例。 */
export const REG_BAR_MAX_WAIT_SHARE = 0.3;

function nonNegative(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function sumTeamReservationUsed(summaries: unknown): number {
  if (!Array.isArray(summaries)) return 0;
  return summaries.reduce((sum: number, item: unknown) => {
    const s = (item ?? {}) as { reservedSlots?: unknown; usedSlots?: unknown };
    return sum + Math.min(nonNegative(s.usedSlots), nonNegative(s.reservedSlots));
  }, 0);
}

export function buildRegCapacityBar(input: {
  teamReservationSummaries: unknown;
  confirmedCount: number;
  reservedRemainingCount: number;
  waitlistCount: number;
  maxCount: number;
}): RegBarModel | null {
  const maxCount = nonNegative(input.maxCount);
  if (maxCount <= 0) return null;
  const confirmed = nonNegative(input.confirmedCount);
  const teamOpen = nonNegative(input.reservedRemainingCount);
  const waitlist = nonNegative(input.waitlistCount);
  const team = Math.min(sumTeamReservationUsed(input.teamReservationSummaries), confirmed);
  const general = confirmed - team;

  // 超收（正取＋團隊未報 > 上限）時以實際總數當滿格，各段比例仍正確、不溢出。
  const mainUnits = Math.max(maxCount, confirmed + teamOpen);
  const segments: RegBarSegment[] = ([
    ['general', general],
    ['team', team],
    ['team-open', teamOpen],
  ] as Array<[RegBarSegmentKey, number]>)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => ({ key, count: n, pct: round((n / mainUnits) * 100) }));

  const waitBasis = waitlist > 0
    ? round(Math.min(waitlist / (mainUnits + waitlist), REG_BAR_MAX_WAIT_SHARE) * 100)
    : 0;

  const hasExtra = team > 0 || teamOpen > 0 || waitlist > 0;
  const legend: RegBarLegendItem[] = hasExtra
    ? ([
      // 有團隊已報時一般段改稱「一般」，避免和上方「N/M」的已報總數混淆。
      { key: 'general', label: team > 0 ? '一般' : '已報', count: general },
      { key: 'team', label: '團隊', count: team },
      { key: 'team-open', label: '保留', count: teamOpen },
      { key: 'wait', label: '候補', count: waitlist },
    ] as RegBarLegendItem[]).filter(item => item.count > 0)
    : [];

  return { segments, waitlist, mainBasis: round(100 - waitBasis), waitBasis, legend };
}
