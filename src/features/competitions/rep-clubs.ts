// 俱樂部代表＝主站 Rules `isCurrentUserTeamCaptainOrLeader`：
// captainUid、creatorUid、ownerUid、leaderUid、leaderUids。不含教練。
// 建賽俱樂部清單、報隊鈕、俱樂部主辦判斷都讀 representativeClubs（同一份 repClubs）。
//
// ASSUMPTION: Firestore 不能一次 OR 五個欄位，所以各查一次再合併。
// 單一欄位查詢失敗就略過該欄，不把整份清單清成空的。

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
    const id = String(doc.data.id ?? doc.id).trim();
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

export async function loadRepClubs(uid: string): Promise<CpClub[]> {
  if (!uid) return [];
  const [{ getFirebase }, fs] = await Promise.all([
    import('@/data/firebase'),
    import('firebase/firestore'),
  ]);
  const { db } = await getFirebase();
  const groups = await Promise.all(REP_QUERIES.map(async ([field, op]) => {
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
  return collectRepClubs(uid, groups.flat());
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
