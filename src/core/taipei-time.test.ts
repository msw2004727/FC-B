/**
 * taipei-time 的單元測試＋時區矩陣（T-054a）。
 *
 * 時區矩陣分兩層，斷言完全相同（期望值全是「帶 +08:00 的絕對時間」，與執行環境時區無關）：
 *  1. 行程層：測試以什麼 TZ 啟動就在什麼時區跑。CI 的 tz-matrix job 用 TZ 環境變數
 *     Asia/Taipei／Asia/Tokyo／UTC／America/Los_Angeles 各啟動一次。
 *  2. 行程內層：測試內用 `process.env.TZ = …` 逐一切換四個時區（Node 在 POSIX 會重新偵測時區），
 *     同一份斷言再跑一次，並涵蓋美西夏令開始（2026/03/08）與結束（2026/11/01）前後。
 *     這層需要平台支援執行期切換：啟動時先探測；探測失敗時（例如某些 Windows／worker thread 環境）
 *     這層暫停（describe.skipIf），但 CI 上探測失敗會直接紅燈（見「CI 必須支援…」案例），不會被靜默略過。
 *
 * 「反例保護」：故意寫三個用本地時區的突變體（T-051 的根因寫法），斷言它們在非台北時區必然與期望值不同，
 * 證明矩陣不是空轉；台北時區下突變體與期望值相同（所以該 bug 在台北開發機與台北使用者身上看不到）。
 *
 * 「與 Functions parity」：refParse* 是逐行移植自 functions/index.js 的 parseEventStartDateInTaipei、
 * parseEventEndDateInTaipei、parseEventRegOpenTimeInTaipei（本卡不修改 Functions）。
 * Functions 若改動，這份參照必須同步。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addTaipeiDays,
  formatTaipei,
  parseTaipei,
  parseTaipeiRange,
  taipeiDateKey,
  taipeiParts,
  taipeiStartOfDay,
  type TaipeiFormatPattern,
  type TaipeiParts,
} from './taipei-time';

const DAY = 86_400_000;

/** ISO 字串帶明確偏移 → 絕對毫秒，與執行環境時區無關。 */
function abs(iso: string): number {
  return Date.parse(iso);
}

function expectedMs(iso: string | null): number | null {
  return iso === null ? null : abs(iso);
}

/* ───────────── 時區切換工具 ───────────── */

const ZONES: readonly string[] = ['Asia/Taipei', 'Asia/Tokyo', 'UTC', 'America/Los_Angeles'];

/** getTimezoneOffset：西邊為正（美西冬令 480、夏令 420）。 */
const EXPECTED_OFFSETS: Record<string, { winter: number; summer: number }> = {
  'Asia/Taipei': { winter: -480, summer: -480 },
  'Asia/Tokyo': { winter: -540, summer: -540 },
  UTC: { winter: 0, summer: 0 },
  'America/Los_Angeles': { winter: 480, summer: 420 },
};

const STARTUP_TZ = process.env.TZ;
/**
 * 還原用的時區：TZ 環境變數有值就用它，沒有就取 ICU 偵測到的系統時區（只在測試檔用 Intl，helper 本身不用），
 * 還原一律明確賦值，不用 delete（Windows 上 delete 後可能停在探測最後設的時區）。
 */
const STARTUP_ZONE = STARTUP_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

function currentOffsets(): { winter: number; summer: number } {
  return {
    winter: new Date(Date.UTC(2026, 0, 15, 12)).getTimezoneOffset(),
    summer: new Date(Date.UTC(2026, 6, 15, 12)).getTimezoneOffset(),
  };
}

function setZone(zone: string): void {
  process.env.TZ = zone;
}

function restoreZone(): void {
  process.env.TZ = STARTUP_ZONE;
}

function isTaipeiZone(): boolean {
  const o = currentOffsets();
  return o.winter === -480 && o.summer === -480;
}

function zoneSwitchWorks(): boolean {
  try {
    setZone('Asia/Tokyo');
    const tokyo = currentOffsets().winter === -540;
    setZone('UTC');
    const utc = currentOffsets().winter === 0;
    return tokyo && utc;
  } finally {
    restoreZone();
  }
}

const CAN_SWITCH_ZONE = zoneSwitchWorks();

/* ───────────── 案例表 ───────────── */

interface ParseCase {
  name: string;
  input: string;
  /** 期望的絕對時間（帶 +08:00 的 ISO），無效輸入為 null。 */
  expected: string | null;
}

