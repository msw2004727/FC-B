// harness 與頁面測試共用的假資料。人名、隊名都是示範，不是真實帳號。

import type { CpActions } from '../actions';
import { CpCallError } from '../data/cp-callables';
import { summaryShardIdOf } from '../data/schedule-load';
import type { CpActor, CpBundle, CpInjectedEnv, CpPreview, WizardSeed } from '../env';
import { taipeiMs } from '../format';
import type {
  CompetitionDoc,
  CompetitionNotice,
  DivisionDoc,
  EntryDoc,
  EntryPrivateDoc,
  MatchDoc,
  RosterPublicDoc,
  StaffDoc,
  StandingDoc,
  StandingRow,
  SummaryEntry,
} from '../data/types';
import { createFakeCpRepo } from './fake-cp-repo';

export const NOW = taipeiMs(2026, 12, 10, 12, 0);
export const REG_OPEN = taipeiMs(2026, 12, 1, 9, 0);
export const REG_CLOSE = taipeiMs(2026, 12, 20, 23, 59);
export const FIRST_MATCH = taipeiMs(2027, 1, 9, 8, 0);
export const LAST_MATCH = taipeiMs(2027, 1, 10, 18, 0);

export const HARNESS_SCREENS = [
  'wizard-1',
  'wizard-1-club',
  'wizard-1-error',
  'wizard-2',
  'wizard-3',
  'wizard-done',
  'detail-rep',
  'detail-member',
  'detail-report',
  'roster',
  'roster-ready',
  'roster-locked',
  'form-self-adult',
  'form-self-minor',
  'form-rep',
  'form-rep-adult',
  'form-rep-adult-nick',
  'host-pending',
  'host-approved',
  'host-rejected',
  'host-reject',
  'host-lock',
  'host-unlock',
  'position-measure',
] as const;

export function idleActions(): CpActions {
  return {
    create: async () => ({ cid: 'cup', dvIds: ['dv_adult', 'dv_u12'] }),
    publish: async () => ({ cid: 'cup', status: 'published' }),
    registerEntry: async () => ({}),
    review: async () => ({}),
    joinRoster: async () => ({}),
    addRosterByRep: async () => ({}),
    leaveRoster: async () => ({}),
    confirmRoster: async () => ({}),
    lockRosters: async () => ({}),
    unlockRosters: async () => ({}),
    setPaymentStatus: async () => ({}),
    report: async () => ({}),
    update: async () => ({ cid: 'cup' }),
    generateSchedule: async () => ({
      dvId: 'dv_adult',
      seed: 1,
      matchCount: 0,
      unplacedCount: 0,
      daysUsed: [],
      perTeam: 0,
      teamCount: 0,
      dryRun: true,
    }),
    clearSchedule: async () => ({}),
    rescheduleMatch: async () => ({}),
    shiftMatchDay: async () => ({}),
    swapMatches: async () => ({}),
    postNotice: async () => ({ noticeId: 'nt_1' }),
    deleteNotice: async () => ({}),
    recordResult: async () => ({}),
    confirmMatchResult: async () => ({}),
    setWalkover: async () => ({}),
    resetMatch: async () => ({}),
    cancelMatch: async () => ({}),
    endCompetition: async () => ({}),
    restoreCompetition: async () => ({}),
    resolveTie: async () => ({}),
    clearTieDecision: async () => ({}),
    explainTie: async () => ({}),
  };
}

function actor(partial: Partial<CpActor> & Pick<CpActor, 'uid'>): CpActor {
  return {
    authPending: false,
    role: 'user',
    displayName: '王示範',
    repClubs: [],
    memberClubIds: [],
    ...partial,
  };
}

export const repActor = actor({
  uid: 'uid_rep',
  displayName: '王示範',
  repClubs: [{ id: 'club_a', name: '示範隊A' }],
  memberClubIds: ['club_a'],
});

export const memberActor = actor({
  uid: 'uid_member',
  displayName: '林示範',
  memberClubIds: ['club_a'],
});

export const hostActor = actor({
  uid: 'uid_host',
  displayName: '王示範',
});

export const coHostActor = actor({
  uid: 'uid_co',
  displayName: '林示範',
});

export const adminActor = actor({
  uid: 'uid_admin',
  role: 'admin',
  displayName: '黃示範',
});

export const clubRepActor = actor({
  uid: 'uid_cap',
  displayName: '示範哥',
  repClubs: [{ id: 'club_host', name: '示範俱樂部' }],
  memberClubIds: ['club_host'],
});

export const wizardActor = actor({
  uid: 'uid_host',
  displayName: '王示範',
  // 建賽下拉讀的是代表俱樂部（文件路徑 id）。
  repClubs: [{ id: 'club_host', name: '示範俱樂部' }],
});

