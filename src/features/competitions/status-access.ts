// 對齊 functions-cp host.ts setCompetitionStatus（TRANSITIONS、COMPETITION_CLOSED、COMPETITION_HIDDEN）。
import type { CompetitionStatus } from './data/types';

export type StatusTarget = 'published' | 'postponed' | 'cancelled';

export const STATUS_REASON_MIN = 2;
export const STATUS_REASON_MAX = 200;

/** 對齊上述後端條件。canHost＝canHostOrCo 的結果（管理員也是 true）。 */
export function canSetCompetitionStatus(
  doc: { status: CompetitionStatus; endedAt: number | null; hidden: boolean; deletingAt?: number | null },
  input: { canHost: boolean; isAdmin: boolean },
): boolean {
  if (!input.canHost) return false;
  if (doc.status !== 'published' && doc.status !== 'postponed') return false;
  if (doc.endedAt != null) return false;
  if (doc.deletingAt != null) return false;
  if (doc.hidden && !input.isAdmin) return false;
  return true;
}

/** published → ['postponed','cancelled']；postponed → ['published','cancelled']；其他 → []。 */
export function statusTargetsOf(status: CompetitionStatus): StatusTarget[] {
  if (status === 'published') return ['postponed', 'cancelled'];
  if (status === 'postponed') return ['published', 'cancelled'];
  return [];
}
