// 賽程、積分榜、預熱倒數、進行中條的純函式。不讀時鐘、不讀網路。
// 分組用台北日曆（format.taipeiParts）。文案裡的「今天」「時間待定」由呼叫端傳入。

import { taipeiParts } from '../format';
import { pkPair, showsCorrected, summaryVenue } from './audience';
import { kickoffTimeLabel, matchDayNoon, matchDayOf } from './match-day';
import { rowNeedsRuling } from './tie-present';
import type { StandingDoc, SummaryEntry } from './types';

export type PublicMark = 'pending' | 'forfeit' | 'moved' | 'cancelled';

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
  /** 已取消場次的原因。沒有就不畫原因行。 */
  reason: string | null;
  /** live／halftime 才為真。 */
  live: boolean;
  /** 有 cx 且已有結果才為真。 */
  corrected: boolean;
  /** 摘要 p。沒有是 null。 */
  pk: [number, number] | null;
  /** 摘要 h.l。沒有是 null，畫面改用報名隊徽或字首。 */
  homeLogo: string | null;
  awayLogo: string | null;
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
  win: number;
  draw: number;
  loss: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  rank: number;
  tie: boolean;
  /** 積分與同表另一列相同。已分出名次的也是 true。 */
  samePoints: boolean;
  /** 列上 decidedBy。有值就不是待裁定。 */
  decidedBy: 'host' | 'drawLots' | null;
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
 * 1月9日　週六。與現在同一台北日時加上今天標記。
 * 星期名稱由呼叫端從 i18n 傳入，順序是週日到週六（getUTCDay）。
 */
export function scheduleDayLabel(
  ms: number,
  now: number,
  todayMark: string,
  weekdays: readonly string[],
): string {
  const part = taipeiParts(ms);
  const weekday = weekdays[new Date(Date.UTC(part.year, part.month - 1, part.day)).getUTCDay()] ?? weekdays[0] ?? '';
  const base = `${part.month}月${part.day}日　${weekday}`;
  return taipeiDayKey(ms) === taipeiDayKey(now) ? `${base}${todayMark}` : base;
}

/**
 * 公開場次小標。
 * ASSUMPTION: 摘要 st 對齊場次狀態。cancelled＝已取消；
 * finished＝已登錄還沒確認（待確認）；walkover 或 wo 有值＝棄權；postponed＝改期。
 * confirmed、scheduled、live、halftime 不掛公開小標。
 */
export function publicMark(entry: SummaryEntry): PublicMark | null {
  if (entry.st === 'cancelled') return 'cancelled';
  if (entry.wo || entry.st === 'walkover') return 'forfeit';
  if (entry.st === 'postponed') return 'moved';
  if (entry.st === 'finished') return 'pending';
  return null;
}

/**
 * ASSUMPTION: 摘要的 s 在未賽時也是 [0, 0]，不能拿來判斷有沒有比分。
 * 已登錄、已確認、進行中、中場、棄權才顯示比分。
 * 已取消不改比分：兩邊都是 0 仍畫 vs；有分數才顯示。
 */
export function showsScore(entry: SummaryEntry): boolean {
  if (entry.st === 'cancelled') return entry.s[0] !== 0 || entry.s[1] !== 0;
  return entry.st === 'finished'
    || entry.st === 'confirmed'
    || entry.st === 'walkover'
    || entry.st === 'live'
    || entry.st === 'halftime'
    || entry.wo != null;
}

/**
 * 今天場數只算開賽時間落在今天的比賽日、而且不是已取消的場次。時間待定不算今天。
 * 台北 00:00～04:59 算前一個比賽日。下一場只看 st === 'scheduled' 且開賽時間 ≥ now 的最早一場（改期、已取消都不算）。
 */
