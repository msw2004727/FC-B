import { describe, expect, it } from 'vitest';
import { CP_READ_LIMIT, type CompetitionDoc, type DivisionDoc } from '../data/types';
import { createFakeCpRepo } from './fake-cp-repo';

function comp(partial: Partial<CompetitionDoc> & Pick<CompetitionDoc, 'id'>): CompetitionDoc {
  return {
    name: '春季賽',
    sport: 'football',
    hostType: 'club',
    hostTeamId: 'team_1',
    hostDisplay: null,
    visibility: 'public',
    status: 'published',
    statusReason: null,
    hidden: false,
    regOpenAt: 1,
    regCloseAt: 2,
    firstMatchAt: 3,
    lastMatchAt: 4,
    endedAt: null,
    rostersLockedAt: null,
    ageBasisAt: null,
    timezone: 'Asia/Taipei',
    venues: [],
    feeNote: null,
    liveLinks: [],
    stateVersion: 1,
    ...partial,
  };
}

function division(dvId: string, order: number): DivisionDoc {
  return {
    dvId,
    name: dvId,
    playersOnField: 7,
    maxTeams: 8,
    rosterMin: 5,
    rosterMax: 11,
    minAge: null,
    maxAge: null,
    requireRealName: false,
    feePerTeam: 0,
    entryCount: 0,
    approvedCount: 0,
    order,
  };
}

