// 賽程彈性與公告的純函式。不讀時鐘、不打網路。
// 畫面依時間新到舊排公告，不照文件陣列原序。系統公告不占主辦的 20 則。

import { taipeiMs, taipeiParts } from '../format';
import { taipeiDayKey } from './schedule-present';
import type { CompetitionNotice, MatchDoc } from './types';

export const HOST_NOTICE_MAX = 20;
export const NOTICE_PREVIEW_COUNT = 3;

const SWAPPABLE = new Set(['scheduled', 'postponed']);

export interface ScheduleClash {
  mtId: string;
  type: 'team' | 'venue';
}

export interface ShiftDayChoice {
  date: string;
  count: number;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 合法的台北日曆日才有星期索引（週日是 0）。不合法回 null。 */
export function calendarWeekdayIndex(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return probe.getUTCDay();
}

function dayUtc(date: string): number | null {
  if (calendarWeekdayIndex(date) == null) return null;
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

function shortWhen(ms: number): string {
  const part = taipeiParts(ms);
  return `${part.month}/${part.day} ${pad(part.hour)}:${pad(part.minute)}`;
}

/** 主辦手寫公告則數。kind 為 system 的不計。 */
export function hostNoticeCount(notices: readonly CompetitionNotice[]): number {
  return notices.filter((notice) => notice.kind === 'host').length;
}

/** 新的在前。同一時間再用 id，避免每次渲染順序亂跳。 */
export function noticesNewestFirst(notices: readonly CompetitionNotice[]): CompetitionNotice[] {
  return [...notices].sort((a, b) => (b.at - a.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function noticeWhen(ms: number): string {
  return shortWhen(ms);
}

/** 2027-01-24 → 2027/01/24。不合法回 null。 */
export function slashDate(date: string): string | null {
  if (calendarWeekdayIndex(date) == null) return null;
  const [year, month, day] = date.split('-');
  return `${year}/${month}/${day}`;
}

/** 選到的日期晚於目前末場的台北日。 */
export function dateAfterLast(date: string, lastMatchAt: number): boolean {
  if (calendarWeekdayIndex(date) == null) return false;
  return date > taipeiDayKey(lastMatchAt);
}

export function nextCalendarDay(date: string): string {
  const utc = dayUtc(date);
  if (utc == null) return '';
  const next = new Date(utc + 86_400_000);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function shiftMovesLater(fromDate: string, toDate: string): boolean {
  if (calendarWeekdayIndex(fromDate) == null || calendarWeekdayIndex(toDate) == null) return false;
  return toDate > fromDate;
}

/** 還沒開打、開賽時間落在這一天的場次。延期（沒有開賽時間）不算。 */
export function movableOnDay(matches: readonly MatchDoc[], date: string): MatchDoc[] {
  return matches.filter((match) => (
    match.status === 'scheduled' && match.kickoffAt != null && taipeiDayKey(match.kickoffAt) === date
  ));
}

export function shiftDayChoices(matches: readonly MatchDoc[]): ShiftDayChoice[] {
  const counts = new Map<string, number>();
  for (const match of matches) {
    if (match.status !== 'scheduled' || match.kickoffAt == null) continue;
    const date = taipeiDayKey(match.kickoffAt);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, count]) => ({ date, count }));
}

/** 1/9 週六　6 場。星期名稱與「場」由呼叫端傳入。星期順序週日到週六。 */
export function shiftDayLabel(date: string, count: number, weekdays: readonly string[], matchUnit: string): string {
  const index = calendarWeekdayIndex(date);
  if (index == null) return date;
  const [, month, day] = date.split('-');
  const weekday = weekdays[index] ?? '';
  return `${Number(month)}/${Number(day)} ${weekday}　${count} ${matchUnit}`;
}

/** 還沒開打的場次，含延期。已開始、已結束、已取消都不對調。 */
export function swappableMatches(matches: readonly MatchDoc[]): MatchDoc[] {
  return matches
    .filter((match) => SWAPPABLE.has(match.status))
    .sort((a, b) => {
      if (a.kickoffAt == null && b.kickoffAt != null) return 1;
      if (a.kickoffAt != null && b.kickoffAt == null) return -1;
      if (a.kickoffAt != null && b.kickoffAt != null && a.kickoffAt !== b.kickoffAt) return a.kickoffAt - b.kickoffAt;
      if (a.matchNo !== b.matchNo) return a.matchNo - b.matchNo;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/** 1/9 09:00 海風對山貓。「對」由呼叫端傳入。 */
export function matchPickLabel(match: MatchDoc, versus: string): string {
  const names = `${match.home.name}${versus}${match.away.name}`;
  if (match.kickoffAt == null) return names;
  return `${shortWhen(match.kickoffAt)} ${names}`;
}

/** 海風對山貓 → 1/10 09:00、2號場。這場會改成對方現在的時間與場地。「對」由呼叫端傳入。 */
export function swapPreview(from: MatchDoc, to: MatchDoc, tbd: string, versus: string): string {
  const when = to.kickoffAt == null ? tbd : shortWhen(to.kickoffAt);
  const venue = to.venueName ? `、${to.venueName}` : '';
  return `${from.home.name}${versus}${from.away.name} → ${when}${venue}`;
}

export function parseConflict(params: Record<string, unknown>): ScheduleClash | null {
  const mtId = typeof params.mtId === 'string' ? params.mtId : '';
  const type = params.type === 'venue' ? 'venue' : params.type === 'team' ? 'team' : null;
  if (!mtId || !type) return null;
  return { mtId, type };
}

/** 撞到的那一場：時間與對戰。場地衝突再附上場地名稱。 */
export function clashSentence(
  match: MatchDoc | undefined,
  type: 'team' | 'venue',
  teamLabel: string,
  venueLabel: string,
  versus: string,
): string {
  const head = type === 'venue' ? venueLabel : teamLabel;
  if (!match) return head;
  const when = match.kickoffAt == null ? '' : shortWhen(match.kickoffAt);
  const names = `${match.home.name}${versus}${match.away.name}`;
  const place = type === 'venue' && match.venueName ? match.venueName : '';
  return [head, when, names, place].filter(Boolean).join('　');
}

/** 只搬還沒開打、而且開賽日落在 fromDate 的場次。鐘點不變，rev 加 1。 */
export function applyDayShift(matches: readonly MatchDoc[], fromDate: string, toDate: string): MatchDoc[] {
  const from = dayUtc(fromDate);
  const to = dayUtc(toDate);
  if (from == null || to == null) return matches.map((match) => match);
  const delta = to - from;
  return matches.map((match) => {
    if (match.status !== 'scheduled' || match.kickoffAt == null) return match;
    if (taipeiDayKey(match.kickoffAt) !== fromDate) return match;
    return { ...match, kickoffAt: match.kickoffAt + delta, rev: match.rev + 1 };
  });
}

/** 兩場互換開賽時間與場地。rev 各加 1。 */
export function applySwap(matches: readonly MatchDoc[], idA: string, idB: string): MatchDoc[] {
  const left = matches.find((match) => match.id === idA);
  const right = matches.find((match) => match.id === idB);
  if (!left || !right || idA === idB) return matches.map((match) => match);
  return matches.map((match) => {
    if (match.id === idA) {
      return { ...match, kickoffAt: right.kickoffAt, venueIdx: right.venueIdx, venueName: right.venueName, rev: match.rev + 1 };
    }
    if (match.id === idB) {
      return { ...match, kickoffAt: left.kickoffAt, venueIdx: left.venueIdx, venueName: left.venueName, rev: match.rev + 1 };
    }
    return match;
  });
}

/** 新的一天比目前末場更晚時，末場改成那天的 00:00。否則回 null。 */
export function laterLastMatch(lastMatchAt: number, toDate: string): number | null {
  if (calendarWeekdayIndex(toDate) == null) return null;
  if (toDate <= taipeiDayKey(lastMatchAt)) return null;
  const [year, month, day] = toDate.split('-').map(Number);
  return taipeiMs(year ?? 0, month ?? 1, day ?? 1, 0, 0);
}

export function extendLastMatchAt(lastMatchAt: number, kickoffs: readonly (number | null)[]): number {
  let last = lastMatchAt;
  for (const kick of kickoffs) {
    if (kick == null) continue;
    const next = laterLastMatch(last, taipeiDayKey(kick));
    if (next != null) last = next;
  }
  return last;
}

export function noticeTextProblem(value: string): 'FIELD_REQUIRED' | 'FIELD_LENGTH' | null {
  const text = value.trim();
  if (!text) return 'FIELD_REQUIRED';
  if ([...text].length > 300) return 'FIELD_LENGTH';
  return null;
}

/** 空白可以，代表清掉。換行不收。超過 60 個碼位不收。 */
export function contactNoteProblem(value: string): 'FIELD_FORMAT' | 'FIELD_LENGTH' | null {
  if (/[\r\n]/.test(value)) return 'FIELD_FORMAT';
  const text = value.trim();
  if ([...text].length > 60) return 'FIELD_LENGTH';
  return null;
}
