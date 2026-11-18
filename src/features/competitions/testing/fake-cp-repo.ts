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
  type RosterPrivateDoc,
  type RosterPublicDoc,
  type StaffDoc,
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
}

function take<T>(items: readonly T[], limit: number): T[] {
  return items.slice(0, limit);
}

function isSafeId(id: string): boolean {
  return id.length > 0 && !id.includes('/') && id !== '.' && id !== '..';
}

/** 實作 CompetitionsRepo。回傳的物件可當 CompetitionsRepo 用。 */
export function createFakeCpRepo(seed: FakeCpSeed = {}): CompetitionsRepo {
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

  return {
    async getLaunch() {
      return launch;
    },

    async getLaunchTester(uid) {
      if (!isSafeId(uid)) return false;
      return testers.has(uid);
    },

    async listMine(uid) {
      if (!isSafeId(uid)) return [];
      return take(mine[uid] ?? [], CP_READ_LIMIT.mine);
    },

    async listPublic(includeInternal = false) {
      const rows = competitions.filter((doc) =>
        (includeInternal || doc.visibility === 'public') && doc.hidden === false
        && (doc.status === 'published' || doc.status === 'postponed' || doc.status === 'cancelled'));
      return take(rows, CP_READ_LIMIT.publicList);
    },

    async listByHostTeam(teamId, publicOnly) {
      if (!isSafeId(teamId)) return [];
      const rows = competitions.filter((doc) =>
        doc.hostTeamId === teamId && (!publicOnly || doc.visibility === 'public'));
      return take(rows, CP_READ_LIMIT.hostTeam);
    },

    async getCompetition(cid) {
      if (!isSafeId(cid)) return null;
      return competitions.find((doc) => doc.id === cid) ?? null;
    },

    async listDivisions(cid) {
      if (!isSafeId(cid)) return [];
      const rows = [...(divisions[cid] ?? [])].sort(
        (a, b) => a.order - b.order || (a.dvId < b.dvId ? -1 : a.dvId > b.dvId ? 1 : 0),
      );
      return take(rows, CP_READ_LIMIT.divisions);
    },

    async listEntries(cid) {
      if (!isSafeId(cid)) return [];
      return take(entries[cid] ?? [], CP_READ_LIMIT.entries);
    },

    async listRoster(cid, enId) {
      if (!isSafeId(cid) || !isSafeId(enId)) return [];
      return take((roster[cid] ?? []).filter((row) => row.enId === enId), CP_READ_LIMIT.roster);
    },

    async listEntryPrivate(cid, teamId) {
      if (!isSafeId(cid) || (teamId != null && !isSafeId(teamId))) return [];
      const rows = entryPrivate[cid] ?? [];
      const filtered = teamId == null ? rows : rows.filter((row) => row.teamId === teamId);
      return take(filtered, CP_READ_LIMIT.private);
    },

    async listRosterPrivate(cid, uid) {
      if (!isSafeId(cid) || (uid != null && !isSafeId(uid))) return [];
      const rows = rosterPrivate[cid] ?? [];
      const filtered = uid == null ? rows : rows.filter((row) => row.uid === uid);
      return take(filtered, CP_READ_LIMIT.private);
    },

    async getStaff(cid, uid) {
      if (!isSafeId(cid) || !isSafeId(uid)) return null;
      return (staff[cid] ?? []).find((row) => row.uid === uid) ?? null;
    },
  };
}
