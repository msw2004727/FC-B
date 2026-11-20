// 新外觀第 3 批（榜單與公開內頁）示範狀態的假資料。只給 src/dev 的示範頁用，不進產品程式。
// 不改 screen-fixtures.ts／step4-fixtures.ts：需要的東西用 import 拿，再另組一份。
import type { AudienceMatch, AudiencePorts, ParsedStats, ParsedTimeline, StatPlayer } from '../data/audience';
import type {
  DivisionDoc,
  EntryDoc,
  MatchDoc,
  StandingDoc,
  StandingRow,
  StaffAssignment,
} from '../data/types';
import type { CpInjectedEnv } from '../env';
import { taipeiMs } from '../format';
import type { ServerEvent } from '../live/data/types';
import { adultDivision, screenEnv } from './screen-fixtures';
import { s4Match } from './step4-fixtures';

/** 與 screen-fixtures 的 LIVE_NOW 同一刻（2027-01-09 12:00 台北）。env.now 固定，時鐘不走。 */
export const P3_NOW = taipeiMs(2027, 1, 9, 12, 0);

/** 16×16 內嵌 PNG（與 cp-step4-u4 的 U4_CREST 同一張）。不連正式儲存網域。 */
export const P3_CREST =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAANElEQVR4nGNgoBDwFeehIdJU49ODSzV2PfhVo+shRjWKnhGpgeRgJSfiyEkauPTgU00MAADYspGlcL3zwAAAAABJRU5ErkJggg==';

/** 13 個字的隊名（規格第 7 節「13 個字的隊名」）。 */
export const P3_LONG_HOME = '一二三四五六七八九十示範隊';
export const P3_LONG_AWAY = '臺北市立第一示範足球俱樂部';

// ── 觀眾即時頁（LiveMatchPage）────────────────────────────────

function audienceMatch(partial: Partial<AudienceMatch> & Pick<AudienceMatch, 'status'>): AudienceMatch {
  return {
    id: 'mt1',
    divisionId: 'dv_adult',
    rev: 1,
    resetRev: 0,
    score: { home: 1, away: 1 },
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'h1' },
    kickoffAt: taipeiMs(2027, 1, 9, 11, 30),
    venueName: '1號場',
    venueIdx: null,
    home: { teamId: 'en_h', name: '雷霆隊', logo: null },
    away: { teamId: 'en_a', name: '海風隊', logo: null },
    penaltyScore: null,
    scoreCorrectedAt: null,
    cancelReason: null,
    ...partial,
  };
}

const RUNNING_34 = { startedAt: P3_NOW - 34 * 60 * 1000, pausedSec: 0, running: true, period: 'h1' };

/** 觀眾即時頁各狀態。null＝找不到比賽（watchMatch 回 missing）。 */
export const P3_LIVE_MATCHES: Record<string, AudienceMatch | null> = {
  live: audienceMatch({ status: 'live', rev: 7, clockBase: RUNNING_34 }),
  pre: audienceMatch({
    status: 'scheduled',
    score: { home: 0, away: 0 },
    kickoffAt: taipeiMs(2027, 1, 9, 14, 30),
    venueName: '2號場',
  }),
  ht: audienceMatch({
    status: 'halftime',
    rev: 9,
    clockBase: { startedAt: P3_NOW - 5 * 60 * 1000, pausedSec: 45 * 60, running: false, period: 'ht' },
  }),
  pk: audienceMatch({
    status: 'live',
    rev: 20,
    score: { home: 2, away: 2 },
    clockBase: { startedAt: P3_NOW - 2 * 60 * 1000, pausedSec: 90 * 60, running: false, period: 'pk' },
    penaltyScore: { home: 3, away: 2 },
  }),
  ftPkCorrected: audienceMatch({
    status: 'confirmed',
    rev: 30,
    score: { home: 2, away: 2 },
    clockBase: { startedAt: null, pausedSec: 90 * 60, running: false, period: 'ft' },
    penaltyScore: { home: 4, away: 3 },
    scoreCorrectedAt: P3_NOW - 10 * 60 * 1000,
  }),
  cancelled: audienceMatch({ status: 'cancelled', score: { home: 0, away: 0 }, cancelReason: '大雨，場地積水無法使用，改期另行公告' }),
  postponed: audienceMatch({
    status: 'postponed',
    score: { home: 0, away: 0 },
    kickoffAt: taipeiMs(2027, 1, 16, 9, 0),
  }),
  longCrest: audienceMatch({
    status: 'live',
    rev: 7,
    clockBase: RUNNING_34,
    home: { teamId: 'en_long1', name: P3_LONG_HOME, logo: P3_CREST },
    away: { teamId: 'en_long2', name: P3_LONG_AWAY, logo: P3_CREST },
  }),
  missing: null,
};

