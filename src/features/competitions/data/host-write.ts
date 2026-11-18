// 主辦排賽程與場次寫入的純函式。不讀時鐘、不打網路。
// 畫面把使用者輸入留在元件裡；這裡只負責欄位、按鈕、以及「重送後內容是否相同」。

import { fromDatetimeLocalValue, taipeiParts } from '../format';
import type { CpGenerateScheduleResult, CpScheduleDay } from './cp-callables';
import {
  formatKickoffClock,
  scheduleDayLabel,
  taipeiDayKey,
} from './schedule-present';
import type { DivisionDoc, MatchDoc, MatchStatus } from './types';

export const SCORE_MAX = 99;

/** 主辦頁有組別文件，可直接用組名；只有一組時不顯示。對不到名稱時不顯示，避免畫出文件 id。 */
export function divisionHeading(divisionId: string, divisions: readonly DivisionDoc[], multiple: boolean): string | null {
  if (!multiple) return null;
  return divisions.find((row) => row.dvId === divisionId)?.name ?? null;
}

export interface DayDraft {
  /** 穩定的 React key。改日期不換 id，輸入框才不會被卸載。不送進排賽程。 */
  id?: string;
  date: string;
  start: string;
  end: string;
}

export interface ParsedSchedule {
  dvId: string;
  legs: 1 | 2;
  matchMinutes: number;
  bufferMinutes: number;
  days: CpScheduleDay[];
  venueIdx: number[];
}

export type WriteIntent =
  | { kind: 'record'; score: { home: number; away: number }; confirm: boolean }
  | { kind: 'confirm'; score: { home: number; away: number } }
  | { kind: 'walkover'; forfeitSide: 'home' | 'away'; reason: string }
  | { kind: 'reset'; reason: string }
  | { kind: 'reschedule'; kickoffAt: number | null; venueIdx: number | null; force?: boolean }
  | { kind: 'cancel'; reason: string };

export type HostAction = 'reschedule' | 'score' | 'confirm' | 'reset' | 'cancel';
export type HostBadgeKey = 'sched' | 'pending' | 'confirmed' | 'forfeit' | 'moved' | 'live' | 'cancelled';

export interface HostDayGroup {
  key: string;
  label: string;
  matches: MatchDoc[];
}

