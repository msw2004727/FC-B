/**
 * 日誌中心時間區間（2026-11-16 站長：要有時間區間選擇，月／週／日單位）與每頁筆數（10／20／30／無限）。
 * 純函式；區間一律以台北時間（UTC+8，無日光節約）切日界，週一為一週開始。
 */
export type RangeUnit = 'day' | 'week' | 'month';
export type PageSizeOption = 10 | 20 | 30 | 'infinite';

export const PAGE_SIZE_OPTIONS: readonly PageSizeOption[] = [10, 20, 30, 'infinite'];
/** 「無限」時每次往下捲自動補抓的筆數。 */
export const INFINITE_CHUNK = 30;

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LogRange {
  unit: RangeUnit;
  /** 區間起點（含），毫秒。 */
  startMs: number;
  /** 區間終點（不含），毫秒。 */
  endMs: number;
}

/** 台北牆鐘的年月日（以 UTC 欄位表示）。 */
function taipeiParts(ms: number): { y: number; m: number; d: number; dow: number } {
  const t = new Date(ms + TAIPEI_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), dow: t.getUTCDay() };
}

function taipeiMidnight(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d) - TAIPEI_OFFSET_MS;
}

/** 含 `anchorMs` 的那一日／週／月。 */
export function rangeContaining(unit: RangeUnit, anchorMs: number): LogRange {
  const { y, m, d, dow } = taipeiParts(anchorMs);
  if (unit === 'day') {
    const start = taipeiMidnight(y, m, d);
    return { unit, startMs: start, endMs: start + DAY_MS };
  }
  if (unit === 'week') {
    const back = (dow + 6) % 7; // 週一＝0
    const start = taipeiMidnight(y, m, d - back);
    return { unit, startMs: start, endMs: start + 7 * DAY_MS };
  }
  return { unit, startMs: taipeiMidnight(y, m, 1), endMs: taipeiMidnight(y, m + 1, 1) };
}

/** 往前（-1）或往後（+1）一個單位。 */
export function shiftRange(range: LogRange, step: -1 | 1): LogRange {
  const anchor = step < 0 ? range.startMs - 1 : range.endMs;
  return rangeContaining(range.unit, anchor);
}

/** 區間終點已超過現在＝最新一段，不能再往後。 */
export function isLatestRange(range: LogRange, nowMs: number): boolean {
  return range.endMs > nowMs;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 區間標籤：日 `2026/11/16`；週 `11/10–11/16`；月 `2026/11`。 */
export function formatRangeLabel(range: LogRange): string {
  const s = taipeiParts(range.startMs);
  if (range.unit === 'day') return `${s.y}/${pad(s.m + 1)}/${pad(s.d)}`;
  if (range.unit === 'month') return `${s.y}/${pad(s.m + 1)}`;
  const e = taipeiParts(range.endMs - 1);
  return `${pad(s.m + 1)}/${pad(s.d)}–${pad(e.m + 1)}/${pad(e.d)}`;
}