const PARSE_CASES: readonly ParseCase[] = [
  // 站內無時區字串 → 台北牆鐘
  { name: '斜線日期時間', input: '2026/10/19 11:00', expected: '2026-10-19T11:00:00+08:00' },
  { name: '斜線只有日期', input: '2026/10/19', expected: '2026-10-19T00:00:00+08:00' },
  { name: '斜線含秒', input: '2026/10/19 11:00:30', expected: '2026-10-19T11:00:30+08:00' },
  { name: '月日單位數', input: '2026/1/5 9:05', expected: '2026-01-05T09:05:00+08:00' },
  { name: '活動範圍字串取起點', input: '2026/10/19 11:00~13:00', expected: '2026-10-19T11:00:00+08:00' },
  { name: '跨日範圍字串取起點', input: '2026/10/19 23:00~01:00', expected: '2026-10-19T23:00:00+08:00' },
  { name: '範圍結束為空', input: '2026/10/19 11:00~', expected: '2026-10-19T11:00:00+08:00' },
  { name: '前後空白', input: '  2026/10/19 11:00  ', expected: '2026-10-19T11:00:00+08:00' },
  { name: '破折號只有日期', input: '2026-10-19', expected: '2026-10-19T00:00:00+08:00' },
  { name: 'datetime-local', input: '2026-10-19T09:00', expected: '2026-10-19T09:00:00+08:00' },
  { name: 'datetime-local 含秒', input: '2026-10-19T09:00:15', expected: '2026-10-19T09:00:15+08:00' },
  { name: '破折號加空白', input: '2026-10-19 09:00', expected: '2026-10-19T09:00:00+08:00' },
  // 台北 00:00–08:00（UTC 日期與台北日期不同日）
  { name: '台北 00:30', input: '2026/10/19 00:30', expected: '2026-10-19T00:30:00+08:00' },
  { name: '台北 07:59', input: '2026/10/19 07:59', expected: '2026-10-19T07:59:00+08:00' },
  { name: '台北 23:59', input: '2026/10/19 23:59', expected: '2026-10-19T23:59:00+08:00' },
  // 年、月、閏年邊界
  { name: '年底', input: '2026/12/31 23:59', expected: '2026-12-31T23:59:00+08:00' },
  { name: '年初', input: '2027/01/01 00:00', expected: '2027-01-01T00:00:00+08:00' },
  { name: '閏年 2/29', input: '2028/02/29 10:00', expected: '2028-02-29T10:00:00+08:00' },
  { name: '世紀閏年 2000/02/29', input: '2000/02/29 10:00', expected: '2000-02-29T10:00:00+08:00' },
  { name: '31 日月底', input: '2026/10/31 23:59', expected: '2026-10-31T23:59:00+08:00' },
  { name: '30 日月底', input: '2026/11/30 23:59', expected: '2026-11-30T23:59:00+08:00' },
  // 美西夏令／冬令與夏令轉換日（本地解析在這些日期的偏移各不相同）
  { name: '美西夏令期間', input: '2026/07/15 12:00', expected: '2026-07-15T12:00:00+08:00' },
  { name: '美西冬令期間', input: '2026/01/15 12:00', expected: '2026-01-15T12:00:00+08:00' },
  { name: '美西夏令開始日（本地不存在的時刻）', input: '2026/03/08 02:30', expected: '2026-03-08T02:30:00+08:00' },
  { name: '美西夏令結束日（本地重複的時刻）', input: '2026/11/01 01:30', expected: '2026-11-01T01:30:00+08:00' },
  // 已帶明確時區 → 原樣當絕對時間
  { name: 'ISO Z', input: '2026-10-19T04:00:00Z', expected: '2026-10-19T12:00:00+08:00' },
  { name: 'ISO +08:00', input: '2026-10-19T12:00:00+08:00', expected: '2026-10-19T12:00:00+08:00' },
  { name: 'ISO +09:00', input: '2026-10-19T13:00:00+09:00', expected: '2026-10-19T12:00:00+08:00' },
  { name: 'ISO -07:00', input: '2026-10-18T21:00:00-07:00', expected: '2026-10-19T12:00:00+08:00' },
  { name: 'ISO 偏移無秒', input: '2026-10-19T12:00+08:00', expected: '2026-10-19T12:00:00+08:00' },
  { name: 'ISO 小數秒 3 位', input: '2026-10-19T04:00:00.123Z', expected: '2026-10-19T12:00:00.123+08:00' },
  { name: 'ISO 小數秒 1 位', input: '2026-10-19T04:00:00.5Z', expected: '2026-10-19T12:00:00.500+08:00' },
  // 無效輸入 → null（不丟例外、不回 NaN）
  { name: '空字串', input: '', expected: null },
  { name: '空白字串', input: '   ', expected: null },
  { name: '非日期文字', input: 'abc', expected: null },
  { name: '月份 13', input: '2026/13/01', expected: null },
  { name: '月份 0', input: '2026/00/10', expected: null },
  { name: '日 0', input: '2026/10/00', expected: null },
  { name: '日 32', input: '2026/10/32', expected: null },
  { name: '2/30', input: '2026/02/30', expected: null },
  { name: '非閏年 2/29', input: '2026/02/29', expected: null },
  { name: '世紀非閏年 2100/02/29', input: '2100/02/29', expected: null },
  { name: '4/31', input: '2026/04/31', expected: null },
  { name: '11/31', input: '2026/11/31', expected: null },
  { name: '24:00', input: '2026/10/19 24:00', expected: null },
  { name: '25:61', input: '2026/10/19 25:61', expected: null },
  { name: '分鐘 60', input: '2026/10/19 11:60', expected: null },
  { name: '秒 60', input: '2026/10/19 11:00:60', expected: null },
  { name: '只有小時', input: '2026/10/19 11', expected: null },
  { name: '尾隨文字', input: '2026/10/19 11:00 extra', expected: null },
  { name: '英文日期', input: 'Oct 19 2026', expected: null },
  { name: '純數字', input: '20261019', expected: null },
  { name: '只有年月', input: '2026/10', expected: null },
  { name: '日期分隔符號混用', input: '2026/10-19', expected: null },
  { name: '兩位數年份', input: '0099/01/01', expected: null },
  { name: '無時區帶小數秒', input: '2026-10-19T09:00:00.500', expected: null },
  { name: 'ISO 日期不存在', input: '2026-02-30T10:00:00Z', expected: null },
  { name: 'ISO 24 時', input: '2026-10-19T24:00:00Z', expected: null },
  { name: 'ISO 偏移超界', input: '2026-10-19T10:00:00+25:00', expected: null },
  { name: 'ISO 偏移無冒號', input: '2026-10-19T10:00:00+0800', expected: null },
  { name: 'ISO 小寫 z', input: '2026-10-19T04:00:00z', expected: null },
  { name: 'ISO 空白分隔含 Z', input: '2026-10-19 04:00:00Z', expected: null },
];

interface RangeCase {
  name: string;
  input: unknown;
  start: string | null;
  end: string | null;
}

