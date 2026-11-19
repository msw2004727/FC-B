// 記憶體假資料。測試與預覽 harness 用，不連 Firestore。
// 篩選與筆數上限與 CompetitionsRepo 相同（CP_READ_LIMIT）。
// ASSUMPTION: 超過上限時先排序再截斷。真實查詢是先 limit，組別再在記憶體依 order 排序（沒有 orderBy）。

import type { CompetitionsRepo } from '../data/cp-repo';
import {
  CP_READ_LIMIT,
  type CompetitionDoc,
  type CpMineItem,
  type DivisionDoc,
  type EntryDoc,
  type EntryPrivateDoc,
  type LaunchDoc,
  type MatchDoc,
  type RosterPrivateDoc,
  type RosterPublicDoc,
  type StaffAssignment,
  type StaffDoc,
  type StandingDoc,
  type SummaryEntry,
} from '../data/types';

export interface FakeCpSeed {
  launch?: LaunchDoc | null;
  testers?: readonly string[];
  mine?: Readonly<Record<string, readonly CpMineItem[]>>;
  competitions?: readonly CompetitionDoc[];
  divisions?: Readonly<Record<string, readonly DivisionDoc[]>>;
  entries?: Readonly<Record<string, readonly EntryDoc[]>>;
  roster?: Readonly<Record<string, readonly RosterPublicDoc[]>>;
  entryPrivate?: Readonly<Record<string, readonly EntryPrivateDoc[]>>;
  rosterPrivate?: Readonly<Record<string, readonly RosterPrivateDoc[]>>;
  /** key 是 cid。 */
  staff?: Readonly<Record<string, readonly StaffDoc[]>>;
  /**
   * 有這個 cid 時，清單與單筆指派用這份（含記分角色）。
   * 沒有這個 cid 時，由 staff 種子合成：角色沿用、場次空、沒有到期。
   */
  assignments?: Readonly<Record<string, readonly StaffAssignment[]>>;
  matches?: Readonly<Record<string, readonly MatchDoc[]>>;
  /** key 是 cid。每片是一筆 summary 文件。 */
  summary?: Readonly<Record<string, readonly { id: string; entries: readonly SummaryEntry[] }[]>>;
  standings?: Readonly<Record<string, readonly StandingDoc[]>>;
}

/** 測試用計數。查詢是回傳文件數＋1（Rules 讀父文件；0 筆仍是 1）。單筆 get 不加。calls 不含快取命中與非法 id。 */
export interface FakeCpRepo extends CompetitionsRepo {
  readCount(): number;
  calls(): readonly string[];
}

function take<T>(items: readonly T[], limit: number): T[] {
  return items.slice(0, limit);
}

function isSafeId(id: string): boolean {
  return id.length > 0 && !id.includes('/') && id !== '.' && id !== '..';
}

