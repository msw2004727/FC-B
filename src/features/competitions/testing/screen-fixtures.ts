// harness 與頁面測試共用的假資料。人名、隊名都是示範，不是真實帳號。

import type { CpActions } from '../actions';
import type { CpActor, CpBundle, CpInjectedEnv, CpPreview, WizardSeed } from '../env';
import { taipeiMs } from '../format';
import type {
  CompetitionDoc,
  DivisionDoc,
  EntryDoc,
  EntryPrivateDoc,
  RosterPublicDoc,
  StaffDoc,
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
    stateVersion: 1,
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
    default:
      return base(actions, wizardActor, undefined, { wizardStep: 1 }, wizardSeed());
  }
}
