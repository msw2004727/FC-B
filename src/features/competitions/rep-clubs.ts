// 俱樂部代表＝主站 Rules `isCurrentUserTeamCaptainOrLeader`：
// captainUid、creatorUid、ownerUid、leaderUid、leaderUids。不含教練。
// 建賽俱樂部清單、報隊鈕、俱樂部主辦判斷都讀 representativeClubs（同一份 repClubs）。
//
// 代表欄位不能一次 OR。viewer 的 loadTeamsForUser 已經查過的欄位沿用文件，
// 只補查缺的（通常是 creatorUid、ownerUid）。viewer 還沒查完就查全部代表欄位。
// ASSUMPTION: 這份清單跟登入 session 走，不過期；登出或換帳號才清。同一 uid 進行中的請求合併成一筆。
// 單一欄位查詢失敗就略過該欄，不把整份清單清成空的。
// 俱樂部 id 只用 Firestore 文件路徑 id。後端與 Rules 只信路徑 id，不讀欄位 id。

import { on } from '@/core/events';
import { peekViewerTeamScan } from '@/features/profile/data/viewer-team-scan';
import type { CpClub } from './access';

export interface ClubRepFields {
  captainUid?: unknown;
  creatorUid?: unknown;
  ownerUid?: unknown;
  leaderUid?: unknown;
  leaderUids?: unknown;
  /** 只為測試標明教練不算代表。判斷時不讀這個欄位。 */
  coachUids?: unknown;
}

/** 與 Rules 相同：字串嚴格相等，leaderUids 用清單包含。不 trim、不含教練。 */
export function isClubRepresentative(uid: string, team: ClubRepFields | null | undefined): boolean {
  if (!uid || !team) return false;
  if (team.captainUid === uid) return true;
  if (team.creatorUid === uid) return true;
  if (team.ownerUid === uid) return true;
  if (team.leaderUid === uid) return true;
  return Array.isArray(team.leaderUids) && team.leaderUids.includes(uid);
}

/** 建賽下拉、報隊、俱樂部主辦判斷共用這份清單，不要改讀 staffTeams（staff 含教練）。 */
export function representativeClubs(actor: { repClubs: readonly CpClub[] }): readonly CpClub[] {
  return actor.repClubs;
}

export function collectRepClubs(
  uid: string,
  docs: ReadonlyArray<{ id: string; data: Record<string, unknown> }>,
): CpClub[] {
  const clubs: CpClub[] = [];
  for (const doc of docs) {
    if (!isClubRepresentative(uid, doc.data)) continue;
    const id = String(doc.id).trim();
    const name = String(doc.data.name || doc.data.teamName || '').trim();
    if (!id || !name) continue;
    if (clubs.some((club) => club.id === id)) continue;
    clubs.push({ id, name });
  }
  return clubs;
}

const REP_QUERIES = [
  ['captainUid', '=='],
  ['creatorUid', '=='],
  ['ownerUid', '=='],
  ['leaderUid', '=='],
  ['leaderUids', 'array-contains'],
] as const;

interface RepCacheEntry {
  clubs: CpClub[];
}

const repCache = new Map<string, RepCacheEntry>();
const repInflight = new Map<string, Promise<CpClub[]>>();

function copyClubs(clubs: readonly CpClub[]): CpClub[] {
  return clubs.map((club) => ({ ...club }));
}

/** 清掉快取與進行中請求。進行中的請求回來後不再寫入。 */
export function invalidateRepClubs(): void {
  repCache.clear();
  repInflight.clear();
}

/** 測試用：清掉 session 快取，避免案例互相殘留。 */
export function resetRepClubsCacheForTest(): void {
  invalidateRepClubs();
}

on('auth:changed', ({ uid }) => {
  if (uid == null || [...repCache.keys(), ...repInflight.keys()].some((key) => key !== uid)) {
    invalidateRepClubs();
  }
});

async function queryRepFields(
  uid: string,
  fields: ReadonlyArray<(typeof REP_QUERIES)[number]>,
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  if (fields.length === 0) return [];
  const [{ getFirebase }, fs] = await Promise.all([
    import('@/data/firebase'),
    import('firebase/firestore'),
  ]);
  const { db } = await getFirebase();
  const groups = await Promise.all(fields.map(async ([field, op]) => {
    try {
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'teams'), fs.where(field, op, uid)));
      return snap.docs.map((doc) => ({
        id: doc.id,
        data: doc.data() as Record<string, unknown>,
      }));
    } catch {
      return [];
    }
  }));
  return groups.flat();
}

async function fetchRepClubs(uid: string): Promise<CpClub[]> {
  const scan = peekViewerTeamScan(uid);
  const covered = new Set<string>(scan?.fields ?? []);
  const missing = REP_QUERIES.filter(([field]) => !covered.has(field));
  const fetched = await queryRepFields(uid, missing);
  const reused = (scan?.docs ?? []).map((doc) => ({ id: doc.docId, data: doc.data }));
  return collectRepClubs(uid, [...reused, ...fetched]);
}

export async function loadRepClubs(uid: string): Promise<CpClub[]> {
  if (!uid) return [];
  const hit = repCache.get(uid);
  if (hit) return copyClubs(hit.clubs);

  let request = repInflight.get(uid);
  if (!request) {
    const started = fetchRepClubs(uid);
    request = started;
    repInflight.set(uid, started);
    started.then(
      (clubs) => {
        // 已被登出、換帳號或換成新請求：只交給原呼叫端，不寫入快取。
        if (repInflight.get(uid) !== started) return;
        repInflight.delete(uid);
        repCache.set(uid, { clubs });
      },
      () => {
        if (repInflight.get(uid) === started) repInflight.delete(uid);
      },
    );
  }
  return request.then(copyClubs);
}

/** 自己登錄時用來判斷是不是未成年。讀 users/{uid}.birthday，沒有就當未知。 */
export async function loadMyBirthday(uid: string): Promise<string | null> {
  if (!uid) return null;
  const [{ getFirebase }, fs] = await Promise.all([
    import('@/data/firebase'),
    import('firebase/firestore'),
  ]);
  const { db } = await getFirebase();
  const snap = await fs.getDoc(fs.doc(db, 'users', uid));
  const birthday = snap.exists() ? snap.data()?.birthday : null;
  return typeof birthday === 'string' && birthday.trim() ? birthday.trim() : null;
}
