/**
 * 活動報名統計與額滿判定。
 *
 * 移植自 A `js/modules/event/event-list-stats.js` 的
 *   `_getEventParticipantStats`（第 111～225 行）、`_isEventTrulyFull`（第 233～235 行）。
 *
 * 差異：
 *   - A 由 cache 與 `ApiService.getRegistrationsByEvent` 讀報名名單；B 由呼叫端傳入
 *     `event`＋最新 `registrations`。傳入即視同 A 的 `_eventRegsFetchedFromServer=true`。
 *   - 其餘（保留席、realCurrent、依顯示名稱去重的計數規則）逐行照 A（2026-10-19 PM 對照 A 原文改寫）。
 */

import type { EventDoc, RegistrationDoc } from './types';

export interface ParticipantStats {
  confirmedCount: number;
  occupiedCount: number;
  waitlistCount: number;
  maxCount: number;
  remainingCount: number;
  reservedRemainingCount: number;
  isCapacityFull: boolean;
  showFullBadge: boolean;
  showAlmostFullBadge: boolean;
}

interface PeopleSummary {
  count: number;
  hasSource: boolean;
}

/** `EventDoc` 未列出的舊欄位；本檔僅作唯讀存取。 */
type EventStatsFields = EventDoc & {
  current?: unknown;
  waitlist?: unknown;
  max?: unknown;
  teamReservationSummaries?: unknown;
  participants?: unknown;
  waitlistNames?: unknown;
};

function stats(event: EventDoc): EventStatsFields {
  return event as EventStatsFields;
}

/** A `event-list-stats.js#_getEventRemainingTeamReservationCount`（第 96～99 行）。 */
function getEventRemainingTeamReservationCount(event: EventDoc): number {
  const raw = stats(event).teamReservationSummaries;
  return (Array.isArray(raw) ? raw : [])
    .reduce((sum: number, summary: unknown) => {
      const remaining = Number((summary as { remainingSlots?: unknown } | null)?.remainingSlots || 0) || 0;
      return sum + Math.max(0, remaining);
    }, 0);
}

/** A `event-list-stats.js#_getEventActualConfirmedCount`（第 101～109 行）：有 realCurrent 用它，否則 current 扣保留席。 */
function getEventActualConfirmedCount(event: EventDoc): number {
  const realCurrent = Number((event as EventDoc & { realCurrent?: unknown }).realCurrent);
  if (Number.isFinite(realCurrent) && realCurrent >= 0) return Math.max(0, realCurrent);
  const projected = Math.max(0, Number(stats(event).current || 0) || 0);
  return Math.max(0, projected - getEventRemainingTeamReservationCount(event));
}

/** A `event-list-stats.js#_getEventProjectedConfirmedCount`（第 85～94 行）：有 realCurrent 用它加保留席，否則 current。 */
function getEventProjectedConfirmedCount(event: EventDoc): number {
  const realCurrent = Number((event as EventDoc & { realCurrent?: unknown }).realCurrent);
  if (Number.isFinite(realCurrent) && realCurrent >= 0) {
    return Math.max(0, realCurrent + getEventRemainingTeamReservationCount(event));
  }
  return Math.max(0, Number(stats(event).current || 0) || 0);
}

/**
 * A `event-list-stats.js#_buildEventPeopleSummaryByStatus`（第 13～68 行）逐行移植。
 * 注意：A 的計數依「顯示名稱」去重（沒有名字的報名不計、同名只算一次）；這是計數規則而非以名字認身分，
 * 額滿判斷依賴它，所以照搬（2026-10-19 PM 核實）。名單 fallback（沒有報名時用活動文件名字）只影響 hasSource=false 的情況。
 */
