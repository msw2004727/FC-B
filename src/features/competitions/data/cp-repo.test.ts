import { describe, expect, it } from 'vitest';
import { CP_READ_LIMIT, type CompetitionDoc } from './types';
import {
  competitionFromDoc,
  createCompetitionsRepo,
  type CpFirestoreSdk,
} from './cp-repo';

type Clause =
  | { kind: 'where'; field: string; op: string; value: unknown }
  | { kind: 'limit'; n: number };

interface QueryRec {
  path: string;
  clauses: Clause[];
}

function rawComp(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: '春季賽',
    sport: 'football',
    hostType: 'personal',
    hostDisplay: '主辦',
    visibility: 'public',
    status: 'published',
    hidden: false,
    regOpenAt: 11,
    regCloseAt: 22,
    firstMatchAt: 33,
    lastMatchAt: 44,
    timezone: 'Asia/Taipei',
    venues: [{ name: '場地一' }],
    liveLinks: [],
    stateVersion: 2,
    ...over,
  };
}

function harness() {
  const docs = new Map<string, Record<string, unknown> | null>();
  const cols = new Map<string, { id: string; data: Record<string, unknown> }[]>();
  const queries: QueryRec[] = [];
  const gets: string[] = [];
  let dbHits = 0;

  const sdk: CpFirestoreSdk = {
    doc(_db, path) {
      return { kind: 'doc', path };
    },
    collection(_db, path) {
      return { kind: 'col', path };
    },
    where(field, op, value) {
      return { kind: 'where', field, op, value };
    },
    limit(n) {
      return { kind: 'limit', n };
    },
    query(col, ...clauses) {
      const ref = col as { path: string };
      return { path: ref.path, clauses };
    },
    async getDoc(ref) {
      const path = (ref as { path: string }).path;
      gets.push(path);
      const data = docs.get(path);
      const id = path.split('/').at(-1) ?? '';
      if (data == null) return { id, exists: () => false, data: () => undefined };
      return { id, exists: () => true, data: () => data };
    },
    async getDocs(query) {
      const rec = query as QueryRec;
      queries.push({ path: rec.path, clauses: rec.clauses });
      let rows = [...(cols.get(rec.path) ?? [])];
      for (const clause of rec.clauses) {
        if (clause.kind === 'where' && clause.op === '==') {
          rows = rows.filter((row) => row.data[clause.field] === clause.value);
        } else if (clause.kind === 'where' && clause.op === 'in' && Array.isArray(clause.value)) {
          const values = clause.value;
          rows = rows.filter((row) => values.includes(row.data[clause.field]));
        } else if (clause.kind === 'limit') {
          rows = rows.slice(0, clause.n);
        }
      }
      return { docs: rows.map((row) => ({ id: row.id, data: () => row.data })) };
    },
  };

  const repo = createCompetitionsRepo({
    getDb: async () => {
      dbHits += 1;
      return { tag: 'asia-main' };
    },
    loadSdk: async () => sdk,
  });

  return {
    repo,
    docs,
    cols,
    queries,
    gets,
    dbHits: () => dbHits,
  };
}

describe('competitionFromDoc', () => {
  it('把 Timestamp 轉成毫秒，丟掉 hostUid，缺數字補 0', () => {
    const doc = competitionFromDoc('cid_1', rawComp({
      hostUid: 'uid_should_drop',
      regOpenAt: { toMillis: () => 1_700_000_000_000 },
      stateVersion: undefined,
      hidden: undefined,
    }));
    expect(doc?.regOpenAt).toBe(1_700_000_000_000);
    expect(doc?.stateVersion).toBe(0);
    expect(doc?.hidden).toBe(false);
    expect(doc && 'hostUid' in doc).toBe(false);
  });

  it('運動不是 football、或缺必填，整筆丟掉', () => {
    expect(competitionFromDoc('cid_1', rawComp({ sport: 'basketball' }))).toBeNull();
    expect(competitionFromDoc('cid_1', rawComp({ name: 1 }))).toBeNull();
  });
});