export function liveStrip(entries: readonly SummaryEntry[], now: number): LiveStrip {
  const todayKey = matchDayOf(now).key;
  let today = 0;
  for (const entry of entries) {
    if (entry.k != null && entry.st !== 'cancelled' && matchDayOf(entry.k).key === todayKey) today += 1;
  }
  return { today, next: nextUp(entries, now)?.time ?? null };
}

export interface NextUp {
  at: number;
  /** 台北 HH:mm。 */
  time: string;
  /** 開賽時間剛好是 at 的全部 scheduled 場次（同一時間兩場以上都算下一場）。 */
  rows: SummaryEntry[];
}

/** 下一場：st === 'scheduled' 且開賽時間 ≥ now 裡最早的那個時間，含同一時間的每一場（與 liveStrip 同一條規則）。 */
export function nextUp(entries: readonly SummaryEntry[], now: number): NextUp | null {
  let at: number | null = null;
  for (const entry of entries) {
    if (entry.st !== 'scheduled' || entry.k == null || entry.k < now) continue;
    if (at == null || entry.k < at) at = entry.k;
  }
  if (at == null) return null;
  const first = at;
  return { at: first, time: formatKickoffClock(first), rows: entries.filter((entry) => entry.st === 'scheduled' && entry.k === first) };
}

export interface HeroUpcoming {
  at: number;
  time: string;
  venue: string | null;
  home: string | null;
  away: string | null;
}

/** 頂部數字格。時間與名稱交給元件格式化；這裡不讀字典。 */
export type HeroCell =
  /** 進行中「下一場」與預熱「首場」：同一時間只有一場才帶對戰與場地。 */
  | ({ kind: 'next' } & HeroUpcoming)
  | ({ kind: 'first' } & HeroUpcoming)
  | { kind: 'today'; n: number }
  | { kind: 'countdown'; n: number }
  | { kind: 'deadline'; at: number }
  | { kind: 'approved'; teams: number; max: number };

export interface HeroChampion {
  id: string;
  /** null＝只有一組（不寫組名）。 */
  group: GroupHeading | null;
  /** 第 1 名未裁定同分時是 null，畫面寫「冠軍待主辦裁定」。 */
  name: string | null;
}

export interface DetailHero {
  /** true＝記分板；false＝同排法的玻璃卡。 */
  board: boolean;
  lit: boolean;
  cells: HeroCell[];
  /** 整場延期／取消的原因（玻璃卡才有）。 */
  reason: string | null;
  /** 已結束才有；有冠軍或待裁定的組別各一筆。 */
  champions: HeroChampion[];
}

/**
 * 詳情頂部要畫什麼（施工-第1b批 3.3）。只用這一頁已經讀進來的資料，不增加讀取。
 * 已取消、已延期、已結束一律玻璃卡；進行中、預熱、招募要算得出至少一格才放板，進行中才亮燈。
 * 進行中而今天一場都沒有（多日賽事的休息日）不放板（設計總監定）。summary 一律是首屏那一片，不用全部賽程。
 */