function buildEventPeopleSummaryByStatus(
  registrations: readonly RegistrationDoc[],
  status: 'confirmed' | 'waitlisted',
  fallbackNames: readonly unknown[] = [],
): PeopleSummary {
  const targetRegs = registrations.filter((r) => r?.status === status);
  const addedNames = new Set<string>();
  let count = 0;

  if (targetRegs.length > 0) {
    const groups = new Map<string, RegistrationDoc[]>();
    for (const reg of targetRegs) {
      const raw = reg as RegistrationDoc & { userName?: unknown; id?: unknown };
      const groupKey = String(raw.userId || raw.userName || raw.id || '').trim() || `anon-${groups.size}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push(reg);
    }
    for (const regs of groups.values()) {
      const selfReg = regs.find((reg) => {
        const r = reg as RegistrationDoc & { participantType?: unknown; companionId?: unknown };
        const type = String(r.participantType || 'self').trim();
        return type !== 'companion' && !String(r.companionId || '').trim();
      });
      const companions = regs.filter((reg) => {
        const r = reg as RegistrationDoc & { participantType?: unknown; companionId?: unknown };
        const type = String(r.participantType || '').trim();
        return type === 'companion' || !!String(r.companionId || '').trim();
      });
      const mainName = String((selfReg as (RegistrationDoc & { userName?: unknown }) | undefined)?.userName || '').trim();
      if (selfReg && mainName && !addedNames.has(mainName)) {
        count += 1;
        addedNames.add(mainName);
      }
      for (const companionReg of companions) {
        const c = companionReg as RegistrationDoc & { companionName?: unknown; userName?: unknown };
        const companionName = String(c.companionName || c.userName || '').trim();
        if (!companionName || addedNames.has(companionName)) continue;
        count += 1;
        addedNames.add(companionName);
      }
    }
  }

  if (targetRegs.length === 0) {
    for (const name of fallbackNames) {
      const safeName = String(name || '').trim();
      if (!safeName || addedNames.has(safeName)) continue;
      count += 1;
      addedNames.add(safeName);
    }
  }

  return { count, hasSource: targetRegs.length > 0 };
}

/**
 * A `_getEventParticipantStats` 的 B 版。
 *
 * @param event 活動文件（可含 `current`／`waitlist`／`max`／`teamReservationSummaries` 等舊欄位）。
 * @param registrations 呼叫端讀到的最新報名名單；視同 A `_eventRegsFetchedFromServer=true`。
 */
export function getEventParticipantStats(
  event: EventDoc,
  registrations: readonly RegistrationDoc[],
): ParticipantStats {
  const reservedRemainingCount = getEventRemainingTeamReservationCount(event);
  const fallbackConfirmed = getEventActualConfirmedCount(event);
  const fallbackOccupied = getEventProjectedConfirmedCount(event);
  const fallbackWaitlist = Math.max(0, Number(stats(event).waitlist || 0));

  let confirmedCount = fallbackConfirmed;
  let occupiedCount = fallbackOccupied;
  let waitlistCount = fallbackWaitlist;

  if (registrations.length > 0) {
    // A 條件 `_hasCompleteRegs || _eventRegsFetchedFromServer`：B 由呼叫端傳入最新報名，
    // 視同 server fetch 成功，故只要 registrations 非空就採用 summary。
    const participants = stats(event).participants;
    const waitlistNames = stats(event).waitlistNames;
    const confirmedSummary = buildEventPeopleSummaryByStatus(
      registrations, 'confirmed', Array.isArray(participants) ? participants : [],
    );
    const waitlistSummary = buildEventPeopleSummaryByStatus(
      registrations, 'waitlisted', Array.isArray(waitlistNames) ? waitlistNames : [],
    );
    if (confirmedSummary.hasSource) confirmedCount = confirmedSummary.count;
    if (waitlistSummary.hasSource) waitlistCount = waitlistSummary.count;
    if (confirmedSummary.hasSource) occupiedCount = confirmedCount + reservedRemainingCount;
  }

  const maxCount = Math.max(0, Number(stats(event).max || 0));
  const remainingCount = maxCount > 0 ? Math.max(0, maxCount - occupiedCount) : 0;
  const isCapacityFull = maxCount > 0 && occupiedCount >= maxCount;
  const status = event.status;
  const isTerminal = status === 'ended' || status === 'cancelled';

  return {
    confirmedCount,
    occupiedCount,
    waitlistCount,
    maxCount,
    remainingCount,
    reservedRemainingCount,
    isCapacityFull,
    showFullBadge: !isTerminal && isCapacityFull,
    showAlmostFullBadge:
      !isTerminal
      && status === 'open'
      && maxCount > 0
      && occupiedCount < maxCount
      && remainingCount / maxCount < 0.2,
  };
}

/** A `_isEventTrulyFull`：以傳入的報名名單計算 `isCapacityFull`。 */
export function isEventTrulyFull(
  event: EventDoc,
  registrations: readonly RegistrationDoc[],
): boolean {
  return getEventParticipantStats(event, registrations).isCapacityFull;
}
