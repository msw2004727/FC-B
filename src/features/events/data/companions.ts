import { getFirebase } from '@/data/firebase';

export interface SignupCompanion {
  id: string;
  name: string;
  /** 照 A `_openCompanionSelectModal` 每列會顯示 gender/notes；缺欄位不影響，多出未知欄位不再 throw。 */
  gender?: string;
  notes?: string;
}

/**
 * ASSUMPTION: 未附 B 同行者讀取契約；採 users/{uid}.companions
 * 唯讀陣列（id/name 必填，A 彈窗會用到的 gender/notes 為選填字串）。
 * 集中於此 adapter，沒有 fallback 路徑或任何寫入。
 * 必填欄位缺漏仍視為無效名單 throw；選填欄位型別錯誤直接忽略。
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
    const entry: SignupCompanion = { id: item.id, name: item.name };
    if ('gender' in item && typeof item.gender === 'string' && item.gender) {
      entry.gender = item.gender;
    }
    if ('notes' in item && typeof item.notes === 'string' && item.notes) {
      entry.notes = item.notes;
    }
    result.push(entry);
  }
  return result;
}