const RANGE_CASES: readonly RangeCase[] = [
  { name: '同日範圍', input: '2026/10/19 11:00~13:00', start: '2026-10-19T11:00:00+08:00', end: '2026-10-19T13:00:00+08:00' },
  { name: '跨日範圍 +24h', input: '2026/10/19 23:00~01:00', start: '2026-10-19T23:00:00+08:00', end: '2026-10-20T01:00:00+08:00' },
  { name: '跨年範圍', input: '2026/12/31 22:00~02:00', start: '2026-12-31T22:00:00+08:00', end: '2027-01-01T02:00:00+08:00' },
  { name: '跨閏日範圍', input: '2028/02/28 23:00~01:00', start: '2028-02-28T23:00:00+08:00', end: '2028-02-29T01:00:00+08:00' },
  { name: '無結束時間 → 結束＝開始', input: '2026/10/19 11:00', start: '2026-10-19T11:00:00+08:00', end: '2026-10-19T11:00:00+08:00' },
  { name: '結束為空 → 結束＝開始', input: '2026/10/19 11:00~', start: '2026-10-19T11:00:00+08:00', end: '2026-10-19T11:00:00+08:00' },
  { name: '結束等於開始 → 不加 24h', input: '2026/10/19 11:00~11:00', start: '2026-10-19T11:00:00+08:00', end: '2026-10-19T11:00:00+08:00' },
  { name: '只有日期 → 當天 23:59', input: '2026/10/19', start: '2026-10-19T00:00:00+08:00', end: '2026-10-19T23:59:00+08:00' },
  { name: '起點含秒、無結束 → 結束＝開始', input: '2026/10/19 11:00:30', start: '2026-10-19T11:00:30+08:00', end: '2026-10-19T11:00:30+08:00' },
  // 起點含秒：跨日判斷以分鐘精度比較（對齊 Functions，起點沒有秒）
  { name: '起點含秒、結束在同一分鐘 → 不加 24h，結束取起點', input: '2026/10/19 11:00:30~11:00', start: '2026-10-19T11:00:30+08:00', end: '2026-10-19T11:00:30+08:00' },
  { name: '起點含秒、結束較晚', input: '2026/10/19 11:00:30~13:00', start: '2026-10-19T11:00:30+08:00', end: '2026-10-19T13:00:00+08:00' },
  { name: '起點含秒、結束早一分鐘 → 加 24h', input: '2026/10/19 11:00:30~10:59', start: '2026-10-19T11:00:30+08:00', end: '2026-10-20T10:59:00+08:00' },
  { name: '起點含秒、跨日', input: '2026/10/19 23:00:30~01:00', start: '2026-10-19T23:00:30+08:00', end: '2026-10-20T01:00:00+08:00' },
  { name: '結束小時超界', input: '2026/10/19 11:00~25:00', start: null, end: null },
  { name: '結束分鐘超界', input: '2026/10/19 11:00~12:60', start: null, end: null },
  { name: '日期不存在', input: '2026/02/30 10:00~11:00', start: null, end: null },
  { name: '空字串', input: '', start: null, end: null },
  { name: 'null', input: null, start: null, end: null },
  { name: 'undefined', input: undefined, start: null, end: null },
  { name: '數字', input: 1760000000000, start: null, end: null },
  { name: 'Date', input: new Date(1760000000000), start: null, end: null },
  { name: '帶時區 ISO 不屬於站內範圍字串', input: '2026-10-19T04:00:00Z', start: null, end: null },
];

interface PartsCase {
  iso: string;
  parts: TaipeiParts;
  /** `YYYY/MM/DD HH:mm`；其他格式由此衍生。 */
  text: string;
}

const PARTS_CASES: readonly PartsCase[] = [
  // UTC 日期為 2026-10-18（週日），台北已是 10/19（週一）
  { iso: '2026-10-19T00:30:00+08:00', parts: { year: 2026, month: 10, day: 19, hour: 0, minute: 30, second: 0, weekday: 1 }, text: '2026/10/19 00:30' },
  { iso: '2026-10-18T23:59:59+08:00', parts: { year: 2026, month: 10, day: 18, hour: 23, minute: 59, second: 59, weekday: 0 }, text: '2026/10/18 23:59' },
  { iso: '2026-10-19T08:00:00+08:00', parts: { year: 2026, month: 10, day: 19, hour: 8, minute: 0, second: 0, weekday: 1 }, text: '2026/10/19 08:00' },
  { iso: '2026-12-31T23:59:00+08:00', parts: { year: 2026, month: 12, day: 31, hour: 23, minute: 59, second: 0, weekday: 4 }, text: '2026/12/31 23:59' },
  { iso: '2027-01-01T00:00:00+08:00', parts: { year: 2027, month: 1, day: 1, hour: 0, minute: 0, second: 0, weekday: 5 }, text: '2027/01/01 00:00' },
  { iso: '2028-02-29T12:00:00+08:00', parts: { year: 2028, month: 2, day: 29, hour: 12, minute: 0, second: 0, weekday: 2 }, text: '2028/02/29 12:00' },
  { iso: '2026-07-15T12:00:00+08:00', parts: { year: 2026, month: 7, day: 15, hour: 12, minute: 0, second: 0, weekday: 3 }, text: '2026/07/15 12:00' },
  { iso: '2026-01-15T12:00:00+08:00', parts: { year: 2026, month: 1, day: 15, hour: 12, minute: 0, second: 0, weekday: 4 }, text: '2026/01/15 12:00' },
];

