/**
 * 活動列表「已結束 N 場」收合分組的判斷（顧問 §3.136，2026-11-13）。
 *
 * 進行中的場次（已開始、未結束）不收合——活動當下主辦與遲到者要找卡簽到。
 * 收合條件：已取消，或結束時間已過。結束時間照 Functions 的台北規則（core/taipei-time#parseTaipeiRange）：
 *   - `YYYY/MM/DD HH:mm~HH:mm`：結束早於開始視為跨日（22:00~01:00 結束在隔天 01:00）；
 *   - 有開始時間但沒有結束時間：退回開始時間；
 *   - 只有日期：當天 23:59。
 * 不是站內日期字串（Timestamp 等）時退回開始時間；連開始時間都解析不了才看 status。
 * 只影響收合分組；卡片自己的狀態膠囊（「已結束」等）仍用 effectiveEventStatus，不在此改。
 */
import { parseEventStartMs } from '@/core/event-time';
import { parseTaipeiRange } from '@/core/taipei-time';
import type { EventDoc } from './types';

export function shouldFoldTimelineEvent(event: EventDoc, nowMs: number): boolean {
  if (event.status === 'cancelled') return true;
  const range = parseTaipeiRange(event.date);
  if (range) return range.endMs <= nowMs;
  const startMs = parseEventStartMs(event.date);
  if (startMs !== null) return startMs <= nowMs;
  return event.status === 'ended';
}
