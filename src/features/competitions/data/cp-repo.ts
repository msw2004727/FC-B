// asia-main 讀取。每個契約 §3 的讀取一個方法，筆數上限照表（CP_READ_LIMIT）。
// 不寫入。寫入走 cp-callables。
//
// ASSUMPTION: divisions、entries、roster、entryPrivate、rosterPrivate、staff 都是 competitions/{cid} 底下的子集合。
// ASSUMPTION: 時間若是 Firestore Timestamp（有 toMillis）就轉成毫秒；契約寫的是整數毫秒。
// ASSUMPTION: 組別讀出後依 order 再依 dvId 排序，查詢本身不加 orderBy（契約沒有要求索引）。
// ASSUMPTION: 有篩選的私密查詢同樣最多 100 筆（契約只對不帶篩選寫了 limit）。
// ASSUMPTION: id 含「/」視為無效，回空結果，避免路徑跳出集合。
// ASSUMPTION: 缺 hidden 視為 false；缺 isMinor、rosterConfirmed 視為 false；缺 stateVersion、人數、費用視為 0。
// ASSUMPTION: requireRealName 缺值時，有年齡限制則 true，否則 false（契約：預設＝有年齡限制）。
// ASSUMPTION: getStaff 對應契約正文的 staff/{uid}.roles，讀取表沒有獨立一列。

import { getCpFirebase } from './cp-firebase';
import {
  CP_READ_LIMIT,
  type CompetitionDoc,
  type CompetitionSport,
  type CompetitionStatus,
  type CpMineItem,
  type DivisionDoc,
  type EntryDoc,
  type EntryPrivateDoc,
  type EntryStatus,
  type HostType,
  type LaunchDoc,
  type MapProvider,
  type MineRole,
  type PaymentStatus,
  type PlayersOnField,
  type RosterPositionCode,
  type RosterPrivateDoc,
  type RosterPublicDoc,
  type StaffDoc,
  type StaffRole,
  type Venue,
} from './types';

export interface CompetitionsRepo {
  getLaunch(): Promise<LaunchDoc | null>;
  getLaunchTester(uid: string): Promise<boolean>;
  listMine(uid: string): Promise<CpMineItem[]>;
  listPublic(): Promise<CompetitionDoc[]>;
  listByHostTeam(teamId: string, publicOnly: boolean): Promise<CompetitionDoc[]>;
  getCompetition(cid: string): Promise<CompetitionDoc | null>;
  listDivisions(cid: string): Promise<DivisionDoc[]>;
  listEntries(cid: string): Promise<EntryDoc[]>;
  listRoster(cid: string, enId: string): Promise<RosterPublicDoc[]>;
  /** teamId 為 null：不帶篩選（主辦／發起人），最多 100。有值則 where teamId。 */
  listEntryPrivate(cid: string, teamId: string | null): Promise<EntryPrivateDoc[]>;
  /** uid 為 null：不帶篩選，最多 100。有值則 where uid。 */
  listRosterPrivate(cid: string, uid: string | null): Promise<RosterPrivateDoc[]>;
  getStaff(cid: string, uid: string): Promise<StaffDoc | null>;
}

interface DocSnap {
  id: string;
  exists(): boolean;
  data(): Record<string, unknown> | undefined;
}

interface QuerySnap {
  docs: ReadonlyArray<{ id: string; data(): Record<string, unknown> }>;
}

export interface CpFirestoreSdk {
  doc(db: unknown, path: string): unknown;
  collection(db: unknown, path: string): unknown;
  query(col: unknown, ...clauses: unknown[]): unknown;
  where(field: string, op: string, value: unknown): unknown;
  limit(n: number): unknown;
  getDoc(ref: unknown): Promise<DocSnap>;
  getDocs(query: unknown): Promise<QuerySnap>;
}

export interface CpRepoDeps {
  getDb: () => Promise<unknown>;
  loadSdk: () => Promise<CpFirestoreSdk>;
}

const PUBLIC_STATUSES: readonly CompetitionStatus[] = ['published', 'postponed', 'cancelled'];
const HOST_TYPES: readonly HostType[] = ['personal', 'club'];
const STATUSES: readonly CompetitionStatus[] = ['draft', 'published', 'postponed', 'cancelled'];
const ENTRY_STATUSES: readonly EntryStatus[] = ['pending', 'approved', 'rejected', 'withdrawn'];
const PAYMENT_STATUSES: readonly PaymentStatus[] = ['none', 'pending', 'paid', 'refunded'];
const PLAYERS: readonly PlayersOnField[] = [5, 7, 8, 9, 11];
const POSITIONS: readonly RosterPositionCode[] = ['GK', 'DF', 'MF', 'FW', 'custom'];
const MINE_ROLES: readonly MineRole[] = ['host', 'rep', 'player'];
const STAFF_ROLES: readonly StaffRole[] = ['host', 'coHost'];

