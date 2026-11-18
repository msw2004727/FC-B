// 賽程、積分榜、預熱倒數、進行中條的純函式。不讀時鐘、不讀網路。
// 分組用台北日曆（format.taipeiParts）。文案裡的「今天」「時間待定」由呼叫端傳入。

import { taipeiParts } from '../format';
import type { DivisionDoc, StandingDoc, SummaryEntry } from './types';

const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'] as const;

export type PublicMark = 'pending' | 'forfeit' | 'moved';

export interface ScheduleMatch {
  id: string;
  /** null＝時間待定。 */
  time: string | null;
  venue: string;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  /** null＝畫 vs，不把未賽的 [0,0] 當比分。 */
  score: [number, number] | null;
  mark: PublicMark | null;
}

export interface ScheduleDay {
  key: string;
  label: string;
  matches: ScheduleMatch[];
}

export interface ScheduleGroup {
  divisionId: string;
  days: ScheduleDay[];
}

export interface StandingLine {
  teamId: string;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  rank: number;
  tie: boolean;
  /** 名次 1（含並列第一）用強調色。 */
  top: boolean;
}

export interface LiveStrip {
  today: number;
  /** 下一場的台北 HH:mm。沒有更晚的場次就是 null。 */
  next: string | null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 台北日曆鍵 YYYY-MM-DD。 */
export function taipeiDayKey(ms: number): string {
  const part = taipeiParts(ms);
  return `${part.year}-${pad(part.month)}-${pad(part.day)}`;
}

function dayNumber(ms: number): number {
  const part = taipeiParts(ms);
  return Math.floor(Date.UTC(part.year, part.month - 1, part.day) / 86_400_000);
}

/** 台北日曆相減。首場當天是 0。 */
export function daysUntilStart(firstMatchAt: number, now: number): number {
  return dayNumber(firstMatchAt) - dayNumber(now);
}

export function formatKickoffClock(ms: number): string {
  const part = taipeiParts(ms);
  return `${pad(part.hour)}:${pad(part.minute)}`;
}

/**
 * 1月9日　週六。與現在同一台北日時加上（今天）。
 * ASSUMPTION: 星期用預覽 harness 的「週日…週六」，不另做語系表（賽事字典其餘語系目前也是同一份中文）。
 */
export function scheduleDayLabel(ms: number, now: number, todayMark: string): string {
  const part = taipeiParts(ms);
  const weekday = WEEKDAYS[new Date(Date.UTC(part.year, part.month - 1, part.day)).getUTCDay()] ?? '週日';
  const base = `${part.month}月${part.day}日　${weekday}`;
  return taipeiDayKey(ms) === taipeiDayKey(now) ? `${base}${todayMark}` : base;
}

/**
 * 公開場次小標。
 * ASSUMPTION: 摘要 st 對齊場次狀態。finished＝已登錄還沒確認（待確認）；
 * walkover 或 wo 有值＝棄權；postponed＝改期。
 * confirmed、scheduled、live、halftime 不掛公開小標。
 */
export function publicMark(entry: SummaryEntry): PublicMark | null {
  if (entry.wo || entry.st === 'walkover') return 'forfeit';
  if (entry.st === 'postponed') return 'moved';
  if (entry.st === 'finished') return 'pending';
  return null;
}

/**
 * ASSUMPTION: 摘要的 s 在未賽時也是 [0, 0]，不能拿來判斷有沒有比分。
 * 已登錄、已確認、進行中、中場、棄權才顯示比分。
 */
export function showsScore(entry: SummaryEntry): boolean {
  return entry.st === 'finished'
    || entry.st === 'confirmed'
    || entry.st === 'walkover'
    || entry.st === 'live'
    || entry.st === 'halftime'
    || entry.wo != null;
}

/**
 * 今天場數只算開賽時間落在台北今天的場次。時間待定不算今天。
 * ASSUMPTION: 下一場是開賽時間嚴格晚於 now 的最早一場（可以是今天稍後，或之後的日期）。
 */
export function liveStrip(entries: readonly SummaryEntry[], now: number): LiveStrip {
  const todayKey = taipeiDayKey(now);
  let today = 0;
  let nextAt: number | null = null;
  for (const entry of entries) {
    if (entry.k == null) continue;
    if (taipeiDayKey(entry.k) === todayKey) today += 1;
    if (entry.k > now && (nextAt == null || entry.k < nextAt)) nextAt = entry.k;
  }
  return { today, next: nextAt == null ? null : formatKickoffClock(nextAt) };
}

function matchOf(entry: SummaryEntry): ScheduleMatch {
  return {
    id: entry.id,
    time: entry.k == null ? null : formatKickoffClock(entry.k),
    venue: entry.v ?? '',
    homeId: entry.h.id,
    homeName: entry.h.n,
    awayId: entry.a.id,
    awayName: entry.a.n,
    score: showsScore(entry) ? entry.s : null,
    mark: publicMark(entry),
  };
}

function byKickoff(a: SummaryEntry, b: SummaryEntry): number {
  if (a.k == null && b.k != null) return 1;
  if (a.k != null && b.k == null) return -1;
  if (a.k != null && b.k != null && a.k !== b.k) return a.k - b.k;
  const no = (a.no ?? 0) - (b.no ?? 0);
  if (no !== 0) return no;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 依組別、再依台北日期分組。時間未定的場次收在該組最後，標題用呼叫端給的「時間待定」。
 * divisionOrder 用組別文件的順序；沒列到的組別排在後面。
 */
export function groupSchedule(
  entries: readonly SummaryEntry[],
  now: number,
  labels: { tbd: string; today: string },
  divisionOrder: readonly string[] = [],
): ScheduleGroup[] {
  const buckets = new Map<string, SummaryEntry[]>();
  for (const entry of entries) {
    const list = buckets.get(entry.dv) ?? [];
    list.push(entry);
    buckets.set(entry.dv, list);
  }
  const order = new Map(divisionOrder.map((id, index) => [id, index]));
  const divisionIds = [...buckets.keys()].sort((a, b) => {
    const ai = order.get(a) ?? 1000;
    const bi = order.get(b) ?? 1000;
    if (ai !== bi) return ai - bi;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return divisionIds.map((divisionId) => {
    const rows = [...(buckets.get(divisionId) ?? [])].sort(byKickoff);
    const dated = new Map<string, ScheduleMatch[]>();
    const dayOrder: string[] = [];
    const tbd: ScheduleMatch[] = [];
    for (const entry of rows) {
      const match = matchOf(entry);
      if (entry.k == null) {
        tbd.push(match);
        continue;
      }
      const key = taipeiDayKey(entry.k);
      if (!dated.has(key)) {
        dated.set(key, []);
        dayOrder.push(key);
      }
      dated.get(key)?.push(match);
    }
    const days: ScheduleDay[] = dayOrder.map((key) => {
      const sample = rows.find((row) => row.k != null && taipeiDayKey(row.k) === key);
      return {
        key,
        label: sample?.k != null ? scheduleDayLabel(sample.k, now, labels.today) : key,
        matches: dated.get(key) ?? [],
      };
    });
    if (tbd.length > 0) days.push({ key: 'tbd', label: labels.tbd, matches: tbd });
    return { divisionId, days };
  });
}

export function divisionHeading(divisionId: string, divisions: readonly DivisionDoc[], multiple: boolean): string | null {
  if (!multiple) return null;
  // ASSUMPTION: 對不到組別名稱時不顯示標題，避免把文件 id 畫出來。
  return divisions.find((row) => row.dvId === divisionId)?.name ?? null;
}

/**
 * 未裁定（hasUnresolvedTie）且積分相同的列，名次改成該群最小的名次，並標同分。
 * 主辦已裁定（hasUnresolvedTie 為 false）時，即使積分相同也沿用列上的名次、不標同分。
 */
export function standingLines(doc: StandingDoc): StandingLine[] {
  const rows = doc.rows.map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.rank - b.row.rank || a.index - b.index)
    .map((item) => item.row);
  const lines: StandingLine[] = rows.map((row) => ({
    teamId: row.teamId,
    name: row.name,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDiff: row.goalDiff,
    points: row.points,
    rank: row.rank,
    tie: false,
    top: false,
  }));
  if (doc.hasUnresolvedTie) {
    const groups = new Map<number, number[]>();
    lines.forEach((line, index) => {
      const bucket = groups.get(line.points) ?? [];
      bucket.push(index);
      groups.set(line.points, bucket);
    });
    for (const indexes of groups.values()) {
      if (indexes.length < 2) continue;
      const shared = Math.min(...indexes.map((index) => lines[index]?.rank ?? 0));
      for (const index of indexes) {
        const line = lines[index];
        if (!line) continue;
        line.rank = shared;
        line.tie = true;
      }
    }
  }
  for (const line of lines) line.top = line.rank === 1;
  return lines;
}

/** 冠軍取第一份積分榜裡名次 1 的第一列。沒有積分榜就沒有冠軍名字。 */
export function championName(docs: readonly StandingDoc[]): string | null {
  for (const doc of docs) {
    const top = standingLines(doc).find((line) => line.rank === 1);
    if (top) return top.name;
  }
  return null;
}

export function formatGoalDiff(diff: number): string {
  return diff > 0 ? `+${diff}` : String(diff);
}
