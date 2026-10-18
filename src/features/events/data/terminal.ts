/**
 * Terminal（已結束／取消）判定與列表頁籤 normalize。純函式，時間以 `now: number`（毫秒）注入。
 *
 * 對應 A：
 *   - event-list.js::_normalizeActivityTab（_hiddenActivityTabs = ['ended']）
 *   - event-list-stats.js::_isEventInActivityEndedTab / _getActivityEndedTabDate
 *     / _parseEventEndDate / _parseEventStartDate（R-EVT-002：結束時間 +6h 後才 terminal）
 *   - home-next-activity.js::parseEventDateRange / eventStartMs（純解析）
 */

export interface DateRange {
  startMs: number;
  endMs: number;
}

/** 6 小時（R-EVT-002） */
export const TERMINAL_DELAY_MS = 6 * 60 * 60 * 1000;

/** 預設活動長度（無結束時間時，A 取 start + 2h） */
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

const DATE_RE =
  /(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s*[~\uFF5E-]\s*(\d{1,2}):(\d{2}))?/;

/** 與 home-next-activity.js::toMillis 對齊（Firestore Timestamp / Date / 數字 / 字串） */
export function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'object') {
    const v = value as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
      nanoseconds?: number;
      _nanoseconds?: number;
    };
    if (typeof v.toMillis === 'function') {
      try {
        return v.toMillis();
      } catch {
        return 0;
      }
    }
    if (typeof v.toDate === 'function') {
      try {
        const d = v.toDate();
        return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
      } catch {
        return 0;
      }
    }
    const secRaw = typeof v.seconds === 'number' ? v.seconds : v._seconds;
    if (typeof secRaw === 'number' && Number.isFinite(secRaw)) {
      const nanoRaw = typeof v.nanoseconds === 'number' ? v.nanoseconds : v._nanoseconds;
      const nano = typeof nanoRaw === 'number' ? nanoRaw : 0;
      return secRaw * 1000 + Math.floor(nano / 1_000_000);
    }
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 與 home-next-activity.js::parseEventDateRange 對齊：
 *  - 支援「YYYY/M/D H:MM~H:MM」「YYYY/M/D H:MM-H:MM」
 *  - 無時間範圍 → start + 2h
 *  - 非字串 → toMillis → start + 2h
 */
export function parseEventDateRange(value: unknown): DateRange | null {
  if (!value) return null;
  if (typeof value !== 'string') {
    const ms = toMillis(value);
    return ms ? { startMs: ms, endMs: ms + DEFAULT_DURATION_MS } : null;
  }
  const raw = value.trim();
  const m = raw.match(DATE_RE);
  if (!m) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? { startMs: parsed, endMs: parsed + DEFAULT_DURATION_MS } : null;
  }
  const y = m[1];
  const mo = m[2];
  const d = m[3];
  const sh = m[4];
  const sm = m[5];
  if (!y || !mo || !d || !sh || !sm) return null;
  const year = Number(y);
  const month = Number(mo) - 1;
  const day = Number(d);
  const startHour = Number(sh);
  const startMinute = Number(sm);
  const eh = m[6];
  const em = m[7];
  const endHour = eh ? Number(eh) : startHour + 2;
  const endMinute = em ? Number(em) : startMinute;
  const start = new Date(year, month, day, startHour, startMinute, 0);
  const end = new Date(year, month, day, endHour, endMinute, 0);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

/** 取得活動起點毫秒（無效時回 0；呼叫端以 `> now` 判定 upcoming） */
export function eventStartMs(event: { date?: unknown; startAt?: unknown; startTime?: unknown } | null | undefined): number {
  if (!event) return 0;
  const range = parseEventDateRange(event.date ?? event.startAt ?? event.startTime);
  return range?.startMs ?? 0;
}

/* ── A event-list-stats.js 的日期解析（terminal 判定專用） ── */

function parseEventStartDate(dateStr: unknown): Date | null {
  if (typeof dateStr !== 'string' || !dateStr) return null;
  const parts = dateStr.split(' ');
  const dateParts = (parts[0] ?? '').split('/');
  if (dateParts.length < 3) return null;
  const y = parseInt(dateParts[0] ?? '', 10);
  const m = parseInt(dateParts[1] ?? '', 10) - 1;
  const d = parseInt(dateParts[2] ?? '', 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;

  const timePartRaw = parts[1];
  if (timePartRaw) {
    const timePart = timePartRaw.split('~')[0] ?? '';
    const [hh, mm] = timePart.split(':').map(Number);
    return new Date(y, m, d, hh || 0, mm || 0);
  }
  return new Date(y, m, d);
}

function parseEventEndDate(dateStr: unknown): Date | null {
  if (typeof dateStr !== 'string' || !dateStr) return null;
  const parts = dateStr.split(' ');
  const dateParts = (parts[0] ?? '').split('/');
  if (dateParts.length < 3) return null;
  const y = parseInt(dateParts[0] ?? '', 10);
  const m = parseInt(dateParts[1] ?? '', 10) - 1;
  const d = parseInt(dateParts[2] ?? '', 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;

  const timePartRaw = parts[1];
  if (!timePartRaw) return new Date(y, m, d, 23, 59, 59);

  const endRaw = timePartRaw.includes('~')
    ? (timePartRaw.split('~')[1] ?? '')
    : (timePartRaw.split('~')[0] ?? '');
  const [hh, mm] = (endRaw || '').split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
    return parseEventStartDate(dateStr);
  }
  return new Date(y, m, d, hh, mm);
}

function getActivityEndedTabDate(event: { date?: unknown } | null | undefined): Date | null {
  const end = parseEventEndDate(event?.date) || parseEventStartDate(event?.date);
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) return null;
  return new Date(end.getTime() + TERMINAL_DELAY_MS);
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
