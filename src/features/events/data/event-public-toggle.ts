import { getFirebase } from '@/data/firebase';

/** 照 A `toggleEventPublicFromDetail` → `FirebaseService.updateEvent`。 */
export async function saveEventPublic(eventDocId: string, isPublic: boolean): Promise<void> {
  const docId = eventDocId.trim();
  if (!docId) throw new Error('EVENT_DOC_NOT_FOUND');
  const [firebase, fs] = await Promise.all([getFirebase(), import('firebase/firestore')]);
  await fs.updateDoc(fs.doc(firebase.db, 'events', docId), {
    isPublic,
    updatedAt: fs.serverTimestamp(),
  });
}