/** 每個格式的期望字串，由 `YYYY/MM/DD HH:mm` 衍生。 */
function expectedFormats(text: string): Record<TaipeiFormatPattern, string> {
  const date = text.slice(0, 10);
  const time = text.slice(11);
  return {
    'YYYY/MM/DD HH:mm': text,
    'YYYY/MM/DD': date,
    'YYYY-MM-DD': date.replace(/\//g, '-'),
    'YYYY-MM-DDTHH:mm': `${date.replace(/\//g, '-')}T${time}`,
    'HH:mm': time,
  };
}

function sweepMs(startIso: string, hours: number, stepMinutes: number): number[] {
  const start = abs(startIso);
  const out: number[] = [];
  for (let t = start; t < start + hours * 3_600_000; t += stepMinutes * 60_000) out.push(t);
  return out;
}

/* ───────────── Functions 參照（逐行移植自 functions/index.js） ───────────── */

function refSplitDate(dateStr: unknown): { rawTimePart: string; year: number; month: number; day: number } | null {
  if (typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  const [rawDatePart = '', rawTimePart = ''] = trimmed.split(/\s+/, 2);
  const dateParts = rawDatePart.split('/').map((part) => Number(part));
  if (dateParts.length < 3 || dateParts.some((part) => !Number.isFinite(part))) return null;
  const [year = NaN, month = NaN, day = NaN] = dateParts;
  return { rawTimePart, year, month, day };
}

function refInRange(year: number, month: number, day: number, hours: number, minutes: number): boolean {
  if (![year, month, day, hours, minutes].every((n) => Number.isInteger(n))) return false;
  return !(month < 1 || month > 12 || day < 1 || day > 31 || hours < 0 || hours > 23 || minutes < 0 || minutes > 59);
}

/** functions/index.js parseEventStartDateInTaipei（回傳毫秒或 null）。 */
function refParseStart(dateStr: unknown): number | null {
  const s = refSplitDate(dateStr);
  if (!s) return null;
  let hours = 0;
  let minutes = 0;
  if (s.rawTimePart) {
    const startTimePart = s.rawTimePart.split('~')[0] ?? '';
    const timeParts = startTimePart.split(':').map((part) => Number(part));
    if (timeParts.length >= 2 && Number.isFinite(timeParts[0]) && Number.isFinite(timeParts[1])) {
      hours = timeParts[0] ?? 0;
      minutes = timeParts[1] ?? 0;
    }
  }
  if (!refInRange(s.year, s.month, s.day, hours, minutes)) return null;
  return Date.UTC(s.year, s.month - 1, s.day, hours - 8, minutes, 0, 0);
}

/** functions/index.js parseEventEndDateInTaipei（回傳毫秒或 null）。 */
function refParseEnd(dateStr: unknown): number | null {
  const s = refSplitDate(dateStr);
  if (!s) return null;
  let hours = 23;
  let minutes = 59;
  if (s.rawTimePart) {
    const endTimePart = s.rawTimePart.includes('~') ? s.rawTimePart.split('~')[1] : s.rawTimePart.split('~')[0];
    const timeParts = String(endTimePart || '').split(':').map((part) => Number(part));
    if (timeParts.length >= 2 && Number.isFinite(timeParts[0]) && Number.isFinite(timeParts[1])) {
      hours = timeParts[0] ?? 0;
      minutes = timeParts[1] ?? 0;
    } else {
      return refParseStart(dateStr);
    }
  }
  if (!refInRange(s.year, s.month, s.day, hours, minutes)) return null;
  const start = refParseStart(dateStr);
  let end = Date.UTC(s.year, s.month - 1, s.day, hours - 8, minutes, 0, 0);
  if (start !== null && end < start) end += DAY;
  return end;
}

/** functions/index.js parseEventRegOpenTimeInTaipei（回傳毫秒或 null）。 */
function refParseRegOpen(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const v = value as { toDate?: () => Date; seconds?: unknown; nanoseconds?: unknown };
  if (typeof v.toDate === 'function') {
    try {
      return v.toDate().getTime();
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && typeof v.seconds === 'number') {
    return v.seconds * 1000 + Math.floor((Number(v.nanoseconds) || 0) / 1_000_000);
  }
  const text = String(value || '').trim();
  if (!text) return null;
  const local = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    const [, y, m, d, h, min, s = '0'] = local;
    return Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h) - 8, Number(min), Number(s), 0);
  }
  const parsed = new Date(text).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/** 與 Functions 行為逐位元相同的輸入（斜線格式、活動範圍字串）。 */
const PARITY_EVENT_DATES: readonly string[] = [
  '2026/10/19 11:00~13:00',
  '2026/10/19 11:00',
  '2026/10/19',
  '2026/1/5 9:05',
  '2026/10/19 00:00~23:59',
  '2026/12/31 23:59',
  '2028/02/29 10:00',
  '2026/10/19 23:00~01:00',
  '2026/12/31 22:00~02:00',
  '2026/10/19 11:00~11:00',
  '2026/10/19 11:00~',
  '  2026/10/19 11:00~13:00  ',
  '2026/10/19 00:30~08:00',
  '2026/10/31 23:00~02:00',
  '',
  '   ',
  'abc',
  '2026/13/01',
  '2026/00/10',
  '2026/10/00',
  '2026/10/32',
  '2026/10/19 24:00',
  '2026/10/19 11:60',
  '2026/10/19 25:61',
  '2026/10/19 11:00~25:00',
  '2026/10/19 11:00~12:60',
];

const PARITY_REG_OPEN_VALUES: readonly unknown[] = [
  '2026-10-19T09:00',
  '2026-10-19T09:00:30',
  '2026-10-19T00:00',
  '2026-12-31T23:59',
  '2026-10-19T04:00:00Z',
  '2026-10-19T12:00:00+08:00',
  '2026-10-19T04:00:00.123Z',
  new Date(1760000000000),
  { toDate: () => new Date(1760000000123) },
  { seconds: 1760000000, nanoseconds: 500_000_000 },
  { seconds: 1760000000 },
  '',
  '   ',
  null,
  undefined,
  'abc',
];

interface DivergenceCase {
  name: string;
  input: unknown;
  /** Functions 的起點／終點／報名開放解析結果（毫秒的 ISO 描述；null＝回 null；不寫＝不斷言）。 */
  functions: { start?: string | null; end?: string | null; regOpen?: string | null };
  /** `parseTaipei` 的結果。 */
  helper: string | null;
  /** `parseTaipeiRange` 的終點（null＝整個範圍回 null）；不寫＝不斷言。 */
  helperEnd?: string | null;
}

/**
 * 刻意與 Functions 不同的地方（簡報要求不存在日期回 null；其餘為更嚴格的格式檢查）。
 * 正式資料不應出現這些輸入；054c 收斂前應先唯讀掃描正式庫確認。
 */
const DIVERGENCES: readonly DivergenceCase[] = [
  {
    name: '不存在的日期：Functions 溢位進下個月，helper 回 null',
    input: '2026/02/30 10:00',
    functions: { start: '2026-03-02T10:00:00+08:00' },
    helper: null,
  },
  {
    name: '斜線格式含秒：Functions 忽略秒，helper 保留秒',
    input: '2026/10/19 11:00:30',
    functions: { start: '2026-10-19T11:00:00+08:00' },
    helper: '2026-10-19T11:00:30+08:00',
  },
  {
    name: '時間文字無法解析：Functions 退回 00:00，helper 回 null',
    input: '2026/10/19 abc',
    functions: { start: '2026-10-19T00:00:00+08:00' },
    helper: null,
  },
  {
    name: '只有小時沒有分鐘：Functions 退回 00:00，helper 回 null',
    input: '2026/10/19 11',
    functions: { start: '2026-10-19T00:00:00+08:00' },
    helper: null,
  },
  {
    name: '結束時間無法解析：Functions 退回起點，helper 整串回 null',
    input: '2026/10/19 11:00~abc',
    functions: { start: '2026-10-19T11:00:00+08:00', end: '2026-10-19T11:00:00+08:00' },
    helper: null,
  },
  {
    name: '多餘片段：Functions 只取前兩段，helper 回 null',
    input: '2026/10/19 11:00 extra',
    functions: { start: '2026-10-19T11:00:00+08:00' },
    helper: null,
  },
  {
    name: '起點含秒的範圍：helper 保留秒，但跨日判斷以分鐘比較（Functions 起訖皆忽略秒）',
    input: '2026/10/19 11:00:30~11:00',
    functions: { start: '2026-10-19T11:00:00+08:00', end: '2026-10-19T11:00:00+08:00' },
    helper: '2026-10-19T11:00:30+08:00',
    helperEnd: '2026-10-19T11:00:30+08:00',
  },
  {
    name: '斜線日期接 T：Functions 回 null，helper 當台北',
    input: '2026/10/19T11:00',
    functions: { start: null },
    helper: '2026-10-19T11:00:00+08:00',
  },
  {
    name: '範圍分隔前後有空白：Functions 只取前兩段（終點＝起點），helper 回 null',
    input: '2026/10/19 11:00 ~ 13:00',
    functions: { start: '2026-10-19T11:00:00+08:00', end: '2026-10-19T11:00:00+08:00' },
    helper: null,
    helperEnd: null,
  },
  {
    name: '全形波浪號 U+FF5E：Functions 退回 00:00（起訖皆是），helper 回 null',
    input: '2026/10/19 11:00～13:00',
    functions: { start: '2026-10-19T00:00:00+08:00', end: '2026-10-19T00:00:00+08:00' },
    helper: null,
    helperEnd: null,
  },
  {
    name: '連字號範圍 11:00-13:00：Functions 退回 00:00（起訖皆是），helper 回 null',
    input: '2026/10/19 11:00-13:00',
    functions: { start: '2026-10-19T00:00:00+08:00', end: '2026-10-19T00:00:00+08:00' },
    helper: null,
    helperEnd: null,
  },
  {
    name: '只有日期後接 ~13:00：Functions 起點 00:00、終點 13:00，helper 回 null',
    input: '2026/10/19 ~13:00',
    functions: { start: '2026-10-19T00:00:00+08:00', end: '2026-10-19T13:00:00+08:00' },
    helper: null,
    helperEnd: null,
  },
  {
    name: '分鐘只有 1 位數：Functions 接受，helper 回 null',
    input: '2026/10/19 9:5',
    functions: { start: '2026-10-19T09:05:00+08:00' },
    helper: null,
  },
  {
    name: 'regOpen 輸入是數字：Functions 先轉字串再 new Date（此處不斷言其結果），helper 直接當毫秒',
    input: 1760000000000,
    functions: {},
    helper: new Date(1760000000000).toISOString(),
  },
  {
    name: '破折號只有日期：Functions 經 new Date 當 UTC 午夜，helper 當台北午夜',
    input: '2026-10-19',
    functions: { regOpen: '2026-10-19T00:00:00Z' },
    helper: '2026-10-19T00:00:00+08:00',
  },
  {
    name: 'datetime-local 月份溢位：Functions 滾進下一年，helper 回 null',
    input: '2026-13-19T09:00',
    functions: { regOpen: '2027-01-19T09:00:00+08:00' },
    helper: null,
  },
];

/* ───────────── 突變體（反例保護）：故意用裝置本地時區 ───────────── */

/** T-051 的根因寫法：`new Date(y, m, d, h, mi)` 以裝置本地時區解析站內字串。 */
function localParseMutant(text: string): number | null {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
}

/** 用 `getHours()` 等本地欄位把絕對時間格式化成站內字串。 */
function localFormatMutant(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** `toISOString().slice(0, 10)` 當「今天」：UTC 日期，台北 00:00–08:00 會取到昨天（與使用者時區無關）。 */
function utcDateKeyMutant(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, '/');
}

/* ───────────── 測試本體（每個時區各註冊一次） ───────────── */

function registerHelperSuite(): void {
  describe('parseTaipei', () => {
    it.each(PARSE_CASES)('$name', ({ input, expected }) => {
      expect(parseTaipei(input)).toBe(expectedMs(expected));
    });

    it('數字毫秒原樣回傳，非有限數字回 null', () => {
      expect(parseTaipei(1760000000000)).toBe(1760000000000);
      expect(parseTaipei(0)).toBe(0);
      expect(parseTaipei(Number.NaN)).toBeNull();
      expect(parseTaipei(Number.POSITIVE_INFINITY)).toBeNull();
      expect(parseTaipei(Number.NEGATIVE_INFINITY)).toBeNull();
    });

    it('Date 取 getTime，Invalid Date 回 null', () => {
      expect(parseTaipei(new Date(1760000000123))).toBe(1760000000123);
      expect(parseTaipei(new Date(Number.NaN))).toBeNull();
    });

    it('Firestore Timestamp 形物件', () => {
      expect(parseTaipei({ toMillis: () => 1760000000000 })).toBe(1760000000000);
      expect(parseTaipei({ toDate: () => new Date(1760000000123) })).toBe(1760000000123);
      expect(parseTaipei({ seconds: 1760000000, nanoseconds: 500_000_000 })).toBe(1760000000500);
      expect(parseTaipei({ _seconds: 1760000000, _nanoseconds: 1_000_000 })).toBe(1760000000001);
      expect(parseTaipei({ seconds: 1760000000 })).toBe(1760000000000);
    });

    it('toMillis 的小數毫秒取整（Math.floor），且 toMillis 優先於 toDate', () => {
      expect(parseTaipei({ toMillis: () => 1760000000123.7 })).toBe(1760000000123);
      expect(
        parseTaipei({
          toMillis: () => 1760000000123.9,
          toDate: () => new Date(1760000000999),
        }),
      ).toBe(1760000000123);
      expect(parseTaipei({ toMillis: () => -1.5 })).toBe(-2);
    });

    it('Timestamp 形物件異常 → null（不丟例外）', () => {
      expect(
        parseTaipei({
          toMillis: () => {
            throw new Error('boom');
          },
        }),
      ).toBeNull();
      expect(parseTaipei({ toMillis: () => Number.NaN })).toBeNull();
      expect(parseTaipei({ toDate: () => new Date(Number.NaN) })).toBeNull();
      expect(parseTaipei({ toDate: () => 'not a date' })).toBeNull();
      expect(parseTaipei({ seconds: 'x' })).toBeNull();
      expect(parseTaipei({})).toBeNull();
      expect(parseTaipei([])).toBeNull();
    });

    it('null、undefined 與其他型別回 null', () => {
      expect(parseTaipei(null)).toBeNull();
      expect(parseTaipei(undefined)).toBeNull();
      expect(parseTaipei(true)).toBeNull();
      expect(parseTaipei(10n)).toBeNull();
      expect(parseTaipei(() => 1)).toBeNull();
      expect(parseTaipei(Symbol('x'))).toBeNull();
    });

    it('結果只會是有限數字或 null，不會是 NaN', () => {
      const results = PARSE_CASES.map((c) => parseTaipei(c.input));
      for (const r of results) {
        expect(r === null || Number.isFinite(r)).toBe(true);
      }
    });
  });

  describe('parseTaipeiRange', () => {
    it.each(RANGE_CASES)('$name', ({ input, start, end }) => {
      const r = parseTaipeiRange(input);
      if (start === null || end === null) {
        expect(r).toBeNull();
      } else {
        expect(r).toEqual({ startMs: abs(start), endMs: abs(end) });
      }
    });
  });

  describe('taipeiParts／formatTaipei／taipeiDateKey', () => {
    it.each(PARTS_CASES)('$iso', ({ iso, parts, text }) => {
      const t = abs(iso);
      expect(taipeiParts(t)).toEqual(parts);
      const formats = expectedFormats(text);
      for (const pattern of Object.keys(formats) as TaipeiFormatPattern[]) {
        expect(formatTaipei(t, pattern)).toBe(formats[pattern]);
      }
      expect(formatTaipei(t)).toBe(text);
      expect(taipeiDateKey(t)).toBe(formats['YYYY/MM/DD']);
    });

    it('非有限數字或超出 Date 範圍 → 空字串', () => {
      expect(formatTaipei(Number.NaN)).toBe('');
      expect(formatTaipei(Number.POSITIVE_INFINITY)).toBe('');
      expect(formatTaipei(8.64e15)).toBe('');
      expect(taipeiDateKey(Number.NaN)).toBe('');
    });

    it('格式化後再解析會回到原值（整分鐘）', () => {
      for (const c of PARTS_CASES) {
        const t = abs(c.iso) - c.parts.second * 1000;
        expect(parseTaipei(formatTaipei(t))).toBe(t);
        expect(parseTaipei(formatTaipei(t, 'YYYY-MM-DDTHH:mm'))).toBe(t);
      }
    });
  });

  describe('taipeiStartOfDay／addTaipeiDays', () => {
    it('taipeiStartOfDay 取台北當日 00:00', () => {
      expect(taipeiStartOfDay(abs('2026-10-19T00:30:00+08:00'))).toBe(abs('2026-10-19T00:00:00+08:00'));
      expect(taipeiStartOfDay(abs('2026-10-19T23:59:59+08:00'))).toBe(abs('2026-10-19T00:00:00+08:00'));
      expect(taipeiStartOfDay(abs('2026-10-19T00:00:00+08:00'))).toBe(abs('2026-10-19T00:00:00+08:00'));
      expect(taipeiStartOfDay(abs('2026-10-18T16:00:00Z'))).toBe(abs('2026-10-19T00:00:00+08:00'));
      expect(taipeiStartOfDay(abs('2026-10-19T08:00:00+08:00'))).toBe(abs('2026-10-19T00:00:00+08:00'));
    });

    it('addTaipeiDays 加減整數天，牆鐘時刻不變', () => {
      const base = abs('2026-10-19T11:00:00+08:00');
      expect(addTaipeiDays(base, 1)).toBe(abs('2026-10-20T11:00:00+08:00'));
      expect(addTaipeiDays(base, -1)).toBe(abs('2026-10-18T11:00:00+08:00'));
      expect(addTaipeiDays(base, 0)).toBe(base);
      expect(addTaipeiDays(base, 30)).toBe(abs('2026-11-18T11:00:00+08:00'));
      expect(addTaipeiDays(abs('2026-12-31T23:30:00+08:00'), 1)).toBe(abs('2027-01-01T23:30:00+08:00'));
      expect(addTaipeiDays(abs('2028-02-28T10:00:00+08:00'), 1)).toBe(abs('2028-02-29T10:00:00+08:00'));
      expect(addTaipeiDays(abs('2028-02-28T10:00:00+08:00'), 2)).toBe(abs('2028-03-01T10:00:00+08:00'));
    });

    it('負數毫秒（1970 年以前）：日界用 floor，欄位與格式化正確', () => {
      expect(taipeiStartOfDay(-1)).toBe(-28_800_000);
      expect(taipeiStartOfDay(-30_000_000)).toBe(-115_200_000);
      // 1970-01-01T07:59:59.999 台北，當天是週四
      expect(taipeiParts(-1)).toEqual({ year: 1970, month: 1, day: 1, hour: 7, minute: 59, second: 59, weekday: 4 });
      expect(formatTaipei(-1)).toBe('1970/01/01 07:59');
      // -30,000,000 ms ＝ 1969-12-31T15:40Z ＝ 台北 1969/12/31 23:40
      expect(formatTaipei(-30_000_000)).toBe('1969/12/31 23:40');
      expect(taipeiDateKey(-30_000_000)).toBe('1969/12/31');
      expect(formatTaipei(taipeiStartOfDay(-30_000_000))).toBe('1969/12/31 00:00');
      expect(parseTaipei('1969/12/31 23:40')).toBe(-30_000_000);
    });

    it('美西夏令轉換日前後加一天仍是整 24 小時', () => {
      for (const iso of ['2026-03-07T12:00:00+08:00', '2026-03-08T12:00:00+08:00', '2026-10-31T12:00:00+08:00', '2026-11-01T12:00:00+08:00']) {
        expect(addTaipeiDays(abs(iso), 1) - abs(iso)).toBe(DAY);
      }
    });
  });

  describe('掃描：格式化／解析／日界一致（含美西夏令轉換日、跨年、閏日）', () => {
    const windows: Array<{ name: string; times: number[] }> = [
      { name: '2026/10/18 20:00 起 72 小時', times: sweepMs('2026-10-18T20:00:00+08:00', 72, 30) },
      { name: '美西夏令開始日前後', times: sweepMs('2026-03-08T00:00:00+08:00', 48, 30) },
      { name: '美西夏令結束日前後', times: sweepMs('2026-11-01T00:00:00+08:00', 48, 30) },
      { name: '跨年', times: sweepMs('2026-12-31T20:00:00+08:00', 8, 30) },
      { name: '閏日', times: sweepMs('2028-02-28T20:00:00+08:00', 30, 30) },
    ];

    it.each(windows)('$name', ({ times }) => {
      const bad = times.filter((t) => {
        const startOfDay = taipeiStartOfDay(t);
        const p = taipeiParts(t);
        return !(
          parseTaipei(formatTaipei(t)) === t &&
          parseTaipei(formatTaipei(t, 'YYYY-MM-DDTHH:mm')) === t &&
          startOfDay <= t &&
          t < startOfDay + DAY &&
          formatTaipei(startOfDay) === `${taipeiDateKey(t)} 00:00` &&
          (t - startOfDay) / 60_000 === p.hour * 60 + p.minute
        );
      });
      expect(bad.map((t) => new Date(t).toISOString())).toEqual([]);
    });
  });

  describe('與 Functions parity（functions/index.js）', () => {
    it.each(PARITY_EVENT_DATES.map((input) => ({ input })))('起點 parseEventStartDateInTaipei：「$input」', ({ input }) => {
      expect(parseTaipei(input)).toBe(refParseStart(input));
    });

    it.each(PARITY_EVENT_DATES.map((input) => ({ input })))('終點 parseEventEndDateInTaipei：「$input」', ({ input }) => {
      const ref = refParseEnd(input);
      const range = parseTaipeiRange(input);
      if (ref === null) {
        expect(range).toBeNull();
      } else {
        expect(range?.endMs).toBe(ref);
        expect(range?.startMs).toBe(refParseStart(input));
      }
    });

    it.each(PARITY_REG_OPEN_VALUES.map((value, i) => ({ i, value })))('報名開放時間 parseEventRegOpenTimeInTaipei：案例 $i', ({ value }) => {
      expect(parseTaipei(value)).toBe(refParseRegOpen(value));
    });

    it.each(DIVERGENCES)('刻意差異：$name', ({ input, functions, helper, helperEnd }) => {
      // Functions 端（參照實作）
      if (functions.start !== undefined) expect(refParseStart(input)).toBe(expectedMs(functions.start));
      if (functions.end !== undefined) expect(refParseEnd(input)).toBe(expectedMs(functions.end));
      if (functions.regOpen !== undefined) expect(refParseRegOpen(input)).toBe(expectedMs(functions.regOpen));
      // helper 端
      expect(parseTaipei(input)).toBe(expectedMs(helper));
      if (helperEnd !== undefined) expect(parseTaipeiRange(input)?.endMs ?? null).toBe(expectedMs(helperEnd));
    });
  });

  describe('T-051／T-053 必測案例', () => {
    it('公告 publishAt／unpublishAt：11:00 在 10:59 還沒到、11:00 起已到、12:00 已到', () => {
      const at = parseTaipei('2026/10/19 11:00');
      expect(at).not.toBeNull();
      expect(at !== null && at <= abs('2026-10-19T10:59:00+08:00')).toBe(false);
      expect(at !== null && at <= abs('2026-10-19T11:00:00+08:00')).toBe(true);
      expect(at !== null && at <= abs('2026-10-19T12:00:00+08:00')).toBe(true);
    });

    it('活動 2026/10/19 11:00~13:00：10:59 未結束、13:00 已結束', () => {
      const range = parseTaipeiRange('2026/10/19 11:00~13:00');
      expect(range).not.toBeNull();
      const endMs = range?.endMs ?? Number.NaN;
      expect(endMs <= abs('2026-10-19T10:59:00+08:00')).toBe(false);
      expect(endMs <= abs('2026-10-19T12:59:00+08:00')).toBe(false);
      expect(endMs <= abs('2026-10-19T13:00:00+08:00')).toBe(true);
    });

    it('跨日活動 23:00~01:00：隔天 00:59 未結束、01:00 已結束', () => {
      const endMs = parseTaipeiRange('2026/10/19 23:00~01:00')?.endMs ?? Number.NaN;
      expect(endMs <= abs('2026-10-20T00:59:00+08:00')).toBe(false);
      expect(endMs <= abs('2026-10-20T01:00:00+08:00')).toBe(true);
    });

    it('regOpenTime 2026-10-19T09:00：08:59 仍是尚未開放、09:00 起開放', () => {
      const open = parseTaipei('2026-10-19T09:00');
      expect(open !== null && open > abs('2026-10-19T08:59:00+08:00')).toBe(true);
      expect(open !== null && open > abs('2026-10-19T09:00:00+08:00')).toBe(false);
    });

    it('台北 00:30 的「今天」日期鍵是台北日期，不是 UTC 日期', () => {
      expect(taipeiDateKey(abs('2026-10-19T00:30:00+08:00'))).toBe('2026/10/19');
      expect(taipeiDateKey(abs('2026-10-19T07:59:00+08:00'))).toBe('2026/10/19');
      expect(taipeiDateKey(abs('2026-10-19T23:59:59+08:00'))).toBe('2026/10/19');
      expect(taipeiDateKey(abs('2026-10-20T00:00:00+08:00'))).toBe('2026/10/20');
    });
  });

  describe('反例保護（突變驗證）：本地時區寫法必須被矩陣抓到', () => {
    const mutantParseCases = PARSE_CASES.filter(
      (c) => c.expected !== null && /^\d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}$/.test(c.input),
    );

    it('本地解析突變體：台北時區與期望值相同，其他時區必然不同', () => {
      const mismatches = mutantParseCases.filter((c) => localParseMutant(c.input) !== expectedMs(c.expected));
      if (isTaipeiZone()) expect(mismatches).toEqual([]);
      else expect(mismatches.length).toBeGreaterThan(0);
    });

    it('本地格式化突變體：台北時區與期望值相同，其他時區必然不同', () => {
      const mismatches = PARTS_CASES.filter((c) => localFormatMutant(abs(c.iso)) !== c.text);
      if (isTaipeiZone()) expect(mismatches).toEqual([]);
      else expect(mismatches.length).toBeGreaterThan(0);
    });

    it('UTC 日期鍵突變體：任何時區都會在台北 00:00–08:00 取錯日期', () => {
      const mismatches = PARTS_CASES.filter((c) => utcDateKeyMutant(abs(c.iso)) !== taipeiDateKey(abs(c.iso)));
      expect(mismatches.length).toBeGreaterThan(0);
    });

    it('真實 helper 對同一組案例沒有任何差異', () => {
      const parseMismatches = PARSE_CASES.filter((c) => parseTaipei(c.input) !== expectedMs(c.expected));
      const formatMismatches = PARTS_CASES.filter((c) => formatTaipei(abs(c.iso)) !== c.text);
      expect(parseMismatches).toEqual([]);
      expect(formatMismatches).toEqual([]);
    });
  });
}

