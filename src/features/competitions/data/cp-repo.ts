// asia-main 讀取。每個契約 §3 的讀取一個方法，筆數上限照表（CP_READ_LIMIT）。
// 不寫入。寫入走 cp-callables。
//
// ASSUMPTION: divisions、entries、roster、entryPrivate、rosterPrivate、staff 都是 competitions/{cid} 底下的子集合。
// ASSUMPTION: 時間若是 Firestore Timestamp（有 toMillis）就轉成毫秒；契約寫的是整數毫秒。
// ASSUMPTION: 組別讀出後依 order 再依 dvId 排序，查詢本身不加 orderBy（契約沒有要求索引）。
// ASSUMPTION: 有篩選的私密查詢同樣最多 100 筆（契約只對不帶篩選寫了 limit）。
// ASSUMPTION: id 含「/」視為無效，回空結果，避免路徑跳出集合。
// ASSUMPTION: 缺 hidden 視為 false；缺 isMinor、rosterConfirmed 視為 false；缺 stateVersion、人數、費用視為 0。
// ASSUMPTION: requireRealName 缺值時，有年齡限制則 true，否則 false（契約：預設＝有年齡限制）。
// ASSUMPTION: getStaff 對應契約正文的 staff/{uid}.roles，讀取表沒有獨立一列。

import { clipCodePoints } from '../format';
import { getCpFirebase } from './cp-firebase';
import { categoryOf } from './present';
import {
  CP_READ_LIMIT,
  type CompetitionDoc,
  type CompetitionSport,
  type CompetitionStatus,
  type CpMineItem,
  type DivisionDoc,
  type EntryDoc,
  type EntryPrivateDoc,
  type EntryStatus,
  type HostType,
  type LaunchDoc,
  type MapProvider,
  type MatchClock,
  type MatchDoc,
  type MatchResult,
  type MatchScore,
  type MatchSide,
  type MatchSideName,
  type MatchStatus,
  type CompetitionNotice,
  type NoticeKind,
  type ManualOverride,
  type MineRole,
  type PaymentStatus,
  type PlayersOnField,
  type RosterPositionCode,
  type RosterPrivateDoc,
  type RosterPublicDoc,
  type StaffAssignment,
  type StaffAssignmentRole,
  type StaffDoc,
  type StaffRole,
  type StandingDoc,
  type StandingRanking,
  type StandingRow,
  type TieDecisionMethod,
  type SummaryEntry,
  type Venue,
} from './types';

export interface CompetitionsRepo {
  getLaunch(): Promise<LaunchDoc | null>;
  getLaunchTester(uid: string): Promise<boolean>;
  listMine(uid: string): Promise<CpMineItem[]>;
  /** includeInternal：測試者／管理員不帶 visibility，才能看到內部賽。一般會員維持只查公開。 */
  listPublic(includeInternal?: boolean): Promise<CompetitionDoc[]>;
  listByHostTeam(teamId: string, publicOnly: boolean): Promise<CompetitionDoc[]>;
  getCompetition(cid: string): Promise<CompetitionDoc | null>;
  listDivisions(cid: string): Promise<DivisionDoc[]>;
  listEntries(cid: string): Promise<EntryDoc[]>;
  listRoster(cid: string, enId: string): Promise<RosterPublicDoc[]>;
  /** teamId 為 null：不帶篩選（主辦／發起人），最多 100。有值則 where teamId。 */
  listEntryPrivate(cid: string, teamId: string | null): Promise<EntryPrivateDoc[]>;
  /** uid 為 null：不帶篩選，最多 100。有值則 where uid。 */
  listRosterPrivate(cid: string, uid: string | null): Promise<RosterPrivateDoc[]>;
  getStaff(cid: string, uid: string): Promise<StaffDoc | null>;
  /** 人員清單。staff 子集合最多 100。保留記分角色與場次。 */
  listStaff(cid: string): Promise<StaffAssignment[]>;
  /** 單筆 staff。保留記分角色。沒有文件是 null。 */
  getStaffAssignment(cid: string, uid: string): Promise<StaffAssignment | null>;
  /** 該賽事場次，最多 CP_READ_LIMIT.matches。不監聽。 */
  listMatches(cid: string): Promise<MatchDoc[]>;
  /** 單筆場次。沒有或壞掉是 null。 */
  getMatch(cid: string, mtId: string): Promise<MatchDoc | null>;
  /** 一片摘要。沒有這片回空陣列。shardId 是 dYYYYMMDD 或 tbd。 */
  getSummaryShard(cid: string, shardId: string): Promise<SummaryEntry[]>;
  /** 摘要片攤平後的條目，片數最多 CP_READ_LIMIT.summary。 */
  listSummary(cid: string): Promise<SummaryEntry[]>;
  /** 積分榜，最多 CP_READ_LIMIT.standings。 */
  listStandings(cid: string): Promise<StandingDoc[]>;
  /**
   * 隊徽用的報名。同一 repo 實例、同一個 cid 只打一次網路（含空結果）。
   * 只查 status == approved，上限仍是 CP_READ_LIMIT.crest。
   * 失敗不記住，下次可以重試。不得改成即時監聽。
   */
  listEntriesForCrest(cid: string): Promise<EntryDoc[]>;
  /** 清掉這個賽事的隊徽快取。下次 listEntriesForCrest 會再查。 */
  invalidateCrests(cid: string): void;
}

