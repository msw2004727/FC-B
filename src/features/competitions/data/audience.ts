// 觀眾即時的純函式。不連 Firestore。監聽與查詢在 audience-watch.ts。
// 單筆 get 計 1。查詢計回傳筆數加 1。0 筆仍是 1。紀錄最多 200，分頁最多 2，每頁最多 100。

import type { ScorerRow, CardStatRow } from '../live/stats';
import type { ServerEvent } from '../live/data/types';
import type { VoidMark } from '../live/types';
import type { EntryDoc, MatchClock, MatchStatus, SummaryEntry } from './types';
import { matchDayOf } from './match-day';

export const LOG_PAGE = 100;
export const LOG_MAX = 200;
export const LOG_PAGES = 2;
export const SCORER_CAP = 50;
export const DASH = '—';

const RESULTED = new Set(['finished', 'confirmed', 'walkover']);
const MATCH_STATUSES: readonly MatchStatus[] = [
  'scheduled', 'postponed', 'live', 'halftime', 'finished', 'confirmed', 'walkover', 'cancelled',
];

export interface AudienceSide {
  teamId: string;
  name: string;
  logo: string | null;
}

export interface AudienceMatch {
  id: string;
  divisionId: string;
  status: MatchStatus;
  rev: number;
  resetRev: number;
  score: { home: number; away: number };
  clockBase: MatchClock;
  kickoffAt: number | null;
  venueName: string | null;
  venueIdx: number | null;
  home: AudienceSide;
  away: AudienceSide;
  penaltyScore: { home: number; away: number } | null;
  scoreCorrectedAt: number | null;
}

export type AudienceMatchResult =
  | { kind: 'ok'; match: AudienceMatch }
  | { kind: 'missing' };

export interface StatPlayer {
  plId: string;
  n: string | null;
  e: string | null;
  g: number;
  y: number;
  r: number;
}

export interface ParsedStats {
  stalled: boolean;
  /** 已知限制：只留最早停更的場次，畫面不顯示。 */
  stalledMt: string | null;
  players: StatPlayer[];
}

export interface RankedCard extends CardStatRow {
  rank: number;
}

export interface ScorerTables {
  scorers: ScorerRow[];
  cards: RankedCard[];
  empty: boolean;
  capped: boolean;
  stalled: boolean;
}

export interface AudiencePorts {
  watchSummary(input: { cid: string; shardId: string }, onRows: (rows: SummaryEntry[]) => void): () => void;
  watchMatch(input: { cid: string; mtId: string }, onMatch: (result: AudienceMatchResult) => void): () => void;
  readLog(input: {
    cid: string;
    mtId: string;
    /** 時間軸只取 seq 大於這個值。第一次是 resetRev。 */
    afterEvents: number;
    /** 作廢只取 seq 大於這個值。第一次是 resetRev。 */
    afterVoids: number;
    /** 這一波之前已經留下的筆數，各自上限 200。 */
    alreadyEvents: number;
    alreadyVoids: number;
  }): Promise<{ events: ParsedTimeline[]; voids: VoidMark[]; reads: number }>;
  getStats(cid: string, dvId: string): Promise<ParsedStats>;
}

export interface ParsedTimeline {
  event: ServerEvent;
  number: number | null;
  playerName: string | null;
  plId: string | null;
  side: 'home' | 'away' | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** 有 cx 且狀態是已結束、已確認或棄權才顯示。重置回未賽但 cx 還在時不顯示。 */
export function showsCorrected(entry: { st: string; cx?: number | null }): boolean {
  if (entry.cx == null || !Number.isFinite(entry.cx)) return false;
  return RESULTED.has(entry.st);
}

export function pkPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const home = finite(value[0]);
  const away = finite(value[1]);
  if (home == null || away == null) return null;
  return [home, away];
}

/**
 * 未確認用 venues[vi].name。vi 缺、不是整數、或超出就用 v。
 * 已確認與棄權（st 或 wo）用 v。
 */
export function summaryVenue(
  entry: { st: string; wo?: string | null; v?: string | null; vi?: number | null },
  venues?: readonly { name?: string | null }[] | null,
): string {
  const locked = entry.st === 'confirmed' || entry.st === 'walkover' || (entry.wo != null && entry.wo !== '');
  if (!locked && venues && entry.vi != null && Number.isInteger(entry.vi) && entry.vi >= 0 && entry.vi < venues.length) {
    const name = venues[entry.vi]?.name?.trim() ?? '';
    if (name) return name;
  }
  return entry.v?.trim() ?? '';
}

