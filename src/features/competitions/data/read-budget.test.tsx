import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InAppSection } from '../components/InAppSection';
import { CpEnvProvider } from '../env';
import { loadCompetitionsDict } from '../i18n';
import CompetitionDetailPage from '../pages/CompetitionDetailPage';
import { createFakeCpRepo, type FakeCpRepo } from '../testing/fake-cp-repo';
import { idleActions, memberActor } from '../testing/screen-fixtures';
import { matchDayOf } from './match-day';
import { loadFullSchedule, loadScheduleDetail, summaryShardIdOf } from './schedule-load';
import { CP_READ_LIMIT, type CompetitionDoc, type DivisionDoc, type EntryDoc, type MatchDoc, type StandingDoc, type SummaryEntry } from './types';

const NEW_READS = ['listMatches', 'getSummaryShard', 'listSummary', 'listStandings', 'listEntriesForCrest'];

function competition(partial: Partial<CompetitionDoc> & Pick<CompetitionDoc, 'id'>): CompetitionDoc {
  return {
    name: '示範盃',
    sport: 'football',
    hostType: 'club',
    hostTeamId: 'club_1',
    hostDisplay: '示範俱樂部',
    visibility: 'public',
    status: 'published',
    statusReason: null,
    hidden: false,
    regOpenAt: 100,
    regCloseAt: 200,
    firstMatchAt: 300,
    lastMatchAt: 400,
    endedAt: null,
    endedBy: null,
    endReason: null,
    rostersLockedAt: null,
    ageBasisAt: null,
    timezone: 'Asia/Taipei',
    venues: [],
    feeNote: null,
    liveLinks: [],
    contactNote: null,
    notices: [],
    lastMatchOriginAt: null,
    stateVersion: 1,
    category: 'league',
    ...partial,
  };
}

const division: DivisionDoc = {
  dvId: 'dv_1',
  name: '甲組',
  playersOnField: 7,
  maxTeams: 16,
  rosterMin: 5,
  rosterMax: 11,
  minAge: null,
  maxAge: null,
  requireRealName: false,
  feePerTeam: 0,
  entryCount: 8,
  approvedCount: 8,
  order: 0,
  ranking: null,
};

function entry(i: number): EntryDoc {
  return {
    id: `en_${i}`,
    dvId: 'dv_1',
    teamId: `team_${i}`,
    name: `隊${i}`,
    status: 'approved',
    rosterCount: 0,
    rosterConfirmed: false,
    teamLogo: null,
  };
}

function summaryEntry(id: string, k: number | null): SummaryEntry {
  return {
    id,
    dv: 'dv_1',
    r: 1,
    no: 1,
    k,
    v: null,
    h: { id: 'en_0', n: '隊0' },
    a: { id: 'en_1', n: '隊1' },
    s: [0, 0],
    st: 'scheduled',
    wo: null,
  };
}

function match(id: string): MatchDoc {
  return {
    id,
    divisionId: 'dv_1',
    stageId: 'group',
    groupId: 'A',
    round: 1,
    matchNo: 1,
    label: null,
    matchKey: null,
    kickoffAt: 300,
    venueIdx: 0,
    venueName: null,
    home: { teamId: 'en_0', name: '隊0' },
    away: { teamId: 'en_1', name: '隊1' },
    teamIds: ['en_0', 'en_1'],
    score: { home: 0, away: 0 },
    penaltyScore: null,
    status: 'scheduled',
    rev: 0,
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
  };
}

const SCHEDULE_TIMES = {
  regOpenAt: Date.parse('2026-12-01T08:00:00+08:00'),
  regCloseAt: Date.parse('2026-12-02T18:00:00+08:00'),
  firstMatchAt: Date.parse('2026-12-05T09:00:00+08:00'),
  lastMatchAt: Date.parse('2026-12-06T18:00:00+08:00'),
};

const nowOf = {
  recruit: Date.parse('2026-12-01T12:00:00+08:00'),
  warm: Date.parse('2026-12-03T12:00:00+08:00'),
  live: Date.parse('2026-12-05T15:00:00+08:00'),
  done: Date.parse('2026-12-07T00:00:00+08:00'),
} as const;

