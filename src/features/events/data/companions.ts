import { getFirebase } from '@/data/firebase';

export interface SignupCompanion {
  id: string;
  name: string;
}

/**
 * ASSUMPTION: 未附 B 同行者讀取契約；採 users/{uid}.companions
 * 唯讀陣列（id/name），集中於此 adapter，沒有 fallback 路徑或任何寫入。
 * 缺欄位視為無同行者；欄位格式錯誤直接 reject，避免誤當空名單。
 */
export async function loadSignupCompanions(uid: string): Promise<SignupCompanion[]> {
  const [{ doc, getDoc }, { db }] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);
  const snapshot = await getDoc(doc(db, 'users', uid));
  if (!snapshot.exists()) return [];
  const raw: unknown = snapshot.data().companions;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('Invalid companion list');

  const ids = new Set<string>();
  const result: SignupCompanion[] = [];
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object' ||
      !('id' in item) || typeof item.id !== 'string' || !item.id ||
      !('name' in item) || typeof item.name !== 'string' || !item.name.trim() ||
      ids.has(item.id)) {
      throw new Error('Invalid companion');
    }
    ids.add(item.id);
    result.push({ id: item.id, name: item.name });
  }
  return result;
}