function isSafeId(id: string): boolean {
  return id.length > 0 && !id.includes('/') && id !== '.' && id !== '..';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isRecord(value) && typeof value.toMillis === 'function') {
    const millis = (value.toMillis as () => unknown)();
    if (typeof millis === 'number' && Number.isFinite(millis)) return millis;
  }
  return null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null;
}

function optNum(value: unknown): number | null {
  return value == null ? null : num(value);
}

function venueOf(value: unknown): Venue | null {
  if (!isRecord(value)) return null;
  const name = str(value.name);
  if (!name) return null;
  const venue: Venue = { name };
  const address = str(value.address);
  if (address) venue.address = address;
  const lat = num(value.lat);
  const lng = num(value.lng);
  if (lat != null) venue.lat = lat;
  if (lng != null) venue.lng = lng;
  const mapPlaceId = str(value.mapPlaceId);
  if (mapPlaceId) venue.mapPlaceId = mapPlaceId;
  const mapProvider = oneOf<MapProvider>(value.mapProvider, ['google', 'manual']);
  if (mapProvider) venue.mapProvider = mapProvider;
  return venue;
}

export function competitionFromDoc(id: string, raw: Record<string, unknown>): CompetitionDoc | null {
  const name = str(raw.name);
  const sport = oneOf<CompetitionSport>(raw.sport, ['football']);
  const hostType = oneOf(raw.hostType, HOST_TYPES);
  const status = oneOf(raw.status, STATUSES);
  const visibility = str(raw.visibility);
  const timezone = str(raw.timezone);
  const regOpenAt = num(raw.regOpenAt);
  const regCloseAt = num(raw.regCloseAt);
  const firstMatchAt = num(raw.firstMatchAt);
  const lastMatchAt = num(raw.lastMatchAt);
  if (!name || !sport || !hostType || !status || !visibility || !timezone) return null;
  if (regOpenAt == null || regCloseAt == null || firstMatchAt == null || lastMatchAt == null) return null;
  const venues = Array.isArray(raw.venues)
    ? raw.venues.map(venueOf).filter((venue): venue is Venue => venue != null)
    : [];
  const liveLinks = Array.isArray(raw.liveLinks)
    ? raw.liveLinks.filter((link): link is string => typeof link === 'string')
    : [];
  return {
    id,
    name,
    sport,
    hostType,
    hostTeamId: str(raw.hostTeamId),
    hostDisplay: str(raw.hostDisplay),
    visibility,
    status,
    statusReason: str(raw.statusReason),
    hidden: bool(raw.hidden) ?? false,
    regOpenAt,
    regCloseAt,
    firstMatchAt,
    lastMatchAt,
    endedAt: optNum(raw.endedAt),
    rostersLockedAt: optNum(raw.rostersLockedAt),
    ageBasisAt: optNum(raw.ageBasisAt),
    timezone,
    venues,
    feeNote: str(raw.feeNote),
    liveLinks,
    stateVersion: num(raw.stateVersion) ?? 0,
  };
}

function divisionFromDoc(id: string, raw: Record<string, unknown>): DivisionDoc | null {
  const name = str(raw.name);
  const playersOnField = oneOf<`${PlayersOnField}`>(String(raw.playersOnField), PLAYERS.map(String) as `${PlayersOnField}`[]);
  const onField = playersOnField == null ? null : Number(playersOnField) as PlayersOnField;
  const maxTeams = num(raw.maxTeams);
  const rosterMin = num(raw.rosterMin);
  const rosterMax = num(raw.rosterMax);
  if (!name || onField == null || maxTeams == null || rosterMin == null || rosterMax == null) return null;
  const minAge = optNum(raw.minAge);
  const maxAge = optNum(raw.maxAge);
  const dvId = str(raw.dvId) ?? id;
  return {
    dvId,
    name,
    playersOnField: onField,
    maxTeams,
    rosterMin,
    rosterMax,
    minAge,
    maxAge,
    requireRealName: bool(raw.requireRealName) ?? (minAge != null || maxAge != null),
    feePerTeam: num(raw.feePerTeam) ?? 0,
    entryCount: num(raw.entryCount) ?? 0,
    approvedCount: num(raw.approvedCount) ?? 0,
    order: num(raw.order) ?? 0,
  };
}

function entryFromDoc(id: string, raw: Record<string, unknown>): EntryDoc | null {
  const dvId = str(raw.dvId);
  const teamId = str(raw.teamId);
  const name = str(raw.name);
  const status = oneOf(raw.status, ENTRY_STATUSES);
  if (!dvId || !teamId || !name || !status) return null;
  return {
    id,
    dvId,
    teamId,
    name,
    status,
    rosterCount: num(raw.rosterCount) ?? 0,
    rosterConfirmed: bool(raw.rosterConfirmed) ?? false,
  };
}