function compareSummary(a: SummaryEntry, b: SummaryEntry): number {
  if (a.k == null && b.k != null) return 1;
  if (a.k != null && b.k == null) return -1;
  if (a.k != null && b.k != null && a.k !== b.k) return a.k - b.k;
  const no = (a.no ?? 0) - (b.no ?? 0);
  if (no !== 0) return no;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 實作 CompetitionsRepo。回傳的物件可當 CompetitionsRepo 用。 */
export function createFakeCpRepo(seed: FakeCpSeed = {}): FakeCpRepo {
  const launch = seed.launch ?? null;
  const testers = new Set(seed.testers ?? []);
  const mine = seed.mine ?? {};
  const competitions = seed.competitions ?? [];
  const divisions = seed.divisions ?? {};
  const entries = seed.entries ?? {};
  const roster = seed.roster ?? {};
  const entryPrivate = seed.entryPrivate ?? {};
  const rosterPrivate = seed.rosterPrivate ?? {};
  const staff = seed.staff ?? {};
  const assignments = seed.assignments;
  const matches = seed.matches ?? {};
  const summary = seed.summary ?? {};
  const standings = seed.standings ?? {};
  const calls: string[] = [];
  let reads = 0;
  const crestCache = new Map<string, Promise<EntryDoc[]>>();

  function note(name: string, docs: number): void {
    calls.push(name);
    reads += docs;
  }

  function noteQuery(name: string, returned: number): void {
    // 回傳幾筆算幾筆，另加 1（Rules 讀父文件）。0 筆仍是 1，不再多加一筆空查詢。
    note(name, returned + 1);
  }

  function copyAssignment(row: StaffAssignment): StaffAssignment {
    return { uid: row.uid, roles: [...row.roles], matchIds: [...row.matchIds], expiresAt: row.expiresAt };
  }

  function staffRows(cid: string): readonly StaffAssignment[] {
    if (assignments && Object.prototype.hasOwnProperty.call(assignments, cid)) {
      return assignments[cid] ?? [];
    }
    return (staff[cid] ?? []).map((row) => ({
      uid: row.uid,
      roles: [...row.roles],
      matchIds: [],
      expiresAt: null,
    }));
  }

  return {
    readCount() {
      return reads;
    },

    calls() {
      return calls;
    },

    async getLaunch() {
      note('getLaunch', 1);
      return launch;
    },

    async getLaunchTester(uid) {
      if (!isSafeId(uid)) return false;
      note('getLaunchTester', 1);
      return testers.has(uid);
    },

    async listMine(uid) {
      if (!isSafeId(uid)) return [];
      const rows = take(mine[uid] ?? [], CP_READ_LIMIT.mine);
      noteQuery('listMine', rows.length);
      return rows;
    },

    async listPublic(includeInternal = false) {
      const rows = competitions.filter((doc) =>
        (includeInternal || doc.visibility === 'public') && doc.hidden === false
        && (doc.status === 'published' || doc.status === 'postponed' || doc.status === 'cancelled'));
      const taken = take(rows, CP_READ_LIMIT.publicList);
      noteQuery('listPublic', taken.length);
      return taken;
    },

    async listByHostTeam(teamId, publicOnly) {
      if (!isSafeId(teamId)) return [];
      const rows = competitions.filter((doc) =>
        doc.hostTeamId === teamId && (!publicOnly || doc.visibility === 'public'));
      const taken = take(rows, CP_READ_LIMIT.hostTeam);
      noteQuery('listByHostTeam', taken.length);
      return taken;
    },

    async getCompetition(cid) {
      if (!isSafeId(cid)) return null;
      note('getCompetition', 1);
      return competitions.find((doc) => doc.id === cid) ?? null;
    },

    async listDivisions(cid) {
      if (!isSafeId(cid)) return [];
      const rows = [...(divisions[cid] ?? [])].sort(
        (a, b) => a.order - b.order || (a.dvId < b.dvId ? -1 : a.dvId > b.dvId ? 1 : 0),
      );
      const taken = take(rows, CP_READ_LIMIT.divisions);
      noteQuery('listDivisions', taken.length);
      return taken;
    },

    async listEntries(cid) {
      if (!isSafeId(cid)) return [];
      const rows = take(entries[cid] ?? [], CP_READ_LIMIT.entries);
      noteQuery('listEntries', rows.length);
      return rows;
    },

    async listRoster(cid, enId) {
      if (!isSafeId(cid) || !isSafeId(enId)) return [];
      const rows = take((roster[cid] ?? []).filter((row) => row.enId === enId), CP_READ_LIMIT.roster);
      noteQuery('listRoster', rows.length);
      return rows;
    },

    async listEntryPrivate(cid, teamId) {
      if (!isSafeId(cid) || (teamId != null && !isSafeId(teamId))) return [];
      const rows = entryPrivate[cid] ?? [];
      const filtered = teamId == null ? rows : rows.filter((row) => row.teamId === teamId);
      const taken = take(filtered, CP_READ_LIMIT.private);
      noteQuery('listEntryPrivate', taken.length);
      return taken;
    },

    async listRosterPrivate(cid, uid) {
      if (!isSafeId(cid) || (uid != null && !isSafeId(uid))) return [];
      const rows = rosterPrivate[cid] ?? [];
      const filtered = uid == null ? rows : rows.filter((row) => row.uid === uid);
      const taken = take(filtered, CP_READ_LIMIT.private);
      noteQuery('listRosterPrivate', taken.length);
      return taken;
    },

    async getStaff(cid, uid) {
      if (!isSafeId(cid) || !isSafeId(uid)) return null;
      note('getStaff', 1);
      return (staff[cid] ?? []).find((row) => row.uid === uid) ?? null;
    },

    async listStaff(cid) {
      if (!isSafeId(cid)) return [];
      const rows = staffRows(cid);
      const sorted = [...rows].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
      const taken = take(sorted, 100);
      noteQuery('listStaff', taken.length);
      return taken.map(copyAssignment);
    },

    async getStaffAssignment(cid, uid) {
      if (!isSafeId(cid) || !isSafeId(uid)) return null;
      note('getStaffAssignment', 1);
      const found = staffRows(cid).find((row) => row.uid === uid);
      return found ? copyAssignment(found) : null;
    },

    async listMatches(cid) {
      if (!isSafeId(cid)) return [];
      const rows = [...(matches[cid] ?? [])].sort(
        (a, b) => a.round - b.round || a.matchNo - b.matchNo || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      const taken = take(rows, CP_READ_LIMIT.matches);
      noteQuery('listMatches', taken.length);
      return taken;
    },

    async getMatch(cid, mtId) {
      if (!isSafeId(cid) || !isSafeId(mtId)) return null;
      note('getMatch', 1);
      return (matches[cid] ?? []).find((row) => row.id === mtId) ?? null;
    },

    async getSummaryShard(cid, shardId) {
      if (!isSafeId(cid) || !isSafeId(shardId)) return [];
      note('getSummaryShard', 1);
      const shard = (summary[cid] ?? []).find((row) => row.id === shardId);
      return shard ? [...shard.entries].sort(compareSummary) : [];
    },

    async listSummary(cid) {
      if (!isSafeId(cid)) return [];
      const shards = take(summary[cid] ?? [], CP_READ_LIMIT.summary);
      noteQuery('listSummary', shards.length);
      return shards.flatMap((shard) => [...shard.entries]).sort(compareSummary);
    },

    async listStandings(cid) {
      if (!isSafeId(cid)) return [];
      const rows = [...(standings[cid] ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const taken = take(rows, CP_READ_LIMIT.standings);
      noteQuery('listStandings', taken.length);
      return taken;
    },

    async listEntriesForCrest(cid) {
      if (!isSafeId(cid)) return [];
      const hit = crestCache.get(cid);
      if (hit) return hit;
      const rows = take(
        (entries[cid] ?? []).filter((row) => row.status === 'approved'),
        CP_READ_LIMIT.crest,
      );
      noteQuery('listEntriesForCrest', rows.length);
      const pending = Promise.resolve(rows);
      crestCache.set(cid, pending);
      return pending;
    },

    invalidateCrests(cid) {
      crestCache.delete(cid);
    },
  };
}
