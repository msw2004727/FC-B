import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { InAppSection } from '../components/InAppSection';
import { CpEnvProvider } from '../env';
import { loadCompetitionsDict } from '../i18n';
import { createFakeCpRepo, type FakeCpRepo } from '../testing/fake-cp-repo';
import { idleActions, memberActor } from '../testing/screen-fixtures';
import { loadScheduleDetail } from './schedule-load';
import { CP_READ_LIMIT, type CompetitionDoc, type DivisionDoc, type EntryDoc, type MatchDoc, type SummaryEntry } from './types';

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

function repoFor(teams: number, shards: number): FakeCpRepo {
  return createFakeCpRepo({
    launch: { isPublic: false, bannedWords: [] },
    testers: ['uid_member'],
    competitions: [competition({ id: 'cid_1' })],
    divisions: { cid_1: [division] },
    entries: { cid_1: Array.from({ length: teams }, (_, i) => entry(i)) },
    staff: { cid_1: [{ uid: 'uid_member', roles: ['host'] }] },
    summary: {
      cid_1: Array.from({ length: shards }, (_, i) => ({
        id: `d2026120${i}`,
        entries: [summaryEntry(`mt_${i}`, 300 + i)],
      })),
    },
    standings: {
      cid_1: [{
        id: 'dv_1__group__A',
        divisionId: 'dv_1',
        groupId: 'A',
        rows: [],
        version: 0,
        hasUnresolvedTie: false,
        manualOverride: false,
        updatedAt: null,
      }],
    },
    matches: { cid_1: Array.from({ length: 120 }, (_, i) => match(`mt_extra_${i}`)) },
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
  const nowOf = { recruit: 150, warm: 250, live: 350, done: 450 } as const;

  it('招募與預熱 ≤ 39，內部期剛好多 3，不讀場次與積分榜', async () => {
    for (const phase of ['recruit', 'warm'] as const) {
      const repo = repoFor(8, 1);
      const view = await loadScheduleDetail(repo, { cid: 'cid_1', uid: 'uid_member', now: nowOf[phase] });
      expect(view.phase).toBe(phase);
      expect(view.standings).toEqual([]);
      expect(view.crests).toHaveLength(8);
      expect(repo.calls()).toEqual([
        'getCompetition', 'listDivisions', 'listEntriesForCrest', 'getStaff', 'listSummary',
      ]);
      const base = repo.readCount();
      expect(base).toBeLessThanOrEqual(39);

      const internal = repoFor(8, 1);
      await loadScheduleDetail(internal, { cid: 'cid_1', uid: 'uid_member', now: nowOf[phase], internal: true });
      expect(internal.readCount()).toBe(base + 3);
      expect(internal.readCount()).toBeLessThanOrEqual(39 + 3);
      expect(internal.calls().slice(0, 3)).toEqual(['getLaunch', 'getLaunchTester', 'listMine']);
      expect(internal.calls()).not.toContain('listMatches');
      expect(internal.calls()).not.toContain('listStandings');
    }
  });

  it('進行中與已結束 ≤ 41，內部期剛好多 3，仍不讀場次全集', async () => {
    for (const phase of ['live', 'done'] as const) {
      const repo = repoFor(8, 1);
      const view = await loadScheduleDetail(repo, { cid: 'cid_1', uid: 'uid_member', now: nowOf[phase] });
      expect(view.phase).toBe(phase);
      expect(view.standings).toHaveLength(1);
      expect(repo.calls()).toEqual([
        'getCompetition', 'listDivisions', 'listEntriesForCrest', 'getStaff', 'listSummary', 'listStandings',
      ]);
      const base = repo.readCount();
      expect(base).toBeLessThanOrEqual(41);
      expect(repo.calls()).not.toContain('listMatches');

      const internal = repoFor(8, 1);
      await loadScheduleDetail(internal, { cid: 'cid_1', uid: 'uid_member', now: nowOf[phase], internal: true });
      expect(internal.readCount()).toBe(base + 3);
      expect(internal.readCount()).toBeLessThanOrEqual(41 + 3);
    }
  });

  it('隊徽頂到上限、摘要四片時招募仍 ≤ 39；16 隊場次放著也不讀', async () => {
    const repo = repoFor(CP_READ_LIMIT.crest, 4);
    await loadScheduleDetail(repo, { cid: 'cid_1', uid: 'uid_member', now: 150 });
    expect(repo.readCount()).toBeLessThanOrEqual(39);
    expect(repo.calls()).not.toContain('listMatches');

    const live = repoFor(CP_READ_LIMIT.crest, 4);
    await loadScheduleDetail(live, { cid: 'cid_1', uid: 'uid_member', now: 350 });
    expect(live.readCount()).toBeLessThanOrEqual(41);
    expect(live.calls()).not.toContain('listMatches');

    // 內部期在上限情境也要 ≤ 基準 +3（Flash 初審 P3）
    const recruitIn = repoFor(CP_READ_LIMIT.crest, 4);
    await loadScheduleDetail(recruitIn, { cid: 'cid_1', uid: 'uid_member', now: 150, internal: true });
    expect(recruitIn.readCount()).toBeLessThanOrEqual(39 + 3);
    const liveIn = repoFor(CP_READ_LIMIT.crest, 4);
    await loadScheduleDetail(liveIn, { cid: 'cid_1', uid: 'uid_member', now: 350, internal: true });
    expect(liveIn.readCount()).toBeLessThanOrEqual(41 + 3);
  });

  it('沒有這場賽事就停，內部期仍只多那 3 筆', async () => {
    const repo = repoFor(8, 1);
    const view = await loadScheduleDetail(repo, { cid: 'missing', uid: 'uid_member', now: 150 });
    expect(view.competition).toBeNull();
    expect(view.phase).toBeNull();
    expect(repo.calls()).toEqual(['getCompetition']);
    expect(repo.readCount()).toBe(1);

    const internal = repoFor(8, 1);
    await loadScheduleDetail(internal, { cid: 'missing', uid: 'uid_member', now: 150, internal: true });
    expect(internal.calls()).toEqual(['getLaunch', 'getLaunchTester', 'listMine', 'getCompetition']);
    expect(internal.readCount()).toBe(4);
  });
});