interface DocSnap {
  id: string;
  exists(): boolean;
  data(): Record<string, unknown> | undefined;
}

interface QuerySnap {
  docs: ReadonlyArray<{ id: string; data(): Record<string, unknown> }>;
}

export interface CpFirestoreSdk {
  doc(db: unknown, path: string): unknown;
  collection(db: unknown, path: string): unknown;
  query(col: unknown, ...clauses: unknown[]): unknown;
  where(field: string, op: string, value: unknown): unknown;
  limit(n: number): unknown;
  getDoc(ref: unknown): Promise<DocSnap>;
  getDocs(query: unknown): Promise<QuerySnap>;
}

export interface CpRepoDeps {
  getDb: () => Promise<unknown>;
  loadSdk: () => Promise<CpFirestoreSdk>;
}

const PUBLIC_STATUSES: readonly CompetitionStatus[] = ['published', 'postponed', 'cancelled'];
const HOST_TYPES: readonly HostType[] = ['personal', 'club'];
const STATUSES: readonly CompetitionStatus[] = ['draft', 'published', 'postponed', 'cancelled'];
const ENTRY_STATUSES: readonly EntryStatus[] = ['pending', 'approved', 'rejected', 'withdrawn'];
const PAYMENT_STATUSES: readonly PaymentStatus[] = ['none', 'pending', 'paid', 'refunded'];
const PLAYERS: readonly PlayersOnField[] = [5, 7, 8, 9, 11];
const POSITIONS: readonly RosterPositionCode[] = ['GK', 'DF', 'MF', 'FW', 'custom'];
const MINE_ROLES: readonly MineRole[] = ['host', 'rep', 'player'];
const STAFF_ROLES: readonly StaffRole[] = ['host', 'coHost'];
const STAFF_ASSIGN_ROLES: readonly StaffAssignmentRole[] = ['host', 'coHost', 'scorer', 'referee'];
/** 人員清單上限。不放進 CP_READ_LIMIT，避免改既有預算常數。 */
const STAFF_LIST_LIMIT = 100;
const MATCH_STATUSES: readonly MatchStatus[] = [
  'scheduled', 'postponed', 'live', 'halftime', 'finished', 'confirmed', 'walkover', 'cancelled',
];
const ENDED_BY: readonly ('confirm' | 'host' | 'auto')[] = ['confirm', 'host', 'auto'];
const TIE_METHODS: readonly TieDecisionMethod[] = ['host', 'drawLots'];
const RANKINGS: readonly StandingRanking[] = ['h2hFirst', 'goalDiffFirst'];

function isSafeId(id: string): boolean {
  return id.length > 0 && !id.includes('/') && id !== '.' && id !== '..';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isRecord(value) && typeof value.toMillis === 'function') {
    const millis = (value.toMillis as () => unknown)();
    if (typeof millis === 'number' && Number.isFinite(millis)) return millis;
  }
  return null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null;
}

function optNum(value: unknown): number | null {
  return value == null ? null : num(value);
}

/** staff.memberNo。只收正整數。0、負數、小數、非數字丟掉，不把字串轉成數字。 */
function memberNoOf(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return undefined;
  return value;
}

function venueOf(value: unknown): Venue | null {
  if (!isRecord(value)) return null;
  const name = str(value.name);
  if (!name) return null;
  const venue: Venue = { name };
  const address = str(value.address);
  if (address) venue.address = address;
  const lat = num(value.lat);
  const lng = num(value.lng);
  if (lat != null) venue.lat = lat;
  if (lng != null) venue.lng = lng;
  const mapPlaceId = str(value.mapPlaceId);
  if (mapPlaceId) venue.mapPlaceId = mapPlaceId;
  const mapProvider = oneOf<MapProvider>(value.mapProvider, ['google', 'manual']);
  if (mapProvider) venue.mapProvider = mapProvider;
  return venue;
}

