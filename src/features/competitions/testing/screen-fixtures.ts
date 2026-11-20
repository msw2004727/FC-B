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
    assignStaff: async () => ({}),
    removeStaff: async () => ({}),
    // K11／K12（PM 11-20 補上，CpActions 改回必填）：假資料，不連任何後端。
    createInvite: async () => ({ ivId: 'iv_' + 'a'.repeat(20), code: 'A'.repeat(22), expiresAt: 0 }),
    revokeInvite: async () => ({}),
    acceptInvite: async ({ cid }) => ({ cid, roles: ['scorer'], matchCount: 1 }),
    moderate: async () => ({}),
    reviewReport: async () => ({}),
    deleteCompetition: async ({ cid }) => ({ cid, deleted: true }),
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
  // 管理員直接過建賽閘門，harness 與測試不必另備 cpConfig/launch。
  role: 'admin',
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

/** 站內清單：進行中有今天場數、預熱、招募，三種分類色封面。nameOverride：長名稱截圖用，三張卡都換成同一個名稱（不給時資料不變）。 */
export function listInEnv(actions: CpActions = idleActions(), nameOverride?: string): CpInjectedEnv {
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
    ].map((doc) => (nameOverride ? { ...doc, name: nameOverride } : doc)),
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
          teamId: 'en_b', name: '銀河隊', points: 5, rank: 2, win: 1, draw: 2, loss: 1,
          hasUnresolvedTie: true, tiedWith: ['en_c'],
        }),
        standingRow({
          teamId: 'en_c', name: '雷霆隊', points: 5, rank: 2, win: 1, draw: 2, loss: 1,
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
        teamId: 'en_b', name: '銀河隊', points: 5, rank: 2, win: 1, draw: 2, loss: 1,
        hasUnresolvedTie: true, tiedWith: ['en_c'],
      }),
      standingRow({
        teamId: 'en_c', name: '雷霆隊', points: 5, rank: 2, win: 1, draw: 2, loss: 1,
        hasUnresolvedTie: true, tiedWith: ['en_b'],
      }),
    ],
  });
}

/** 同分兩隊的相關場次（1：1）。 */
function tieSummary(): SummaryEntry[] {
  return [summaryEntry({
    id: 'mt_rel',
    k: taipeiMs(2027, 1, 9, 9, 0),
    st: 'confirmed',
    s: [1, 1],
    h: { id: 'en_b', n: '銀河隊' },
    a: { id: 'en_c', n: '雷霆隊' },
  })];
}

/** tieStandings 已由主辦裁定：銀河隊第 2、雷霆隊第 3，列上 decidedBy，文件帶 manualOverride。 */
function decidedStandings(): StandingDoc {
  const tied = tieStandings();
  return standingDoc({
    hasUnresolvedTie: false,
    version: 5,
    manualOverride: { method: 'host', reason: '兩隊所有比較項目相同，依賽前公告規則由主辦裁定', at: taipeiMs(2027, 1, 10, 20, 0) },
    rows: tied.rows.map((row) => (row.teamId === 'en_b' || row.teamId === 'en_c'
      ? { ...row, hasUnresolvedTie: false, tiedWith: [], decidedBy: 'host' as const, rank: row.teamId === 'en_b' ? 2 : 3 }
      : row)),
  });
}

// ── 卡 2-5 同分裁定補兩個示範狀態（設計總監 03:38）──
// 下面積分列與 explainTie 回傳都不是手寫的：把同一組場次餵給 functions-cp 引擎（computeRows → rankRows、
// explainTie，規則 RR_FEDA_DEFAULT＝h2hFirst），照輸出原樣抄進來。teamIds 依積分表列順序送（與 samePointTeamIds 相同）。
// 引擎在某一項分出高下就停（同一群不再往下比），所以淡青綠列一定是最後一列。

type TieGame = [id: string, home: string, away: string, homeGoals: number, awayGoals: number, day: number, hour: number];

const TIE_NAMES: Readonly<Record<string, string>> = {
  en_h: '海風隊', en_b: '銀河隊', en_c: '雷霆隊', en_a: '山貓隊', en_d: '青鳥隊', en_e: '赤焰隊',
};

function tieGames(games: readonly TieGame[]): SummaryEntry[] {
  return games.map(([id, home, away, hg, ag, day, hour], index) => summaryEntry({
    id,
    k: taipeiMs(2027, 1, day, hour, 0),
    st: 'confirmed',
    no: index + 1,
    s: [hg, ag],
    h: { id: home, n: TIE_NAMES[home] ?? home },
    a: { id: away, n: TIE_NAMES[away] ?? away },
  }));
}