function entryPrivateFromDoc(id: string, raw: Record<string, unknown>): EntryPrivateDoc | null {
  const teamId = str(raw.teamId);
  const paymentStatus = oneOf(raw.paymentStatus, PAYMENT_STATUSES);
  if (!teamId || !paymentStatus) return null;
  return {
    id,
    teamId,
    contactName: str(raw.contactName),
    contactPhone: str(raw.contactPhone),
    paymentStatus,
    reviewNote: str(raw.reviewNote),
  };
}

function rosterFromDoc(id: string, raw: Record<string, unknown>): RosterPublicDoc | null {
  const enId = str(raw.enId);
  const displayName = str(raw.displayName);
  const number = num(raw.number);
  if (!enId || displayName == null || number == null) return null;
  return {
    id,
    enId,
    displayName,
    number,
    position: oneOf(raw.position, POSITIONS),
    positionText: str(raw.positionText),
    isMinor: bool(raw.isMinor) ?? false,
  };
}

function mineFromDoc(id: string, raw: Record<string, unknown>): CpMineItem | null {
  const roles = Array.isArray(raw.roles)
    ? raw.roles.filter((role): role is MineRole => oneOf(role, MINE_ROLES) != null)
    : [];
  return {
    id,
    cid: str(raw.cid) ?? id,
    roles,
    host: bool(raw.host) ?? false,
  };
}

function staffFromDoc(uid: string, raw: Record<string, unknown>): StaffDoc | null {
  const roles = Array.isArray(raw.roles)
    ? raw.roles.filter((role): role is StaffRole => oneOf(role, STAFF_ROLES) != null)
    : [];
  return { uid, roles };
}

function launchFromDoc(raw: Record<string, unknown>): LaunchDoc | null {
  const isPublic = bool(raw.isPublic);
  if (isPublic == null) return null;
  const bannedWords = Array.isArray(raw.bannedWords)
    // 去頭尾空白並丟掉空字串：設定混入 '' 時不得讓所有名稱都判為禁用（Flash 交叉審 P3）
    ? raw.bannedWords.filter((word): word is string => typeof word === 'string').map(w => w.trim()).filter(w => w.length > 0)
    : [];
  return { isPublic, bannedWords };
}