export function competitionFromDoc(id: string, raw: Record<string, unknown>): CompetitionDoc | null {
  const name = str(raw.name);
  const sport = oneOf<CompetitionSport>(raw.sport, ['football']);
  const hostType = oneOf(raw.hostType, HOST_TYPES);
  const status = oneOf(raw.status, STATUSES);
  const visibility = str(raw.visibility);
  const timezone = str(raw.timezone);
  const regOpenAt = num(raw.regOpenAt);
  const regCloseAt = num(raw.regCloseAt);
  const firstMatchAt = num(raw.firstMatchAt);
  const lastMatchAt = num(raw.lastMatchAt);
  if (!name || !sport || !hostType || !status || !visibility || !timezone) return null;
  if (regOpenAt == null || regCloseAt == null || firstMatchAt == null || lastMatchAt == null) return null;
  const venues = Array.isArray(raw.venues)
    ? raw.venues.map(venueOf).filter((venue): venue is Venue => venue != null)
    : [];
  const liveLinks = Array.isArray(raw.liveLinks)
    ? raw.liveLinks.filter((link): link is string => typeof link === 'string')
    : [];
  return {
    id,
    name,
    sport,
    hostType,
    hostTeamId: str(raw.hostTeamId),
    hostDisplay: str(raw.hostDisplay),
    visibility,
    status,
    statusReason: str(raw.statusReason),
    hidden: bool(raw.hidden) ?? false,
    regOpenAt,
    regCloseAt,
    firstMatchAt,
    lastMatchAt,
    endedAt: optNum(raw.endedAt),
    endedBy: oneOf(raw.endedBy, ENDED_BY),
    endReason: str(raw.endReason),
    rostersLockedAt: optNum(raw.rostersLockedAt),
    ageBasisAt: optNum(raw.ageBasisAt),
    timezone,
    venues,
    feeNote: str(raw.feeNote),
    liveLinks,
    contactNote: contactNoteOf(raw.contactNote),
    notices: noticesOf(raw.notices),
    lastMatchOriginAt: optNum(raw.lastMatchOriginAt),
    stateVersion: num(raw.stateVersion) ?? 0,
    category: categoryOf(raw),
  };
}

const NOTICE_KINDS: readonly NoticeKind[] = ['host', 'system'];

function contactNoteOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
}

function noticesOf(value: unknown): CompetitionNotice[] {
  if (!Array.isArray(value)) return [];
  const out: CompetitionNotice[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = str(item.id);
    const text = typeof item.text === 'string' ? item.text : null;
    const kind = oneOf(item.kind, NOTICE_KINDS);
    const at = num(item.at);
    if (!id || text == null || !kind || at == null) continue;
    out.push({ id, text, kind, at, by: str(item.by) });
  }
  return out;
}

function divisionFromDoc(id: string, raw: Record<string, unknown>): DivisionDoc | null {
  const name = str(raw.name);
  const playersOnField = oneOf<`${PlayersOnField}`>(String(raw.playersOnField), PLAYERS.map(String) as `${PlayersOnField}`[]);
  const onField = playersOnField == null ? null : Number(playersOnField) as PlayersOnField;
  const maxTeams = num(raw.maxTeams);
  const rosterMin = num(raw.rosterMin);
  const rosterMax = num(raw.rosterMax);
  if (!name || onField == null || maxTeams == null || rosterMin == null || rosterMax == null) return null;
  const minAge = optNum(raw.minAge);
  const maxAge = optNum(raw.maxAge);
  const dvId = str(raw.dvId) ?? id;
  return {
    dvId,
    name,
    playersOnField: onField,
    maxTeams,
    rosterMin,
    rosterMax,
    minAge,
    maxAge,
    requireRealName: bool(raw.requireRealName) ?? (minAge != null || maxAge != null),
    feePerTeam: num(raw.feePerTeam) ?? 0,
    entryCount: num(raw.entryCount) ?? 0,
    approvedCount: num(raw.approvedCount) ?? 0,
    order: num(raw.order) ?? 0,
    ranking: rankingOf(raw.schedule),
  };
}

/** generateSchedule 寫在 division.schedule.ranking。缺欄或不認得是 null。 */
function rankingOf(schedule: unknown): StandingRanking | null {
  if (!isRecord(schedule)) return null;
  return oneOf(schedule.ranking, RANKINGS);
}

function entryFromDoc(id: string, raw: Record<string, unknown>): EntryDoc | null {
  const dvId = str(raw.dvId);
  const teamId = str(raw.teamId);
  const name = str(raw.name);
  const status = oneOf(raw.status, ENTRY_STATUSES);
  if (!dvId || !teamId || !name || !status) return null;
  return {
    id,
    dvId,
    teamId,
    name,
    status,
    rosterCount: num(raw.rosterCount) ?? 0,
    rosterConfirmed: bool(raw.rosterConfirmed) ?? false,
    teamLogo: teamLogoOf(raw.teamLogo),
  };
}

/** 只收 https。http、空白、其他方案都當沒有隊徽。 */
function teamLogoOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('https://') || /\s/.test(trimmed)) return null;
  return trimmed;
}

function entryPrivateFromDoc(id: string, raw: Record<string, unknown>): EntryPrivateDoc | null {
  const teamId = str(raw.teamId);
  const paymentStatus = oneOf(raw.paymentStatus, PAYMENT_STATUSES);
  if (!teamId || !paymentStatus) return null;
  return {
    id,
    teamId,
    contactName: str(raw.contactName),
    contactPhone: str(raw.contactPhone),
    paymentStatus,
    reviewNote: str(raw.reviewNote),
  };
}