describe('createCompetitionsRepo（查詢條件與上限）', () => {
  it('公開列表：visibility、hidden、status in、limit 30，壞文件丟掉', async () => {
    const { repo, cols, queries } = harness();
    cols.set('competitions', [
      { id: 'cid_ok', data: rawComp() },
      { id: 'cid_bad', data: rawComp({ sport: 'other' }) },
      { id: 'cid_draft', data: rawComp({ status: 'draft' }) },
    ]);
    const rows = await repo.listPublic();
    expect(rows.map((row) => row.id)).toEqual(['cid_ok']);
    expect(queries).toEqual([{
      path: 'competitions',
      clauses: [
        { kind: 'where', field: 'visibility', op: '==', value: 'public' },
        { kind: 'where', field: 'hidden', op: '==', value: false },
        { kind: 'where', field: 'status', op: 'in', value: ['published', 'postponed', 'cancelled'] },
        { kind: 'limit', n: CP_READ_LIMIT.publicList },
      ],
    }]);
  });

  it('主辦俱樂部：有 publicOnly 才加 visibility，上限 50', async () => {
    const { repo, queries } = harness();
    await repo.listByHostTeam('team_1', true);
    await repo.listByHostTeam('team_1', false);
    expect(queries[0]?.clauses).toEqual([
      { kind: 'where', field: 'hostTeamId', op: '==', value: 'team_1' },
      { kind: 'where', field: 'visibility', op: '==', value: 'public' },
      { kind: 'limit', n: CP_READ_LIMIT.hostTeam },
    ]);
    expect(queries[1]?.clauses).toEqual([
      { kind: 'where', field: 'hostTeamId', op: '==', value: 'team_1' },
      { kind: 'limit', n: CP_READ_LIMIT.hostTeam },
    ]);
  });

  it('單筆、組別、報名、名單路徑與上限', async () => {
    const { repo, docs, cols, queries, gets } = harness();
    docs.set('competitions/cid_1', rawComp({ hostUid: 'uid_x' }));
    const one = await repo.getCompetition('cid_1');
    expect(one?.id).toBe('cid_1');
    expect(one && 'hostUid' in one).toBe(false);
    expect(gets).toEqual(['competitions/cid_1']);

    docs.set('competitions/missing', null);
    await expect(repo.getCompetition('missing')).resolves.toBeNull();

    cols.set('competitions/cid_1/divisions', [
      { id: 'b', data: { dvId: 'b', name: '乙', playersOnField: '7', maxTeams: 4, rosterMin: 5, rosterMax: 11, order: 0 } },
      { id: 'a', data: { dvId: 'a', name: '甲', playersOnField: 11, maxTeams: 4, rosterMin: 5, rosterMax: 11, minAge: 8, order: 0 } },
      { id: 'c', data: { dvId: 'c', name: '丙', playersOnField: 5, maxTeams: 4, rosterMin: 5, rosterMax: 11, order: 2 } },
    ]);
    const divisions = await repo.listDivisions('cid_1');
    expect(divisions.map((row) => row.dvId)).toEqual(['a', 'b', 'c']);
    expect(divisions[0]?.requireRealName).toBe(true);
    expect(divisions[1]?.requireRealName).toBe(false);
    expect(queries.at(-1)).toMatchObject({
      path: 'competitions/cid_1/divisions',
      clauses: [{ kind: 'limit', n: CP_READ_LIMIT.divisions }],
    });

    cols.set('competitions/cid_1/entries', [
      { id: 'en_1', data: { dvId: 'a', teamId: 'team_1', name: '隊', status: 'pending' } },
    ]);
    const entries = await repo.listEntries('cid_1');
    expect(entries[0]).toMatchObject({ id: 'en_1', rosterCount: 0, rosterConfirmed: false });
    expect(queries.at(-1)?.clauses).toEqual([{ kind: 'limit', n: CP_READ_LIMIT.entries }]);

    cols.set('competitions/cid_1/roster', [
      { id: 'pl_1', data: { enId: 'en_1', displayName: '王', number: 7, isMinor: true } },
      { id: 'pl_2', data: { enId: 'en_2', displayName: '林', number: 1 } },
    ]);
    const roster = await repo.listRoster('cid_1', 'en_1');
    expect(roster.map((row) => row.id)).toEqual(['pl_1']);
    expect(roster[0]?.position).toBeNull();
    expect(queries.at(-1)).toMatchObject({
      path: 'competitions/cid_1/roster',
      clauses: [
        { kind: 'where', field: 'enId', op: '==', value: 'en_1' },
        { kind: 'limit', n: CP_READ_LIMIT.roster },
      ],
    });
  });

  it('私密讀取：有篩選才加 where，上限 100；缺 uid 的名單私密丟掉', async () => {
    const { repo, cols, queries } = harness();
    cols.set('competitions/cid_1/entryPrivate', [
      { id: 'en_1', data: { teamId: 'team_1', paymentStatus: 'paid', contactName: '聯絡人' } },
      { id: 'en_2', data: { teamId: 'team_2', paymentStatus: 'none' } },
    ]);
    const mine = await repo.listEntryPrivate('cid_1', 'team_1');
    expect(mine.map((row) => row.id)).toEqual(['en_1']);
    const all = await repo.listEntryPrivate('cid_1', null);
    expect(all.map((row) => row.id)).toEqual(['en_1', 'en_2']);
    expect(queries[0]?.clauses).toEqual([
      { kind: 'where', field: 'teamId', op: '==', value: 'team_1' },
      { kind: 'limit', n: CP_READ_LIMIT.private },
    ]);
    expect(queries[1]?.clauses).toEqual([{ kind: 'limit', n: CP_READ_LIMIT.private }]);

    cols.set('competitions/cid_1/rosterPrivate', [
      { id: 'pl_1', data: { uid: 'uid_me' } },
      { id: 'pl_2', data: {} },
    ]);
    const priv = await repo.listRosterPrivate('cid_1', null);
    expect(priv).toEqual([{ id: 'pl_1', uid: 'uid_me' }]);
    const filtered = await repo.listRosterPrivate('cid_1', 'uid_me');
    expect(filtered).toEqual([{ id: 'pl_1', uid: 'uid_me' }]);
    expect(queries.at(-1)?.clauses[0]).toEqual({ kind: 'where', field: 'uid', op: '==', value: 'uid_me' });
  });

  it('我的賽事、開賽設定、測試員、staff', async () => {
    const { repo, docs, cols, queries, gets } = harness();
    cols.set('cpMine/uid_me/items', [
      { id: 'cid_1', data: { roles: ['host', 'nope'], host: true } },
    ]);
    const mine = await repo.listMine('uid_me');
    expect(mine).toEqual([{ id: 'cid_1', cid: 'cid_1', roles: ['host'], host: true }]);
    expect(queries.at(-1)).toMatchObject({
      path: 'cpMine/uid_me/items',
      clauses: [{ kind: 'limit', n: CP_READ_LIMIT.mine }],
    });

    docs.set('cpConfig/launch', { isPublic: false, bannedWords: ['', 1] });
    await expect(repo.getLaunch()).resolves.toEqual({ isPublic: false, bannedWords: [''] });
    docs.set('cpConfig/launch/testers/uid_me', { ok: true });
    await expect(repo.getLaunchTester('uid_me')).resolves.toBe(true);
    await expect(repo.getLaunchTester('uid_no')).resolves.toBe(false);

    docs.set('competitions/cid_1/staff/uid_me', { roles: ['host', 'creator', 'fan'] });
    await expect(repo.getStaff('cid_1', 'uid_me')).resolves.toEqual({
      uid: 'uid_me',
      roles: ['host', 'creator'],
    });
    expect(gets).toContain('competitions/cid_1/staff/uid_me');
  });

  it('id 含斜線或為 . / .. 時不查詢', async () => {
    const box = harness();
    await expect(box.repo.getCompetition('a/b')).resolves.toBeNull();
    await expect(box.repo.getCompetition('')).resolves.toBeNull();
    await expect(box.repo.getCompetition('.')).resolves.toBeNull();
    await expect(box.repo.getCompetition('..')).resolves.toBeNull();
    await expect(box.repo.listDivisions('a/b')).resolves.toEqual([]);
    await expect(box.repo.listRoster('cid_1', '..')).resolves.toEqual([]);
    await expect(box.repo.getLaunchTester('a/b')).resolves.toBe(false);
    expect(box.gets).toEqual([]);
    expect(box.queries).toEqual([]);
    expect(box.dbHits()).toBe(0);
  });
});

describe('CompetitionDoc 沒有 hostUid', () => {
  it('型別不含 hostUid', () => {
    const doc = competitionFromDoc('cid_1', rawComp()) as CompetitionDoc;
    const keys = Object.keys(doc);
    expect(keys).not.toContain('hostUid');
  });
});