export interface HostDivisionGroup {
  divisionId: string;
  heading: string | null;
  days: HostDayGroup[];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dayKey(ms: number): string {
  const part = taipeiParts(ms);
  return `${part.year}-${pad(part.month)}-${pad(part.day)}`;
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** HH:MM。一位數小時補零。不合法回 null。 */
export function normalizeTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${pad(hour)}:${match[2]}`;
}

function whole(value: string): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * 比賽日預設。同一天只留一筆。
 * ASSUMPTION: 開始 09:00、結束 18:00，對齊預覽 harness，不讀賽事文件上的開賽鐘點。
 */
export function initialDays(firstMatchAt: number, lastMatchAt: number): DayDraft[] {
  const first = dayKey(firstMatchAt);
  const last = dayKey(lastMatchAt);
  const row: DayDraft = { id: 'day-1', date: first, start: '09:00', end: '18:00' };
  if (first === last) return [row];
  return [row, { id: 'day-2', date: last, start: '09:00', end: '18:00' }];
}

export function allVenueIdx(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

export function parseScheduleForm(form: {
  dvId: string;
  legs: 1 | 2;
  matchMinutes: string;
  bufferMinutes: string;
  days: readonly DayDraft[];
  venueIdx: readonly number[];
}): { ok: true; value: ParsedSchedule } | { ok: false; reason: 'FIELD_REQUIRED' | 'FIELD_RANGE' } {
  if (!form.dvId.trim()) return { ok: false, reason: 'FIELD_REQUIRED' };
  if (form.days.length === 0 || form.venueIdx.length === 0) return { ok: false, reason: 'FIELD_REQUIRED' };
  const matchMinutes = whole(form.matchMinutes);
  const bufferMinutes = whole(form.bufferMinutes);
  if (matchMinutes == null || bufferMinutes == null) {
    return { ok: false, reason: form.matchMinutes.trim() && form.bufferMinutes.trim() ? 'FIELD_RANGE' : 'FIELD_REQUIRED' };
  }
  if (matchMinutes < 1 || bufferMinutes < 0) return { ok: false, reason: 'FIELD_RANGE' };
  const days: CpScheduleDay[] = [];
  for (const day of form.days) {
    if (!day.date.trim() || !day.start.trim() || !day.end.trim()) return { ok: false, reason: 'FIELD_REQUIRED' };
    if (!validDate(day.date)) return { ok: false, reason: 'FIELD_RANGE' };
    const start = normalizeTime(day.start);
    const end = normalizeTime(day.end);
    if (!start || !end) return { ok: false, reason: 'FIELD_RANGE' };
    if (start >= end) return { ok: false, reason: 'FIELD_RANGE' };
    days.push({ date: day.date.trim(), start, end });
  }
  const venueIdx = [...form.venueIdx].filter((index) => Number.isInteger(index) && index >= 0).sort((a, b) => a - b);
  if (venueIdx.length === 0) return { ok: false, reason: 'FIELD_REQUIRED' };
  return {
    ok: true,
    value: { dvId: form.dvId, legs: form.legs, matchMinutes, bufferMinutes, days, venueIdx },
  };
}

export function previewFromResult(result: CpGenerateScheduleResult):
  | { kind: 'ok'; m: number; d: number; p: number; seed: number }
  | { kind: 'bad'; n: number } {
  if (result.unplacedCount > 0) return { kind: 'bad', n: result.unplacedCount };
  return {
    kind: 'ok',
    m: result.matchCount,
    d: result.daysUsed.length,
    p: result.perTeam,
    seed: result.seed,
  };
}

/** 棄權方 0、對手 2。主隊棄權是 0：2，客隊棄權是 2：0。 */
export function walkoverScore(side: 'home' | 'away'): { home: number; away: number } {
  return side === 'home' ? { home: 0, away: 2 } : { home: 2, away: 0 };
}

export function stepScore(current: number, delta: number): number {
  const next = current + delta;
  if (next < 0) return 0;
  if (next > SCORE_MAX) return SCORE_MAX;
  return next;
}

export function reasonProblem(value: string): 'FIELD_REQUIRED' | 'FIELD_LENGTH' | null {
  const text = value.trim();
  if (!text) return 'FIELD_REQUIRED';
  if ([...text].length > 200) return 'FIELD_LENGTH';
  return null;
}

/** 去空白後以 Unicode 碼位計。空的是必填；短於 min 或長於 max 是字數。 */
export function boundedReason(value: string, min: number, max: number): 'FIELD_REQUIRED' | 'FIELD_LENGTH' | null {
  const text = value.trim();
  const length = [...text].length;
  if (length === 0) return 'FIELD_REQUIRED';
  if (length < min || length > max) return 'FIELD_LENGTH';
  return null;
}

/** 還沒確認、也不是棄權或已取消的場次。結束賽事對話框用這個數字。 */
export function unconfirmedCount(matches: readonly MatchDoc[]): number {
  return matches.filter((match) => (
    match.status !== 'confirmed' && match.status !== 'walkover' && match.status !== 'cancelled'
  )).length;
}

export function hostActions(status: MatchStatus): HostAction[] {
  switch (status) {
    case 'scheduled': return ['reschedule', 'cancel', 'score'];
    case 'postponed': return ['reschedule', 'cancel'];
    case 'finished': return ['score', 'confirm', 'cancel'];
    case 'confirmed':
    case 'walkover':
    case 'cancelled': return ['reset'];
    case 'live':
    case 'halftime': return [];
    default: return [];
  }
}

export function hostBadgeKey(status: MatchStatus): HostBadgeKey | null {
  switch (status) {
    case 'scheduled': return 'sched';
    case 'finished': return 'pending';
    case 'confirmed': return 'confirmed';
    case 'walkover': return 'forfeit';
    case 'postponed': return 'moved';
    case 'cancelled': return 'cancelled';
    case 'live':
    case 'halftime': return 'live';
    default: return null;
  }
}

export function hostShowsScore(status: MatchStatus): boolean {
  return status === 'finished'
    || status === 'confirmed'
    || status === 'walkover'
    || status === 'live'
    || status === 'halftime';
}

export function sheetScore(match: MatchDoc): { home: number; away: number } {
  if (!hostShowsScore(match.status)) return { home: 0, away: 0 };
  return { home: match.score.home, away: match.score.away };
}

/**
 * ASSUMPTION: 沒有開賽時間的改期預設勾待定。有場次但沒有場地索引時，預設第一個場地。
 */
export function rescheduleDraft(match: MatchDoc, venueCount: number): {
  tbd: boolean;
  date: string;
  time: string;
  venueIdx: string;
} {
  const fallback = venueCount > 0 ? '0' : '';
  const venueIdx = match.venueIdx == null ? fallback : String(match.venueIdx);
  if (match.kickoffAt == null) return { tbd: true, date: '', time: '', venueIdx };
  const part = taipeiParts(match.kickoffAt);
  return {
    tbd: false,
    date: `${part.year}-${pad(part.month)}-${pad(part.day)}`,
    time: `${pad(part.hour)}:${pad(part.minute)}`,
    venueIdx,
  };
}

export function parseReschedule(input: {
  tbd: boolean;
  date: string;
  time: string;
  venueIdx: string;
  venueCount: number;
}): { ok: true; kickoffAt: number | null; venueIdx: number | null } | { ok: false; reason: 'FIELD_REQUIRED' | 'FIELD_RANGE' } {
  if (input.tbd) return { ok: true, kickoffAt: null, venueIdx: null };
  if (!input.date.trim() || !input.time.trim()) return { ok: false, reason: 'FIELD_REQUIRED' };
  if (!validDate(input.date)) return { ok: false, reason: 'FIELD_RANGE' };
  const time = normalizeTime(input.time);
  if (!time) return { ok: false, reason: 'FIELD_RANGE' };
  const kickoffAt = fromDatetimeLocalValue(`${input.date.trim()}T${time}`);
  if (kickoffAt == null) return { ok: false, reason: 'FIELD_RANGE' };
  if (input.venueCount <= 0) return { ok: true, kickoffAt, venueIdx: null };
  if (!/^\d+$/.test(input.venueIdx.trim())) return { ok: false, reason: 'FIELD_REQUIRED' };
  const venueIdx = Number(input.venueIdx);
  if (venueIdx < 0 || venueIdx >= input.venueCount) return { ok: false, reason: 'FIELD_RANGE' };
  return { ok: true, kickoffAt, venueIdx };
}

/**
 * 重送遇到 REV_CONFLICT 時，伺服器狀態是否就是這次要寫的結果。
 * ASSUMPTION: 確認要比對按下時的比分，避免別人改分後確認被當成同一件事。
 * 棄權比對 walkoverSide 與 0：2（公開場次沒有原因欄）。重置比對歸零與狀態。
 * 取消只比對狀態。伺服器會清理原因字串，不比對原因內容。
 */
export function outcomeMatches(intent: WriteIntent, match: MatchDoc): boolean {
  if (intent.kind === 'record') {
    const sameScore = match.score.home === intent.score.home && match.score.away === intent.score.away;
    const status = intent.confirm ? 'confirmed' : 'finished';
    return sameScore && match.status === status;
  }
  if (intent.kind === 'confirm') {
    return match.status === 'confirmed'
      && match.score.home === intent.score.home
      && match.score.away === intent.score.away;
  }
  if (intent.kind === 'walkover') {
    const score = walkoverScore(intent.forfeitSide);
    return match.status === 'walkover'
      && match.walkoverSide === intent.forfeitSide
      && match.score.home === score.home
      && match.score.away === score.away;
  }
  if (intent.kind === 'reset') {
    const status = match.kickoffAt == null ? 'postponed' : 'scheduled';
    return match.status === status
      && match.score.home === 0
      && match.score.away === 0
      && match.walkoverSide == null
      && match.result == null
      && match.resultSource == null
      && match.cancelReason == null
      && match.cancelledAt == null;
  }
  if (intent.kind === 'cancel') {
    return match.status === 'cancelled';
  }
  if (intent.kickoffAt == null) {
    return intent.venueIdx == null
      && match.status === 'postponed'
      && match.kickoffAt == null
      && match.venueIdx == null;
  }
  return match.status === 'scheduled'
    && match.kickoffAt === intent.kickoffAt
    && match.venueIdx === intent.venueIdx;
}

/** 樂觀更新。rev 只加 1。成功後若重讀得到不同 rev，以重讀為準。 */
export function applyWrite(match: MatchDoc, intent: WriteIntent): MatchDoc {
  const rev = match.rev + 1;
  if (intent.kind === 'record') {
    return {
      ...match,
      rev,
      score: { home: intent.score.home, away: intent.score.away },
      status: intent.confirm ? 'confirmed' : 'finished',
      resultSource: 'host',
      lock: { locked: true },
    };
  }
  if (intent.kind === 'confirm') {
    return { ...match, rev, status: 'confirmed', resultSource: match.resultSource ?? 'host' };
  }
  if (intent.kind === 'walkover') {
    return {
      ...match,
      rev,
      status: 'walkover',
      walkoverSide: intent.forfeitSide,
      score: walkoverScore(intent.forfeitSide),
      resultSource: 'host',
      lock: { locked: true },
    };
  }
  if (intent.kind === 'reset') {
    return {
      ...match,
      rev,
      status: match.kickoffAt == null ? 'postponed' : 'scheduled',
      score: { home: 0, away: 0 },
      walkoverSide: null,
      result: null,
      resultSource: null,
      lock: { locked: false },
      finishedAt: null,
      confirmedAt: null,
      cancelReason: null,
      cancelledAt: null,
    };
  }
  if (intent.kind === 'cancel') {
    return { ...match, rev, status: 'cancelled', cancelReason: intent.reason };
  }
  return {
    ...match,
    rev,
    kickoffAt: intent.kickoffAt,
    venueIdx: intent.venueIdx,
    venueName: intent.kickoffAt == null ? null : match.venueName,
    status: intent.kickoffAt == null ? 'postponed' : 'scheduled',
  };
}

/**
 * ASSUMPTION: 沒有 reason 的 Callable 錯誤被轉成 UNKNOWN，畫面把它當網路、逾時或伺服器錯誤，可以原樣重送。
 * 契約代碼（除了 REV_CONFLICT 另計）用 toast，不顯示「重新送出」。
 */
export function isTransportFailure(reason: string): boolean {
  return reason === 'UNKNOWN' || reason === '';
}

export function matchDigest(match: MatchDoc, labels: { tbd: string; status: string }): string {
  const when = match.kickoffAt == null
    ? labels.tbd
    : `${formatKickoffClock(match.kickoffAt)}${match.venueName ? `　${match.venueName}` : ''}`;
  return `${when}　${match.home.name} ${match.score.home}：${match.score.away} ${match.away.name}　${labels.status}`;
}

function compareMatch(a: MatchDoc, b: MatchDoc): number {
  if (a.kickoffAt == null && b.kickoffAt != null) return 1;
  if (a.kickoffAt != null && b.kickoffAt == null) return -1;
  if (a.kickoffAt != null && b.kickoffAt != null && a.kickoffAt !== b.kickoffAt) return a.kickoffAt - b.kickoffAt;
  if (a.matchNo !== b.matchNo) return a.matchNo - b.matchNo;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 依組別再依台北日期。時間未定收在該組最後。
 * ASSUMPTION: 「今天」標記沿用公開賽程的「（今天）」，由呼叫端傳入。
 */
export function groupHostMatches(
  matches: readonly MatchDoc[],
  divisions: readonly DivisionDoc[],
  now: number,
  labels: { today: string; tbd: string; weekdays: readonly string[] },
): HostDivisionGroup[] {
  const buckets = new Map<string, MatchDoc[]>();
  for (const match of matches) {
    const list = buckets.get(match.divisionId) ?? [];
    list.push(match);
    buckets.set(match.divisionId, list);
  }
  const order = new Map(divisions.map((division, index) => [division.dvId, index]));
  const ids = [...buckets.keys()].sort((a, b) => {
    const ai = order.get(a) ?? 1000;
    const bi = order.get(b) ?? 1000;
    if (ai !== bi) return ai - bi;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const multiple = ids.length > 1;
  return ids.map((divisionId) => {
    const rows = [...(buckets.get(divisionId) ?? [])].sort(compareMatch);
    const dated = new Map<string, MatchDoc[]>();
    const dayOrder: string[] = [];
    const tbd: MatchDoc[] = [];
    for (const match of rows) {
      if (match.kickoffAt == null) {
        tbd.push(match);
        continue;
      }
      const key = taipeiDayKey(match.kickoffAt);
      if (!dated.has(key)) {
        dated.set(key, []);
        dayOrder.push(key);
      }
      dated.get(key)?.push(match);
    }
    const days: HostDayGroup[] = dayOrder.map((key) => {
      const sample = rows.find((row) => row.kickoffAt != null && taipeiDayKey(row.kickoffAt) === key);
      const label = sample?.kickoffAt != null ? scheduleDayLabel(sample.kickoffAt, now, labels.today, labels.weekdays) : key;
      return { key, label, matches: dated.get(key) ?? [] };
    });
    if (tbd.length > 0) days.push({ key: 'tbd', label: labels.tbd, matches: tbd });
    return {
      divisionId,
      heading: divisionHeading(divisionId, divisions, multiple),
      days,
    };
  });
}