function rosterFromDoc(id: string, raw: Record<string, unknown>): RosterPublicDoc | null {
  const enId = str(raw.enId);
  const displayName = str(raw.displayName);
  const number = num(raw.number);
  if (!enId || displayName == null || number == null) return null;
  return {
    id,
    enId,
    displayName,
    number,
    position: oneOf(raw.position, POSITIONS),
    positionText: str(raw.positionText),
    isMinor: bool(raw.isMinor) ?? false,
  };
}

function mineFromDoc(id: string, raw: Record<string, unknown>): CpMineItem | null {
  const roles = Array.isArray(raw.roles)
    ? raw.roles.filter((role): role is MineRole => oneOf(role, MINE_ROLES) != null)
    : [];
  const name = str(raw.name)?.trim();
  return {
    id,
    cid: str(raw.cid) ?? id,
    roles,
    host: bool(raw.host) ?? false,
    ...(name ? { name } : {}),
    category: categoryOf(raw),
  };
}

function staffFromDoc(uid: string, raw: Record<string, unknown>): StaffDoc | null {
  const roles = Array.isArray(raw.roles)
    ? raw.roles.filter((role): role is StaffRole => oneOf(role, STAFF_ROLES) != null)
    : [];
  const memberNo = memberNoOf(raw.memberNo);
  return memberNo == null ? { uid, roles } : { uid, roles, memberNo };
}

/** 指派文件。已知角色依文件順序去重。matchIds 去重，最多 100。 */
function assignmentFromDoc(uid: string, raw: Record<string, unknown>): StaffAssignment {
  const roles: StaffAssignmentRole[] = [];
  if (Array.isArray(raw.roles)) {
    for (const item of raw.roles) {
      const role = oneOf(item, STAFF_ASSIGN_ROLES);
      if (role && !roles.includes(role)) roles.push(role);
    }
  }
  const matchIds: string[] = [];
  if (Array.isArray(raw.matchIds)) {
    for (const item of raw.matchIds) {
      if (typeof item !== 'string' || matchIds.includes(item)) continue;
      matchIds.push(item);
      if (matchIds.length >= STAFF_LIST_LIMIT) break;
    }
  }
  const memberNo = memberNoOf(raw.memberNo);
  const expiresAt = optNum(raw.expiresAt);
  return memberNo == null
    ? { uid, roles, matchIds, expiresAt }
    : { uid, roles, matchIds, expiresAt, memberNo };
}

function sideOf(value: unknown): MatchSide | null {
  if (!isRecord(value)) return null;
  const teamId = str(value.teamId);
  const name = str(value.name);
  if (!teamId || name == null) return null;
  return { teamId, name };
}

function matchResultOf(value: unknown): MatchResult | null {
  if (!isRecord(value)) return null;
  return {
    winner: str(value.winner),
    method: str(value.method),
    homePoints: num(value.homePoints) ?? 0,
    awayPoints: num(value.awayPoints) ?? 0,
  };
}

function clockOf(value: unknown): MatchClock {
  const raw = isRecord(value) ? value : {};
  return {
    startedAt: optNum(raw.startedAt),
    pausedSec: num(raw.pausedSec) ?? 0,
    running: bool(raw.running) ?? false,
    period: str(raw.period) ?? 'pre',
  };
}

/** 契約 §1.2。壞掉的場次整筆丟掉。penaltyScore 一律不收。 */
export function matchFromDoc(id: string, raw: Record<string, unknown>): MatchDoc | null {
  const divisionId = str(raw.divisionId);
  const status = oneOf(raw.status, MATCH_STATUSES);
  const home = sideOf(raw.home);
  const away = sideOf(raw.away);
  if (!divisionId || !status || !home || !away) return null;
  const scoreRaw = isRecord(raw.score) ? raw.score : {};
  const score: MatchScore = {
    home: num(scoreRaw.home) ?? 0,
    away: num(scoreRaw.away) ?? 0,
  };
  const teamIds = Array.isArray(raw.teamIds)
    ? raw.teamIds.filter((item): item is string => typeof item === 'string')
    : [];
  const pair: [string, string] = teamIds.length >= 2
    ? [teamIds[0] ?? home.teamId, teamIds[1] ?? away.teamId]
    : [home.teamId, away.teamId];
  const lockRaw = isRecord(raw.lock) ? raw.lock : {};
  const walkover = oneOf<MatchSideName>(raw.walkoverSide, ['home', 'away']);
  return {
    id: str(raw.matchId) ?? id,
    divisionId,
    stageId: str(raw.stageId) ?? 'group',
    groupId: str(raw.groupId) ?? 'A',
    round: num(raw.round) ?? 0,
    matchNo: num(raw.matchNo) ?? 0,
    label: str(raw.label),
    matchKey: str(raw.matchKey),
    kickoffAt: optNum(raw.kickoffAt),
    venueIdx: optNum(raw.venueIdx),
    venueName: str(raw.venueName),
    home,
    away,
    teamIds: pair,
    score,
    penaltyScore: null,
    status,
    rev: num(raw.rev) ?? 0,
    resetRev: num(raw.resetRev) ?? 0,
    lock: { locked: bool(lockRaw.locked) ?? false },
    clockBase: clockOf(raw.clockBase),
    finishedAt: optNum(raw.finishedAt),
    confirmedAt: optNum(raw.confirmedAt),
    walkoverSide: walkover,
    result: matchResultOf(raw.result),
    resultSource: raw.resultSource === 'host' ? 'host' : null,
    updatedAt: optNum(raw.updatedAt),
    cancelReason: str(raw.cancelReason),
    cancelledAt: optNum(raw.cancelledAt),
  };
}