/** 分得出高下：銀河、雷霆同 4 分，對戰銀河 2：1 勝，靠「對戰積分」分出（銀河淨勝球反而較少，正好看出對戰優先）。 */
const TIE_RANKED_GAMES: readonly TieGame[] = [
  ['mt_rel', 'en_b', 'en_c', 2, 1, 9, 9],
  ['mt_r2', 'en_h', 'en_a', 2, 0, 9, 11],
  ['mt_r3', 'en_h', 'en_b', 2, 0, 9, 13],
  ['mt_r4', 'en_c', 'en_a', 1, 1, 9, 15],
  ['mt_r5', 'en_c', 'en_h', 1, 0, 10, 9],
  ['mt_r6', 'en_b', 'en_a', 1, 1, 10, 11],
];

function tieRankedStandings(): StandingDoc {
  return standingDoc({
    rows: [
      standingRow({ teamId: 'en_h', name: '海風隊', rank: 1, points: 6, played: 3, win: 2, draw: 0, loss: 1, goalsFor: 4, goalsAgainst: 1, goalDiff: 3 }),
      standingRow({ teamId: 'en_b', name: '銀河隊', rank: 2, points: 4, played: 3, win: 1, draw: 1, loss: 1, goalsFor: 3, goalsAgainst: 4, goalDiff: -1 }),
      standingRow({ teamId: 'en_c', name: '雷霆隊', rank: 3, points: 4, played: 3, win: 1, draw: 1, loss: 1, goalsFor: 3, goalsAgainst: 3, goalDiff: 0 }),
      standingRow({ teamId: 'en_a', name: '山貓隊', rank: 4, points: 2, played: 3, win: 0, draw: 2, loss: 1, goalsFor: 2, goalsAgainst: 4, goalDiff: -2 }),
    ],
  });
}

const TIE_RANKED_EXPLAINED = {
  dvId: 'dv_adult',
  groupId: 'A',
  naturalOrder: ['en_b', 'en_c'],
  steps: [
    { teamIds: ['en_b', 'en_c'], criterion: 'points', values: [{ teamId: 'en_b', value: 4 }, { teamId: 'en_c', value: 4 }], split: false },
    { teamIds: ['en_b', 'en_c'], criterion: 'headToHeadPoints', values: [{ teamId: 'en_b', value: 3 }, { teamId: 'en_c', value: 0 }], split: true },
  ],
  splits: [{ criterion: 'headToHeadPoints', aboveTeamIds: ['en_b'], belowTeamIds: ['en_c'] }],
  decidedCriterion: 'headToHeadPoints',
  pending: false,
  pendingCriterion: null,
  matchIds: ['mt_rel'],
  decision: null,
  marks: [{ teamId: 'en_b', rank: 2, decidedBy: null }, { teamId: 'en_c', rank: 3, decidedBy: null }],
};

/**
 * 四隊同分：海風全勝，其餘四隊同 4 分（對戰各 1 勝 1 和 1 敗、對戰積分也都是 4），
 * 靠「對戰淨勝球」一次分成四段。用來量比較表四欄在 360 寬放不放得下。
 */
const TIE_FOUR_GAMES: readonly TieGame[] = [
  ['mt_f1', 'en_b', 'en_c', 4, 0, 9, 9],
  ['mt_f2', 'en_d', 'en_e', 1, 0, 9, 11],
  ['mt_f3', 'en_c', 'en_d', 2, 0, 9, 13],
  ['mt_f4', 'en_e', 'en_b', 1, 0, 9, 15],
  ['mt_f5', 'en_b', 'en_d', 0, 0, 10, 9],
  ['mt_f6', 'en_c', 'en_e', 0, 0, 10, 11],
  ['mt_f7', 'en_h', 'en_b', 1, 0, 10, 13],
  ['mt_f8', 'en_h', 'en_c', 1, 0, 10, 15],
  ['mt_f9', 'en_h', 'en_d', 1, 0, 11, 9],
  ['mt_f10', 'en_h', 'en_e', 1, 0, 11, 11],
];

