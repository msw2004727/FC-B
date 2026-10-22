/**
 * M-076：收藏讀寫（寫入格式必須與 A 完全一致）。
 * A 寫入鏈：`favorites.js#toggleFavoriteEvent` → `ApiService.updateCurrentUser` → `FirebaseService.updateUser`
 *   → `users/{docId}.update({ favorites, updatedAt: serverTimestamp() })`。
 * B 的使用者文件 ID 就是 uid（見 `src/data/stealth.ts` 同樣從 `users/{uid}` 讀寫）。
 */
import { getFirebase as defaultGetFirebase } from '@/data/firebase';

export interface FavoritesDoc { events: string[]; tournaments: string[]; }

/**
 * 照 A `_getFavorites`：沒有或格式不對時回 `{ events: [], tournaments: [] }`；
 * 非陣列欄位視為 `[]`；非字串元素一律過濾掉。
 */
export function normalizeFavorites(raw: unknown): FavoritesDoc {
  const record = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const events = Array.isArray(record.events)
    ? record.events.filter((v): v is string => typeof v === 'string')
    : [];
  const tournaments = Array.isArray(record.tournaments)
    ? record.tournaments.filter((v): v is string => typeof v === 'string')
    : [];
  return { events: [...events], tournaments: [...tournaments] };
}

/**
 * 照 A `toggleFavoriteEvent` 的陣列運算：不在就 push 到尾端，在就移除第一個；
 * `tournaments` 原樣保留。回傳新物件（不變更輸入）與 added 旗標。
 */
export function toggleEventInFavorites(
  current: FavoritesDoc,
  eventId: string,
): { next: FavoritesDoc; added: boolean } {
  const events = [...current.events];
  const tournaments = [...current.tournaments];
  const idx = events.indexOf(eventId);
  const added = idx < 0;
  if (added) events.push(eventId);
  else events.splice(idx, 1);
  return { next: { events, tournaments }, added };
}

/** 讀 `users/{uid}.favorites`。失敗 reject。 */
export async function loadFavorites(uid: string): Promise<FavoritesDoc> {
  const cleanUid = String(uid || '').trim();
  if (!cleanUid) throw new Error('loadFavorites: uid is required');
  const [firebase, fs] = await Promise.all([defaultGetFirebase(), import('firebase/firestore')]);
  const snap = await fs.getDoc(fs.doc(firebase.db, 'users', cleanUid));
  if (!snap.exists()) return { events: [], tournaments: [] };
  const data = snap.data() as Record<string, unknown> | undefined;
  return normalizeFavorites(data?.favorites);
}

/**
 * 寫 `users/{uid}.favorites`（含 `updatedAt: serverTimestamp()`）。
 * 欄位只有這兩個（與 A `FirebaseService.updateUser` 一致）。
 */
export async function saveFavorites(uid: string, next: FavoritesDoc): Promise<void> {
  const cleanUid = String(uid || '').trim();
  if (!cleanUid) throw new Error('saveFavorites: uid is required');
  const [firebase, fs] = await Promise.all([defaultGetFirebase(), import('firebase/firestore')]);
  await fs.updateDoc(fs.doc(firebase.db, 'users', cleanUid), {
    favorites: { events: [...next.events], tournaments: [...next.tournaments] },
    updatedAt: fs.serverTimestamp(),
  });
}