/** 今天（比賽日）有 live 或 halftime 才監聽。沒有開賽時間的場次不算今天。 */
export function hasLiveOnMatchDay(entries: readonly SummaryEntry[], now: number): boolean {
  const key = matchDayOf(now).key;
  return entries.some((entry) => (
    entry.k != null
    && matchDayOf(entry.k).key === key
    && (entry.st === 'live' || entry.st === 'halftime')
  ));
}

/** 用這一波摘要換掉同一個比賽日的列。其他天與時間待定留著。 */
export function mergeSummaryShard(
  current: readonly SummaryEntry[],
  incoming: readonly SummaryEntry[],
  now: number,
): SummaryEntry[] {
  const key = matchDayOf(now).key;
  const rest = current.filter((entry) => entry.k == null || matchDayOf(entry.k).key !== key);
  return [...rest, ...incoming];
}

export function scorerDivisions(
  divisions: readonly { dvId: string; name: string }[],
  standings: readonly { divisionId: string; divisionName?: string | null }[],
  summary: readonly { dv: string }[],
): { id: string; name: string }[] {
  if (divisions.length > 0) {
    return divisions.filter((row) => row.dvId).map((row) => ({ id: row.dvId, name: row.name || row.dvId }));
  }
  const fromStandings: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const row of standings) {
    if (!row.divisionId || seen.has(row.divisionId)) continue;
    seen.add(row.divisionId);
    const name = row.divisionName?.trim() || row.divisionId;
    fromStandings.push({ id: row.divisionId, name });
  }
  if (fromStandings.length > 0) return fromStandings;
  const ids: { id: string; name: string }[] = [];
  for (const row of summary) {
    if (!row.dv || seen.has(row.dv)) continue;
    seen.add(row.dv);
    ids.push({ id: row.dv, name: row.dv });
  }
  return ids;
}

/** 隊名只對報名文件 id。對不到是 null，呼叫端顯示破折號。 */
export function teamNameByEnId(enId: string, entries: readonly EntryDoc[]): string | null {
  const found = entries.find((row) => row.id === enId);
  const name = found?.name?.trim() ?? '';
  return name || null;
}

function addFinite(value: unknown): number {
  const n = finite(value);
  return n == null ? 0 : n;
}

/** stalledAt 只要不是 null／undefined 就算停更，含 0。stalledMt 不進畫面。 */
export function parseStats(raw: unknown): ParsedStats {
  const rec = isRecord(raw) ? raw : {};
  const matches = isRecord(rec.m) ? rec.m : {};
  const by = new Map<string, StatPlayer>();
  for (const cell of Object.values(matches)) {
    if (!isRecord(cell)) continue;
    for (const [plId, value] of Object.entries(cell)) {
      if (!plId || !isRecord(value)) continue;
      const row = by.get(plId) ?? { plId, n: null, e: null, g: 0, y: 0, r: 0 };
      row.g += addFinite(value.g);
      row.y += addFinite(value.y);
      row.r += addFinite(value.r);
      const name = text(value.n);
      const enId = text(value.e);
      if (name) row.n = name;
      if (enId) row.e = enId;
      by.set(plId, row);
    }
  }
  return {
    stalled: rec.stalledAt != null,
    stalledMt: text(rec.stalledMt),
    players: [...by.values()],
  };
}

function byId(a: { plId: string }, b: { plId: string }): number {
  return a.plId < b.plId ? -1 : a.plId > b.plId ? 1 : 0;
}

function withRank<T>(rows: readonly T[], same: (a: T, b: T) => boolean): (T & { rank: number })[] {
  let rank = 1;
  return rows.map((row, index) => {
    if (index > 0 && !same(rows[index - 1] as T, row)) rank = index + 1;
    return { ...row, rank };
  });
}