export function detailHero(input: {
  phase: 'recruit' | 'warm' | 'live' | 'done';
  status: string;
  statusReason: string | null;
  regCloseAt: number;
  firstMatchAt: number;
  summary: readonly SummaryEntry[];
  divisions: readonly { approvedCount: number; maxTeams: number }[];
  standings: readonly StandingDoc[];
  venues?: readonly { name?: string | null }[];
  now: number;
}): DetailHero {
  const plain: DetailHero = { board: false, lit: false, cells: [], reason: null, champions: [] };
  if (input.status === 'cancelled' || input.status === 'postponed') {
    return { ...plain, reason: input.statusReason?.trim() || null };
  }
  if (input.phase === 'done') {
    const multiple = input.standings.length > 1;
    const champions = input.standings.flatMap((doc, index): HeroChampion[] => {
      const result = championName(doc);
      if (!result.pending && !result.name) return [];
      return [{ id: doc.id, group: standingHeading(doc, index, multiple), name: result.pending ? null : result.name }];
    });
    return { ...plain, champions };
  }
  const cells: HeroCell[] = [];
  const upCell = (kind: 'next' | 'first', up: NextUp | null): void => {
    if (!up) return;
    const only = up.rows.length === 1 ? up.rows[0] : undefined;
    const upcoming: HeroUpcoming = {
      at: up.at,
      time: up.time,
      venue: only ? summaryVenue(only, input.venues) || null : null,
      home: only?.h.n ?? null,
      away: only?.a.n ?? null,
    };
    cells.push(kind === 'next' ? { kind, ...upcoming } : { kind, ...upcoming });
  };
  if (input.phase === 'live') {
    const today = liveStrip(input.summary, input.now).today;
    if (today === 0) return plain;
    upCell('next', nextUp(input.summary, input.now));
    cells.push({ kind: 'today', n: today });
  } else if (input.phase === 'warm') {
    upCell('first', nextUp(input.summary, input.now));
    cells.push({ kind: 'countdown', n: daysUntilStart(input.firstMatchAt, input.now) });
  } else {
    cells.push({ kind: 'deadline', at: input.regCloseAt });
    if (input.divisions.length > 0) {
      cells.push({
        kind: 'approved',
        teams: input.divisions.reduce((sum, division) => sum + division.approvedCount, 0),
        max: input.divisions.reduce((sum, division) => sum + division.maxTeams, 0),
      });
    }
  }
  return { ...plain, board: true, lit: input.phase === 'live', cells };
}

function matchOf(
  entry: SummaryEntry,
  venues: readonly { name?: string | null }[] | undefined,
  nextDay: ((time: string) => string) | undefined,
): ScheduleMatch {
  return {
    id: entry.id,
    time: entry.k == null ? null : kickoffTimeLabel(entry.k, nextDay),
    venue: summaryVenue(entry, venues),
    homeId: entry.h.id,
    homeName: entry.h.n,
    awayId: entry.a.id,
    awayName: entry.a.n,
    score: showsScore(entry) ? entry.s : null,
    mark: publicMark(entry),
    // 已取消的原因只看摘要 cr。當日公開列與全部賽程同一條，不另讀場次。
    reason: entry.st === 'cancelled' ? (entry.cr?.trim() || null) : null,
    live: entry.st === 'live' || entry.st === 'halftime',
    corrected: showsCorrected(entry),
    pk: pkPair(entry.p),
    homeLogo: entry.h.l ?? null,
    awayLogo: entry.a.l ?? null,
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
 * 依組別、再依比賽日分組。時間未定的場次收在該組最後，標題用呼叫端給的「時間待定」。
 * 白天場的比賽日與日曆日相同。凌晨場歸前一日，時刻由 kickoffTimeLabel 寫「隔日」。
 * divisionOrder 用組別文件的順序；沒列到的組別排在後面。
 * venues 省略時場地只用 v。
 */
export function groupSchedule(
  entries: readonly SummaryEntry[],
  now: number,
  labels: { tbd: string; today: string; weekdays: readonly string[]; nextDay?: (time: string) => string },
  divisionOrder: readonly string[] = [],
  venues?: readonly { name?: string | null }[],
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
    const dayAt = new Map<string, number>();
    const tbd: ScheduleMatch[] = [];
    for (const entry of rows) {
      const match = matchOf(entry, venues, labels.nextDay);
      if (entry.k == null) {
        tbd.push(match);
        continue;
      }
      // 分組用比賽日。標題用該日中午，凌晨場不會被標成下一個日曆日。
      const day = matchDayOf(entry.k);
      if (!dated.has(day.key)) {
        dated.set(day.key, []);
        dayOrder.push(day.key);
        dayAt.set(day.key, matchDayNoon(entry.k));
      }
      dated.get(day.key)?.push(match);
    }
    const days: ScheduleDay[] = dayOrder.map((key) => {
      const at = dayAt.get(key);
      return {
        key,
        label: at != null ? scheduleDayLabel(at, now, labels.today, labels.weekdays) : key,
        matches: dated.get(key) ?? [],
      };
    });
    if (tbd.length > 0) days.push({ key: 'tbd', label: labels.tbd, matches: tbd });
    return { divisionId, days };
  });
}