function ev(
  seq: number,
  partial: Omit<ServerEvent, 'seq' | 'op' | 'sid' | 'createdAt'>,
  who: { side: 'home' | 'away' | null; number: number | null; name: string | null } = { side: null, number: null, name: null },
): ParsedTimeline {
  const plId = partial.plId ?? null;
  return {
    event: { seq, op: partial.type, sid: '', createdAt: P3_NOW - (40 - seq) * 60_000, ...partial },
    number: who.number,
    playerName: who.name,
    plId,
    side: who.side,
  };
}

/** 比賽紀錄：進球、黃牌、作廢一筆、紅牌、PK 一腳（PK 進行中那場用）。 */
export const P3_LOG_EVENTS: ParsedTimeline[] = [
  ev(1, { type: 'kickoff', matchSecond: 0 }),
  ev(2, { type: 'goal', side: 'home', plId: 'pl_th9', goalKind: 'normal', matchSecond: 5 * 60 + 12 }, { side: 'home', number: 9, name: '劉冠廷' }),
  ev(3, { type: 'card', side: 'away', plId: 'pl_hf4', cardType: 'yellow', matchSecond: 12 * 60 + 40 }, { side: 'away', number: 4, name: '陳柏宇' }),
  ev(4, { type: 'goal', side: 'away', plId: 'pl_hf10', goalKind: 'normal', matchSecond: 18 * 60 + 5 }, { side: 'away', number: 10, name: '黃信翰' }),
  ev(5, { type: 'goal', side: 'home', plId: 'pl_th7', goalKind: 'normal', matchSecond: 25 * 60 + 30 }, { side: 'home', number: 7, name: '張家豪' }),
  ev(7, { type: 'card', side: 'away', plId: 'pl_hf4', cardType: 'second_yellow', refSeq: 3, matchSecond: 31 * 60 + 2 }, { side: 'away', number: 4, name: '陳柏宇' }),
];

export const P3_LOG_PK: ParsedTimeline[] = [
  ...P3_LOG_EVENTS,
  ev(20, { type: 'pk', side: 'home', plId: 'pl_th9', scored: true, matchSecond: 90 * 60 }, { side: 'home', number: 9, name: '劉冠廷' }),
  ev(21, { type: 'pk', side: 'away', plId: 'pl_hf10', scored: false, matchSecond: 90 * 60 }, { side: 'away', number: 10, name: '黃信翰' }),
];

function quietPorts(over: Partial<AudiencePorts> = {}): AudiencePorts {
  return {
    watchSummary: () => () => {},
    watchMatch: () => () => {},
    readLog: async () => ({ events: [], voids: [], reads: 0 }),
    getStats: async () => ({ stalled: false, stalledMt: null, players: [] }),
    ...over,
  };
}

/** 觀眾即時頁的注入環境：watchMatch 直接回一筆假場次（寫法同 audience-pages.test.tsx 的 drawMatch）。 */
export function liveMatchEnv(key: string): CpInjectedEnv {
  const match = P3_LIVE_MATCHES[key];
  const log = key === 'pk' ? P3_LOG_PK : P3_LOG_EVENTS;
  return {
    ...screenEnv('detail-rep'),
    now: P3_NOW,
    route: { cid: 'cup', enId: 'en_h', mtId: 'mt1' },
    audience: quietPorts({
      watchMatch: (_input, onMatch) => {
        onMatch(match ? { kind: 'ok', match } : { kind: 'missing' });
        return () => {};
      },
      readLog: async () => ({
        events: log,
        voids: [{ targetSeq: 5, seq: 6, createdAt: P3_NOW - 30 * 60_000 }],
        reads: log.length + 1,
      }),
    }),
  };
}

// ── 詳情頁：積分榜、射手榜、紅黃牌 ─────────────────────────────

