import { formatTaipei, parseTaipei, taipeiStartOfDay } from './taipei-time';

/** 活動日期拆出的事實；均為絕對毫秒，結束尚未套用消費端跨日規則。 */
export interface EventDate {
  startMs: number;
  hasTime: boolean;
  explicitEndMs: number | null;
}

export const EVENT_DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

export function parseEventDate(value: unknown): EventDate | null {
  if (typeof value !== 'string') {
    const startMs = parseTaipei(value);
    return startMs === null ? null : { startMs, hasTime: true, explicitEndMs: null };
  }
  const separator = value.indexOf('~');
  const head = (separator < 0 ? value : value.slice(0, separator)).trim();
  const tail = separator < 0 ? '' : value.slice(separator + 1).trim();
  const startMs = parseTaipei(head);
  if (startMs === null) return null;
  return {
    startMs,
    hasTime: head.includes(':'),
    explicitEndMs: tail ? parseTaipei(formatTaipei(startMs, 'YYYY/MM/DD') + ' ' + tail) : null,
  };
}

export function parseEventStartMs(value: unknown): number | null {
  return parseEventDate(value)?.startMs ?? null;
}

/** 範圍型沿用 +2h 後備；explicitEndMs 早於起點時不加一天。 */
export function parseEventRangeMs(value: unknown): { startMs: number; endMs: number } | null {
  const parsed = parseEventDate(value);
  return parsed === null ? null : {
    startMs: parsed.startMs,
    endMs: parsed.explicitEndMs ?? parsed.startMs + EVENT_DEFAULT_DURATION_MS,
  };
}

/** 保留既有 23:59:59（不是 23:59:00，也不是 23:59:59.999）。 */
export function eventEndOfDayMs(startMs: number): number {
  return taipeiStartOfDay(startMs) + 86_400_000 - 1000;
}