export function competition(partial: Partial<CompetitionDoc> = {}): CompetitionDoc {
  return {
    id: 'cup',
    name: '示範盃',
    sport: 'football',
    hostType: 'club',
    hostTeamId: 'club_host',
    hostDisplay: '示範俱樂部',
    visibility: 'public',
    status: 'published',
    statusReason: null,
    hidden: false,
    regOpenAt: REG_OPEN,
    regCloseAt: REG_CLOSE,
    firstMatchAt: FIRST_MATCH,
    lastMatchAt: LAST_MATCH,
    endedAt: null,
    endedBy: null,
    endReason: null,
    rostersLockedAt: null,
    ageBasisAt: FIRST_MATCH,
    timezone: 'Asia/Taipei',
    venues: [{
      name: '示範球場',
      address: '示範路 1 號',
      lat: 25.04,
      lng: 121.56,
      mapPlaceId: 'place_demo',
      mapProvider: 'google',
    }],
    feeNote: '每隊報名費 3,000 元，賽前於領隊會議現場繳交。',
    liveLinks: [],
    contactNote: null,
    notices: [],
    lastMatchOriginAt: null,
    stateVersion: 1,
    category: 'league',
    ...partial,
  };
}

function division(partial: Partial<DivisionDoc> & Pick<DivisionDoc, 'dvId' | 'name'>): DivisionDoc {
  return {
    playersOnField: 5,
    maxTeams: 8,
    rosterMin: 7,
    rosterMax: 12,
    minAge: null,
    maxAge: null,
    requireRealName: false,
    feePerTeam: 0,
    entryCount: 0,
    approvedCount: 0,
    order: 0,
    ranking: null,
    ...partial,
  };
}

export const adultDivision = division({
  dvId: 'dv_adult',
  name: '成人組',
  playersOnField: 5,
  maxTeams: 8,
  rosterMin: 7,
  rosterMax: 12,
  feePerTeam: 1500,
  approvedCount: 2,
  entryCount: 2,
  order: 0,
});

export const youthDivision = division({
  dvId: 'dv_u12',
  name: 'U12',
  playersOnField: 7,
  maxTeams: 6,
  rosterMin: 9,
  rosterMax: 14,
  minAge: 8,
  maxAge: 12,
  requireRealName: true,
  feePerTeam: 0,
  approvedCount: 1,
  entryCount: 1,
  order: 1,
});

function entry(partial: Partial<EntryDoc> & Pick<EntryDoc, 'id' | 'name' | 'status' | 'dvId'>): EntryDoc {
  return {
    teamId: 'club_a',
    rosterCount: 0,
    rosterConfirmed: false,
    teamLogo: null,
    ...partial,
  };
}

function player(
  id: string,
  number: number,
  displayName: string,
  position: RosterPublicDoc['position'],
  positionText: string | null,
  isMinor = false,
): RosterPublicDoc {
  return { id, enId: 'en_a', displayName, number, position, positionText, isMinor };
}

const SHORT_PLAYERS: RosterPublicDoc[] = [
  player('pl_1', 10, '王示範', 'GK', null),
  player('pl_2', 7, '林示範', 'DF', null),
  player('pl_3', 8, '黃示範', 'MF', null),
  player('pl_4', 9, '歐陽O明', 'FW', null, true),
  player('pl_5', 11, '小示', null, null),
];

const READY_PLAYERS: RosterPublicDoc[] = [
  ...SHORT_PLAYERS,
  player('pl_6', 4, '示範哥', 'DF', null),
  player('pl_7', 5, '阿宏', 'MF', null),
];

const MEASURE_PLAYERS: RosterPublicDoc[] = [
  player('m1', 99, '一二三四五六七八九十', 'custom', '甲乙丙丁戊己'),
  player('m2', 99, '一二三四五六七八九十', 'custom', '甲乙丙丁戊'),
  player('m3', 99, '一二三四五六七八九十', 'custom', '甲乙丙丁'),
];

export function wizardSeed(name = '示範盃'): WizardSeed {
  return {
    name,
    hostType: 'personal',
    hostTeamId: 'club_host',
    feeNote: '每隊報名費 3,000 元，賽前於領隊會議現場繳交。',
    regOpen: '2026-12-01T09:00',
    regClose: '2026-12-20T23:59',
    firstMatch: '2027-01-09T08:00',
    lastMatch: '2027-01-10T18:00',
    venues: [{
      name: '示範球場',
      address: '示範路 1 號',
      lat: 25.04,
      lng: 121.56,
      mapPlaceId: 'place_demo',
      mapProvider: 'google',
    }],
    divisions: [
      {
        name: '成人組',
        playersOnField: 5,
        maxTeams: 8,
        rosterMin: 7,
        rosterMax: 12,
        limitAge: false,
        minAge: 18,
        maxAge: 40,
        requireRealName: false,
        feePerTeam: 1500,
      },
      {
        name: 'U12',
        playersOnField: 7,
        maxTeams: 6,
        rosterMin: 9,
        rosterMax: 14,
        limitAge: true,
        minAge: 8,
        maxAge: 12,
        requireRealName: true,
        feePerTeam: 0,
      },
    ],
  };
}