function row(partial: Partial<StandingRow> & Pick<StandingRow, 'teamId' | 'name' | 'points' | 'rank'>): StandingRow {
  return {
    played: 4,
    win: 1,
    draw: 1,
    loss: 2,
    goalsFor: 4,
    goalsAgainst: 4,
    goalDiff: 0,
    hasUnresolvedTie: false,
    tiedWith: [],
    decidedBy: null,
    ...partial,
  };
}

function standing(partial: Partial<StandingDoc> = {}): StandingDoc {
  return {
    id: 'dv_adult__group__A',
    divisionId: 'dv_adult',
    groupId: 'A',
    rows: [],
    version: 4,
    hasUnresolvedTie: false,
    manualOverride: null,
    ranking: 'h2hFirst',
    updatedAt: null,
    ...partial,
  };
}

const LONG_TEAMS = [
  P3_LONG_HOME,
  P3_LONG_AWAY,
  '新北市板橋區青年示範聯隊',
  '高雄港都海洋之星足球隊',
  '台中大肚山風之子足球隊',
  '花蓮太平洋藍色海浪球隊',
  '桃園國際機場飛翔示範隊',
  '新竹科學園區工程師球隊',
  '嘉義阿里山森林小火車隊',
  '台南府城古都老街足球隊',
  '宜蘭蘭陽平原三星蔥球隊',
  '屏東墾丁南國陽光示範隊',
];

/**
 * 長隊名、兩位數名次、三位數積分（規格第 7 節要補）。
 * 一組 12 隊：正式允許的情況（每組隊數 2～64，後端 validate.ts LIMITS.teamsMin／teamsMax、建賽頁 maxTeams Stepper），
 * 10 隊以上的組就會有兩位數名次。（更正：原註解誤把 CP_READ_LIMIT.standings＝8 當成每組隊數上限，那是一次讀取的組別積分文件數。設計總監 11-21 第 3 批施工問答第 4 題。）
 */
export const P3_STAND_LONG: StandingDoc[] = [standing({
  hasUnresolvedTie: true,
  rows: LONG_TEAMS.map((name, index) => {
    const rank = index + 1;
    // 第 3、4 名同分待裁定；第 11 名有主辦裁定。
    const points = index === 3 ? 128 - 2 * 9 : 128 - index * 9;
    return row({
      teamId: `en_l${rank}`,
      name,
      rank,
      points,
      played: 44,
      win: 40 - index * 3,
      draw: 8,
      loss: index * 3,
      goalsFor: 120 - index * 7,
      goalsAgainst: 18 + index * 6,
      goalDiff: 102 - index * 13,
      ...(index === 2 || index === 3 ? { hasUnresolvedTie: true, tiedWith: [index === 2 ? 'en_l4' : 'en_l3'] } : {}),
      ...(index === 10 ? { decidedBy: 'host' as const } : {}),
    });
  }),
})];

/** 長隊名那一份給的隊徽：第一隊有上傳隊徽圖，其餘字章。 */
export const P3_STAND_LONG_CRESTS: EntryDoc[] = [{
  id: 'en_l1',
  dvId: 'dv_adult',
  teamId: 'en_l1',
  name: P3_LONG_HOME,
  status: 'approved',
  rosterCount: 0,
  rosterConfirmed: false,
  teamLogo: P3_CREST,
}];

function division(dvId: string, name: string, order: number): DivisionDoc {
  return { ...adultDivision, dvId, name, order };
}

/** 三個以上組別（射手榜組別切換換行用）。 */
export const P3_DIVISIONS_4: DivisionDoc[] = [
  division('dv_adult', '成人組', 0),
  division('dv_u12', '國小高年級組', 1),
  division('dv_women', '女子社會組', 2),
  division('dv_senior', '壯年四十歲以上組', 3),
];

const ENTRY_NAMES: [string, string][] = [
  ['en_h', '雷霆隊'],
  ['en_a', '海風隊'],
  ['en_b', '銀河隊'],
  ['en_c', '山貓隊'],
  ['en_l1', P3_LONG_HOME],
];

export const P3_ENTRIES: EntryDoc[] = ENTRY_NAMES.map(([id, name]) => ({
  id,
  dvId: 'dv_adult',
  teamId: id,
  name,
  status: 'approved',
  rosterCount: 8,
  rosterConfirmed: true,
  teamLogo: null,
}));