describe('createFakeCpRepo', () => {
  it('公開列表排除草稿、隱藏、非公開，並截到 30', async () => {
    const competitions = [
      comp({ id: 'cid_draft', status: 'draft' }),
      comp({ id: 'cid_hidden', hidden: true }),
      comp({ id: 'cid_private', visibility: 'unlisted' }),
      ...Array.from({ length: 31 }, (_, i) => comp({ id: `cid_${i}` })),
    ];
    const repo = createFakeCpRepo({ competitions });
    const rows = await repo.listPublic();
    expect(rows).toHaveLength(CP_READ_LIMIT.publicList);
    expect(rows.some((row) => row.status === 'draft' || row.hidden || row.visibility !== 'public')).toBe(false);
    expect(rows[0]?.id).toBe('cid_0');
  });

  it('includeInternal 才列出非公開，草稿仍然排除', async () => {
    const repo = createFakeCpRepo({
      competitions: [
        comp({ id: 'cid_pub' }),
        comp({ id: 'cid_inner', visibility: 'internal' }),
        comp({ id: 'cid_draft', status: 'draft', visibility: 'internal' }),
      ],
    });
    await expect(repo.listPublic().then((rows) => rows.map((row) => row.id))).resolves.toEqual(['cid_pub']);
    await expect(repo.listPublic(true).then((rows) => rows.map((row) => row.id))).resolves.toEqual(['cid_pub', 'cid_inner']);
  });

  it('主辦俱樂部：publicOnly 才要求公開，上限 50；找不到回 null', async () => {
    const published = comp({ id: 'cid_pub', hostTeamId: 'team_1', visibility: 'public' });
    const unlisted = comp({ id: 'cid_draft_team', hostTeamId: 'team_1', visibility: 'unlisted', status: 'draft' });
    const competitions = [
      published,
      unlisted,
      comp({ id: 'cid_other', hostTeamId: 'team_2' }),
      ...Array.from({ length: 50 }, (_, i) => comp({ id: `extra_${i}`, hostTeamId: 'team_9' })),
    ];
    const repo = createFakeCpRepo({ competitions });
    await expect(repo.listByHostTeam('team_1', true)).resolves.toEqual([published]);
    await expect(repo.listByHostTeam('team_1', false)).resolves.toEqual([published, unlisted]);
    const many = await repo.listByHostTeam('team_9', false);
    expect(many).toHaveLength(CP_READ_LIMIT.hostTeam);
    await expect(repo.getCompetition('missing')).resolves.toBeNull();
    await expect(repo.getCompetition('a/b')).resolves.toBeNull();
  });

  it('組別先依 order 再截 8；報名截 100；名單依 enId 截 60', async () => {
    const divisions = ['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h', 'i'].map((id, index) =>
      division(id, index === 1 ? 0 : index));
    const entries = Array.from({ length: 101 }, (_, i) => ({
      id: `en_${i}`,
      dvId: 'a',
      teamId: 'team_1',
      name: `隊${i}`,
      status: 'pending' as const,
      rosterCount: 0,
      rosterConfirmed: false,
    }));
    const roster = [
      ...Array.from({ length: 61 }, (_, i) => ({
        id: `pl_${i}`,
        enId: 'en_1',
        displayName: '王',
        number: i,
        position: null,
        positionText: null,
        isMinor: false,
      })),
      {
        id: 'pl_other',
        enId: 'en_2',
        displayName: '林',
        number: 1,
        position: null,
        positionText: null,
        isMinor: false,
      },
    ];
    const repo = createFakeCpRepo({
      divisions: { cid_1: divisions },
      entries: { cid_1: entries },
      roster: { cid_1: roster },
    });
    const divs = await repo.listDivisions('cid_1');
    expect(divs).toHaveLength(CP_READ_LIMIT.divisions);
    expect(divs.map((row) => row.dvId)).toEqual(['a', 'c', 'b', 'd', 'e', 'f', 'g', 'h']);
    await expect(repo.listEntries('cid_1')).resolves.toHaveLength(CP_READ_LIMIT.entries);
    const players = await repo.listRoster('cid_1', 'en_1');
    expect(players).toHaveLength(CP_READ_LIMIT.roster);
    expect(players.every((row) => row.enId === 'en_1')).toBe(true);
  });

  it('私密讀取有篩選與無篩選都截 100；我的賽事截 50', async () => {
    const entryPrivate = Array.from({ length: 101 }, (_, i) => ({
      id: `en_${i}`,
      teamId: i < 2 ? 'team_1' : 'team_2',
      contactName: null,
      contactPhone: null,
      paymentStatus: 'none' as const,
      reviewNote: null,
    }));
    const rosterPrivate = Array.from({ length: 101 }, (_, i) => ({
      id: `pl_${i}`,
      uid: i === 0 ? 'uid_me' : 'uid_other',
    }));
    const mine = Array.from({ length: 51 }, (_, i) => ({
      id: `cid_${i}`,
      cid: `cid_${i}`,
      roles: ['player' as const],
      host: false,
    }));
    const repo = createFakeCpRepo({
      entryPrivate: { cid_1: entryPrivate },
      rosterPrivate: { cid_1: rosterPrivate },
      mine: { uid_me: mine },
      launch: { isPublic: false, bannedWords: [] },
      testers: ['uid_me'],
      staff: { cid_1: [{ uid: 'uid_me', roles: ['host'] }] },
    });
    await expect(repo.listEntryPrivate('cid_1', 'team_1')).resolves.toHaveLength(2);
    await expect(repo.listEntryPrivate('cid_1', null)).resolves.toHaveLength(CP_READ_LIMIT.private);
    await expect(repo.listRosterPrivate('cid_1', 'uid_me')).resolves.toEqual([{ id: 'pl_0', uid: 'uid_me' }]);
    await expect(repo.listRosterPrivate('cid_1', null)).resolves.toHaveLength(CP_READ_LIMIT.private);
    await expect(repo.listMine('uid_me')).resolves.toHaveLength(CP_READ_LIMIT.mine);
    await expect(repo.getLaunch()).resolves.toEqual({ isPublic: false, bannedWords: [] });
    await expect(repo.getLaunchTester('uid_me')).resolves.toBe(true);
    await expect(repo.getLaunchTester('uid_no')).resolves.toBe(false);
    await expect(repo.getStaff('cid_1', 'uid_me')).resolves.toEqual({ uid: 'uid_me', roles: ['host'] });
    await expect(repo.getStaff('cid_1', 'uid_no')).resolves.toBeNull();
  });

  it('回傳物件沒有 hostUid', async () => {
    const repo = createFakeCpRepo({ competitions: [comp({ id: 'cid_1' })] });
    const doc = await repo.getCompetition('cid_1');
    expect(doc && 'hostUid' in doc).toBe(false);
  });
});