/** 查詢的 Rules 父文件。單筆 get 不加。上限用 CP_READ_LIMIT，不寫死 8／32／14。 */
const RULES_PARENT = 1;
const ROOT = 1;
const INTERNAL = 3;
/** 已登入才讀。單筆 get，不加父文件。 */
const STAFF = 1;
/** 預熱多讀首場那天一片。單筆 get，不加父文件。 */
const WARM_SHARD = 1;
const recruitMax = ROOT
  + (CP_READ_LIMIT.divisions + RULES_PARENT)
  + (CP_READ_LIMIT.crest + RULES_PARENT)
  + STAFF;
const warmMax = recruitMax + WARM_SHARD;
const liveMax = ROOT
  + (1 + RULES_PARENT)
  + (CP_READ_LIMIT.standings + RULES_PARENT)
  + (CP_READ_LIMIT.crest + RULES_PARENT)
  + STAFF;
const doneMax = ROOT
  + (CP_READ_LIMIT.standings + RULES_PARENT)
  + (CP_READ_LIMIT.crest + RULES_PARENT)
  + STAFF;
const fullMax = CP_READ_LIMIT.summary + RULES_PARENT;
// 當日摘要是單筆 get，不加父文件，所以比 liveMax 少父文件那 1 筆。職員另計。
/**
 * 詳情頁預算表
 * - 沿用 loadScheduleDetail（已登入的 getStaff 算在 STAFF）
 * - 登入 +1（自己的 staff）：getStaffAssignment。同一次開頁只讀一次
 * - 未登入不加
 */
const DETAIL_ASSIGNMENT = 1;
const liveExact = ROOT
  + 1
  + (CP_READ_LIMIT.standings + RULES_PARENT)
  + (CP_READ_LIMIT.crest + RULES_PARENT)
  + STAFF;

function standing(i: number): StandingDoc {
  return {
    id: `dv_${i}__group__A`,
    divisionId: `dv_${i}`,
    groupId: 'A',
    rows: [],
    version: 0,
    hasUnresolvedTie: false,
    manualOverride: null,
    ranking: null,
    updatedAt: null,
  };
}

/** 組別、報隊、積分、摘要都塞到上限（摘要多 1 片，確認截斷後仍是上限＋父文件）。 */
function repoFor(groups: number = CP_READ_LIMIT.divisions, todayExtra: readonly SummaryEntry[] = []): FakeCpRepo {
  const today = summaryShardIdOf(nowOf.live);
  const shards = [
    { id: today, entries: [summaryEntry('mt_today', nowOf.live), ...todayExtra] },
    ...Array.from({ length: CP_READ_LIMIT.summary }, (_, i) => ({
      id: `d202611${String(i).padStart(2, '0')}`,
      entries: [summaryEntry(`mt_extra_${i}`, i)],
    })),
  ];
  return createFakeCpRepo({
    launch: { isPublic: false, bannedWords: [] },
    testers: ['uid_member'],
    competitions: [competition({ id: 'cid_1', ...SCHEDULE_TIMES })],
    divisions: {
      cid_1: Array.from({ length: groups }, (_, i) => ({ ...division, dvId: `dv_${i}`, order: i })),
    },
    entries: { cid_1: Array.from({ length: CP_READ_LIMIT.crest }, (_, i) => entry(i)) },
    staff: { cid_1: [{ uid: 'uid_member', roles: ['host'] }] },
    summary: { cid_1: shards },
    standings: { cid_1: Array.from({ length: groups }, (_, i) => standing(i)) },
    matches: { cid_1: Array.from({ length: 120 }, (_, i) => match(`mt_pile_${i}`)) },
  });
}

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
});

afterEach(() => {
  cleanup();
});