const PLAYER_NAMES = ['劉冠廷', '陳柏宇', '黃信翰', '張家豪', '林志明', '王建民', '李承恩', '吳宗翰', '蔡佳穎', '許書豪'];

function statPlayer(index: number, g: number, y: number, r: number): StatPlayer {
  const team = ENTRY_NAMES[index % ENTRY_NAMES.length]![0];
  const base = PLAYER_NAMES[index % PLAYER_NAMES.length]!;
  return { plId: `pl_${index}`, n: index < PLAYER_NAMES.length ? base : `${base}${Math.floor(index / PLAYER_NAMES.length) + 1}`, e: team, g, y, r };
}

/** 一般射手榜：10 人，有同分、有紅黃牌。 */
export const P3_STATS_SOME: ParsedStats = {
  stalled: false,
  stalledMt: null,
  players: [
    statPlayer(0, 7, 1, 0),
    statPlayer(1, 5, 2, 1),
    statPlayer(2, 5, 0, 0),
    statPlayer(3, 4, 0, 0),
    statPlayer(4, 3, 1, 0),
    statPlayer(5, 2, 0, 0),
    statPlayer(6, 2, 3, 0),
    statPlayer(7, 1, 0, 1),
    statPlayer(8, 1, 0, 0),
    statPlayer(9, 0, 2, 0),
  ],
};

export const P3_STATS_STALLED: ParsedStats = { ...P3_STATS_SOME, stalled: true, stalledMt: 'mt_x' };
export const P3_STATS_EMPTY: ParsedStats = { stalled: false, stalledMt: null, players: [] };

/** 超過 50 名：60 人都有進球，正式會截在 50 名並出附註。 */
export const P3_STATS_CAP: ParsedStats = {
  stalled: false,
  stalledMt: null,
  players: Array.from({ length: 60 }, (_, index) => statPlayer(index, Math.max(1, 12 - Math.floor(index / 5)), index % 7 === 0 ? 1 : 0, 0)),
};

export interface DetailOptions {
  stats?: ParsedStats;
  standings?: StandingDoc[];
  crests?: EntryDoc[];
  divisions?: DivisionDoc[];
}

/**
 * 詳情頁（進行中）注入環境：沿用 screenEnv('real-live')，只換積分、組別、隊伍與 getStats。
 * 不改 screen-fixtures.ts。
 */
export function detailLiveEnv(options: DetailOptions = {}): CpInjectedEnv {
  const env = screenEnv('real-live');
  const bundle = env.bundle!;
  const schedule = env.schedule!;
  return {
    ...env,
    bundle: {
      ...bundle,
      divisions: options.divisions ?? bundle.divisions,
      // 假隊伍放前面：teamNameByEnId 取第一筆，en_a 才是「海風隊」而不是 screen-fixtures 的「示範隊A」。
      entries: [...P3_ENTRIES, ...(options.crests ?? []), ...bundle.entries],
    },
    schedule: {
      summary: schedule.summary,
      standings: options.standings ?? schedule.standings,
    },
    audience: quietPorts({
      getStats: async () => options.stats ?? P3_STATS_SOME,
    }),
  };
}

// ── 我的場次（ScorerMatchesPage）──────────────────────────────

function myMatch(id: string, partial: Partial<MatchDoc>): MatchDoc {
  return s4Match({ id, rev: 1, updatedAt: null, ...partial });
}

const IDLE_CLOCK = { startedAt: null, pausedSec: 0, running: false, period: 'pre' };

/** 都還沒開賽：今天兩場、隔天凌晨一場（跨日）、後天一場。 */
const MY_PRE: MatchDoc[] = [
  myMatch('my_p1', { status: 'scheduled', kickoffAt: taipeiMs(2027, 1, 9, 14, 0), venueName: '2號場', score: { home: 0, away: 0 }, clockBase: IDLE_CLOCK, home: { teamId: 'en_c', name: '山貓隊' }, away: { teamId: 'en_b', name: '藍鯨隊' } }),
  myMatch('my_p2', { status: 'scheduled', kickoffAt: taipeiMs(2027, 1, 9, 16, 30), venueName: '1號場', score: { home: 0, away: 0 }, clockBase: IDLE_CLOCK }),
  myMatch('my_p3', { status: 'scheduled', kickoffAt: taipeiMs(2027, 1, 10, 0, 20), venueName: '1號場', score: { home: 0, away: 0 }, clockBase: IDLE_CLOCK, home: { teamId: 'en_c', name: '雷霆隊' }, away: { teamId: 'en_b', name: '藍鯨隊' } }),
  myMatch('my_p4', { status: 'scheduled', kickoffAt: taipeiMs(2027, 1, 11, 9, 0), venueName: '2號場', score: { home: 0, away: 0 }, clockBase: IDLE_CLOCK, home: { teamId: 'en_h', name: '海風隊' }, away: { teamId: 'en_c', name: '山貓隊' } }),
];