/** 多組才有標題。name 是積分文件的 divisionName；沒有時用 n（1 起算）套「組別 {n}」。 */
export interface GroupHeading {
  name: string | null;
  n: number;
}

function divisionNameOf(doc: StandingDoc | undefined): string | null {
  const text = doc?.divisionName?.trim() ?? '';
  return text || null;
}

/**
 * 積分榜一組的標題。只有一份積分文件時不顯示組名。
 * n 依呼叫端傳入的積分文件順序（0 起算），這裡不重排。
 */
export function standingHeading(doc: StandingDoc, index: number, multiple: boolean): GroupHeading | null {
  if (!multiple) return null;
  return { name: divisionNameOf(doc), n: index + 1 };
}

/**
 * 賽程依摘要 dv 分組後的標題。只有一組不顯示。
 * 組名用對到的積分文件 divisionName。缺名稱時，序號用該組在積分文件裡的順序。
 * 對不到積分文件時，序號用賽程分組順序。不讀組別文件。
 */
export function scheduleHeading(
  divisionId: string,
  scheduleIndex: number,
  multiple: boolean,
  standings: readonly StandingDoc[],
): GroupHeading | null {
  if (!multiple) return null;
  const at = standings.findIndex((doc) => doc.divisionId === divisionId);
  if (at >= 0) return { name: divisionNameOf(standings[at]), n: at + 1 };
  return { name: null, n: scheduleIndex + 1 };
}

/**
 * 只看每一列自己的 hasUnresolvedTie。文件上的 hasUnresolvedTie 不拿來標。
 * hasUnresolvedTie === true 才標同分；這些列若積分相同，名次改成該群最小的名次。
 * 積分相同但該列已分出名次（hasUnresolvedTie 不是 true）不標、不改名次，但 samePoints 仍是 true。
 * decidedBy 有值時不當待裁定，同分小標也不掛（改由裁定小標負責）。
 */
export function standingLines(doc: StandingDoc): StandingLine[] {
  const rows = doc.rows.map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.rank - b.row.rank || a.index - b.index)
    .map((item) => item.row);
  const pointCount = new Map<number, number>();
  for (const row of rows) pointCount.set(row.points, (pointCount.get(row.points) ?? 0) + 1);
  const lines: StandingLine[] = rows.map((row) => ({
    teamId: row.teamId,
    name: row.name,
    played: row.played,
    win: row.win,
    draw: row.draw,
    loss: row.loss,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDiff: row.goalDiff,
    points: row.points,
    rank: row.rank,
    tie: rowNeedsRuling(row),
    samePoints: (pointCount.get(row.points) ?? 0) >= 2,
    decidedBy: row.decidedBy,
    top: false,
  }));
  const groups = new Map<number, number[]>();
  lines.forEach((line, index) => {
    if (!line.tie) return;
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
    }
  }
  for (const line of lines) line.top = line.rank === 1;
  return lines;
}

export interface ChampionName {
  /** 已裁定的第 1 名。未裁定或沒有第 1 名是 null。 */
  name: string | null;
  /** 第 1 名尚未裁定同分。這時不寫隊名。 */
  pending: boolean;
}

/**
 * 這一組的冠軍。第 1 名有未裁定同分時 pending，name 是 null。
 * 多組時由呼叫端每份積分文件各算一次，每組一位。
 */
export function championName(doc: StandingDoc): ChampionName {
  const top = standingLines(doc).filter((line) => line.rank === 1);
  if (top.some((line) => line.tie)) return { name: null, pending: true };
  return { name: top[0]?.name ?? null, pending: false };
}

export function formatGoalDiff(diff: number): string {
  return diff > 0 ? `+${diff}` : String(diff);
}
