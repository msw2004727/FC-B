import { getFirebase } from '@/data/firebase';

/**
 * 照 A `saveTitles`（profile-data-stats.js#saveTitles）→
 *   `ApiService.updateCurrentUser({ titleBig, titleNormal })` →
 *   `users/{uid}.update({ titleBig, titleNormal, updatedAt: serverTimestamp() })`。
 * 只寫這三個欄位；值必須由呼叫端驗證在使用者已取得的稱號清單內。
 * 空字串轉 null（照 A `document.getElementById('title-big')?.value || null`）。
 */
export async function saveTitles(
  uid: string,
  titleBig: string | null,
  titleNormal: string | null,
): Promise<void> {
  const cleanUid = String(uid || '').trim();
  if (!cleanUid) throw new Error('saveTitles: uid is required');

  const [{ doc, updateDoc, serverTimestamp }, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  await updateDoc(doc(db, 'users', cleanUid), {
    titleBig: titleBig || null,
    titleNormal: titleNormal || null,
    updatedAt: serverTimestamp(),
  });
}