function tieFourStandings(): StandingDoc {
  return standingDoc({
    rows: [
      standingRow({ teamId: 'en_h', name: '海風隊', rank: 1, points: 12, played: 4, win: 4, draw: 0, loss: 0, goalsFor: 4, goalsAgainst: 0, goalDiff: 4 }),
      standingRow({ teamId: 'en_b', name: '銀河隊', rank: 2, points: 4, played: 4, win: 1, draw: 1, loss: 2, goalsFor: 4, goalsAgainst: 2, goalDiff: 2 }),
      standingRow({ teamId: 'en_e', name: '赤焰隊', rank: 3, points: 4, played: 4, win: 1, draw: 1, loss: 2, goalsFor: 1, goalsAgainst: 2, goalDiff: -1 }),
      standingRow({ teamId: 'en_d', name: '青鳥隊', rank: 4, points: 4, played: 4, win: 1, draw: 1, loss: 2, goalsFor: 1, goalsAgainst: 3, goalDiff: -2 }),
      standingRow({ teamId: 'en_c', name: '雷霆隊', rank: 5, points: 4, played: 4, win: 1, draw: 1, loss: 2, goalsFor: 2, goalsAgainst: 5, goalDiff: -3 }),
    ],
  });
}

const FOUR_IDS = ['en_b', 'en_e', 'en_d', 'en_c'];
const fourValues = (values: readonly number[]) => FOUR_IDS.map((teamId, index) => ({ teamId, value: values[index] ?? null }));

const TIE_FOUR_EXPLAINED = {
  dvId: 'dv_adult',
  groupId: 'A',
  naturalOrder: [...FOUR_IDS],
  steps: [
    { teamIds: [...FOUR_IDS], criterion: 'points', values: fourValues([4, 4, 4, 4]), split: false },
    { teamIds: [...FOUR_IDS], criterion: 'headToHeadPoints', values: fourValues([4, 4, 4, 4]), split: false },
    { teamIds: [...FOUR_IDS], criterion: 'headToHeadGoalDiff', values: fourValues([3, 0, -1, -2]), split: true },
  ],
  splits: [
    { criterion: 'headToHeadGoalDiff', aboveTeamIds: ['en_b'], belowTeamIds: ['en_e'] },
    { criterion: 'headToHeadGoalDiff', aboveTeamIds: ['en_e'], belowTeamIds: ['en_d'] },
    { criterion: 'headToHeadGoalDiff', aboveTeamIds: ['en_d'], belowTeamIds: ['en_c'] },
  ],
  decidedCriterion: 'headToHeadGoalDiff',
  pending: false,
  pendingCriterion: null,
  matchIds: ['mt_f1', 'mt_f2', 'mt_f3', 'mt_f4', 'mt_f5', 'mt_f6'],
  decision: null,
  marks: FOUR_IDS.map((teamId, index) => ({ teamId, rank: index + 2, decidedBy: null })),
};

