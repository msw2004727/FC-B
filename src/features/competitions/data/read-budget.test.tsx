import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InAppSection } from '../components/InAppSection';
import { CpEnvProvider } from '../env';
import { loadCompetitionsDict } from '../i18n';
import { createFakeCpRepo, type FakeCpRepo } from '../testing/fake-cp-repo';
import { idleActions, memberActor } from '../testing/screen-fixtures';
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
    rostersLockedAt: null,
    ageBasisAt: null,
    timezone: 'Asia/Taipei',
    venues: [],
    feeNote: null,
    liveLinks: [],
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
const recruitMax = ROOT
  + (CP_READ_LIMIT.divisions + RULES_PARENT)
  + (CP_READ_LIMIT.crest + RULES_PARENT);
const liveMax = ROOT
  + (1 + RULES_PARENT)
  + (CP_READ_LIMIT.standings + RULES_PARENT)
  + (CP_READ_LIMIT.crest + RULES_PARENT);
const doneMax = ROOT
  + (CP_READ_LIMIT.standings + RULES_PARENT)
  + (CP_READ_LIMIT.crest + RULES_PARENT);
const fullMax = CP_READ_LIMIT.summary + RULES_PARENT;
// 當日摘要是單筆 get，不加父文件，所以比 liveMax 少 1。
const liveExact = ROOT
  + 1
  + (CP_READ_LIMIT.standings + RULES_PARENT)
  + (CP_READ_LIMIT.crest + RULES_PARENT);

function standing(i: number): StandingDoc {
  return {
    id: `dv_${i}__group__A`,
    divisionId: `dv_${i}`,
    groupId: 'A',
    rows: [],
    version: 0,
    hasUnresolvedTie: false,
    manualOverride: false,
    updatedAt: null,
  };
}

/** 組別、報隊、積分、摘要都塞到上限（摘要多 1 片，確認截斷後仍是上限＋父文件）。 */
function repoFor(groups: number = CP_READ_LIMIT.divisions): FakeCpRepo {
  const today = summaryShardIdOf(nowOf.live);
  const shards = [
    { id: today, entries: [summaryEntry('mt_today', nowOf.live)] },
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
    expect(await screen.findByText('站內賽事')).toBeTruthy();
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
});

describe('詳情讀取預算', () => {
  it('招募與預熱塞滿組別與隊徽仍在上限內，不讀摘要、積分、職員', async () => {
    for (const phase of ['recruit', 'warm'] as const) {
      const repo = repoFor();
      const view = await loadScheduleDetail(repo, { cid: 'cid_1', uid: 'uid_member', now: nowOf[phase] });
      expect(view.phase).toBe(phase);
      expect(view.divisions).toHaveLength(CP_READ_LIMIT.divisions);
      expect(view.crests).toHaveLength(CP_READ_LIMIT.crest);
      expect(view.summary).toEqual([]);
      expect(view.standings).toEqual([]);
      expect(repo.calls()).toEqual(['getCompetition', 'listDivisions', 'listEntriesForCrest']);
      for (const name of ['getSummaryShard', 'listSummary', 'listStandings', 'getStaff', 'listMatches']) {
        expect(repo.calls(), name).not.toContain(name);
      }
      expect(repo.readCount()).toBe(recruitMax);
      expect(repo.readCount()).toBeLessThanOrEqual(recruitMax);

      const internal = repoFor();
      await loadScheduleDetail(internal, { cid: 'cid_1', uid: 'uid_member', now: nowOf[phase], internal: true });
      expect(internal.calls().slice(0, 3)).toEqual(['getLaunch', 'getLaunchTester', 'listMine']);
      expect(internal.readCount()).toBe(recruitMax + INTERNAL);
      expect(internal.readCount()).toBeLessThanOrEqual(recruitMax + INTERNAL);
    }
  });

  it('進行中只讀當日摘要、積分、隊徽，不讀組別與摘要全集', async () => {
    const repo = repoFor();
    const view = await loadScheduleDetail(repo, { cid: 'cid_1', uid: 'uid_member', now: nowOf.live });
    expect(view.phase).toBe('live');
    expect(summaryShardIdOf(nowOf.live)).toBe('d20261205');
    expect(view.divisions).toEqual([]);
    expect(view.summary.map((row) => row.id)).toEqual(['mt_today']);
    expect(view.standings).toHaveLength(CP_READ_LIMIT.standings);
    expect(view.crests).toHaveLength(CP_READ_LIMIT.crest);
    expect(repo.calls()).toEqual([
      'getCompetition', 'getSummaryShard', 'listStandings', 'listEntriesForCrest',
    ]);
    expect(repo.calls()).not.toContain('listDivisions');
    expect(repo.calls()).not.toContain('listSummary');
    expect(repo.calls()).not.toContain('getStaff');
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

  it('已結束不讀摘要，塞滿積分與隊徽仍在上限內', async () => {
    const repo = repoFor();
    const view = await loadScheduleDetail(repo, { cid: 'cid_1', uid: 'uid_member', now: nowOf.done });
    expect(view.phase).toBe('done');
    expect(view.divisions).toEqual([]);
    expect(view.summary).toEqual([]);
    expect(view.standings).toHaveLength(CP_READ_LIMIT.standings);
    expect(view.crests).toHaveLength(CP_READ_LIMIT.crest);
    expect(repo.calls()).toEqual(['getCompetition', 'listStandings', 'listEntriesForCrest']);
    for (const name of ['getSummaryShard', 'listSummary', 'listDivisions', 'getStaff', 'listMatches']) {
      expect(repo.calls(), name).not.toContain(name);
    }
    expect(repo.readCount()).toBe(doneMax);
    expect(repo.readCount()).toBeLessThanOrEqual(doneMax);

    const internal = repoFor();
    await loadScheduleDetail(internal, { cid: 'cid_1', uid: 'uid_member', now: nowOf.done, internal: true });
    expect(internal.readCount()).toBe(doneMax + INTERNAL);
    expect(internal.readCount()).toBeLessThanOrEqual(doneMax + INTERNAL);
  });

  // 顧問 §3.269：上限隨組別數變動，至少測 1、4、8 組三點（每組一份積分、一次性讀取）
  for (const groups of [1, 4, 8]) {
    it(`組別 ${groups} 組：各階段讀取 ≤ 依組別數算出的上限，內部期再 +3`, async () => {
      const crest = CP_READ_LIMIT.crest + 1;
      const limits = {
        warm: 1 + (groups + 1) + crest,
        live: 1 + (1 + 1) + (groups + 1) + crest,
        done: 1 + (groups + 1) + crest,
      } as const;
      for (const phase of ['warm', 'live', 'done'] as const) {
        for (const internal of [false, true]) {
          const repo = repoFor(groups);
          await loadScheduleDetail(repo, { cid: 'cid_1', uid: 'uid_member', now: nowOf[phase], internal });
          expect(repo.readCount(), `${groups} 組 ${phase}${internal ? ' 內部期' : ''}`).toBeLessThanOrEqual(limits[phase] + (internal ? 3 : 0));
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

  it('台北跨日時摘要片用台北日期', () => {
    expect(summaryShardIdOf(Date.parse('2026-12-05T00:30:00+08:00'))).toBe('d20261205');
    expect(summaryShardIdOf(Date.parse('2026-12-04T23:30:00+08:00'))).toBe('d20261204');
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
