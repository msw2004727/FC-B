import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CP_READ_LIMIT, type CompetitionDoc } from './types';
import {
  competitionFromDoc,
  createCompetitionsRepo,
  matchFromDoc,
  standingFromDoc,
  summaryEntriesFromDoc,
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
  let docsFail = 0;

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
      if (docsFail > 0) {
        docsFail -= 1;
        throw new Error('讀取失敗');
      }
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
    failDocs(n: number) {
      docsFail = n;
    },
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

  it('公告與聯絡文字：缺欄是空，空白聯絡是 null，壞公告丟掉', () => {
    const bare = competitionFromDoc('cid_1', rawComp());
    expect(bare?.notices).toEqual([]);
    expect(bare?.contactNote).toBeNull();
    expect(bare?.lastMatchOriginAt).toBeNull();
    expect(bare && 'hostUid' in bare).toBe(false);
    const doc = competitionFromDoc('cid_1', rawComp({
      contactNote: '  賽前群組  ',
      lastMatchOriginAt: 9,
      notices: [
        { id: 'n1', text: '改期', kind: 'system', at: { toMillis: () => 20 }, by: 'hash' },
        { id: '', text: '壞', kind: 'host', at: 1 },
        { id: 'n2', text: '手寫', kind: 'host', at: 30, by: null },
        { id: 'n3', text: '錯', kind: 'other', at: 1 },
      ],
    }));
    expect(doc?.contactNote).toBe('賽前群組');
    expect(doc?.lastMatchOriginAt).toBe(9);
    expect(doc?.notices).toEqual([
      { id: 'n1', text: '改期', kind: 'system', at: 20, by: 'hash' },
      { id: 'n2', text: '手寫', kind: 'host', at: 30, by: null },
    ]);
    expect(competitionFromDoc('cid_1', rawComp({ contactNote: '   ' }))?.contactNote).toBeNull();
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

  it('測試者與管理員的公開列表不帶 visibility', async () => {
    const { repo, queries } = harness();
    await repo.listPublic(true);
    expect(queries[0]?.clauses).toEqual([
      { kind: 'where', field: 'hidden', op: '==', value: false },
      { kind: 'where', field: 'status', op: 'in', value: ['published', 'postponed', 'cancelled'] },
      { kind: 'limit', n: CP_READ_LIMIT.publicList },
    ]);
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

  it('單筆 mine（CP-PO-08）：讀 cpMine/{uid}/items/{cid}，plIds 只收非空字串，沒文件回 null', async () => {
    const { repo, docs, gets } = harness();
    docs.set('cpMine/uid_me/items/cid_1', { cid: 'cid_1', roles: ['player'], plIds: ['pl_a', '', 3, null, 'pl_b'] });
    await expect(repo.getMine('uid_me', 'cid_1')).resolves.toEqual({
      id: 'cid_1', cid: 'cid_1', roles: ['player'], host: false, category: 'league', plIds: ['pl_a', 'pl_b'],
    });
    expect(gets.at(-1)).toBe('cpMine/uid_me/items/cid_1');
    docs.set('cpMine/uid_me/items/cid_2', { roles: ['rep'], plIds: 'pl_a' });
    const noPl = await repo.getMine('uid_me', 'cid_2');
    expect(noPl && 'plIds' in noPl).toBe(false);
    await expect(repo.getMine('uid_me', 'cid_none')).resolves.toBeNull();
    const before = gets.length;
    await expect(repo.getMine('uid_me', 'a/b')).resolves.toBeNull();
    await expect(repo.getMine('', 'cid_1')).resolves.toBeNull();
    expect(gets.length).toBe(before);
  });

  it('我的賽事、開賽設定、測試員、staff', async () => {
    const { repo, docs, cols, queries, gets } = harness();
    cols.set('cpMine/uid_me/items', [
      { id: 'cid_1', data: { roles: ['host', 'nope'], host: true } },
    ]);
    const mine = await repo.listMine('uid_me');
    expect(mine).toEqual([{ id: 'cid_1', cid: 'cid_1', roles: ['host'], host: true, category: 'league' }]);
    expect(queries.at(-1)).toMatchObject({
      path: 'cpMine/uid_me/items',
      clauses: [{ kind: 'limit', n: CP_READ_LIMIT.mine }],
    });

    docs.set('cpConfig/launch', { isPublic: false, bannedWords: ['', 1] });
    await expect(repo.getLaunch()).resolves.toEqual({ isPublic: false, bannedWords: [] });
    docs.set('cpConfig/launch/testers/uid_me', { ok: true });
    await expect(repo.getLaunchTester('uid_me')).resolves.toBe(true);
    await expect(repo.getLaunchTester('uid_no')).resolves.toBe(false);

    docs.set('competitions/cid_1/staff/uid_me', { roles: ['host', 'creator', 'fan'] });
    // creator 不是角色，讀取出來會丢掉，只留 host／coHost。
    await expect(repo.getStaff('cid_1', 'uid_me')).resolves.toEqual({
      uid: 'uid_me',
      roles: ['host'],
    });
    expect(gets).toContain('competitions/cid_1/staff/uid_me');
  });

  it('人員清單最多 100，單筆指派保留記分角色，單筆場次走 get', async () => {
    const { repo, docs, cols, queries, gets } = harness();
    const rows = Array.from({ length: 101 }, (_, i) => ({
      id: `uid_${String(i).padStart(3, '0')}`,
      data: {
        roles: i === 0 ? ['scorer', 'fan', 'scorer', 'host'] : ['referee'],
        matchIds: ['mt_a', 'mt_a', 1, 'mt_b'],
        expiresAt: { toMillis: () => 50 },
      },
    }));
    cols.set('competitions/cid_1/staff', rows);
    const list = await repo.listStaff('cid_1');
    expect(list).toHaveLength(100);
    expect(queries.at(-1)).toMatchObject({
      path: 'competitions/cid_1/staff',
      clauses: [{ kind: 'limit', n: 100 }],
    });
    expect(list[0]).toEqual({
      uid: 'uid_000',
      roles: ['scorer', 'host'],
      matchIds: ['mt_a', 'mt_b'],
      expiresAt: 50,
    });
    expect(list.map((row) => row.uid)).toEqual([...list.map((row) => row.uid)].sort());

    docs.set('competitions/cid_1/staff/uid_me', {
      roles: ['coHost', 'creator', 'referee'],
      matchIds: [],
      expiresAt: null,
    });
    await expect(repo.getStaffAssignment('cid_1', 'uid_me')).resolves.toEqual({
      uid: 'uid_me',
      roles: ['coHost', 'referee'],
      matchIds: [],
      expiresAt: null,
    });
    await expect(repo.getStaff('cid_1', 'uid_me')).resolves.toEqual({
      uid: 'uid_me',
      roles: ['coHost'],
    });
    expect(gets).toContain('competitions/cid_1/staff/uid_me');

    docs.set('competitions/cid_1/matches/mt_1', {
      divisionId: 'dv_1',
      status: 'live',
      home: { teamId: 'en_h', name: '主隊' },
      away: { teamId: 'en_a', name: '客隊' },
    });
    const match = await repo.getMatch('cid_1', 'mt_1');
    expect(match?.id).toBe('mt_1');
    expect(match?.status).toBe('live');
    expect(gets).toContain('competitions/cid_1/matches/mt_1');
    await expect(repo.getMatch('cid_1', 'missing')).resolves.toBeNull();
    await expect(repo.listStaff('a/b')).resolves.toEqual([]);
    await expect(repo.getStaffAssignment('cid_1', '..')).resolves.toBeNull();
    await expect(repo.getMatch('.', 'mt_1')).resolves.toBeNull();
  });

  it('memberNo 只留正整數，缺欄與壞值不帶號碼', async () => {
    const { repo, docs, cols } = harness();
    cols.set('competitions/cid_1/staff', [
      { id: 'uid_b', data: { roles: ['scorer'], memberNo: 3 } },
      { id: 'uid_a', data: { roles: ['referee'], memberNo: 0 } },
      { id: 'uid_c', data: { roles: ['coHost'], memberNo: 1.5 } },
      { id: 'uid_d', data: { roles: ['host'], memberNo: '2' } },
      { id: 'uid_e', data: { roles: ['scorer'], memberNo: -4 } },
      { id: 'uid_f', data: { roles: ['host'], memberNo: 8 } },
    ]);
    const list = await repo.listStaff('cid_1');
    const byId = new Map(list.map((row) => [row.uid, row.memberNo]));
    expect(byId.get('uid_b')).toBe(3);
    expect(byId.get('uid_f')).toBe(8);
    expect(byId.get('uid_a')).toBeUndefined();
    expect(byId.get('uid_c')).toBeUndefined();
    expect(byId.get('uid_d')).toBeUndefined();
    expect(byId.get('uid_e')).toBeUndefined();

    docs.set('competitions/cid_1/staff/uid_me', { roles: ['host', 'creator'], memberNo: 1 });
    await expect(repo.getStaff('cid_1', 'uid_me')).resolves.toEqual({
      uid: 'uid_me',
      roles: ['host'],
      memberNo: 1,
    });
    await expect(repo.getStaffAssignment('cid_1', 'uid_me')).resolves.toMatchObject({
      uid: 'uid_me',
      roles: ['host'],
      memberNo: 1,
    });
    docs.set('competitions/cid_1/staff/uid_me', { roles: ['scorer'], memberNo: Number.NaN });
    const bad = await repo.getStaffAssignment('cid_1', 'uid_me');
    expect(bad?.memberNo).toBeUndefined();
    await expect(repo.getStaff('cid_1', 'uid_me')).resolves.toEqual({
      uid: 'uid_me',
      roles: [],
    });
  });

  // CP-DETAIL-SPEED d1：詳情頁把 getStaff 與 getStaffAssignment 合成一次讀。兩種形狀都要和單讀方法一模一樣，
  // 否則計分員會看不到自己的場次、主辦會看不到管理區。
  it('getStaffWithAssignment：同一份 staff 文件只 getDoc 一次，兩種形狀分別等於 getStaff 與 getStaffAssignment', async () => {
    const shapes: Record<string, unknown>[] = [
      { roles: ['coHost', 'creator', 'referee'], matchIds: [], expiresAt: null },
      { roles: ['scorer', 'scorer', 'host'], matchIds: ['mt_a', 'mt_a', 'mt_b'], expiresAt: 50, memberNo: 3 },
      { roles: ['host'], memberNo: 1 },
      { roles: ['scorer'], memberNo: Number.NaN, matchIds: ['mt_1', 7] },
      { roles: 'host' },
      {},
    ];
    for (const data of shapes) {
      const { repo, docs, gets } = harness();
      docs.set('competitions/cid_1/staff/uid_me', data);
      const staff = await repo.getStaff('cid_1', 'uid_me');
      const assignment = await repo.getStaffAssignment('cid_1', 'uid_me');
      gets.length = 0;
      await expect(repo.getStaffWithAssignment('cid_1', 'uid_me')).resolves.toEqual({ staff, assignment });
      expect(gets).toEqual(['competitions/cid_1/staff/uid_me']);
    }

    // 鎖住記分員那條：指派要保留 scorer 與場次（staff 形狀本來就不收記分角色）。
    const { repo, docs } = harness();
    docs.set('competitions/cid_1/staff/uid_me', { roles: ['scorer'], matchIds: ['mt_1', 'mt_2'], expiresAt: null });
    await expect(repo.getStaffWithAssignment('cid_1', 'uid_me')).resolves.toEqual({
      staff: { uid: 'uid_me', roles: [] },
      assignment: { uid: 'uid_me', roles: ['scorer'], matchIds: ['mt_1', 'mt_2'], expiresAt: null },
    });
  });

  it('getStaffWithAssignment：沒有文件兩者都是 null；id 不安全不發請求', async () => {
    const { repo, gets, dbHits } = harness();
    await expect(repo.getStaffWithAssignment('cid_1', 'uid_none')).resolves.toEqual({ staff: null, assignment: null });
    expect(gets).toEqual(['competitions/cid_1/staff/uid_none']);
    gets.length = 0;
    const before = dbHits();
    for (const [cid, uid] of [['a/b', 'uid_me'], ['cid_1', '..'], ['', 'uid_me'], ['cid_1', '.'], ['cid_1', 'x/y']]) {
      await expect(repo.getStaffWithAssignment(cid!, uid!)).resolves.toEqual({ staff: null, assignment: null });
    }
    expect(gets).toEqual([]);
    expect(dbHits()).toBe(before);
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

function rawMatch(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    divisionId: 'dv_1',
    round: 1,
    matchNo: 1,
    home: { teamId: 'en_h', name: '主隊' },
    away: { teamId: 'en_a', name: '客隊' },
    score: { home: 2, away: 1 },
    penaltyScore: { home: 4, away: 3 },
    status: 'scheduled',
    rev: 3,
    ...over,
  };
}

describe('第 3 步文件解析', () => {
  it('分類缺值是 league，只收三種', () => {
    expect(competitionFromDoc('cid_1', rawComp())?.category).toBe('league');
    expect(competitionFromDoc('cid_1', rawComp({ category: 'cup' }))?.category).toBe('cup');
    expect(competitionFromDoc('cid_1', rawComp({ category: 'friendly' }))?.category).toBe('friendly');
    expect(competitionFromDoc('cid_1', rawComp({ category: 'knockout' }))?.category).toBe('league');
  });

  it('場次丟掉壞列，penaltyScore 一律是 null，缺省補 group／A', () => {
    const doc = matchFromDoc('mt_1', rawMatch());
    expect(doc).toMatchObject({
      id: 'mt_1',
      divisionId: 'dv_1',
      stageId: 'group',
      groupId: 'A',
      teamIds: ['en_h', 'en_a'],
      score: { home: 2, away: 1 },
      penaltyScore: null,
      status: 'scheduled',
      rev: 3,
      lock: { locked: false },
      walkoverSide: null,
      resultSource: null,
    });
    expect(matchFromDoc('mt_x', rawMatch({ status: 'void' }))).toBeNull();
    expect(matchFromDoc('mt_x', rawMatch({ home: { name: '沒有 id' } }))).toBeNull();
    expect(matchFromDoc('mt_x', rawMatch({ divisionId: '' }))).toBeNull();
    expect(matchFromDoc('doc_id', rawMatch({ matchId: 'mt_named' }))?.id).toBe('mt_named');
  });

  it('摘要依開賽時間、場次號、id 排，沒有開賽時間的排最後', () => {
    const rows = summaryEntriesFromDoc({
      updatedAt: 9,
      m: {
        mt_late: { dv: 'dv_1', r: 1, no: 2, k: 50, h: { id: 'en_h', n: '主' }, a: { id: 'en_a', n: '客' }, s: [0, 1], st: 'scheduled' },
        mt_tbd: { dv: 'dv_1', r: 1, no: 1, k: null, h: { id: 'en_h', n: '主' }, a: { id: 'en_a', n: '客' }, s: [0, 0], st: 'postponed' },
        mt_early: { dv: 'dv_1', r: 1, no: 3, k: 10, h: { id: 'en_h', n: '主' }, a: { id: 'en_a', n: '客' }, s: [1, 0], st: 'confirmed', wo: 'away' },
        mt_bad: { dv: 'dv_1' },
      },
    });
    expect(rows.map((row) => row.id)).toEqual(['mt_early', 'mt_late', 'mt_tbd']);
    expect(rows[0]).toMatchObject({ no: 3, k: 10, s: [1, 0], wo: 'away' });
    expect(rows[2]?.k).toBeNull();
    expect(summaryEntriesFromDoc({})).toEqual([]);
  });

  it('摘要 cr 只有已取消才讀，空白丟掉，超過 100 字截斷', () => {
    const side = { h: { id: 'en_h', n: '主' }, a: { id: 'en_a', n: '客' } };
    const rows = summaryEntriesFromDoc({
      m: {
        mt_off: { dv: 'dv_1', r: 1, no: 1, k: 10, ...side, s: [0, 0], st: 'cancelled', cr: ' 大雨 ' },
        mt_live: { dv: 'dv_1', r: 1, no: 2, k: 20, ...side, s: [0, 0], st: 'scheduled', cr: '不該留下' },
        mt_old: { dv: 'dv_1', r: 1, no: 3, k: 30, ...side, s: [0, 0], st: 'cancelled', cancelReason: '舊欄位' },
        mt_long: { dv: 'dv_1', r: 1, no: 4, k: 40, ...side, s: [0, 0], st: 'cancelled', cr: `${'😀'.repeat(100)}多` },
        mt_blank: { dv: 'dv_1', r: 1, no: 5, k: 50, ...side, s: [0, 0], st: 'cancelled', cr: '   ' },
      },
    });
    expect(rows.find((row) => row.id === 'mt_off')?.cr).toBe('大雨');
    expect(rows.find((row) => row.id === 'mt_live')?.cr).toBeUndefined();
    expect(rows.find((row) => row.id === 'mt_old')?.cr).toBeUndefined();
    expect(rows.find((row) => row.id === 'mt_long')?.cr).toBe('😀'.repeat(100));
    expect([...'😀'.repeat(100)].length).toBe(100);
    expect(rows.find((row) => row.id === 'mt_blank')?.cr).toBeUndefined();
  });

  it('摘要有 l、vi、cx、p 才掛上，缺欄的物件不多出鍵', () => {
    const side = { id: 'en_h', n: '主' };
    const away = { id: 'en_a', n: '客' };
    const rows = summaryEntriesFromDoc({
      m: {
        mt_plain: { dv: 'dv_1', r: 1, k: 10, h: side, a: away, s: [0, 0], st: 'scheduled' },
        mt_full: {
          dv: 'dv_1', r: 1, k: 20,
          h: { ...side, l: ' https://crest/h ' },
          a: { ...away, l: '   ' },
          s: [1, 1], st: 'confirmed', vi: 1, cx: 50, p: [4, 3],
        },
        mt_bad: { dv: 'dv_1', r: 1, k: 30, h: side, a: away, s: [0, 0], st: 'scheduled', vi: -1, cx: 'x', p: [1] },
      },
    });
    const plain = rows.find((row) => row.id === 'mt_plain');
    expect(plain && 'vi' in plain).toBe(false);
    expect(plain && 'cx' in plain).toBe(false);
    expect(plain && 'p' in plain).toBe(false);
    expect(plain?.h).not.toHaveProperty('l');
    const full = rows.find((row) => row.id === 'mt_full');
    expect(full?.h.l).toBe('https://crest/h');
    expect(full?.a).not.toHaveProperty('l');
    expect(full).toMatchObject({ vi: 1, cx: 50, p: [4, 3] });
    const bad = rows.find((row) => row.id === 'mt_bad');
    expect(bad && 'vi' in bad).toBe(false);
    expect(bad && 'cx' in bad).toBe(false);
    expect(bad && 'p' in bad).toBe(false);
  });

  it('積分列只讀後端欄位，短名與文件 id 不算', () => {
    const doc = standingFromDoc('dv_1__group__A', {
      version: 3,
      hasUnresolvedTie: true,
      updatedAt: 9,
      rows: [{
        teamId: 'en_h',
        name: '主隊',
        played: 1,
        win: 1,
        draw: 0,
        loss: 0,
        goalsFor: 2,
        goalsAgainst: 0,
        goalDiff: 2,
        points: 3,
        rank: 1,
        // 短名即使同時存在也不採用
        w: 9,
        d: 9,
        l: 9,
        gf: 9,
        ga: 9,
        gd: 9,
        pts: 9,
        p: 9,
        n: '不採用',
        id: 'en_other',
      }],
    });
    expect(doc).toMatchObject({
      id: 'dv_1__group__A',
      divisionId: 'dv_1',
      groupId: 'A',
      version: 3,
      hasUnresolvedTie: true,
      updatedAt: 9,
    });
    expect(doc?.rows[0]).toEqual({
      teamId: 'en_h',
      name: '主隊',
      played: 1,
      win: 1,
      draw: 0,
      loss: 0,
      goalsFor: 2,
      goalsAgainst: 0,
      goalDiff: 2,
      points: 3,
      rank: 1,
      hasUnresolvedTie: false,
      tiedWith: [],
      decidedBy: null,
    });
    // 只有短名、沒有 teamId：整列丟掉。有 teamId 但只有短名：數字是 0，name 不讀 n。
    expect(standingFromDoc('dv_1__group__A', {
      rows: [{ id: 'en_h', n: '主隊', p: 1, w: 1, d: 0, l: 0, gf: 2, ga: 0, gd: 2, pts: 3 }],
    })?.rows).toEqual([]);
    expect(standingFromDoc('dv_1__group__A', {
      rows: [{ teamId: 'en_h', n: '主隊', w: 1, gf: 4, ga: 1, pts: 3, p: 1 }],
    })?.rows).toEqual([{
      teamId: 'en_h',
      name: '',
      played: 0,
      win: 0,
      draw: 0,
      loss: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      points: 0,
      rank: 0,
      hasUnresolvedTie: false,
      tiedWith: [],
      decidedBy: null,
    }]);
    const tied = standingFromDoc('dv_1__group__A', {
      divisionName: ' 公開組 ',
      rows: [{
        teamId: 'en_h',
        name: '主隊',
        hasUnresolvedTie: true,
        tiedWith: ['en_a', 1, '', 'en_b'],
      }],
    });
    expect(tied?.divisionName).toBe('公開組');
    expect(tied?.rows[0]).toMatchObject({
      hasUnresolvedTie: true,
      tiedWith: ['en_a', 'en_b'],
    });
    expect(standingFromDoc('dv_1__group__A', { divisionName: '  ', rows: [] })?.divisionName).toBeUndefined();
    // 缺 goalDiff 不拿得失球相減；缺 rank 不拿列序補。
    expect(standingFromDoc('dv_1__group__B', {
      rows: [{ teamId: 'en_a', name: '客隊', goalsFor: 1, goalsAgainst: 3 }],
    })?.rows[0]).toMatchObject({
      goalsFor: 1,
      goalsAgainst: 3,
      goalDiff: 0,
      rank: 0,
      played: 0,
      win: 0,
      draw: 0,
      loss: 0,
      points: 0,
    });
    expect(standingFromDoc('dv_1__group__A', { rows: [] })?.rows).toEqual([]);
    expect(standingFromDoc('not-a-standing', { rows: [] })).toBeNull();
  });

  it('manualOverride 在 enabled 為 true 時留下方式、原因、時間', () => {
    expect(standingFromDoc('dv_1__group__A', {
      manualOverride: { enabled: true, by: 'uid_host', at: 1, reason: '手排', method: 'host' },
      rows: [],
    })?.manualOverride).toEqual({ method: 'host', reason: '手排', at: 1 });
    expect(standingFromDoc('dv_1__group__A', {
      manualOverride: { enabled: true, method: 'drawLots', reason: '抽籤', decidedAt: 9, at: 1 },
      rows: [],
    })?.manualOverride).toEqual({ method: 'drawLots', reason: '抽籤', at: 9 });
    expect(standingFromDoc('dv_1__group__A', {
      manualOverride: { enabled: false, by: null, at: null, reason: null },
      rows: [],
    })?.manualOverride).toBeNull();
    expect(standingFromDoc('dv_1__group__A', { manualOverride: true, rows: [] })?.manualOverride).toBeNull();
    expect(standingFromDoc('dv_1__group__A', { manualOverride: { enabled: 'true' }, rows: [] })?.manualOverride).toBeNull();
    expect(standingFromDoc('dv_1__group__A', { rows: [] })?.manualOverride).toBeNull();
    expect(standingFromDoc('dv_1__group__A', { rows: [] })?.ranking).toBeNull();
    expect(standingFromDoc('dv_1__group__A', {
      ranking: 'goalDiffFirst',
      rows: [{ teamId: 'en_h', decidedBy: 'host' }],
    })?.ranking).toBe('goalDiffFirst');
    expect(standingFromDoc('dv_1__group__A', {
      rows: [{ teamId: 'en_h', decidedBy: 'host', hasUnresolvedTie: true }],
    })?.rows[0]?.decidedBy).toBe('host');
    expect(matchFromDoc('mt_1', rawMatch({ status: 'cancelled', cancelReason: '大雨', cancelledAt: 8 }))).toMatchObject({
      status: 'cancelled',
      cancelReason: '大雨',
      cancelledAt: 8,
    });
  });
});

describe('第 3 步讀取', () => {
  it('場次、摘要、積分榜的路徑與上限，記憶體排序', async () => {
    const { repo, docs, cols, queries, gets } = harness();
    cols.set('competitions/cid_1/matches', [
      { id: 'mt_2', data: rawMatch({ round: 1, matchNo: 2 }) },
      { id: 'mt_1', data: rawMatch({ round: 1, matchNo: 1 }) },
      { id: 'mt_bad', data: rawMatch({ status: 'void' }) },
    ]);
    const matches = await repo.listMatches('cid_1');
    expect(matches.map((row) => row.id)).toEqual(['mt_1', 'mt_2']);
    expect(queries.at(-1)).toMatchObject({
      path: 'competitions/cid_1/matches',
      clauses: [{ kind: 'limit', n: CP_READ_LIMIT.matches }],
    });
    // 已部署 asia-main Rules：matches list 要求 limit <= 100（firestore.asia-main.rules:579）；超過整個查詢被拒（11-20 走查）。
    expect(CP_READ_LIMIT.matches).toBeLessThanOrEqual(100);
    expect(queries.at(-1)?.clauses).toEqual([{ kind: 'limit', n: 100 }]);

    docs.set('competitions/cid_1/summary/d20261205', {
      m: {
        mt_2: { dv: 'dv_1', r: 1, no: 2, k: 20, h: { id: 'en_h', n: '主' }, a: { id: 'en_a', n: '客' }, s: [0, 0], st: 'scheduled' },
        mt_1: { dv: 'dv_1', r: 1, no: 1, k: 10, h: { id: 'en_h', n: '主' }, a: { id: 'en_a', n: '客' }, s: [0, 0], st: 'scheduled' },
      },
    });
    const shard = await repo.getSummaryShard('cid_1', 'd20261205');
    expect(shard.map((row) => row.id)).toEqual(['mt_1', 'mt_2']);
    expect(gets).toContain('competitions/cid_1/summary/d20261205');
    await expect(repo.getSummaryShard('cid_1', 'tbd')).resolves.toEqual([]);

    cols.set('competitions/cid_1/summary', [
      { id: 'tbd', data: { m: { mt_tbd: { dv: 'dv_1', r: 2, no: 1, k: null, h: { id: 'en_h', n: '主' }, a: { id: 'en_a', n: '客' }, s: [0, 0], st: 'postponed' } } } },
      { id: 'd20261205', data: { m: { mt_1: { dv: 'dv_1', r: 1, no: 1, k: 10, h: { id: 'en_h', n: '主' }, a: { id: 'en_a', n: '客' }, s: [1, 0], st: 'confirmed' } } } },
    ]);
    const summary = await repo.listSummary('cid_1');
    expect(summary.map((row) => row.id)).toEqual(['mt_1', 'mt_tbd']);
    expect(queries.at(-1)).toMatchObject({
      path: 'competitions/cid_1/summary',
      clauses: [{ kind: 'limit', n: CP_READ_LIMIT.summary }],
    });

    cols.set('competitions/cid_1/standings', [
      { id: 'dv_b__group__A', data: { rows: [] } },
      { id: 'dv_a__group__A', data: { rows: [{ teamId: 'en_h', name: '主隊', points: 3 }] } },
    ]);
    const standings = await repo.listStandings('cid_1');
    expect(standings.map((row) => row.id)).toEqual(['dv_a__group__A', 'dv_b__group__A']);
    expect(standings[0]?.rows[0]?.points).toBe(3);
    expect(queries.at(-1)).toMatchObject({
      path: 'competitions/cid_1/standings',
      clauses: [{ kind: 'limit', n: CP_READ_LIMIT.standings }],
    });
  });

  it('隊徽只查一次，上限 32；失敗不記住；不是 https 的圖當沒有', async () => {
    const box = harness();
    const entries = Array.from({ length: 40 }, (_, i) => ({
      id: `en_${i}`,
      data: {
        dvId: 'dv_1',
        teamId: `team_${i}`,
        name: `隊${i}`,
        status: 'approved',
        teamLogo: i === 0 ? 'https://logo.invalid/a.png' : 'http://logo.invalid/b.png',
      },
    }));
    box.cols.set('competitions/cid_1/entries', entries);
    const first = await box.repo.listEntriesForCrest('cid_1');
    const second = await box.repo.listEntriesForCrest('cid_1');
    expect(first).toHaveLength(CP_READ_LIMIT.crest);
    expect(second).toBe(first);
    expect(first[0]?.teamLogo).toBe('https://logo.invalid/a.png');
    expect(first[1]?.teamLogo).toBeNull();
    expect(box.queries.filter((query) => query.path === 'competitions/cid_1/entries')).toHaveLength(1);
    expect(box.queries[0]?.clauses).toEqual([
      { kind: 'where', field: 'status', op: '==', value: 'approved' },
      { kind: 'limit', n: CP_READ_LIMIT.crest },
    ]);

    box.cols.set('competitions/cid_2/entries', [
      { id: 'en_ok', data: { dvId: 'dv_1', teamId: 'team_ok', name: '核准隊', status: 'approved', teamLogo: null } },
      { id: 'en_wait', data: { dvId: 'dv_1', teamId: 'team_wait', name: '待審隊', status: 'pending', teamLogo: null } },
    ]);
    const approvedOnly = await box.repo.listEntriesForCrest('cid_2');
    expect(approvedOnly.map((row) => row.id)).toEqual(['en_ok']);

    box.repo.invalidateCrests('cid_1');
    const refreshed = await box.repo.listEntriesForCrest('cid_1');
    expect(refreshed).toHaveLength(CP_READ_LIMIT.crest);
    expect(refreshed).not.toBe(first);
    expect(box.queries.filter((query) => query.path === 'competitions/cid_1/entries')).toHaveLength(2);

    const listed = await box.repo.listEntries('cid_1');
    expect(listed).toHaveLength(40);
    expect(box.queries.filter((query) => query.path === 'competitions/cid_1/entries')).toHaveLength(3);

    await expect(box.repo.listEntriesForCrest('a/b')).resolves.toEqual([]);
    await expect(box.repo.listMatches('..')).resolves.toEqual([]);
    await expect(box.repo.getSummaryShard('cid_1', '')).resolves.toEqual([]);
    await expect(box.repo.listSummary('.')).resolves.toEqual([]);
    await expect(box.repo.listStandings('a/b')).resolves.toEqual([]);
    expect(box.queries.filter((query) => query.path.includes('/matches') || query.path.endsWith('/summary') || query.path.endsWith('/standings'))).toEqual([]);

    const again = harness();
    again.cols.set('competitions/cid_1/entries', entries.slice(0, 1));
    again.failDocs(1);
    await expect(again.repo.listEntriesForCrest('cid_1')).rejects.toThrow('讀取失敗');
    const retried = await again.repo.listEntriesForCrest('cid_1');
    expect(retried).toHaveLength(1);
    expect(again.queries).toHaveLength(2);
  });

  it('沒有 onSnapshot', () => {
    const src = readFileSync(resolve(__dirname, 'cp-repo.ts'), 'utf8');
    expect(src).not.toContain('onSnapshot');
  });
});