/** 全部已結束（含已取消一場）：昨天兩場、今天早上兩場。 */
const MY_DONE: MatchDoc[] = [
  myMatch('my_d1', { status: 'confirmed', kickoffAt: taipeiMs(2027, 1, 8, 9, 0), score: { home: 2, away: 1 }, finishedAt: taipeiMs(2027, 1, 8, 10, 0), confirmedAt: taipeiMs(2027, 1, 8, 10, 5) }),
  myMatch('my_d2', { status: 'cancelled', kickoffAt: taipeiMs(2027, 1, 8, 14, 0), venueName: '2號場', score: { home: 0, away: 0 }, clockBase: IDLE_CLOCK, cancelReason: '大雨，場地無法使用', cancelledAt: taipeiMs(2027, 1, 8, 12, 0) }),
  myMatch('my_d3', { status: 'finished', kickoffAt: taipeiMs(2027, 1, 9, 9, 0), score: { home: 0, away: 3 }, finishedAt: taipeiMs(2027, 1, 9, 10, 0) }),
  myMatch('my_d4', { status: 'walkover', kickoffAt: taipeiMs(2027, 1, 9, 10, 30), venueName: '2號場', score: { home: 0, away: 3 }, walkoverSide: 'home', finishedAt: taipeiMs(2027, 1, 9, 10, 30) }),
];

/** 長隊名：一場進行中、兩場未開賽（其中一場跨日），隊名 13 字。 */
const MY_LONG: MatchDoc[] = [
  myMatch('my_l1', { status: 'live', kickoffAt: taipeiMs(2027, 1, 9, 11, 30), home: { teamId: 'en_long1', name: P3_LONG_HOME }, away: { teamId: 'en_long2', name: P3_LONG_AWAY } }),
  myMatch('my_l2', { status: 'scheduled', kickoffAt: taipeiMs(2027, 1, 9, 15, 0), venueName: '2號場', score: { home: 0, away: 0 }, clockBase: IDLE_CLOCK, home: { teamId: 'en_l3', name: LONG_TEAMS[2]! }, away: { teamId: 'en_l4', name: LONG_TEAMS[3]! } }),
  myMatch('my_l3', { status: 'scheduled', kickoffAt: taipeiMs(2027, 1, 10, 1, 30), venueName: '1號場', score: { home: 0, away: 0 }, clockBase: IDLE_CLOCK, home: { teamId: 'en_l5', name: LONG_TEAMS[4]! }, away: { teamId: 'en_long1', name: P3_LONG_HOME } }),
];

export const P3_MY_MATCHES: Record<string, MatchDoc[]> = {
  pre: MY_PRE,
  done: MY_DONE,
  long: MY_LONG,
};

/**
 * 我的場次注入環境：記分員身分，repo 只換 getStaffAssignment／getMatch。
 * 原 repo 用原型鏈保留（不展開，避免類別方法遺失）。
 */
export function myMatchesEnv(key: string): CpInjectedEnv {
  const env = screenEnv('detail-member');
  const matches = P3_MY_MATCHES[key] ?? [];
  const assignment: StaffAssignment = {
    uid: env.actor.uid ?? 'uid_member',
    roles: ['scorer'],
    matchIds: matches.map((m) => m.id),
    expiresAt: null,
  };
  const repo = Object.assign(Object.create(env.repo) as CpInjectedEnv['repo'], {
    getStaffAssignment: async () => assignment,
    getMatch: async (_cid: string, mtId: string) => matches.find((m) => m.id === mtId) ?? null,
  });
  return {
    ...env,
    bundle: undefined,
    preview: undefined,
    repo,
    now: P3_NOW,
    route: { cid: 'cup' },
  };
}