function summaryLogo(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text || undefined;
}

function summarySide(value: unknown): { id: string; n: string; l?: string } | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const n = str(value.n);
  if (!id || n == null) return null;
  const logo = summaryLogo(value.l);
  return logo ? { id, n, l: logo } : { id, n };
}

function summaryPk(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const home = num(value[0]);
  const away = num(value[1]);
  if (home == null || away == null) return undefined;
  return [home, away];
}

/** 摘要 cr：只有已取消才留。空白不算。超過 100 字以碼位截斷。 */
function summaryCr(st: string, raw: unknown): string | undefined {
  if (st !== 'cancelled') return undefined;
  const text = str(raw)?.trim() ?? '';
  if (!text) return undefined;
  return clipCodePoints(text, 100);
}

function summaryEntryOf(id: string, raw: unknown): SummaryEntry | null {
  if (!isRecord(raw)) return null;
  const dv = str(raw.dv);
  const round = num(raw.r);
  const home = summarySide(raw.h);
  const away = summarySide(raw.a);
  if (!dv || round == null || !home || !away) return null;
  const score = Array.isArray(raw.s) ? raw.s : [];
  const st = str(raw.st) ?? '';
  const cr = summaryCr(st, raw.cr);
  const vi = optNum(raw.vi);
  const cx = optNum(raw.cx);
  const pk = summaryPk(raw.p);
  return {
    id,
    dv,
    r: round,
    no: optNum(raw.no),
    k: optNum(raw.k),
    v: str(raw.v),
    h: home,
    a: away,
    s: [num(score[0]) ?? 0, num(score[1]) ?? 0],
    st,
    wo: str(raw.wo),
    ...(cr ? { cr } : {}),
    // 選填只在有值時掛上。缺欄的物件與既有斷言相同。
    ...(vi != null && Number.isInteger(vi) && vi >= 0 ? { vi } : {}),
    ...(cx != null ? { cx } : {}),
    ...(pk ? { p: pk } : {}),
  };
}

/** 摘要文件的 m 對照表。鍵是場次 id。 */
export function summaryEntriesFromDoc(raw: Record<string, unknown>): SummaryEntry[] {
  const map = raw.m;
  if (!isRecord(map)) return [];
  const rows: SummaryEntry[] = [];
  for (const [id, value] of Object.entries(map)) {
    const entry = summaryEntryOf(id, value);
    if (entry) rows.push(entry);
  }
  return rows.sort(compareSummary);
}

