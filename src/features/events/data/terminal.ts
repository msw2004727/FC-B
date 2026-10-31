/**
 * Terminal（已結束／取消）判定與列表頁籤 normalize。純函式，時間以 `now: number`（毫秒）注入。
 *
 * 對應 A：
 *   - event-list.js::_normalizeActivityTab（_hiddenActivityTabs = ['ended']）
 *   - event-list-stats.js::_isEventInActivityEndedTab / _getActivityEndedTabDate
 *     / _parseEventEndDate / _parseEventStartDate（R-EVT-002：結束時間 +6h 後才 terminal）
 *   - home-next-activity.js::parseEventDateRange / eventStartMs（純解析）
 */

import { eventEndOfDayMs, parseEventDate, parseEventRangeMs, parseEventStartMs } from '@/core/event-time';

export interface DateRange {
  startMs: number;
  endMs: number;
}

/** 6 小時（R-EVT-002） */
export const TERMINAL_DELAY_MS = 6 * 60 * 60 * 1000;

/** 薄包裝：範圍型沿用無結束 +2h、不跨日；解析來源為 event-time。 */
export function parseEventDateRange(value: unknown): DateRange | null {
  return parseEventRangeMs(value);
}

/** 取得活動起點毫秒（無效時回 0）。 */
export function eventStartMs(event: { date?: unknown; startAt?: unknown; startTime?: unknown } | null | undefined): number {
  return parseEventStartMs(event?.date ?? event?.startAt ?? event?.startTime) ?? 0;
}

function getActivityEndedTabDate(event: { date?: unknown } | null | undefined): Date | null {
  const date = event?.date;
  // 已結束頁籤沿用斜線日期限制，不擴大成 ISO／時間戳輸入。
  if (typeof date !== 'string' || (date.split(' ')[0] ?? '').split('/').length < 3) return null;
  const parsed = parseEventDate(date);
  if (parsed === null) return null;
  const endMs = parsed.hasTime
    ? parsed.explicitEndMs ?? parsed.startMs
    : eventEndOfDayMs(parsed.startMs);
  return new Date(endMs + TERMINAL_DELAY_MS);
}

/**
 * R-EVT-002：逐條照 A _isEventInActivityEndedTab。
 *  - !event → true
 *  - 無有效日期 → status === 'ended' || status === 'cancelled'
 *  - 有有效日期 → 結束時間 +6h <= now
 */
export function isEventInEndedTab(
  event: { status?: string; date?: unknown } | null | undefined,
  now: number,
): boolean {
  if (!event) return true;
  const moveAt = getActivityEndedTabDate(event);
  if (!moveAt) return event.status === 'ended' || event.status === 'cancelled';
  return moveAt.getTime() <= now;
}

/**
 * A 的 _normalizeActivityTab：_hiddenActivityTabs = ['ended']。
 * - 'ended' 舊值 → 'normal'
 * - 其他空值 → 'normal'
 * - 其他值原樣回傳
 */
export function normalizeListTab(tab: string | null | undefined): string {
  if (tab === 'ended') return 'normal';
  return tab || 'normal';
}