/** 跨場加總後排序。進球由大到小，牌先紅再黃。同分同名次，下一名次跳號。超過 50 才截斷。 */
export function scorerTables(stats: ParsedStats, teamName: (enId: string) => string | null): ScorerTables {
  const active = stats.players.filter((row) => row.g > 0 || row.y > 0 || row.r > 0);
  const named = active.map((row) => ({
    plId: row.plId,
    displayName: row.n?.trim() || DASH,
    teamName: (row.e ? teamName(row.e) : null) || DASH,
    goals: row.g,
    yellow: row.y,
    red: row.r,
    isMinor: false,
  }));
  const goals = withRank(
    [...named].filter((row) => row.goals > 0).sort((a, b) => b.goals - a.goals || byId(a, b)),
    (a, b) => a.goals === b.goals,
  );
  const cards = withRank(
    [...named].filter((row) => row.yellow > 0 || row.red > 0).sort((a, b) => b.red - a.red || b.yellow - a.yellow || byId(a, b)),
    (a, b) => a.red === b.red && a.yellow === b.yellow,
  );
  return {
    scorers: goals.slice(0, SCORER_CAP).map((row) => ({
      rank: row.rank,
      plId: row.plId,
      displayName: row.displayName,
      isMinor: false,
      teamName: row.teamName,
      goals: row.goals,
    })),
    cards: cards.slice(0, SCORER_CAP).map((row) => ({
      rank: row.rank,
      plId: row.plId,
      displayName: row.displayName,
      isMinor: false,
      teamName: row.teamName,
      yellow: row.yellow,
      red: row.red,
    })),
    empty: named.length === 0,
    capped: goals.length > SCORER_CAP || cards.length > SCORER_CAP,
    stalled: stats.stalled,
  };
}

export interface PageRequest {
  afterSeq: number;
  limit: number;
  /** 第一頁是 null。之後是上一頁最後一筆，讓查詢用 startAfter。 */
  cursor: unknown;
}

/**
 * 依 seq 分頁。每頁最多 100、最多 2 頁、留下的筆數加已讀筆數不超過 200。
 * 每一頁讀取量是回傳筆數加 1。沒有剩餘額度時不查，讀取是 0。
 * 0 筆仍查 1 頁，讀取是 1。
 */
export async function pageLoop<T>(
  fetchPage: (input: { afterSeq: number; limit: number; cursor: T | null }) => Promise<T[]>,
  afterSeq: number,
  already: number,
): Promise<{ rows: T[]; reads: number }> {
  const room = LOG_MAX - already;
  if (room <= 0) return { rows: [], reads: 0 };
  const rows: T[] = [];
  let reads = 0;
  let cursor: T | null = null;
  for (let page = 0; page < LOG_PAGES && rows.length < room; page += 1) {
    const limit = Math.min(LOG_PAGE, room - rows.length);
    const batch = await fetchPage({ afterSeq, limit, cursor });
    reads += batch.length + 1;
    rows.push(...batch);
    if (batch.length < limit) break;
    cursor = batch[batch.length - 1] ?? null;
  }
  return { rows: rows.slice(0, room), reads };
}

function sideOf(value: unknown): AudienceSide | null {
  if (!isRecord(value)) return null;
  const teamId = text(value.teamId) ?? text(value.id);
  const name = typeof value.name === 'string' ? value.name : (typeof value.n === 'string' ? value.n : null);
  if (!teamId || name == null) return null;
  return { teamId, name, logo: text(value.logo) ?? text(value.l) };
}

/**
 * clockBase.startedAt 在 Firestore 是 Timestamp（有 toMillis），也接受 {seconds,nanoseconds} 與毫秒數字。
 * 11-20 走查：原本用 finite() 只收數字，Timestamp 讀成 null，觀眾頁時鐘停在暫停累計秒數（取代 finite(raw.startedAt)）。
 */
function startedAtMillis(value: unknown): number | null {
  const n = finite(value);
  if (n != null) return n;
  if (!isRecord(value)) return null;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis === 'function') {
    const ms = (toMillis as () => unknown).call(value);
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
  }
  const seconds = finite(value.seconds);
  if (seconds == null) return null;
  return seconds * 1000 + Math.floor((finite(value.nanoseconds) ?? 0) / 1e6);
}

function clockOf(value: unknown): MatchClock {
  const raw = isRecord(value) ? value : {};
  return {
    startedAt: startedAtMillis(raw.startedAt),
    pausedSec: finite(raw.pausedSec) ?? 0,
    running: raw.running === true,
    period: typeof raw.period === 'string' ? raw.period : 'pre',
  };
}

function penaltyOf(value: unknown): { home: number; away: number } | null {
  if (!isRecord(value)) return null;
  const home = finite(value.home);
  const away = finite(value.away);
  if (home == null || away == null) return null;
  return { home, away };
}