describe('列表讀取預算', () => {
  it('維持原本的查詢，不讀賽程、摘要、積分榜、隊徽', async () => {
    const repo = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      competitions: [competition({ id: 'open_cup', name: '公開示範盃', hostType: 'personal', hostTeamId: null })],
    });
    render(
      <LocationProvider>
        <CpEnvProvider value={{ actor: memberActor, repo, actions: idleActions(), now: 150 }}>
          <InAppSection />
        </CpEnvProvider>
      </LocationProvider>,
    );
    await waitFor(() => expect(repo.calls()).toEqual(['getLaunch', 'listMine', 'listPublic']));
    expect(repo.calls().some((name) => NEW_READS.includes(name))).toBe(false);

    cleanup();
    const withClub = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      competitions: [competition({ id: 'open_cup', hostTeamId: 'club_a', visibility: 'public', status: 'draft' })],
    });
    const { rerender } = render(
      <LocationProvider>
        <CpEnvProvider value={{ actor: { ...memberActor, repClubs: [] }, repo: withClub, actions: idleActions(), now: 150 }}>
          <InAppSection />
        </CpEnvProvider>
      </LocationProvider>,
    );
    await waitFor(() => expect(withClub.calls()).toEqual(['getLaunch', 'listMine', 'listPublic']));
    expect(await screen.findByText('只看我的')).toBeTruthy();
    rerender(
      <LocationProvider>
        <CpEnvProvider value={{
          actor: { ...memberActor, repClubs: [{ id: 'club_a', name: '示範隊A' }] },
          repo: withClub,
          actions: idleActions(),
          now: 150,
        }}
        >
          <InAppSection />
        </CpEnvProvider>
      </LocationProvider>,
    );
    await waitFor(() => expect(withClub.calls()).toEqual(['getLaunch', 'listMine', 'listPublic', 'listByHostTeam']));
    expect(withClub.calls().some((name) => NEW_READS.includes(name))).toBe(false);
  });

  it('列表讀取＝改前查詢數＋畫面上進行中卡數；再出現不重讀', async () => {
    const now = nowOf.live;
    const live = (id: string, category: 'league' | 'cup'): CompetitionDoc => competition({
      id,
      name: id,
      category,
      hostType: 'personal',
      hostTeamId: null,
      ...SCHEDULE_TIMES,
    });
    const repo = createFakeCpRepo({
      launch: { isPublic: true, bannedWords: [] },
      competitions: [
        live('live_a', 'league'),
        live('live_b', 'cup'),
        competition({
          id: 'rec',
          name: '招募',
          hostType: 'personal',
          hostTeamId: null,
          regOpenAt: now - 1000,
          regCloseAt: now + 1000,
          firstMatchAt: now + 2000,
          lastMatchAt: now + 3000,
        }),
      ],
    });
    const env = { actor: memberActor, repo, actions: idleActions(), now };
    const { rerender } = render(
      <LocationProvider>
        <CpEnvProvider value={env}>
          <InAppSection tab="league" />
        </CpEnvProvider>
      </LocationProvider>,
    );
    await waitFor(() => expect(repo.calls()).toEqual(['getLaunch', 'listMine', 'listPublic', 'getSummaryShard']));
    expect(repo.calls().filter((name) => name === 'getSummaryShard')).toHaveLength(1);

    rerender(
      <LocationProvider>
        <CpEnvProvider value={env}>
          <InAppSection tab="all" />
        </CpEnvProvider>
      </LocationProvider>,
    );
    await waitFor(() => expect(repo.calls().filter((name) => name === 'getSummaryShard')).toHaveLength(2));
    expect(repo.calls()).toEqual([
      'getLaunch', 'listMine', 'listPublic', 'getSummaryShard', 'getSummaryShard',
    ]);
    expect(repo.calls()).toHaveLength(3 + 2);

    rerender(
      <LocationProvider>
        <CpEnvProvider value={env}>
          <InAppSection tab="league" />
        </CpEnvProvider>
      </LocationProvider>,
    );
    rerender(
      <LocationProvider>
        <CpEnvProvider value={env}>
          <InAppSection tab="all" />
        </CpEnvProvider>
      </LocationProvider>,
    );
    expect(repo.calls()).toHaveLength(3 + 2);
    for (const name of ['listSummary', 'listStandings', 'listMatches', 'listEntriesForCrest']) {
      expect(repo.calls()).not.toContain(name);
    }
  });
});

