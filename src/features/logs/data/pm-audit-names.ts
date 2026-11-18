/**
 * 聊天室稽核用的 UID → 暱稱查詢（顧問 §3.195 硬條件 5）。
 * - 只在 super_admin 打開聊天室稽核頁籤後才呼叫（呼叫端負責）。
 * - `users` 根文件現行 Rules 為 `isAuth()` 可讀；用 `documentId() in` 每批 ≤ 30 筆（同 ops-dashboard／user-roles 寫法）。
 * - 結果只放記憶體（模組層 Map），不寫 localStorage；查不到的 UID 記成空字串，同一 UID 不重查。
 * - 暱稱是「現在的」暱稱，畫面一律並列 UID 短碼。
 */
const NAME_BATCH_SIZE = 30;
const cache = new Map<string, string>();

export type NameResolver = (uids: readonly string[]) => Promise<Record<string, string>>;

function pickName(data: Record<string, unknown>): string {
  const name = [data['displayName'], data['name']].find(
    (v): v is string => typeof v === 'string' && v.trim() !== '',
  );
  return name ? name.trim() : '';
}

export const resolvePmUserNames: NameResolver = async (uids) => {
  const wanted = [...new Set(uids.map((u) => String(u || '').trim()).filter(Boolean))];
  const missing = wanted.filter((uid) => !cache.has(uid));
  if (missing.length > 0) {
    const [{ getFirebase }, fs] = await Promise.all([import('@/data/firebase'), import('firebase/firestore')]);
    const { db } = await getFirebase();
    for (let i = 0; i < missing.length; i += NAME_BATCH_SIZE) {
      const batch = missing.slice(i, i + NAME_BATCH_SIZE);
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'users'), fs.where(fs.documentId(), 'in', batch)));
      const found = new Map<string, string>();
      for (const d of snap.docs) found.set(d.id, pickName((d.data() ?? {}) as Record<string, unknown>));
      for (const uid of batch) cache.set(uid, found.get(uid) ?? '');
    }
  }
  const out: Record<string, string> = {};
  for (const uid of wanted) out[uid] = cache.get(uid) ?? '';
  return out;
};

/** 測試用：清掉記憶體快取。 */
export function _resetPmNameCacheForTest(): void {
  cache.clear();
}
