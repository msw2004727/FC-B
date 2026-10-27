/**
 * 台北時間 helper（T-054a）。
 *
 * 站內「無時區時間字串」（活動 `date` 的 `YYYY/MM/DD HH:mm~HH:mm`、`regOpenTime` 的 `YYYY-MM-DDTHH:mm`、
 * 公告／廣告 `publishAt`／`unpublishAt` 的 `YYYY/MM/DD HH:mm`…）語意一律是 Asia/Taipei（UTC+8）牆鐘。
 * 後端 Functions 已照此解析（functions/index.js 的 parseEventStartDateInTaipei 等）；
 * 前端若用 `new Date(y, m, d, h, mi)`／`getHours()` 這類「裝置本地時區」寫法，
 * 裝置偏移 ≠ +8 的使用者會看到偏移的狀態判斷（T-051、T-053 盤點）。
 *
 * 本檔的規則：
 *  - 純函式，不依賴執行環境時區：只用 `Date.UTC`／`getUTC*`，不用 `getHours()`、不用 `new Date('YYYY/MM/DD HH:mm')`、
 *    不用 `Date.parse` 解析無時區字串、不用 `Intl`（舊 WebView 較慢且行為不一）。
 *  - 台北無夏令時間，偏移固定 +8 小時。
 *  - 解析一律回「絕對毫秒」或 `null`；不丟例外、不回 `NaN`。
 *  - 本卡只提供基礎，尚未有任何業務呼叫端使用（054b 起才逐步替換）。
 */

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 台北牆鐘欄位。`month` 為 1–12（不是 JS 的 0–11）；`weekday` 0＝週日。 */
export interface TaipeiParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

export type TaipeiFormatPattern =
  | 'YYYY/MM/DD HH:mm'
  | 'YYYY/MM/DD'
  | 'YYYY-MM-DD'
  | 'YYYY-MM-DDTHH:mm'
  | 'HH:mm';

export interface TaipeiRange {
  startMs: number;
  endMs: number;
}

/**
 * 站內無時區字串：`YYYY/MM/DD`、`YYYY-MM-DD`，後面可接（空白或 T）`H:mm[:ss]`，
 * 再可接 `~[H:mm]`（活動時間範圍，結束時間可缺）。月、日、時允許 1–2 位數（照 Functions 以 Number 解析的寬度）。
 * 日期分隔符號前後必須一致（\2 反向參照）。
 */
const WALL_CLOCK_RE =
  /^(\d{4})([/-])(\d{1,2})\2(\d{1,2})(?:(?:\s+|T)(\d{1,2}):(\d{2})(?::(\d{2}))?(?:~(?:(\d{1,2}):(\d{2}))?)?)?$/;