/** explainTie 假回傳：送來的隊伍與引擎跑的那一組不同就丟錯，避免畫面拿到對不上的數字。 */
function tieExplainOf(expected: readonly string[], result: unknown) {
  return async (input: { teamIds: string[] }) => {
    if (input.teamIds.join(',') !== expected.join(',')) throw new CpCallError('TIE_NOT_SAME_POINTS', {});
    return result;
  };
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
/** 1/10～1/12 每天 8 場，共 24 場未賽，撐出長清單。 */
function manyMatches(): MatchDoc[] {
  const rows: MatchDoc[] = [];
  for (let day = 0; day < 3; day += 1) {
    for (let slot = 0; slot < 8; slot += 1) {
      const n = day * 8 + slot;
      rows.push(matchDoc({
        id: `mt_many_${n}`,
        status: 'scheduled',
        matchNo: 9 + n,
        kickoffAt: taipeiMs(2027, 1, 10 + day, 8 + slot, 0),
        home: { teamId: `en_mh${n}`, name: `主隊${n + 1}` },
        away: { teamId: `en_ma${n}`, name: `客隊${n + 1}` },
        teamIds: [`en_mh${n}`, `en_ma${n}`],
      }));
    }
  }
  return rows;
}

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

// ── 新外觀第 1b／4 批與第 3 批留下的示範狀態（只給 harness 截圖；不改上面既有 screen 的資料）──

/** 截圖隊徽：16×16 內嵌 PNG（TeamCrest 只收這種 data URI），不連正式儲存網域。 */
export const SHOT_CREST = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAANElEQVR4nGNgoBDwFeehIdJU49ODSzV2PfhVo+shRjWKnhGpgeRgJSfiyEkauPTgU00MAADYspGlcL3zwAAAAABJRU5ErkJggg==';
/** 22 字賽事名（同 cp-delete 的 ?long=1）、14 字場地、12 字隊名。 */
export const LONG_COMP_NAME = '新北市三重區二〇二七年春季社區五人制足球聯賽';
export const LONG_VENUE = '三重區示範運動公園第一足球場';
export const LONG_TEAM = '三重示範青年足球俱樂部隊';

export const scorerActor = actor({
  uid: 'uid_scorer',
  displayName: '陳示範',
});

/** 同一時間（14:30）兩場「下一場」。 */
function twinNextBoard(): { summary: SummaryEntry[]; standings: StandingDoc[] } {
  const board = liveBoard();
  return {
    summary: [
      ...board.summary,
      summaryEntry({
        id: 'nx2',
        k: taipeiMs(2027, 1, 9, 14, 30),
        st: 'scheduled',
        no: 5,
        v: '1號場',
        h: { id: 'en_i', n: '綠洲隊' },
        a: { id: 'en_j', n: '黃沙隊' },
      }),
    ],
    standings: board.standings,
  };
}

/** 進行中、另有已更正＋PK；有內嵌隊徽（詳情列 24／28 兩種尺寸都看得到）。 */
function crestLiveBoard(pkOnly: boolean): { summary: SummaryEntry[]; standings: StandingDoc[] } {
  const corrected = summaryEntry({
    id: 'cx_pk',
    k: taipeiMs(2027, 1, 9, 8, 0),
    st: 'confirmed',
    s: pkOnly ? [2, 2] : [2, 1],
    no: 1,
    h: { id: 'en_whale', n: '藍鯨隊', l: SHOT_CREST },
    a: { id: 'en_h', n: '海風隊' },
    cx: LIVE_NOW,
    ...(pkOnly ? { p: [4, 3] as [number, number] } : {}),
  });
  if (pkOnly) return { summary: [corrected], standings: [] };
  return {
    summary: [
      corrected,
      summaryEntry({
        id: 'lv1', k: taipeiMs(2027, 1, 9, 11, 0), st: 'live', s: [1, 1], no: 2,
        h: { id: 'en_c', n: '雷霆隊', l: SHOT_CREST }, a: { id: 'en_h2', n: '海風隊' },
      }),
      summaryEntry({
        id: 'lv2', k: taipeiMs(2027, 1, 9, 11, 0), st: 'halftime', s: [0, 2], no: 3, v: '2號場',
        h: { id: 'en_cat', n: '山貓隊' }, a: { id: 'en_gal', n: '銀河隊', l: SHOT_CREST },
      }),
      summaryEntry({
        id: 'nx', k: taipeiMs(2027, 1, 9, 14, 30), st: 'scheduled', no: 4,
        h: { id: 'en_f', n: '晨光隊' }, a: { id: 'en_g', n: '北風隊' },
      }),
    ],
    standings: [],
  };
}

/** 30 字組名（卡 1b-3 驗組名省略）。 */
export const LONG_DIVISION_NAME = '新北市三重區二〇二七年社區五人制足球聯賽成人男子組第一級別組';

/** 五個組別各一份積分（各有冠軍）。冠軍那一行的組名讀積分文件的 divisionName，其中一組是 30 字組名。 */
const FIVE_DIVISION_NAMES = ['成人組', '壯年組', 'U15', 'U12', LONG_DIVISION_NAME];
const FIVE_DIVISIONS: DivisionDoc[] = FIVE_DIVISION_NAMES.map((name, index) => division({
  dvId: `dv_${index + 1}`,
  name,
  order: index,
  approvedCount: 4,
  entryCount: 4,
}));

function fiveChampionBoard(): { summary: SummaryEntry[]; standings: StandingDoc[] } {
  const teams = ['海風隊', '銀河隊', '雷霆隊', '青鳥隊', '赤焰隊'];
  return {
    summary: [summaryEntry({ id: 'final', k: LAST_MATCH, st: 'confirmed', s: [1, 0], no: 1 })],
    standings: FIVE_DIVISIONS.map((dv, index) => standingDoc({
      id: `${dv.dvId}__group__A`,
      divisionId: dv.dvId,
      divisionName: dv.name,
      rows: [
        standingRow({ teamId: `en_c${index}`, name: teams[index] ?? '海風隊', points: 9, rank: 1, win: 3, draw: 0, loss: 1 }),
        standingRow({ teamId: `en_r${index}`, name: '山貓隊', points: 4, rank: 2 }),
      ],
    })),
  };
}

/** 冠軍待裁定：第 1 名兩隊同分未裁定。 */
function pendingChampionBoard(): { summary: SummaryEntry[]; standings: StandingDoc[] } {
  return {
    summary: [summaryEntry({ id: 'final', k: LAST_MATCH, st: 'confirmed', s: [1, 1], no: 1 })],
    standings: [standingDoc({
      hasUnresolvedTie: true,
      rows: [
        standingRow({ teamId: 'en_h', name: '海風隊', points: 7, rank: 1, hasUnresolvedTie: true, tiedWith: ['en_a'] }),
        standingRow({ teamId: 'en_a', name: '山貓隊', points: 7, rank: 1, hasUnresolvedTie: true, tiedWith: ['en_h'] }),
        standingRow({ teamId: 'en_b', name: '銀河隊', points: 3, rank: 3 }),
      ],
    })],
  };
}

/** 長名稱：賽程列用 12 字隊名與 14 字場地。 */
function longBoard(): { summary: SummaryEntry[]; standings: StandingDoc[] } {
  return {
    summary: [
      summaryEntry({ id: 'l1', k: taipeiMs(2027, 1, 9, 9, 0), st: 'finished', s: [2, 1], no: 1, v: LONG_VENUE, h: { id: 'en_l1', n: LONG_TEAM }, a: { id: 'en_l2', n: '海風隊' } }),
      summaryEntry({ id: 'l2', k: taipeiMs(2027, 1, 9, 14, 30), st: 'scheduled', no: 2, v: LONG_VENUE, h: { id: 'en_l3', n: '銀河隊' }, a: { id: 'en_l4', n: LONG_TEAM } }),
    ],
    standings: [standingDoc({
      rows: [
        standingRow({ teamId: 'en_l1', name: LONG_TEAM, points: 3, rank: 1, played: 1, win: 1, draw: 0, loss: 0 }),
        standingRow({ teamId: 'en_l2', name: '海風隊', points: 0, rank: 2, played: 1, win: 0, draw: 0, loss: 1 }),
      ],
    })],
  };
}

/** 以俱樂部報隊：一個或兩個代表俱樂部。 */
function clubRep(count: 1 | 2): CpActor {
  const clubs = count === 1
    ? [{ id: 'club_x', name: '示範隊X' }]
    : [{ id: 'club_x', name: '示範隊X' }, { id: 'club_y', name: '示範隊Y' }];
  return actor({ uid: 'uid_rep2', displayName: '王示範', repClubs: clubs, memberClubIds: clubs.map((club) => club.id) });
}

/** 詳情不注入 bundle、改走假資料庫（記分員要讀自己的指派；讀取失敗要讓 getCompetition 丟錯）。 */
function repoDetailEnv(who: CpActor, now: number, repo: ReturnType<typeof createFakeCpRepo>, actions: CpActions): CpInjectedEnv {
  return { actor: who, repo, actions, now, route: { cid: 'cup', enId: 'en_a' } };
}

function scorerRepo(): ReturnType<typeof createFakeCpRepo> {
  const board = liveBoard();
  return createFakeCpRepo({
    competitions: [competition({ category: 'cup' })],
    divisions: { cup: [adultDivision, youthDivision] },
    entries: { cup: detailBundle().entries },
    staff: { cup: [{ uid: 'uid_host', roles: ['host'] }] },
    assignments: { cup: [{ uid: 'uid_scorer', roles: ['scorer'], matchIds: ['nx'], expiresAt: null, memberNo: 3 }] },
    summary: { cup: [{ id: summaryShardIdOf(LIVE_NOW), entries: board.summary }] },
    standings: { cup: board.standings },
  });
}

function failingDetailRepo(): ReturnType<typeof createFakeCpRepo> {
  const repo = createFakeCpRepo();
  // 沒有 code＝網路或其他錯誤（不是權限被拒），正式頁給「讀取失敗＋重試」。
  return { ...repo, getCompetition: async () => { throw new Error('offline'); } };
}

/** 賽程管理・待確認 3 分鐘內（撤回時鐘還在跑，多一顆「記分」）。 */
function freshPendingMatches(): MatchDoc[] {
  return [
    matchDoc({
      id: 'mt_fresh', status: 'finished', matchNo: 1, kickoffAt: taipeiMs(2027, 1, 9, 10, 30),
      score: { home: 2, away: 1 }, finishedAt: LIVE_NOW - 60 * 1000,
      home: { teamId: 'en_b', name: '銀河隊' }, away: { teamId: 'en_c', name: '晨光隊' }, teamIds: ['en_b', 'en_c'],
    }),
    matchDoc({ id: 'mt_next', status: 'scheduled', matchNo: 2, kickoffAt: taipeiMs(2027, 1, 9, 14, 0) }),
  ];
}

function shiftClashActions(actions: CpActions): CpActions {
  let times = 0;
  return {
    ...actions,
    shiftMatchDay: async () => {
      times += 1;
      // 1/9 整天順延到 1/10，跟 1/10 11:00 第二球場那場撞期
      if (times === 1) throw new CpCallError('SCHEDULE_CONFLICT', { mtId: 'mt_2', type: 'venue' });
      return {};
    },
  };
}

/** 報隊管理・長名稱：賽事名 22 字、隊名 12 字以上。 */
function longManageBundle(): CpBundle {
  const b = manageBundle();
  const names: Record<string, string> = {
    en_pa: LONG_TEAM,
    en_c: `${LONG_TEAM}二`,
    en_e: '一二三四五六七八九十示範隊',
  };
  return {
    ...b,
    competition: competition({ name: LONG_COMP_NAME }),
    entries: b.entries.map((row) => (names[row.id] ? { ...row, name: names[row.id] ?? row.name } : row)),
  };
}

/** 建賽守門三態：未登入、內部期一般會員、讀開放設定失敗。 */
function gateEnv(kind: 'guest' | 'member' | 'error', actions: CpActions): CpInjectedEnv {
  const repo = createFakeCpRepo({ launch: { isPublic: false, bannedWords: [] } });
  const who = kind === 'guest' ? { ...memberActor, uid: null } : memberActor;
  const gateRepo = kind === 'error'
    ? { ...repo, getLaunch: async () => { throw new Error('offline'); } }
    : repo;
  return { ...base(actions, who, undefined, { wizardStep: 1 }, wizardSeed()), repo: gateRepo };
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
    case 'real-notices-host':
      // 主辦視角的詳情頁（公告輸入框在最上方）。比照 real-notices 的公告，換成主辦身分。
      return detailEnv(hostActor, NOW, {
        hostType: 'personal',
        hostTeamId: null,
        hostDisplay: '王示範',
        feeNote: null,
        contactNote: null,
        notices: [
          notice('nt_sys', '因雨延後一小時，請各隊留意集合時間', 'system', taipeiMs(2026, 12, 10, 9, 0)),
          notice('nt_host', '領隊會議改在示範球場門口', 'host', taipeiMs(2026, 12, 9, 18, 0)),
        ],
      }, { summary: [], standings: [] }, HOST_STAFF);
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
    case 'real-host-matches-many':
      // 場次很多時「結束賽事」在清單最下方，量它跟底部導覽預留空間的關係。
      return hostEnv([...statusMatches(), ...manyMatches()], actions);
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
          summary: tieSummary(),
          standings: [tieStandings()],
        },
        HOST_STAFF,
        { ...actions, explainTie: async () => TIE_EXPLAINED },
      );
    case 'real-forfeit-sheet':
      // 卡 2-0（施工-第2批 3.27 #1）：登錄比分面板裡點「改登錄棄權」。資料同 real-score-sheet。
      return hostEnv([matchDoc({ id: 'mt_1', status: 'scheduled', home: { teamId: 'en_h', name: '海風隊' }, away: { teamId: 'en_a', name: '山貓隊' } })], actions);
    case 'real-reset-dialog':
      // 卡 2-0（3.27 #2）：已確認、棄權、已取消的場次才有「重置」。
      return hostEnv(statusMatches(), actions);
    case 'real-clear-schedule':
      // 卡 2-0（3.27 #3）：預覽丟 SCHEDULE_REPLACE_TOO_LARGE，頁面才出現「清除賽程」。
      return {
        ...base({
          ...actions,
          generateSchedule: async () => { throw new CpCallError('SCHEDULE_REPLACE_TOO_LARGE', {}); },
        }, hostActor, manageBundle(HOST_STAFF)),
        now: NOW,
      };
    case 'real-tie-exists':
      // 卡 2-0（3.25 另外兩張卡之一）：儲存裁定時後端回「已有裁定」，出現「已有裁定，請先撤銷」那張卡。
      return detailEnv(
        hostActor,
        DONE_NOW,
        {},
        { summary: tieSummary(), standings: [tieStandings()] },
        HOST_STAFF,
        {
          ...actions,
          explainTie: async () => TIE_EXPLAINED,
          resolveTie: async () => { throw new CpCallError('TIE_DECISION_EXISTS', {}); },
        },
      );
    case 'real-tie-decision':
      // 卡 2-0（3.25 另外兩張卡之二）：已裁定的組，點名次欄「裁定」打開 DecisionCard（主辦可撤銷）。
      return detailEnv(
        hostActor,
        DONE_NOW,
        {},
        { summary: tieSummary(), standings: [decidedStandings()] },
        HOST_STAFF,
        actions,
      );
    case 'real-tie-ranked':
      // 卡 2-5 補（設計總監 03:38）：同分但比較表分得出高下，比較表最後一列是淡青綠的「對戰積分」。
      return detailEnv(
        hostActor,
        DONE_NOW,
        {},
        { summary: tieGames(TIE_RANKED_GAMES), standings: [tieRankedStandings()] },
        HOST_STAFF,
        { ...actions, explainTie: tieExplainOf(['en_b', 'en_c'], TIE_RANKED_EXPLAINED) },
      );
    case 'real-tie-four':
      // 卡 2-5 補（設計總監 03:38）：四隊同分，比較表四欄，量 360 寬放不放得下。
      return detailEnv(
        hostActor,
        DONE_NOW,
        {},
        { summary: tieGames(TIE_FOUR_GAMES), standings: [tieFourStandings()] },
        HOST_STAFF,
        { ...actions, explainTie: tieExplainOf(FOUR_IDS, TIE_FOUR_EXPLAINED) },
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
    // ── 新外觀第 1b 批第 7 節「要補示範狀態」（截圖拍正式版現況）──
    case 'real-live-twin-next':
      return detailEnv(memberActor, LIVE_NOW, { category: 'cup' }, twinNextBoard());
    case 'real-live-no-today':
      // 1/10 進行中，賽程只有 1/9（今天沒有任何場次）。
      return detailEnv(memberActor, taipeiMs(2027, 1, 10, 12, 0), { category: 'cup' }, liveBoard());
    case 'real-warm-no-schedule':
      return detailEnv(memberActor, WARM_NOW, {}, { summary: [], standings: [] });
    case 'real-recruit-nodiv': {
      const env = detailEnv(memberActor, NOW, {}, { summary: [], standings: [] });
      return env.bundle ? { ...env, bundle: { ...env.bundle, divisions: [], entries: [] } } : env;
    }
    case 'real-done-five': {
      const env = detailEnv(memberActor, DONE_NOW, {}, fiveChampionBoard());
      return env.bundle ? { ...env, bundle: { ...env.bundle, divisions: FIVE_DIVISIONS } } : env;
    }
    case 'real-done-nochamp':
      return detailEnv(memberActor, DONE_NOW, {}, { summary: [summaryEntry({ id: 'final', k: LAST_MATCH, st: 'confirmed', s: [1, 0], no: 1 })], standings: [] });
    case 'real-done-pending':
      return detailEnv(memberActor, DONE_NOW, {}, pendingChampionBoard());
    case 'real-long':
      return detailEnv(memberActor, LIVE_NOW, { name: LONG_COMP_NAME, venues: [{ name: LONG_VENUE, address: '示範路 1 號' }] }, longBoard());
    case 'real-long-recruit': {
      const env = detailEnv(memberActor, NOW, { name: LONG_COMP_NAME, venues: [{ name: LONG_VENUE, address: '示範路 1 號' }] }, { summary: [], standings: [] });
      const b = env.bundle;
      return b ? { ...env, bundle: { ...b, entries: b.entries.map((row, index) => (index === 0 ? { ...row, name: LONG_TEAM } : row)) } } : env;
    }
    case 'real-draft-host':
      return detailEnv(hostActor, NOW, { status: 'draft' }, { summary: [], standings: [] }, HOST_STAFF);
    case 'real-scorer':
      return repoDetailEnv(scorerActor, LIVE_NOW, scorerRepo(), actions);
    case 'real-admin-menu':
      return { ...detailEnv(adminActor, NOW, {}, { summary: [], standings: [] }), preview: { menuOpen: true } };
    case 'real-club-entry-one':
      return detailEnv(clubRep(1), NOW, {}, { summary: [], standings: [] });
    case 'real-club-entry-two':
    case 'real-club-entry-error':
      return detailEnv(clubRep(2), NOW, {}, { summary: [], standings: [] });
    case 'real-notice-delete':
    case 'real-notice-delete-sys':
      return screenEnv('real-notices-host', actions);
    case 'real-load-failed':
      return repoDetailEnv(memberActor, NOW, failingDetailRepo(), actions);
    case 'real-crest-live':
      return detailEnv(memberActor, LIVE_NOW, { category: 'cup' }, crestLiveBoard(false));
    case 'real-corrected-pk':
      return detailEnv(memberActor, LIVE_NOW, { category: 'cup' }, crestLiveBoard(true));
    // ── 新外觀第 4 批第 7 節「要補」（賽程管理、排賽程）──
    case 'real-swap-open':
      return hostEnv(clashMatches(), actions);
    case 'real-shift-clash':
    case 'real-shift-clash-settled':
      return withSecondVenue(hostEnv(clashMatches(), shiftClashActions(actions)));
    case 'real-pending-fresh':
      return hostEnv(freshPendingMatches(), actions);
    case 'real-host-matches-empty':
      return hostEnv([], actions);
    case 'real-host-matches-denied':
      return { ...base(actions, memberActor, manageBundle(null)), now: LIVE_NOW, matches: [] };
    case 'real-schedule-preview':
      return {
        ...base({
          ...actions,
          generateSchedule: async () => ({ dvId: 'dv_adult', seed: 7, matchCount: 12, unplacedCount: 0, daysUsed: ['2027-01-09', '2027-01-10'], perTeam: 3, teamCount: 8, dryRun: true }),
        }, hostActor, manageBundle(HOST_STAFF)),
        now: NOW,
      };
    case 'real-schedule-unplaced':
      return {
        ...base({
          ...actions,
          generateSchedule: async () => { throw new CpCallError('SCHEDULE_UNPLACED', { unplacedCount: 4 }); },
        }, hostActor, manageBundle(HOST_STAFF)),
        now: NOW,
      };
    case 'real-schedule-too-many':
      return {
        ...base({
          ...actions,
          generateSchedule: async () => { throw new CpCallError('TOO_MANY_MATCHES', {}); },
        }, hostActor, manageBundle(HOST_STAFF)),
        now: NOW,
      };
    case 'real-schedule-replace':
      // 與 real-clear-schedule 同一個錯誤，但不打開確認框：看「清除賽程」紅框鈕本身。
      return screenEnv('real-clear-schedule', actions);
    // ── 新外觀第 4 批第 7 節「要補」（報隊管理、建賽守門）──
    case 'host-locked':
      return base(actions, hostActor, manageBundle({ uid: 'uid_host', roles: ['host'] }, true), { manageTab: 'approved' });
    case 'host-edit-open':
      return base(actions, hostActor, manageBundle(), { manageTab: 'approved' });
    case 'host-long':
      return base(actions, hostActor, longManageBundle(), { manageTab: 'approved' });
    case 'host-long-pending':
      return base(actions, hostActor, longManageBundle(), { manageTab: 'pending' });
    case 'gate-guest':
      return gateEnv('guest', actions);
    case 'gate-member':
      return gateEnv('member', actions);
    case 'gate-error':
      return gateEnv('error', actions);
    // ── 第 3 批留下的狀態（名單隊員視角、移除確認框、表單錯誤／自訂位置／資格不符）──
    case 'roster-member':
      return base(actions, memberActor, rosterBundle(SHORT_PLAYERS, false));
    case 'roster-remove':
      return base(actions, repActor, rosterBundle(SHORT_PLAYERS, false));
    case 'form-error':
    case 'form-custom-pos':
      return base(actions, memberActor, rosterBundle(SHORT_PLAYERS, false), { prefillForm: true });
    case 'form-ineligible':
      // 不是這支俱樂部的成員：rosterFormBlock 回 NOT_CLUB_MEMBER，畫「一句話＋回名單」。
      return base(actions, hostActor, rosterBundle(SHORT_PLAYERS, false), { prefillForm: true });
    default:
      return base(actions, wizardActor, undefined, { wizardStep: 1 }, wizardSeed());
  }
}