function detailBundle(): CpBundle {
  return {
    competition: competition(),
    divisions: [adultDivision, youthDivision],
    entries: [
      entry({ id: 'en_a', name: '示範隊A', status: 'approved', dvId: 'dv_adult', rosterCount: 7, rosterConfirmed: true }),
      entry({ id: 'en_b', name: '示範隊B', status: 'approved', dvId: 'dv_adult', teamId: 'club_b', rosterCount: 8, rosterConfirmed: true }),
      entry({ id: 'en_c', name: '示範隊C', status: 'approved', dvId: 'dv_u12', teamId: 'club_c', rosterCount: 9, rosterConfirmed: false }),
    ],
    roster: [],
    privates: [],
    staff: null,
  };
}

function rosterBundle(players: RosterPublicDoc[], locked: boolean): CpBundle {
  return {
    competition: competition({ rostersLockedAt: locked ? NOW : null }),
    divisions: [adultDivision],
    entries: [entry({
      id: 'en_a',
      name: '示範隊A',
      status: 'approved',
      dvId: 'dv_adult',
      teamId: 'club_a',
      rosterCount: players.length,
      rosterConfirmed: false,
    })],
    roster: players,
    privates: [],
    staff: null,
  };
}

function manageEntries(): { entries: EntryDoc[]; privates: EntryPrivateDoc[] } {
  const entries: EntryDoc[] = [
    entry({ id: 'en_pa', name: '示範隊A', status: 'pending', dvId: 'dv_adult', teamId: 'club_1' }),
    entry({ id: 'en_pb', name: '示範隊B', status: 'pending', dvId: 'dv_adult', teamId: 'club_2' }),
    entry({ id: 'en_c', name: '示範隊C', status: 'approved', dvId: 'dv_adult', teamId: 'club_3', rosterCount: 7, rosterConfirmed: true }),
    entry({ id: 'en_d', name: '示範隊D', status: 'approved', dvId: 'dv_adult', teamId: 'club_4', rosterCount: 7, rosterConfirmed: true }),
    entry({ id: 'en_e', name: '示範隊E', status: 'approved', dvId: 'dv_u12', teamId: 'club_5', rosterCount: 5, rosterConfirmed: false }),
    entry({ id: 'en_f', name: '示範隊F', status: 'rejected', dvId: 'dv_adult', teamId: 'club_6' }),
    entry({ id: 'en_g', name: '示範隊G', status: 'withdrawn', dvId: 'dv_adult', teamId: 'club_7' }),
  ];
  const privates: EntryPrivateDoc[] = [
    { id: 'en_pa', teamId: 'club_1', contactName: '王示範', contactPhone: null, paymentStatus: 'none', reviewNote: null },
    { id: 'en_pb', teamId: 'club_2', contactName: '林示範', contactPhone: null, paymentStatus: 'none', reviewNote: null },
    { id: 'en_c', teamId: 'club_3', contactName: null, contactPhone: null, paymentStatus: 'paid', reviewNote: null },
    { id: 'en_d', teamId: 'club_4', contactName: null, contactPhone: null, paymentStatus: 'none', reviewNote: null },
    { id: 'en_e', teamId: 'club_5', contactName: null, contactPhone: null, paymentStatus: 'none', reviewNote: null },
    { id: 'en_f', teamId: 'club_6', contactName: null, contactPhone: null, paymentStatus: 'none', reviewNote: '報名資料不齊全' },
  ];
  return { entries, privates };
}

export function manageBundle(staff: StaffDoc | null = { uid: 'uid_host', roles: ['host'] }, locked = false): CpBundle {
  const rows = manageEntries();
  return {
    competition: competition({ rostersLockedAt: locked ? taipeiMs(2026, 12, 5, 10, 0) : null }),
    divisions: [adultDivision, youthDivision],
    entries: rows.entries,
    roster: [],
    privates: rows.privates,
    staff,
  };
}

// 第 3 步截圖用的時間。形狀照 step3-ui／g1-ui／host-ops 測試，不改第 2 步的 NOW。
const WARM_NOW = taipeiMs(2026, 12, 21, 12, 0);
const LIVE_NOW = taipeiMs(2027, 1, 9, 12, 0);
const DONE_NOW = taipeiMs(2027, 1, 11, 12, 0);
const ENDED_AT = taipeiMs(2027, 1, 10, 18, 0);
const HOST_STAFF: StaffDoc = { uid: 'uid_host', roles: ['host'] };

function summaryEntry(partial: Partial<SummaryEntry> & Pick<SummaryEntry, 'id' | 'k' | 'st'>): SummaryEntry {
  return {
    dv: 'dv_adult',
    r: 1,
    no: 1,
    v: '1號場',
    h: { id: 'en_h', n: '海風隊' },
    a: { id: 'en_a', n: '山貓隊' },
    s: [0, 0],
    wo: null,
    ...partial,
  };
}