describe('詳情讀取預算', () => {
  it('招募塞滿組別與隊徽仍在上限內，已登入多讀職員，不讀摘要與積分', async () => {
    const repo = repoFor();
    const view = await loadScheduleDetail(repo, { cid: 'cid_1', uid: 'uid_member', now: nowOf.recruit });
    expect(view.phase).toBe('recruit');
    expect(view.staff).toEqual({ uid: 'uid_member', roles: ['host'] });
    expect(view.divisions).toHaveLength(CP_READ_LIMIT.divisions);
    expect(view.crests).toHaveLength(CP_READ_LIMIT.crest);
    expect(view.summary).toEqual([]);
    expect(view.standings).toEqual([]);
    expect(repo.calls()).toEqual(['getCompetition', 'listDivisions', 'listEntriesForCrest', 'getStaff']);
    for (const name of ['getSummaryShard', 'listSummary', 'listStandings', 'listMatches']) {
      expect(repo.calls(), name).not.toContain(name);
    }
    expect(repo.readCount()).toBe(recruitMax);
    expect(repo.readCount()).toBeLessThanOrEqual(recruitMax);

    const internal = repoFor();
    await loadScheduleDetail(internal, { cid: 'cid_1', uid: 'uid_member', now: nowOf.recruit, internal: true });
    expect(internal.calls().slice(0, 3)).toEqual(['getLaunch', 'getLaunchTester', 'listMine']);
    expect(internal.readCount()).toBe(recruitMax + INTERNAL);
    expect(internal.readCount()).toBeLessThanOrEqual(recruitMax + INTERNAL);
  });

  it('預熱另讀首場那天一片摘要，已登入多讀職員，不讀積分與摘要全集', async () => {
    const repo = repoFor();
    const view = await loadScheduleDetail(repo, { cid: 'cid_1', uid: 'uid_member', now: nowOf.warm });
    expect(view.phase).toBe('warm');
    expect(view.staff).toEqual({ uid: 'uid_member', roles: ['host'] });
    expect(view.divisions).toHaveLength(CP_READ_LIMIT.divisions);
    expect(view.crests).toHaveLength(CP_READ_LIMIT.crest);
    expect(view.standings).toEqual([]);
    expect(summaryShardIdOf(nowOf.warm)).toBe('d20261203');
    expect(summaryShardIdOf(SCHEDULE_TIMES.firstMatchAt)).toBe('d20261205');
    expect(view.summary.map((row) => row.id)).toEqual(['mt_today']);
    expect(repo.calls()).toEqual([
      'getCompetition', 'listDivisions', 'listEntriesForCrest', 'getStaff', 'getSummaryShard',
    ]);
    expect(repo.calls()).not.toContain('listSummary');
    expect(repo.calls()).not.toContain('listStandings');
    expect(repo.calls()).not.toContain('listMatches');
    expect(repo.readCount()).toBe(warmMax);
    expect(repo.readCount()).toBeLessThanOrEqual(warmMax);

    const internal = repoFor();
    await loadScheduleDetail(internal, { cid: 'cid_1', uid: 'uid_member', now: nowOf.warm, internal: true });
    expect(internal.calls().slice(0, 3)).toEqual(['getLaunch', 'getLaunchTester', 'listMine']);
    expect(internal.readCount()).toBe(warmMax + INTERNAL);
    expect(internal.readCount()).toBeLessThanOrEqual(warmMax + INTERNAL);
  });

  it('進行中只讀當日摘要、積分、隊徽與職員，不讀組別與摘要全集', async () => {
    const repo = repoFor();
    const view = await loadScheduleDetail(repo, { cid: 'cid_1', uid: 'uid_member', now: nowOf.live });
    expect(view.phase).toBe('live');
    expect(view.staff).toEqual({ uid: 'uid_member', roles: ['host'] });
    expect(summaryShardIdOf(nowOf.live)).toBe('d20261205');
    expect(view.divisions).toEqual([]);
    expect(view.summary.map((row) => row.id)).toEqual(['mt_today']);
    expect(view.standings).toHaveLength(CP_READ_LIMIT.standings);
    expect(view.crests).toHaveLength(CP_READ_LIMIT.crest);
    expect(repo.calls()).toEqual([
      'getCompetition', 'getSummaryShard', 'listStandings', 'listEntriesForCrest', 'getStaff',
    ]);
    expect(repo.calls()).not.toContain('listDivisions');
    expect(repo.calls()).not.toContain('listSummary');
    expect(repo.calls()).not.toContain('listMatches');
    // 公式上限含當日片的父文件 (1+1)。單筆 get 不加，塞滿後少 1，仍不超過上限。
    expect(liveExact).toBeLessThanOrEqual(liveMax);
    expect(repo.readCount()).toBe(liveExact);
    expect(repo.readCount()).toBeLessThanOrEqual(liveMax);

    const internal = repoFor();
    await loadScheduleDetail(internal, { cid: 'cid_1', uid: 'uid_member', now: nowOf.live, internal: true });
    expect(internal.calls().slice(0, 3)).toEqual(['getLaunch', 'getLaunchTester', 'listMine']);
    expect(internal.readCount()).toBe(liveExact + INTERNAL);
    expect(internal.readCount()).toBeLessThanOrEqual(liveMax + INTERNAL);
  });

  it('已結束不讀摘要，塞滿積分、隊徽與職員仍在上限內', async () => {
    const repo = repoFor();
    const view = await loadScheduleDetail(repo, { cid: 'cid_1', uid: 'uid_member', now: nowOf.done });
    expect(view.phase).toBe('done');
    expect(view.staff).toEqual({ uid: 'uid_member', roles: ['host'] });
    expect(view.divisions).toEqual([]);
    expect(view.summary).toEqual([]);
    expect(view.standings).toHaveLength(CP_READ_LIMIT.standings);
    expect(view.crests).toHaveLength(CP_READ_LIMIT.crest);
    expect(repo.calls()).toEqual(['getCompetition', 'listStandings', 'listEntriesForCrest', 'getStaff']);
    for (const name of ['getSummaryShard', 'listSummary', 'listDivisions', 'listMatches']) {
      expect(repo.calls(), name).not.toContain(name);
    }
    expect(repo.readCount()).toBe(doneMax);
    expect(repo.readCount()).toBeLessThanOrEqual(doneMax);

    const internal = repoFor();
    await loadScheduleDetail(internal, { cid: 'cid_1', uid: 'uid_member', now: nowOf.done, internal: true });
    expect(internal.readCount()).toBe(doneMax + INTERNAL);
    expect(internal.readCount()).toBeLessThanOrEqual(doneMax + INTERNAL);
  });

  it('未登入不讀職員', async () => {
    for (const phase of ['recruit', 'warm', 'live', 'done'] as const) {
      const signedIn = repoFor();
      const guest = repoFor();
      const member = await loadScheduleDetail(signedIn, { cid: 'cid_1', uid: 'uid_member', now: nowOf[phase] });
      const anon = await loadScheduleDetail(guest, { cid: 'cid_1', uid: null, now: nowOf[phase] });
      expect(member.staff, phase).toEqual({ uid: 'uid_member', roles: ['host'] });
      expect(anon.staff, phase).toBeNull();
      expect(signedIn.calls(), phase).toContain('getStaff');
      expect(guest.calls(), phase).not.toContain('getStaff');
      expect(signedIn.readCount(), phase).toBe(guest.readCount() + STAFF);
      if (phase === 'warm') {
        expect(guest.calls()).toContain('getSummaryShard');
        expect(anon.summary.map((row) => row.id)).toEqual(['mt_today']);
      }
    }
  });

  // 顧問 §3.269：上限隨組別數變動，至少測 1、4、8 組三點（每組一份積分、一次性讀取）
  for (const groups of [1, 4, 8]) {
    it(`組別 ${groups} 組：各階段讀取 ≤ 依組別數算出的上限，內部期再 +3`, async () => {
      const crest = CP_READ_LIMIT.crest + RULES_PARENT;
      const limits = {
        warm: ROOT + (groups + RULES_PARENT) + crest + STAFF + WARM_SHARD,
        live: ROOT + (1 + RULES_PARENT) + (groups + RULES_PARENT) + crest + STAFF,
        done: ROOT + (groups + RULES_PARENT) + crest + STAFF,
      } as const;
      for (const phase of ['warm', 'live', 'done'] as const) {
        for (const internal of [false, true]) {
          const repo = repoFor(groups);
          await loadScheduleDetail(repo, { cid: 'cid_1', uid: 'uid_member', now: nowOf[phase], internal });
          expect(repo.readCount(), `${groups} 組 ${phase}${internal ? ' 內部期' : ''}`).toBeLessThanOrEqual(limits[phase] + (internal ? INTERNAL : 0));
        }
      }
      expect(groups).toBeLessThanOrEqual(CP_READ_LIMIT.divisions);
    });
  }

  it('全部賽程只讀摘要片，片數到上限仍是片數＋1', async () => {
    const repo = repoFor();
    const rows = await loadFullSchedule(repo, 'cid_1');
    expect(repo.calls()).toEqual(['listSummary']);
    expect(rows).toHaveLength(CP_READ_LIMIT.summary);
    expect(rows.some((row) => row.id === 'mt_today')).toBe(true);
    expect(repo.readCount()).toBe(fullMax);
    expect(repo.readCount()).toBeLessThanOrEqual(fullMax);
  });

  it('台北跨日時摘要片用比賽日，00:00～04:59 歸前一天', () => {
    expect(summaryShardIdOf(Date.parse('2026-12-05T00:30:00+08:00'))).toBe('d20261204');
    expect(summaryShardIdOf(Date.parse('2026-12-04T23:30:00+08:00'))).toBe('d20261204');
    expect(summaryShardIdOf(Date.parse('2026-12-05T05:00:00+08:00'))).toBe('d20261205');
  });

  it('01:30 開賽的場次讀前一天的摘要片', async () => {
    const kick = Date.parse('2026-12-05T01:30:00+08:00');
    expect(summaryShardIdOf(kick)).toBe(matchDayOf(kick).shardId);
    expect(summaryShardIdOf(kick)).toBe('d20261204');
    const warm = createFakeCpRepo({
      competitions: [competition({
        id: 'cid_1',
        ...SCHEDULE_TIMES,
        firstMatchAt: kick,
        lastMatchAt: Date.parse('2026-12-06T18:00:00+08:00'),
      })],
      summary: {
        cid_1: [
          { id: 'd20261204', entries: [summaryEntry('mt_early', kick)] },
          { id: 'd20261205', entries: [summaryEntry('mt_wrong', kick)] },
        ],
      },
    });
    const warmed = await loadScheduleDetail(warm, {
      cid: 'cid_1',
      uid: null,
      now: Date.parse('2026-12-04T12:00:00+08:00'),
    });
    expect(warmed.phase).toBe('warm');
    expect(warmed.summary.map((row) => row.id)).toEqual(['mt_early']);

    const liveNow = kick;
    const live = createFakeCpRepo({
      competitions: [competition({
        id: 'cid_1',
        ...SCHEDULE_TIMES,
        firstMatchAt: Date.parse('2026-12-04T09:00:00+08:00'),
      })],
      summary: {
        cid_1: [
          { id: 'd20261204', entries: [summaryEntry('mt_night', liveNow)] },
          { id: 'd20261205', entries: [summaryEntry('mt_wrong', liveNow)] },
        ],
      },
    });
    const going = await loadScheduleDetail(live, { cid: 'cid_1', uid: null, now: liveNow });
    expect(going.phase).toBe('live');
    expect(summaryShardIdOf(liveNow)).toBe('d20261204');
    expect(going.summary.map((row) => row.id)).toEqual(['mt_night']);
  });

  it('詳情頁用同一組讀取，不呼叫 listMatches 或 listEntries', async () => {
    const recruit = repoFor(8);
    render(
      <LocationProvider>
        <CpEnvProvider value={{ actor: memberActor, repo: recruit, actions: idleActions(), now: nowOf.recruit, route: { cid: 'cid_1' } }}>
          <CompetitionDetailPage />
        </CpEnvProvider>
      </LocationProvider>,
    );
    await waitFor(() => expect(recruit.calls()).toEqual([
      'getCompetition', 'listDivisions', 'listEntriesForCrest', 'getStaff', 'getStaffAssignment',
    ]));
    expect(recruit.readCount()).toBeLessThanOrEqual(recruitMax + DETAIL_ASSIGNMENT);
    expect(recruit.calls()).not.toContain('listSummary');
    expect(recruit.calls()).not.toContain('getSummaryShard');
    expect(recruit.calls()).not.toContain('listMatches');
    expect(recruit.calls()).not.toContain('listEntries');
    expect(screen.getAllByText('招募中').length).toBeGreaterThan(0);

    cleanup();
    const live = repoFor(8);
    render(
      <LocationProvider>
        <CpEnvProvider value={{ actor: memberActor, repo: live, actions: idleActions(), now: nowOf.live, route: { cid: 'cid_1' } }}>
          <CompetitionDetailPage />
        </CpEnvProvider>
      </LocationProvider>,
    );
    await waitFor(() => expect(live.calls()).toEqual([
      'getCompetition', 'getSummaryShard', 'listStandings', 'listEntriesForCrest', 'getStaff', 'getStaffAssignment',
    ]));
    expect(live.readCount()).toBeLessThanOrEqual(liveMax + DETAIL_ASSIGNMENT);
    expect(live.calls()).not.toContain('listSummary');
    expect(live.calls()).not.toContain('listMatches');
    expect(live.calls()).not.toContain('listEntries');
    expect(await screen.findByText('進行中')).toBeTruthy();
  });

  it('摘要有已取消場次時詳情頁讀取數不變、不呼叫 listMatches', async () => {
    const liveCalls = [
      'getCompetition', 'getSummaryShard', 'listStandings', 'listEntriesForCrest', 'getStaff', 'getStaffAssignment',
    ];
    const plain = repoFor(8);
    render(
      <LocationProvider>
        <CpEnvProvider value={{ actor: memberActor, repo: plain, actions: idleActions(), now: nowOf.live, route: { cid: 'cid_1' } }}>
          <CompetitionDetailPage />
        </CpEnvProvider>
      </LocationProvider>,
    );
    await waitFor(() => expect(plain.calls()).toEqual(liveCalls));
    const baseline = plain.readCount();
    cleanup();

    const cancelled = repoFor(8, [
      { ...summaryEntry('mt_off', nowOf.live), st: 'cancelled', cr: '大雨停賽' },
      { ...summaryEntry('mt_bare', nowOf.live), st: 'cancelled' },
    ]);
    const view = render(
      <LocationProvider>
        <CpEnvProvider value={{ actor: memberActor, repo: cancelled, actions: idleActions(), now: nowOf.live, route: { cid: 'cid_1' } }}>
          <CompetitionDetailPage />
        </CpEnvProvider>
      </LocationProvider>,
    );
    await waitFor(() => expect(view.container.textContent ?? '').toContain('大雨停賽'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(cancelled.calls()).toEqual(liveCalls);
    expect(cancelled.readCount()).toBe(baseline);
    expect(cancelled.calls()).not.toContain('listMatches');

    const beforeFull = cancelled.readCount();
    fireEvent.click(screen.getByRole('button', { name: '全部賽程' }));
    await waitFor(() => expect(view.container.textContent ?? '').toContain('1月1日'));
    expect(cancelled.calls().filter((name) => name === 'listSummary')).toHaveLength(1);
    expect(cancelled.calls()).not.toContain('listMatches');
    expect(cancelled.readCount()).toBe(beforeFull + CP_READ_LIMIT.summary + RULES_PARENT);
    expect(view.container.textContent ?? '').toContain('大雨停賽');
  });

  it('全部賽程沿用摘要 cr，不另讀場次', async () => {
    const repo = createFakeCpRepo({
      summary: {
        cid_1: [{
          id: 'd20261205',
          entries: [{ ...summaryEntry('mt_off', nowOf.live), st: 'cancelled', cr: '大雨停賽' }],
        }],
      },
    });
    const rows = await loadFullSchedule(repo, 'cid_1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cr).toBe('大雨停賽');
    expect(rows[0]?.st).toBe('cancelled');
    expect(repo.calls()).toEqual(['listSummary']);
    expect(repo.calls()).not.toContain('listMatches');
  });

  it('全部賽程按鈕只讀一次', async () => {
    for (const phase of ['warm', 'live'] as const) {
      const repo = repoFor();
      const view = render(
        <LocationProvider>
          <CpEnvProvider value={{ actor: memberActor, repo, actions: idleActions(), now: nowOf[phase], route: { cid: 'cid_1' } }}>
            <CompetitionDetailPage />
          </CpEnvProvider>
        </LocationProvider>,
      );
      const button = await screen.findByRole('button', { name: '全部賽程' });
      expect(repo.calls(), phase).not.toContain('listSummary');
      expect(view.container.textContent ?? '', phase).not.toContain('1月1日');
      fireEvent.click(button);
      fireEvent.click(button);
      await waitFor(() => expect(view.container.textContent ?? '').toContain('1月1日'));
      expect(repo.calls().filter((name) => name === 'listSummary'), phase).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: '全部賽程' }));
      expect(repo.calls().filter((name) => name === 'listSummary'), phase).toHaveLength(1);
      expect(repo.calls(), phase).not.toContain('listMatches');
      cleanup();
    }
  });

  it('已結束展開才讀', async () => {
    const repo = repoFor();
    const view = render(
      <LocationProvider>
        <CpEnvProvider value={{ actor: memberActor, repo, actions: idleActions(), now: nowOf.done, route: { cid: 'cid_1' } }}>
          <CompetitionDetailPage />
        </CpEnvProvider>
      </LocationProvider>,
    );
    const fold = await screen.findByRole('button', { name: /^賽程$/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(repo.calls()).not.toContain('listSummary');
    expect(view.container.textContent ?? '').not.toContain('1月1日');
    fireEvent.click(fold);
    await waitFor(() => expect(screen.getByRole('button', { name: `賽程（${CP_READ_LIMIT.summary} 場）` })).toBeTruthy());
    expect(repo.calls().filter((name) => name === 'listSummary')).toHaveLength(1);
    expect(view.container.textContent ?? '').toContain('1月1日');
    const opened = screen.getByRole('button', { name: `賽程（${CP_READ_LIMIT.summary} 場）` });
    expect(opened.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(opened);
    fireEvent.click(screen.getByRole('button', { name: `賽程（${CP_READ_LIMIT.summary} 場）` }));
    expect(repo.calls().filter((name) => name === 'listSummary')).toHaveLength(1);
    expect(repo.calls()).not.toContain('listMatches');
  });

  it('沒有這場賽事就停，內部期仍只多那 3 筆', async () => {
    const repo = repoFor();
    const view = await loadScheduleDetail(repo, { cid: 'missing', uid: 'uid_member', now: nowOf.recruit });
    expect(view.competition).toBeNull();
    expect(view.phase).toBeNull();
    expect(view.divisions).toEqual([]);
    expect(view.summary).toEqual([]);
    expect(view.standings).toEqual([]);
    expect(repo.calls()).toEqual(['getCompetition']);
    expect(repo.readCount()).toBe(1);

    const internal = repoFor();
    await loadScheduleDetail(internal, { cid: 'missing', uid: 'uid_member', now: nowOf.recruit, internal: true });
    expect(internal.calls()).toEqual(['getLaunch', 'getLaunchTester', 'listMine', 'getCompetition']);
    expect(internal.readCount()).toBe(1 + INTERNAL);
  });
});