/** 觀眾場次。比分更正與 PK 留著。不讀點數。 */
export function audienceMatchFromDoc(id: string, raw: unknown): AudienceMatch | null {
  if (!isRecord(raw)) return null;
  const status = typeof raw.status === 'string' && (MATCH_STATUSES as readonly string[]).includes(raw.status)
    ? raw.status as MatchStatus
    : null;
  const home = sideOf(raw.home);
  const away = sideOf(raw.away);
  if (!status || !home || !away) return null;
  const scoreRaw = isRecord(raw.score) ? raw.score : {};
  return {
    id: text(raw.matchId) ?? id,
    divisionId: text(raw.divisionId) ?? '',
    status,
    rev: finite(raw.rev) ?? 0,
    resetRev: finite(raw.resetRev) ?? 0,
    score: { home: finite(scoreRaw.home) ?? 0, away: finite(scoreRaw.away) ?? 0 },
    clockBase: clockOf(raw.clockBase),
    kickoffAt: finite(raw.kickoffAt),
    venueName: text(raw.venueName),
    venueIdx: Number.isInteger(raw.venueIdx) ? raw.venueIdx as number : null,
    home,
    away,
    penaltyScore: penaltyOf(raw.penaltyScore),
    scoreCorrectedAt: finite(raw.scoreCorrectedAt),
  };
}

function eventSide(value: unknown): 'home' | 'away' | null {
  return value === 'home' || value === 'away' ? value : null;
}

/** 文件上若有 n／no 就帶出來，不為了名字另讀名單。 */
export function parseTimelineDoc(raw: unknown): ParsedTimeline | null {
  if (!isRecord(raw)) return null;
  const seq = finite(raw.seq);
  const type = text(raw.type);
  if (seq == null || !type) return null;
  const side = eventSide(raw.side);
  const plId = text(raw.plId);
  const event: ServerEvent = {
    seq,
    type,
    op: text(raw.op) ?? type,
    sid: text(raw.sid) ?? '',
    ...(side ? { side } : {}),
    ...(plId ? { plId } : {}),
    ...(text(raw.goalKind) ? { goalKind: text(raw.goalKind) ?? undefined } : {}),
    ...(text(raw.cardType) ? { cardType: text(raw.cardType) ?? undefined } : {}),
    ...(finite(raw.refSeq) != null ? { refSeq: finite(raw.refSeq) ?? undefined } : {}),
    ...(finite(raw.targetSeq) != null ? { targetSeq: finite(raw.targetSeq) ?? undefined } : {}),
    ...(text(raw.inPlId) ? { inPlId: text(raw.inPlId) ?? undefined } : {}),
    ...(text(raw.outPlId) ? { outPlId: text(raw.outPlId) ?? undefined } : {}),
    ...(typeof raw.scored === 'boolean' ? { scored: raw.scored } : {}),
    matchSecond: finite(raw.matchSecond) ?? 0,
    createdAt: finite(raw.createdAt) ?? 0,
  };
  const number = finite(raw.no);
  return {
    event,
    number: number != null && Number.isInteger(number) ? number : null,
    playerName: text(raw.n),
    plId,
    side,
  };
}

export function parseVoidDoc(id: string, raw: unknown): VoidMark | null {
  const rec = isRecord(raw) ? raw : {};
  const target = finite(rec.targetSeq) ?? finite(Number(id));
  const seq = finite(rec.seq);
  if (target == null || seq == null) return null;
  return { targetSeq: target, seq, createdAt: finite(rec.createdAt) ?? 0 };
}

/**
 * 頁面可見才執行 attach。隱藏時解除，回到前景再掛一次。
 * 開始時若已經隱藏，不呼叫 attach。
 */
export function bindVisible(attach: () => () => void, doc: Document = document): () => void {
  let stop = (): void => {};
  const sync = (): void => {
    stop();
    stop = () => {};
    if (doc.visibilityState === 'hidden') return;
    stop = attach();
  };
  sync();
  const onVisibility = (): void => sync();
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    stop();
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}

/** 未開賽、改期、已取消不顯示走時。回傳給時鐘列的一行字，由呼叫端組。 */
export function isPrefaceStatus(status: string): boolean {
  return status === 'scheduled' || status === 'postponed' || status === 'cancelled';
}