function compareSummary(a: SummaryEntry, b: SummaryEntry): number {
  if (a.k == null && b.k != null) return 1;
  if (a.k != null && b.k == null) return -1;
  if (a.k != null && b.k != null && a.k !== b.k) return a.k - b.k;
  const no = (a.no ?? 0) - (b.no ?? 0);
  if (no !== 0) return no;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** tiedWith 只留非空字串。不是陣列、或混進數字與空字串，都丟掉。 */
function tiedWithOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/** 只讀引擎 StandingRow 的真實欄位。短名（w、d、l、gf、ga、gd、pts、p、n）與文件 id 不算。 */
function standingRowOf(value: unknown): StandingRow | null {
  if (!isRecord(value)) return null;
  const teamId = str(value.teamId);
  if (!teamId) return null;
  return {
    teamId,
    name: str(value.name) ?? '',
    played: num(value.played) ?? 0,
    win: num(value.win) ?? 0,
    draw: num(value.draw) ?? 0,
    loss: num(value.loss) ?? 0,
    goalsFor: num(value.goalsFor) ?? 0,
    goalsAgainst: num(value.goalsAgainst) ?? 0,
    goalDiff: num(value.goalDiff) ?? 0,
    points: num(value.points) ?? 0,
    rank: num(value.rank) ?? 0,
    hasUnresolvedTie: value.hasUnresolvedTie === true,
    tiedWith: tiedWithOf(value.tiedWith),
    decidedBy: oneOf(value.decidedBy, TIE_METHODS),
  };
}

function splitStandingId(id: string): { divisionId: string; groupId: string } | null {
  const parts = id.split('__');
  if (parts.length >= 3 && parts[1] === 'group' && parts[0]) {
    return { divisionId: parts[0], groupId: parts.slice(2).join('__') || 'A' };
  }
  return null;
}

/**
 * enabled === true 才留下方式、原因、時間。
 * decidedAt 優先，沒有才用舊欄位 at。method 不認得就當 null，紀錄仍留著。
 */
function manualOverrideOf(value: unknown): ManualOverride | null {
  if (!isRecord(value) || value.enabled !== true) return null;
  return {
    method: oneOf(value.method, TIE_METHODS),
    reason: str(value.reason),
    at: num(value.decidedAt) ?? num(value.at),
  };
}

/** 契約 §1.3。列可以是空的（產程先寫一份全 0）。 */
export function standingFromDoc(id: string, raw: Record<string, unknown>): StandingDoc | null {
  const parsed = splitStandingId(id);
  const divisionId = str(raw.divisionId) ?? parsed?.divisionId ?? '';
  const groupId = str(raw.groupId) ?? parsed?.groupId ?? 'A';
  if (!divisionId) return null;
  const rows = Array.isArray(raw.rows)
    ? raw.rows.map((row) => standingRowOf(row)).filter((row): row is StandingRow => row != null)
    : [];
  const divisionName = str(raw.divisionName)?.trim() ?? '';
  return {
    id,
    divisionId,
    groupId,
    rows,
    version: num(raw.version) ?? 0,
    hasUnresolvedTie: bool(raw.hasUnresolvedTie) ?? false,
    ...(divisionName ? { divisionName } : {}),
    manualOverride: manualOverrideOf(raw.manualOverride),
    ranking: oneOf(raw.ranking, RANKINGS),
    updatedAt: optNum(raw.updatedAt),
  };
}

function compareMatch(a: MatchDoc, b: MatchDoc): number {
  return a.round - b.round || a.matchNo - b.matchNo || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function launchFromDoc(raw: Record<string, unknown>): LaunchDoc | null {
  const isPublic = bool(raw.isPublic);
  if (isPublic == null) return null;
  const bannedWords = Array.isArray(raw.bannedWords)
    // 去頭尾空白並丟掉空字串：設定混入 '' 時不得讓所有名稱都判為禁用（Flash 交叉審 P3）
    ? raw.bannedWords.filter((word): word is string => typeof word === 'string').map(w => w.trim()).filter(w => w.length > 0)
    : [];
  return { isPublic, bannedWords };
}

/**
 * 開賽閘門快取多久（毫秒）。管理員改公開狀態或測試者名單後，已開著的分頁最晚這麼久會看到；
 * 重新整理頁面立即生效。5 分鐘：閘門很少改，來回進出賽事頁不必每次都讀。
 */
export const LAUNCH_CACHE_MS = 5 * 60_000;

export function createCompetitionsRepo(deps: CpRepoDeps): CompetitionsRepo {
  async function ready(): Promise<{ db: unknown; sdk: CpFirestoreSdk }> {
    const [db, sdk] = await Promise.all([deps.getDb(), deps.loadSdk()]);
    return { db, sdk };
  }

  // 頁內記憶體。這個 repo 實例活多久，快取就活多久。成功（含空清單）才記住。
  const crestCache = new Map<string, Promise<EntryDoc[]>>();
  // 開賽閘門的記憶體快取（顧問 §3.368 P2-1）。正式頁的 repo 是單例，所以同一個分頁內來回進出賽事頁
  // 在 LAUNCH_CACHE_MS 內不再讀 cpConfig/launch 與 testers；同時進行中的讀取共用同一個 promise。
  // 成功（含文件不存在＝null、不是測試者＝false）才留；失敗立刻拿掉，下次進頁重讀（仍 fail-closed）。
  let launchCache: { at: number; pending: Promise<LaunchDoc | null> } | null = null;
  const testerCache = new Map<string, { at: number; pending: Promise<boolean> }>();

  return {
    getLaunch() {
      const now = Date.now();
      if (launchCache && now - launchCache.at < LAUNCH_CACHE_MS) return launchCache.pending;
      const pending = (async () => {
        const { db, sdk } = await ready();
        const snap = await sdk.getDoc(sdk.doc(db, 'cpConfig/launch'));
        if (!snap.exists()) return null;
        const data = snap.data();
        return data ? launchFromDoc(data) : null;
      })();
      const entry = { at: now, pending };
      launchCache = entry;
      pending.catch(() => {
        if (launchCache === entry) launchCache = null;
      });
      return pending;
    },

    getLaunchTester(uid) {
      if (!isSafeId(uid)) return Promise.resolve(false);
      const now = Date.now();
      const hit = testerCache.get(uid);
      if (hit && now - hit.at < LAUNCH_CACHE_MS) return hit.pending;
      const pending = (async () => {
        const { db, sdk } = await ready();
        const snap = await sdk.getDoc(sdk.doc(db, `cpConfig/launch/testers/${uid}`));
        return snap.exists();
      })();
      const entry = { at: now, pending };
      testerCache.set(uid, entry);
      pending.catch(() => {
        if (testerCache.get(uid) === entry) testerCache.delete(uid);
      });
      return pending;
    },

    async listMine(uid) {
      if (!isSafeId(uid)) return [];
      const { db, sdk } = await ready();
      const snap = await sdk.getDocs(sdk.query(
        sdk.collection(db, `cpMine/${uid}/items`),
        sdk.limit(CP_READ_LIMIT.mine),
      ));
      return snap.docs
        .map((doc) => mineFromDoc(doc.id, doc.data() ?? {}))
        .filter((item): item is CpMineItem => item != null);
    },

    async listPublic(includeInternal = false) {
      const { db, sdk } = await ready();
      const clauses: unknown[] = [];
      // Rules：isPubLike && internalGate。測試者／管理員不帶 visibility，內部賽才查得到。
      if (!includeInternal) clauses.push(sdk.where('visibility', '==', 'public'));
      clauses.push(
        sdk.where('hidden', '==', false),
        sdk.where('status', 'in', [...PUBLIC_STATUSES]),
        sdk.limit(CP_READ_LIMIT.publicList),
      );
      const snap = await sdk.getDocs(sdk.query(sdk.collection(db, 'competitions'), ...clauses));
      return snap.docs
        .map((doc) => competitionFromDoc(doc.id, doc.data() ?? {}))
        .filter((doc): doc is CompetitionDoc => doc != null);
    },

    async listByHostTeam(teamId, publicOnly) {
      if (!isSafeId(teamId)) return [];
      const { db, sdk } = await ready();
      const clauses: unknown[] = [sdk.where('hostTeamId', '==', teamId)];
      if (publicOnly) clauses.push(sdk.where('visibility', '==', 'public'));
      clauses.push(sdk.limit(CP_READ_LIMIT.hostTeam));
      const snap = await sdk.getDocs(sdk.query(sdk.collection(db, 'competitions'), ...clauses));
      return snap.docs
        .map((doc) => competitionFromDoc(doc.id, doc.data() ?? {}))
        .filter((doc): doc is CompetitionDoc => doc != null);
    },

    async getCompetition(cid) {
      if (!isSafeId(cid)) return null;
      const { db, sdk } = await ready();
      const snap = await sdk.getDoc(sdk.doc(db, `competitions/${cid}`));
      if (!snap.exists()) return null;
      const data = snap.data();
      return data ? competitionFromDoc(snap.id, data) : null;
    },

    async listDivisions(cid) {
      if (!isSafeId(cid)) return [];
      const { db, sdk } = await ready();
      const snap = await sdk.getDocs(sdk.query(
        sdk.collection(db, `competitions/${cid}/divisions`),
        sdk.limit(CP_READ_LIMIT.divisions),
      ));
      return snap.docs
        .map((doc) => divisionFromDoc(doc.id, doc.data() ?? {}))
        .filter((doc): doc is DivisionDoc => doc != null)
        .sort((a, b) => a.order - b.order || (a.dvId < b.dvId ? -1 : a.dvId > b.dvId ? 1 : 0));
    },

    async listEntries(cid) {
      if (!isSafeId(cid)) return [];
      const { db, sdk } = await ready();
      const snap = await sdk.getDocs(sdk.query(
        sdk.collection(db, `competitions/${cid}/entries`),
        sdk.limit(CP_READ_LIMIT.entries),
      ));
      return snap.docs
        .map((doc) => entryFromDoc(doc.id, doc.data() ?? {}))
        .filter((doc): doc is EntryDoc => doc != null);
    },

    async listRoster(cid, enId) {
      if (!isSafeId(cid) || !isSafeId(enId)) return [];
      const { db, sdk } = await ready();
      const snap = await sdk.getDocs(sdk.query(
        sdk.collection(db, `competitions/${cid}/roster`),
        sdk.where('enId', '==', enId),
        sdk.limit(CP_READ_LIMIT.roster),
      ));
      return snap.docs
        .map((doc) => rosterFromDoc(doc.id, doc.data() ?? {}))
        .filter((doc): doc is RosterPublicDoc => doc != null);
    },

    async listEntryPrivate(cid, teamId) {
      if (!isSafeId(cid) || (teamId != null && !isSafeId(teamId))) return [];
      const { db, sdk } = await ready();
      const clauses: unknown[] = [];
      if (teamId != null) clauses.push(sdk.where('teamId', '==', teamId));
      clauses.push(sdk.limit(CP_READ_LIMIT.private));
      const snap = await sdk.getDocs(sdk.query(sdk.collection(db, `competitions/${cid}/entryPrivate`), ...clauses));
      return snap.docs
        .map((doc) => entryPrivateFromDoc(doc.id, doc.data() ?? {}))
        .filter((doc): doc is EntryPrivateDoc => doc != null);
    },

    async listRosterPrivate(cid, uid) {
      if (!isSafeId(cid) || (uid != null && !isSafeId(uid))) return [];
      const { db, sdk } = await ready();
      const clauses: unknown[] = [];
      if (uid != null) clauses.push(sdk.where('uid', '==', uid));
      clauses.push(sdk.limit(CP_READ_LIMIT.private));
      const snap = await sdk.getDocs(sdk.query(sdk.collection(db, `competitions/${cid}/rosterPrivate`), ...clauses));
      return snap.docs
        .map((doc) => {
          const data = doc.data() ?? {};
          const owner = str(data.uid) ?? uid ?? '';
          if (!owner) return null;
          return { id: doc.id, uid: owner };
        })
        .filter((doc): doc is RosterPrivateDoc => doc != null);
    },

    async getStaff(cid, uid) {
      if (!isSafeId(cid) || !isSafeId(uid)) return null;
      const { db, sdk } = await ready();
      const snap = await sdk.getDoc(sdk.doc(db, `competitions/${cid}/staff/${uid}`));
      if (!snap.exists()) return null;
      const data = snap.data();
      return data ? staffFromDoc(uid, data) : null;
    },

    async listStaff(cid) {
      if (!isSafeId(cid)) return [];
      const { db, sdk } = await ready();
      const snap = await sdk.getDocs(sdk.query(
        sdk.collection(db, `competitions/${cid}/staff`),
        sdk.limit(STAFF_LIST_LIMIT),
      ));
      return snap.docs
        .map((doc) => assignmentFromDoc(doc.id, doc.data() ?? {}))
        .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    },

    async getStaffAssignment(cid, uid) {
      if (!isSafeId(cid) || !isSafeId(uid)) return null;
      const { db, sdk } = await ready();
      const snap = await sdk.getDoc(sdk.doc(db, `competitions/${cid}/staff/${uid}`));
      if (!snap.exists()) return null;
      const data = snap.data();
      return data ? assignmentFromDoc(uid, data) : null;
    },

    async listMatches(cid) {
      if (!isSafeId(cid)) return [];
      const { db, sdk } = await ready();
      const snap = await sdk.getDocs(sdk.query(
        sdk.collection(db, `competitions/${cid}/matches`),
        sdk.limit(CP_READ_LIMIT.matches),
      ));
      return snap.docs
        .map((doc) => matchFromDoc(doc.id, doc.data() ?? {}))
        .filter((doc): doc is MatchDoc => doc != null)
        .sort(compareMatch);
    },

    async getMatch(cid, mtId) {
      if (!isSafeId(cid) || !isSafeId(mtId)) return null;
      const { db, sdk } = await ready();
      const snap = await sdk.getDoc(sdk.doc(db, `competitions/${cid}/matches/${mtId}`));
      if (!snap.exists()) return null;
      const data = snap.data();
      return data ? matchFromDoc(mtId, data) : null;
    },

    async getSummaryShard(cid, shardId) {
      if (!isSafeId(cid) || !isSafeId(shardId)) return [];
      const { db, sdk } = await ready();
      const snap = await sdk.getDoc(sdk.doc(db, `competitions/${cid}/summary/${shardId}`));
      if (!snap.exists()) return [];
      const data = snap.data();
      return data ? summaryEntriesFromDoc(data) : [];
    },

    async listSummary(cid) {
      if (!isSafeId(cid)) return [];
      const { db, sdk } = await ready();
      const snap = await sdk.getDocs(sdk.query(
        sdk.collection(db, `competitions/${cid}/summary`),
        sdk.limit(CP_READ_LIMIT.summary),
      ));
      const rows: SummaryEntry[] = [];
      for (const doc of snap.docs) {
        rows.push(...summaryEntriesFromDoc(doc.data() ?? {}));
      }
      return rows.sort(compareSummary);
    },

    async listStandings(cid) {
      if (!isSafeId(cid)) return [];
      const { db, sdk } = await ready();
      const snap = await sdk.getDocs(sdk.query(
        sdk.collection(db, `competitions/${cid}/standings`),
        sdk.limit(CP_READ_LIMIT.standings),
      ));
      return snap.docs
        .map((doc) => standingFromDoc(doc.id, doc.data() ?? {}))
        .filter((doc): doc is StandingDoc => doc != null)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },

    async listEntriesForCrest(cid) {
      if (!isSafeId(cid)) return [];
      const cached = crestCache.get(cid);
      if (cached) return cached;
      const pending = (async () => {
        const { db, sdk } = await ready();
        const snap = await sdk.getDocs(sdk.query(
          sdk.collection(db, `competitions/${cid}/entries`),
          sdk.where('status', '==', 'approved'),
          sdk.limit(CP_READ_LIMIT.crest),
        ));
        return snap.docs
          .map((doc) => entryFromDoc(doc.id, doc.data() ?? {}))
          .filter((doc): doc is EntryDoc => doc != null);
      })();
      crestCache.set(cid, pending);
      try {
        return await pending;
      } catch (err) {
        crestCache.delete(cid);
        throw err;
      }
    },

    invalidateCrests(cid) {
      crestCache.delete(cid);
    },
  };
}

let singleton: CompetitionsRepo | null = null;

/** 預設實作：資料庫是 getCpFirebase() 的 asia-main。import 本模組不會連線。 */
export function getCompetitionsRepo(): CompetitionsRepo {
  if (!singleton) {
    singleton = createCompetitionsRepo({
      getDb: async () => (await getCpFirebase()).db,
      loadSdk: async () => (await import('firebase/firestore')) as unknown as CpFirestoreSdk,
    });
  }
  return singleton;
}

/** 測試用。 */
export function _resetCompetitionsRepoForTest(): void {
  singleton = null;
}
