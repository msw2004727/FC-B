// 俱樂部代表＝teams.captainUid 是我。職員（幹部、教練）不算代表。
// 「我管理的俱樂部」另用 viewer.staffTeams，不在這裡。

import type { CpClub } from './access';

export async function loadRepClubs(uid: string): Promise<CpClub[]> {
  if (!uid) return [];
  const [{ getFirebase }, fs] = await Promise.all([
    import('@/data/firebase'),
    import('firebase/firestore'),
  ]);
  const { db } = await getFirebase();
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'teams'), fs.where('captainUid', '==', uid)));
  const clubs: CpClub[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const id = String(data.id ?? doc.id).trim();
    const name = String(data.name || data.teamName || '').trim();
    if (!id || !name) continue;
    if (clubs.some((club) => club.id === id)) continue;
    clubs.push({ id, name });
  }
  return clubs;
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