function standingRow(partial: Partial<StandingRow> & Pick<StandingRow, 'teamId' | 'name' | 'points' | 'rank'>): StandingRow {
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

function standingDoc(partial: Partial<StandingDoc> = {}): StandingDoc {
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

function matchDoc(partial: Partial<MatchDoc> & Pick<MatchDoc, 'id' | 'status'>): MatchDoc {
  return {
    divisionId: 'dv_adult',
    stageId: 'group',
    groupId: 'A',
    round: 1,
    matchNo: 1,
    label: null,
    matchKey: null,
    kickoffAt: taipeiMs(2027, 1, 9, 9, 0),
    venueIdx: 0,
    venueName: '1號場',
    home: { teamId: 'en_h', name: '海風隊' },
    away: { teamId: 'en_a', name: '山貓隊' },
    teamIds: ['en_h', 'en_a'],
    score: { home: 0, away: 0 },
    penaltyScore: null,
    rev: 3,
    resetRev: 0,
    lock: { locked: false },
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'pre' },
    finishedAt: null,
    confirmedAt: null,
    walkoverSide: null,
    result: null,
    resultSource: null,
    updatedAt: null,
    cancelReason: null,
    cancelledAt: null,
    ...partial,
  };
}

function notice(id: string, text: string, kind: CompetitionNotice['kind'], at: number): CompetitionNotice {
  return { id, text, kind, at, by: null };
}

/** 詳情假資料加上賽程。第 2 步的 detail bundle 不動，這裡另組一份。 */
function detailEnv(
  who: CpActor,
  now: number,
  competitionPatch: Partial<CompetitionDoc>,
  schedule: { summary: SummaryEntry[]; standings: StandingDoc[] },
  staff: StaffDoc | null = null,
  actions: CpActions = idleActions(),
): CpInjectedEnv {
  const bundle = detailBundle();
  return {
    ...base(actions, who, {
      ...bundle,
      staff,
      competition: competition({ ...competitionPatch }),
    }),
    now,
    schedule,
  };
}

/** 撞期截圖用：賽事多一個「第二球場」，改期表單才選得到撞期那場的場地。 */
function withSecondVenue(env: CpInjectedEnv): CpInjectedEnv {
  const bundle = env.bundle;
  if (!bundle?.competition) return env;
  const first = bundle.competition.venues[0];
  return {
    ...env,
    bundle: {
      ...bundle,
      competition: { ...bundle.competition, venues: [...bundle.competition.venues, { ...first, name: '第二球場', address: '示範路 2 號' }] },
    },
  };
}

function hostEnv(
  matches: readonly MatchDoc[],
  actions: CpActions = idleActions(),
  schedule?: { summary: SummaryEntry[]; standings: StandingDoc[] },
): CpInjectedEnv {
  return {
    ...base(actions, hostActor, manageBundle(HOST_STAFF)),
    now: LIVE_NOW,
    matches,
    schedule,
  };
}

/** 站內清單：進行中有今天場數、預熱、招募，三種分類色封面。 */
function listInEnv(actions: CpActions): CpInjectedEnv {
  const liveAt = NOW - 60 * 60 * 1000;
  const repo = createFakeCpRepo({
    launch: { isPublic: true, bannedWords: [] },
    competitions: [
      competition({
        id: 'live_cup',
        name: '示範盃五人制足球賽',
        category: 'cup',
        hostType: 'personal',
        hostTeamId: null,
        feeNote: null,
        regCloseAt: taipeiMs(2026, 12, 1, 23, 59),
        firstMatchAt: liveAt,
        lastMatchAt: NOW + 2 * 24 * 60 * 60 * 1000,
        venues: [{ name: '示範運動公園' }],
      }),
      competition({
        id: 'warm_lg',
        name: '冬季聯賽',
        category: 'league',
        hostType: 'personal',
        hostTeamId: null,
        feeNote: null,
        regCloseAt: taipeiMs(2026, 12, 9, 23, 59),
        firstMatchAt: taipeiMs(2026, 12, 13, 9, 0),
        lastMatchAt: taipeiMs(2026, 12, 14, 18, 0),
        venues: [{ name: '河濱足球場' }],
      }),
      competition({
        id: 'rec_fr',
        name: '新春迎新友誼賽',
        category: 'friendly',
        hostType: 'personal',
        hostTeamId: null,
        feeNote: null,
        venues: [{ name: '示範國小' }],
      }),
    ],
    summary: {
      live_cup: [{
        id: summaryShardIdOf(NOW),
        entries: [
          summaryEntry({ id: 'a', k: taipeiMs(2026, 12, 10, 10, 0), st: 'finished', s: [1, 0] }),
          summaryEntry({ id: 'b', k: taipeiMs(2026, 12, 10, 14, 30), st: 'scheduled' }),
          summaryEntry({ id: 'c', k: taipeiMs(2026, 12, 10, 16, 0), st: 'scheduled', v: '2號場' }),
        ],
      }],
    },
  });
  return { ...base(actions, memberActor), now: NOW, repo };
}

function warmSchedule(): SummaryEntry[] {
  return [
    summaryEntry({ id: 'w1', k: FIRST_MATCH, st: 'scheduled', no: 1 }),
    summaryEntry({
      id: 'w2',
      k: taipeiMs(2027, 1, 9, 10, 0),
      st: 'scheduled',
      no: 2,
      v: '2號場',
      h: { id: 'en_b', n: '銀河隊' },
      a: { id: 'en_c', n: '雷霆隊' },
    }),
  ];
}

/** 今天：待確認、棄權、已取消（含原因）、下一場。積分含未裁定同分與主辦裁定。 */
function liveBoard(): { summary: SummaryEntry[]; standings: StandingDoc[] } {
  return {
    summary: [
      summaryEntry({ id: 'fin', k: taipeiMs(2027, 1, 9, 9, 0), st: 'finished', s: [2, 1], no: 1 }),
      summaryEntry({
        id: 'wo',
        k: taipeiMs(2027, 1, 9, 10, 30),
        st: 'walkover',
        wo: 'away',
        s: [0, 2],
        no: 2,
        v: '2號場',
        h: { id: 'en_b', n: '銀河隊' },
        a: { id: 'en_c', n: '雷霆隊' },
      }),
      summaryEntry({
        id: 'cx',
        k: taipeiMs(2027, 1, 9, 11, 0),
        st: 'cancelled',
        cr: '大雨，場地無法使用',
        no: 3,
        v: '1號場',
        h: { id: 'en_d', n: '青鳥隊' },
        a: { id: 'en_e', n: '赤焰隊' },
      }),
      summaryEntry({
        id: 'nx',
        k: taipeiMs(2027, 1, 9, 14, 30),
        st: 'scheduled',
        no: 4,
        v: '2號場',
        h: { id: 'en_f', n: '晨光隊' },
        a: { id: 'en_g', n: '北風隊' },
      }),
    ],
    standings: [standingDoc({
      hasUnresolvedTie: true,
      manualOverride: { method: 'host', reason: '依對戰精神', at: taipeiMs(2027, 1, 8, 15, 0) },
      rows: [
        standingRow({
          teamId: 'en_h', name: '海風隊', points: 10, rank: 1,
          win: 3, draw: 1, loss: 0, goalsFor: 10, goalsAgainst: 3, goalDiff: 7,
        }),
        standingRow({
          teamId: 'en_b', name: '銀河隊', points: 5, rank: 2,
          hasUnresolvedTie: true, tiedWith: ['en_c'],
        }),
        standingRow({
          teamId: 'en_c', name: '雷霆隊', points: 5, rank: 2,
          hasUnresolvedTie: true, tiedWith: ['en_b'],
        }),
        standingRow({
          teamId: 'en_d', name: '青鳥隊', points: 4, rank: 4,
          decidedBy: 'host', hasUnresolvedTie: true, tiedWith: ['en_e'],
        }),
        standingRow({
          teamId: 'en_e', name: '赤焰隊', points: 4, rank: 5,
          decidedBy: 'host', hasUnresolvedTie: true, tiedWith: ['en_d'],
        }),
      ],
    })],
  };
}

function championBoard(): { summary: SummaryEntry[]; standings: StandingDoc[] } {
  return {
    summary: [summaryEntry({ id: 'final', k: LAST_MATCH, st: 'confirmed', s: [1, 0], no: 1 })],
    standings: [standingDoc({
      rows: [
        standingRow({
          teamId: 'en_h', name: '海風隊', points: 10, rank: 1,
          win: 3, draw: 1, loss: 0, goalsFor: 10, goalsAgainst: 3, goalDiff: 7,
        }),
        standingRow({ teamId: 'en_a', name: '山貓隊', points: 4, rank: 2 }),
      ],
    })],
  };
}

/** 同分逐項比較。回傳形狀照 g1-ui 測試的 explainTie。 */
// 跟 tieStandings 一致：兩隊每一項都相同（對戰 1：1、全組淨勝 0、進球 4），待主辦裁定（顧問 §3.294 截圖驗收：數字要跟積分表對得上）
const TIE_EXPLAINED = {
  dvId: 'dv_adult',
  groupId: 'A',
  naturalOrder: ['en_b', 'en_c'],
  steps: [
    { criterion: 'points', teamIds: ['en_b', 'en_c'], values: [{ teamId: 'en_b', value: 5 }, { teamId: 'en_c', value: 5 }], split: false },
    { criterion: 'headToHeadPoints', teamIds: ['en_b', 'en_c'], values: [{ teamId: 'en_b', value: 1 }, { teamId: 'en_c', value: 1 }], split: false },
    { criterion: 'headToHeadGoalDiff', teamIds: ['en_b', 'en_c'], values: [{ teamId: 'en_b', value: 0 }, { teamId: 'en_c', value: 0 }], split: false },
    { criterion: 'goalDiff', teamIds: ['en_b', 'en_c'], values: [{ teamId: 'en_b', value: 0 }, { teamId: 'en_c', value: 0 }], split: false },
    { criterion: 'goalsFor', teamIds: ['en_b', 'en_c'], values: [{ teamId: 'en_b', value: 4 }, { teamId: 'en_c', value: 4 }], split: false },
  ],
  pending: true,
  matchIds: ['mt_rel'],
};

function tieStandings(): StandingDoc {
  return standingDoc({
    hasUnresolvedTie: true,
    rows: [
      standingRow({
        teamId: 'en_h', name: '海風隊', points: 10, rank: 1,
        win: 3, draw: 1, loss: 0, goalsFor: 10, goalsAgainst: 3, goalDiff: 7,
      }),
      standingRow({
        teamId: 'en_b', name: '銀河隊', points: 5, rank: 2,
        hasUnresolvedTie: true, tiedWith: ['en_c'],
      }),
      standingRow({
        teamId: 'en_c', name: '雷霆隊', points: 5, rank: 2,
        hasUnresolvedTie: true, tiedWith: ['en_b'],
      }),
    ],
  });
}

function statusMatches(): MatchDoc[] {
  const rows: Array<Partial<MatchDoc> & Pick<MatchDoc, 'id' | 'status'>> = [
    { id: 'mt_sched', status: 'scheduled', matchNo: 1, kickoffAt: taipeiMs(2027, 1, 9, 9, 0), home: { teamId: 'en_h', name: '海風隊' }, away: { teamId: 'en_a', name: '山貓隊' }, teamIds: ['en_h', 'en_a'] },
    { id: 'mt_fin', status: 'finished', matchNo: 2, kickoffAt: taipeiMs(2027, 1, 9, 11, 0), score: { home: 2, away: 1 }, home: { teamId: 'en_b', name: '銀河隊' }, away: { teamId: 'en_c', name: '晨光隊' }, teamIds: ['en_b', 'en_c'] },
    { id: 'mt_ok', status: 'confirmed', matchNo: 3, kickoffAt: taipeiMs(2027, 1, 9, 13, 0), score: { home: 1, away: 0 }, home: { teamId: 'en_d', name: '青鳥隊' }, away: { teamId: 'en_e', name: '赤焰隊' }, teamIds: ['en_d', 'en_e'] },
    { id: 'mt_wo', status: 'walkover', matchNo: 4, kickoffAt: taipeiMs(2027, 1, 9, 15, 0), score: { home: 0, away: 2 }, walkoverSide: 'home', home: { teamId: 'en_f', name: '白浪隊' }, away: { teamId: 'en_g', name: '黑潮隊' }, teamIds: ['en_f', 'en_g'] },
    { id: 'mt_live', status: 'live', matchNo: 5, kickoffAt: taipeiMs(2027, 1, 9, 17, 0), score: { home: 1, away: 1 }, home: { teamId: 'en_i', name: '綠洲隊' }, away: { teamId: 'en_j', name: '黃沙隊' }, teamIds: ['en_i', 'en_j'] },
    { id: 'mt_half', status: 'halftime', matchNo: 6, kickoffAt: taipeiMs(2027, 1, 9, 18, 0), home: { teamId: 'en_k', name: '赤陽隊' }, away: { teamId: 'en_m', name: '青石隊' }, teamIds: ['en_k', 'en_m'] },
    { id: 'mt_move', status: 'postponed', matchNo: 7, kickoffAt: null, venueIdx: null, venueName: null, home: { teamId: 'en_n', name: '北風隊' }, away: { teamId: 'en_p', name: '南風隊' }, teamIds: ['en_n', 'en_p'] },
    {
      id: 'mt_cx', status: 'cancelled', matchNo: 8, kickoffAt: taipeiMs(2027, 1, 9, 19, 0),
      cancelReason: '大雨，場地無法使用', cancelledAt: taipeiMs(2027, 1, 9, 8, 0),
      home: { teamId: 'en_q', name: '晨星隊' }, away: { teamId: 'en_r', name: '飛燕隊' }, teamIds: ['en_q', 'en_r'],
    },
  ];
  return rows.map((row) => matchDoc(row));
}

/** 改期撞期用的兩場。句子照 host-ops：1/10 11:00 藍鯨隊對紅狐隊。 */
function clashMatches(): MatchDoc[] {
  return [
    matchDoc({ id: 'mt_1', status: 'scheduled', rev: 3 }),
    matchDoc({
      id: 'mt_2',
      status: 'scheduled',
      rev: 4,
      matchNo: 2,
      kickoffAt: taipeiMs(2027, 1, 10, 11, 0),
      venueIdx: 1,
      venueName: '第二球場',
      home: { teamId: 'en_b', name: '藍鯨隊' },
      away: { teamId: 'en_c', name: '紅狐隊' },
      teamIds: ['en_b', 'en_c'],
    }),
  ];
}

function clashActions(actions: CpActions): CpActions {
  let times = 0;
  return {
    ...actions,
    rescheduleMatch: async () => {
      times += 1;
      if (times === 1) throw new CpCallError('SCHEDULE_CONFLICT', { mtId: 'mt_2', type: 'venue' }); // 截圖改期到 1/10 11:00，跟 mt_2 同時段
      return {};
    },
  };
}

const REPO = createFakeCpRepo();

function base(actions: CpActions, who: CpActor, bundle?: CpBundle, preview?: CpPreview, seed?: WizardSeed): CpInjectedEnv {
  return {
    actor: who,
    repo: REPO,
    actions,
    now: NOW,
    route: { cid: 'cup', enId: 'en_a' },
    bundle,
    preview,
    wizardSeed: seed,
  };
}

/** 每個 ?screen= 的注入環境。首屏就有 bundle，不打網路。 */
export function screenEnv(screen: string, actions: CpActions = idleActions()): CpInjectedEnv {
  switch (screen) {
    case 'wizard-1':
      return base(actions, wizardActor, undefined, { wizardStep: 1 }, wizardSeed());
    case 'wizard-1-club':
      return base(actions, wizardActor, undefined, { wizardStep: 1, wizardClub: true }, wizardSeed());
    case 'wizard-1-error':
      return base(actions, wizardActor, undefined, { wizardStep: 1, wizardError: true }, wizardSeed('示範官方盃'));
    case 'wizard-2':
      return base(actions, wizardActor, undefined, { wizardStep: 2 }, wizardSeed());
    case 'wizard-3':
      return base(actions, wizardActor, undefined, { wizardStep: 3 }, wizardSeed());
    case 'wizard-done':
      return base(actions, wizardActor, undefined, { wizardStep: 'done' }, wizardSeed());
    case 'detail-rep':
      return base(actions, repActor, detailBundle());
    case 'detail-member':
      return base(actions, memberActor, detailBundle(), { menuOpen: true });
    case 'detail-report':
      return base(actions, memberActor, detailBundle(), { reportOpen: true });
    case 'roster':
      return base(actions, repActor, rosterBundle(SHORT_PLAYERS, false));
    case 'roster-ready':
      return base(actions, repActor, rosterBundle(READY_PLAYERS, false));
    case 'roster-locked':
      return base(actions, repActor, rosterBundle(READY_PLAYERS, true));
    case 'form-self-adult':
      return base(actions, memberActor, rosterBundle(SHORT_PLAYERS, false), { prefillForm: true });
    case 'form-self-minor':
      return base(actions, memberActor, rosterBundle(SHORT_PLAYERS, false), { prefillForm: true, selfMinor: true });
    case 'form-rep':
      return base(actions, repActor, rosterBundle(SHORT_PLAYERS, false), { prefillForm: true });
    case 'form-rep-adult':
      return base(actions, repActor, rosterBundle(SHORT_PLAYERS, false), { prefillForm: true, repAdult: true });
    case 'form-rep-adult-nick':
      return base(actions, repActor, rosterBundle(SHORT_PLAYERS, false), { prefillForm: true, repAdult: true, repNick: true });
    case 'host-pending':
      return base(actions, hostActor, manageBundle(), { manageTab: 'pending' });
    case 'host-approved':
      return base(actions, hostActor, manageBundle(), { manageTab: 'approved' });
    case 'host-approved-personal': {
      // 個人主辦：沒有報名費、繳費標籤、標示已繳費（顧問 §3.257）
      const b = manageBundle();
      return base(actions, hostActor, { ...b, competition: competition({ hostType: 'personal', hostTeamId: null }) }, { manageTab: 'approved' });
    }
    case 'detail-personal': {
      const b = detailBundle();
      return base(actions, memberActor, { ...b, competition: competition({ hostType: 'personal', hostTeamId: null, feeNote: null }) });
    }
    case 'host-rejected':
      return base(actions, hostActor, manageBundle(), { manageTab: 'rejected' });
    case 'host-reject':
      return base(actions, hostActor, manageBundle(), { rejectOpen: true, manageTab: 'pending' });
    case 'host-lock':
      return base(actions, hostActor, manageBundle(), { lockDialog: true });
    case 'host-unlock':
      return base(actions, hostActor, manageBundle({ uid: 'uid_host', roles: ['host'] }, true), { unlockOpen: true });
    case 'position-measure':
      return base(actions, memberActor, rosterBundle(MEASURE_PLAYERS, false));
    // 第 3 步正式頁截圖。下面每個 case 都是新 screen，不改上面既有 case 的資料。
    case 'list-in':
      return listInEnv(actions);
    case 'real-recruit':
      return detailEnv(memberActor, NOW, {}, { summary: [], standings: [] });
    case 'real-warm':
      return detailEnv(memberActor, WARM_NOW, {}, { summary: warmSchedule(), standings: [] });
    case 'real-live':
    case 'real-live-stand':
      return detailEnv(memberActor, LIVE_NOW, { category: 'cup' }, liveBoard());
    case 'real-done':
      return detailEnv(memberActor, DONE_NOW, {}, championBoard());
    case 'real-ended-host':
      return detailEnv(
        adminActor,
        DONE_NOW,
        { endedAt: ENDED_AT, endedBy: 'host', endReason: '剩餘場次不再進行' },
        championBoard(),
      );
    case 'real-postponed':
      return detailEnv(
        memberActor,
        LIVE_NOW,
        { status: 'postponed', statusReason: '場地整修，日期另行通知' },
        { summary: [summaryEntry({ id: 'mt_1', k: taipeiMs(2027, 1, 9, 9, 0), st: 'scheduled' })], standings: [] },
      );
    case 'real-cancelled-comp':
      return detailEnv(
        memberActor,
        DONE_NOW,
        { status: 'cancelled', statusReason: '報名隊伍不足' },
        { summary: [summaryEntry({ id: 'mt_1', k: taipeiMs(2027, 1, 9, 9, 0), st: 'scheduled' })], standings: [] },
      );
    case 'real-notices':
      return detailEnv(memberActor, NOW, {
        hostType: 'personal',
        hostTeamId: null,
        hostDisplay: '王示範',
        feeNote: null,
        contactNote: null,
        notices: [
          notice('nt_sys', '因雨延後一小時，請各隊留意集合時間', 'system', taipeiMs(2026, 12, 10, 9, 0)),
          notice('nt_host', '領隊會議改在示範球場門口', 'host', taipeiMs(2026, 12, 9, 18, 0)),
          notice('nt_sys2', '賽程摘要已更新', 'system', taipeiMs(2026, 12, 8, 12, 0)),
        ],
      }, { summary: [], standings: [] });
    case 'real-contact-club':
      return detailEnv(memberActor, NOW, { contactNote: '賽前群組' }, { summary: [], standings: [] });
    case 'real-contact-personal':
      return detailEnv(memberActor, NOW, {
        hostType: 'personal',
        hostTeamId: null,
        hostDisplay: '王示範',
        feeNote: null,
        contactNote: '賽前到集合點找王示範',
      }, { summary: [], standings: [] });
    case 'real-contact-personal-empty':
      return detailEnv(memberActor, NOW, {
        name: '個人主辦（未留聯絡）',
        hostType: 'personal',
        hostTeamId: null,
        hostDisplay: '王示範',
        feeNote: null,
        contactNote: null,
      }, { summary: [], standings: [] });
    case 'real-host-matches':
      return hostEnv(statusMatches(), actions);
    case 'real-host-schedule':
      return { ...base(actions, hostActor, manageBundle(HOST_STAFF)), now: NOW };
    case 'real-score-sheet':
      return hostEnv([matchDoc({ id: 'mt_1', status: 'scheduled', home: { teamId: 'en_h', name: '海風隊' }, away: { teamId: 'en_a', name: '山貓隊' } })], actions);
    case 'real-reschedule-clash':
      return withSecondVenue(hostEnv(clashMatches(), clashActions(actions)));
    case 'real-shift-day':
      return hostEnv(clashMatches(), actions);
    case 'real-tie-panel':
      return detailEnv(
        hostActor,
        DONE_NOW,
        {},
        {
          summary: [summaryEntry({
            id: 'mt_rel',
            k: taipeiMs(2027, 1, 9, 9, 0),
            st: 'confirmed',
            s: [1, 1],
            h: { id: 'en_b', n: '銀河隊' },
            a: { id: 'en_c', n: '雷霆隊' },
          })],
          standings: [tieStandings()],
        },
        HOST_STAFF,
        { ...actions, explainTie: async () => TIE_EXPLAINED },
      );
    case 'real-end-dialog':
      return hostEnv(
        [
          matchDoc({ id: 'mt_1', status: 'scheduled' }),
          matchDoc({ id: 'mt_2', status: 'finished', matchNo: 2, score: { home: 1, away: 0 } }),
        ],
        actions,
        { summary: [], standings: [tieStandings()] },
      );
    case 'real-cancel-sheet':
      return hostEnv([matchDoc({
        id: 'mt_1',
        status: 'scheduled',
        home: { teamId: 'en_h', name: '晨星隊' },
        away: { teamId: 'en_a', name: '飛燕隊' },
      })], actions);
    case 'real-wizard-personal':
      return base(actions, wizardActor, undefined, { wizardStep: 1 }, wizardSeed());
    default:
      return base(actions, wizardActor, undefined, { wizardStep: 1 }, wizardSeed());
  }
}