export function createCompetitionsRepo(deps: CpRepoDeps): CompetitionsRepo {
  async function ready(): Promise<{ db: unknown; sdk: CpFirestoreSdk }> {
    const [db, sdk] = await Promise.all([deps.getDb(), deps.loadSdk()]);
    return { db, sdk };
  }

  return {
    async getLaunch() {
      const { db, sdk } = await ready();
      const snap = await sdk.getDoc(sdk.doc(db, 'cpConfig/launch'));
      if (!snap.exists()) return null;
      const data = snap.data();
      return data ? launchFromDoc(data) : null;
    },

    async getLaunchTester(uid) {
      if (!isSafeId(uid)) return false;
      const { db, sdk } = await ready();
      const snap = await sdk.getDoc(sdk.doc(db, `cpConfig/launch/testers/${uid}`));
      return snap.exists();
    },

    async listMine(uid) {
      if (!isSafeId(uid)) return [];
      const { db, sdk } = await ready();
      const snap = await sdk.getDocs(sdk.query(
        sdk.collection(db, `cpMine/${uid}/items`),
        sdk.limit(CP_READ_LIMIT.mine),
      ));
      return snap.docs
        .map((doc) => mineFromDoc(doc.id, doc.data() ?? {}))
        .filter((item): item is CpMineItem => item != null);
    },

    async listPublic() {
      const { db, sdk } = await ready();
      const snap = await sdk.getDocs(sdk.query(
        sdk.collection(db, 'competitions'),
        sdk.where('visibility', '==', 'public'),
        sdk.where('hidden', '==', false),
        sdk.where('status', 'in', [...PUBLIC_STATUSES]),
        sdk.limit(CP_READ_LIMIT.publicList),
      ));
      return snap.docs
        .map((doc) => competitionFromDoc(doc.id, doc.data() ?? {}))
        .filter((doc): doc is CompetitionDoc => doc != null);
    },

    async listByHostTeam(teamId, publicOnly) {
      if (!isSafeId(teamId)) return [];
      const { db, sdk } = await ready();
      const clauses: unknown[] = [sdk.where('hostTeamId', '==', teamId)];
      if (publicOnly) clauses.push(sdk.where('visibility', '==', 'public'));
      clauses.push(sdk.limit(CP_READ_LIMIT.hostTeam));
      const snap = await sdk.getDocs(sdk.query(sdk.collection(db, 'competitions'), ...clauses));
      return snap.docs
        .map((doc) => competitionFromDoc(doc.id, doc.data() ?? {}))
        .filter((doc): doc is CompetitionDoc => doc != null);
    },

    async getCompetition(cid) {
      if (!isSafeId(cid)) return null;
      const { db, sdk } = await ready();
      const snap = await sdk.getDoc(sdk.doc(db, `competitions/${cid}`));
      if (!snap.exists()) return null;
      const data = snap.data();
      return data ? competitionFromDoc(snap.id, data) : null;
    },

    async listDivisions(cid) {
      if (!isSafeId(cid)) return [];
      const { db, sdk } = await ready();
      const snap = await sdk.getDocs(sdk.query(
        sdk.collection(db, `competitions/${cid}/divisions`),
        sdk.limit(CP_READ_LIMIT.divisions),
      ));
      return snap.docs
        .map((doc) => divisionFromDoc(doc.id, doc.data() ?? {}))
        .filter((doc): doc is DivisionDoc => doc != null)
        .sort((a, b) => a.order - b.order || (a.dvId < b.dvId ? -1 : a.dvId > b.dvId ? 1 : 0));
    },

    async listEntries(cid) {
      if (!isSafeId(cid)) return [];
      const { db, sdk } = await ready();
      const snap = await sdk.getDocs(sdk.query(
        sdk.collection(db, `competitions/${cid}/entries`),
        sdk.limit(CP_READ_LIMIT.entries),
      ));
      return snap.docs
        .map((doc) => entryFromDoc(doc.id, doc.data() ?? {}))
        .filter((doc): doc is EntryDoc => doc != null);
    },

    async listRoster(cid, enId) {
      if (!isSafeId(cid) || !isSafeId(enId)) return [];
      const { db, sdk } = await ready();
      const snap = await sdk.getDocs(sdk.query(
        sdk.collection(db, `competitions/${cid}/roster`),
        sdk.where('enId', '==', enId),
        sdk.limit(CP_READ_LIMIT.roster),
      ));
      return snap.docs
        .map((doc) => rosterFromDoc(doc.id, doc.data() ?? {}))
        .filter((doc): doc is RosterPublicDoc => doc != null);
    },

    async listEntryPrivate(cid, teamId) {
      if (!isSafeId(cid) || (teamId != null && !isSafeId(teamId))) return [];
      const { db, sdk } = await ready();
      const clauses: unknown[] = [];
      if (teamId != null) clauses.push(sdk.where('teamId', '==', teamId));
      clauses.push(sdk.limit(CP_READ_LIMIT.private));
      const snap = await sdk.getDocs(sdk.query(sdk.collection(db, `competitions/${cid}/entryPrivate`), ...clauses));
      return snap.docs
        .map((doc) => entryPrivateFromDoc(doc.id, doc.data() ?? {}))
        .filter((doc): doc is EntryPrivateDoc => doc != null);
    },

    async listRosterPrivate(cid, uid) {
      if (!isSafeId(cid) || (uid != null && !isSafeId(uid))) return [];
      const { db, sdk } = await ready();
      const clauses: unknown[] = [];
      if (uid != null) clauses.push(sdk.where('uid', '==', uid));
      clauses.push(sdk.limit(CP_READ_LIMIT.private));
      const snap = await sdk.getDocs(sdk.query(sdk.collection(db, `competitions/${cid}/rosterPrivate`), ...clauses));
      return snap.docs
        .map((doc) => {
          const data = doc.data() ?? {};
          const owner = str(data.uid) ?? uid ?? '';
          if (!owner) return null;
          return { id: doc.id, uid: owner };
        })
        .filter((doc): doc is RosterPrivateDoc => doc != null);
    },

    async getStaff(cid, uid) {
      if (!isSafeId(cid) || !isSafeId(uid)) return null;
      const { db, sdk } = await ready();
      const snap = await sdk.getDoc(sdk.doc(db, `competitions/${cid}/staff/${uid}`));
      if (!snap.exists()) return null;
      const data = snap.data();
      return data ? staffFromDoc(uid, data) : null;
    },
  };
}

let singleton: CompetitionsRepo | null = null;

/** 預設實作：資料庫是 getCpFirebase() 的 asia-main。import 本模組不會連線。 */
export function getCompetitionsRepo(): CompetitionsRepo {
  if (!singleton) {
    singleton = createCompetitionsRepo({
      getDb: async () => (await getCpFirebase()).db,
      loadSdk: async () => (await import('firebase/firestore')) as unknown as CpFirestoreSdk,
    });
  }
  return singleton;
}

/** 測試用。 */
export function _resetCompetitionsRepoForTest(): void {
  singleton = null;
}