/** 帶明確時區的 ISO：只收 `Z` 或 `±hh:mm`，秒與小數秒可省。 */
const ZONED_ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function daysInMonth(year: number, month: number): number {
  // month 為 1–12：Date.UTC(year, month, 0) 是「該月最後一天」。
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidDate(year: number, month: number, day: number): boolean {
  // 年份 < 1000 時 Date.UTC 會把 0–99 對應到 1900–1999，一律視為無效。
  return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function isValidTime(hour: number, minute: number, second: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

function wallClockToMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  return Date.UTC(year, month - 1, day, hour, minute, second) - TAIPEI_OFFSET_MS;
}

interface WallClockScan {
  year: number;
  month: number;
  day: number;
  hasTime: boolean;
  hour: number;
  minute: number;
  second: number;
  /** `~` 後的結束時分；沒有 `~` 或 `~` 後為空時為 null。尚未驗證範圍。 */
  endHour: number | null;
  endMinute: number | null;
}

function scanWallClock(text: string): WallClockScan | null {
  const m = WALL_CLOCK_RE.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (!isValidDate(year, month, day)) return null;
  const hasTime = m[5] !== undefined;
  const hour = Number(m[5] ?? 0);
  const minute = Number(m[6] ?? 0);
  const second = Number(m[7] ?? 0);
  if (!isValidTime(hour, minute, second)) return null;
  return {
    year,
    month,
    day,
    hasTime,
    hour,
    minute,
    second,
    endHour: m[8] === undefined ? null : Number(m[8]),
    endMinute: m[9] === undefined ? null : Number(m[9]),
  };
}

function parseZonedIso(text: string): number | null {
  const m = ZONED_ISO_RE.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? 0);
  if (!isValidDate(year, month, day) || !isValidTime(hour, minute, second)) return null;
  const fraction = m[7];
  const millis = fraction ? Number(fraction.padEnd(3, '0').slice(0, 3)) : 0;
  let offsetMinutes = 0;
  if (m[8]) {
    const offsetHour = Number(m[9]);
    const offsetMinute = Number(m[10]);
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMinutes = (m[8] === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  }
  return Date.UTC(year, month - 1, day, hour, minute, second, millis) - offsetMinutes * 60_000;
}

function parseTaipeiString(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const clock = scanWallClock(text);
  if (clock) {
    return wallClockToMs(clock.year, clock.month, clock.day, clock.hour, clock.minute, clock.second);
  }
  return parseZonedIso(text);
}

interface TimestampLike {
  toMillis?: () => unknown;
  toDate?: () => unknown;
  seconds?: unknown;
  _seconds?: unknown;
  nanoseconds?: unknown;
  _nanoseconds?: unknown;
}

function isDate(value: unknown): value is Date {
  return Object.prototype.toString.call(value) === '[object Date]';
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timestampLikeToMillis(value: object): number | null {
  const v = value as TimestampLike;
  try {
    if (typeof v.toMillis === 'function') {
      const ms = finiteOrNull(v.toMillis());
      return ms === null ? null : Math.floor(ms);
    }
    if (typeof v.toDate === 'function') {
      const d = v.toDate();
      return isDate(d) ? finiteOrNull(d.getTime()) : null;
    }
  } catch {
    return null;
  }
  const seconds = finiteOrNull(typeof v.seconds === 'number' ? v.seconds : v._seconds);
  if (seconds === null) return null;
  const nanos = finiteOrNull(typeof v.nanoseconds === 'number' ? v.nanoseconds : v._nanoseconds) ?? 0;
  return seconds * 1000 + Math.floor(nanos / 1_000_000);
}

/**
 * 轉成絕對毫秒。
 *  - 無時區字串（`YYYY/MM/DD`、`YYYY/MM/DD HH:mm[:ss]`、`YYYY-MM-DD`、`YYYY-MM-DD[T ]HH:mm[:ss]`，
 *    可帶 `~HH:mm` 後綴，此時回起點）→ 當 Asia/Taipei 牆鐘。
 *  - 帶 `Z`／`±hh:mm` 的 ISO 字串、數字毫秒、`Date`、Firestore Timestamp 形物件
 *    （`toMillis()`／`toDate()`／`{seconds, nanoseconds}`）→ 原樣當絕對時間。
 *  - 格式不合、空字串、不存在的日期或時間（`2026/02/30`、`25:61`）、非有限數字 → `null`。
 */
export function parseTaipei(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string') return parseTaipeiString(input);
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (isDate(input)) return finiteOrNull(input.getTime());
  if (typeof input === 'object') return timestampLikeToMillis(input);
  return null;
}

/**
 * 解析活動時間範圍字串（`YYYY/MM/DD HH:mm~HH:mm`），行為與 functions/index.js 的
 * parseEventStartDateInTaipei／parseEventEndDateInTaipei 對齊：
 *  - 只有日期 → 當天 00:00～23:59（結束秒數為 0）。
 *  - 有開始時間但沒有結束時間（無 `~` 或 `~` 後為空）→ 結束＝開始。
 *  - 結束時間「早於」開始（嚴格小於，以分鐘精度比較，起點的秒不影響）→ 結束 +24 小時（跨日）；相等不加。
 *  - 結束時間超出 00:00–23:59 → `null`。
 * 只接受無時區的站內字串；其他型別一律 `null`。
 */
export function parseTaipeiRange(input: unknown): TaipeiRange | null {
  if (typeof input !== 'string') return null;
  const clock = scanWallClock(input.trim());
  if (!clock) return null;
  const startMs = wallClockToMs(clock.year, clock.month, clock.day, clock.hour, clock.minute, clock.second);
  let endMs: number;
  if (!clock.hasTime) {
    endMs = wallClockToMs(clock.year, clock.month, clock.day, 23, 59, 0);
  } else if (clock.endHour === null || clock.endMinute === null) {
    endMs = startMs;
  } else {
    if (!isValidTime(clock.endHour, clock.endMinute, 0)) return null;
    endMs = wallClockToMs(clock.year, clock.month, clock.day, clock.endHour, clock.endMinute, 0);
  }
  // 跨日判斷以分鐘精度比較（Functions 的起點沒有秒）；起點含秒且結束落在同一分鐘時，結束取起點，保持 endMs >= startMs。
  if (endMs < startMs - clock.second * 1000) endMs += DAY_MS;
  else if (endMs < startMs) endMs = startMs;
  return { startMs, endMs };
}

/** 絕對毫秒 → 台北牆鐘欄位。`ms` 須為有限數字（來自 `parseTaipei` 的非 null 結果或 `Date.now()`）。 */
export function taipeiParts(ms: number): TaipeiParts {
  const t = new Date(ms + TAIPEI_OFFSET_MS);
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    second: t.getUTCSeconds(),
    weekday: t.getUTCDay(),
  };
}

/** 絕對毫秒 → 台北牆鐘字串（預設 `YYYY/MM/DD HH:mm`，與既有寫入格式逐字相同）。非有限數字回空字串。 */
export function formatTaipei(ms: number, pattern: TaipeiFormatPattern = 'YYYY/MM/DD HH:mm'): string {
  const p = taipeiParts(ms);
  if (Number.isNaN(p.year)) return '';
  const y = String(p.year).padStart(4, '0');
  const mo = pad2(p.month);
  const d = pad2(p.day);
  const hh = pad2(p.hour);
  const mm = pad2(p.minute);
  switch (pattern) {
    case 'YYYY/MM/DD':
      return `${y}/${mo}/${d}`;
    case 'YYYY-MM-DD':
      return `${y}-${mo}-${d}`;
    case 'YYYY-MM-DDTHH:mm':
      return `${y}-${mo}-${d}T${hh}:${mm}`;
    case 'HH:mm':
      return `${hh}:${mm}`;
    case 'YYYY/MM/DD HH:mm':
      return `${y}/${mo}/${d} ${hh}:${mm}`;
  }
}

/** 台北日期鍵（`YYYY/MM/DD`）。取代 `toISOString().slice(0, 10)`（UTC 日期，台北 00:00–08:00 會取到昨天）。 */
export function taipeiDateKey(ms: number): string {
  return formatTaipei(ms, 'YYYY/MM/DD');
}

/** 該時刻所在台北日的 00:00（絕對毫秒）。 */
export function taipeiStartOfDay(ms: number): number {
  return Math.floor((ms + TAIPEI_OFFSET_MS) / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS;
}

/** 加減整數天；台北無夏令時間，所以牆鐘時刻不變。 */
export function addTaipeiDays(ms: number, days: number): number {
  return ms + days * DAY_MS;
}