/* ───────────── 行程層：以啟動時的 TZ 環境變數為準（CI tz-matrix 逐一啟動） ───────────── */

describe('時區矩陣：行程啟動時區', () => {
  // CI 一律檢查：TZ 必須存在且是矩陣表內的時區名（含 check job 的 Asia/Taipei），
  // 這樣 matrix 的時區名或環境變數打錯時會轉紅，而不是被略過。
  it.runIf(Boolean(process.env.CI))('CI：行程時區確實是 TZ 環境變數指定的時區', () => {
    expect(STARTUP_TZ).toBeDefined();
    expect(Object.hasOwn(EXPECTED_OFFSETS, STARTUP_TZ ?? '')).toBe(true);
    expect(currentOffsets()).toEqual(EXPECTED_OFFSETS[STARTUP_TZ ?? '']);
  });

  registerHelperSuite();
});

/* ───────────── 行程內層：測試內切換 process.env.TZ ───────────── */

describe('時區矩陣：行程內切換 process.env.TZ', () => {
  it.runIf(Boolean(process.env.CI))('CI 必須支援 process.env.TZ 執行期切換（否則本層會被略過）', () => {
    expect(CAN_SWITCH_ZONE).toBe(true);
  });

  describe.skipIf(!CAN_SWITCH_ZONE)('逐一切換四個時區', () => {
    for (const zone of ZONES) {
      describe(`TZ=${zone}`, () => {
        beforeEach(() => {
          setZone(zone);
        });

        afterEach(() => {
          restoreZone();
        });

        it('環境時區確實已切換', () => {
          expect(currentOffsets()).toEqual(EXPECTED_OFFSETS[zone]);
        });

        registerHelperSuite();
      });
    }
  });
});
