/** T-073a：只讀名單 UID 的補正，禁止全集合掃描與補正寫入。 */
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import { NO_SHOW_FEATURE_ENABLED } from './noshow-roster';

const MAX_UIDS_PER_QUERY = 30;

/**
 * canViewNoShow 由頁面既有權限判斷傳入，資料層不另算一份權限。
 * 無權限、旗標關閉或空 UID：零 Firebase 初始化／零查詢。
 * 每次呼叫最多 ceil(去重 UID 數 / 30) 次查詢；無監聽、無自動重試、無持久快取。
 * 任一批失敗即 reject，呼叫端須處理錯誤，不可把失敗當成「沒有補正」。
 */
export async function loadNoShowAdjustments(
  uids: readonly string[],
  canViewNoShow: boolean,
  featureEnabled = NO_SHOW_FEATURE_ENABLED,
): Promise<Map<string, unknown>> {
  const result = new Map<string, unknown>();
  if (canViewNoShow !== true || !featureEnabled) return result;
  const normalized = [...new Set(uids.map((uid) => uid.trim()).filter(Boolean))];
  if (normalized.length === 0) return result;

  const { db } = await getFirebase();
  for (let i = 0; i < normalized.length; i += MAX_UIDS_PER_QUERY) {
    const batch = normalized.slice(i, i + MAX_UIDS_PER_QUERY);
    const snapshot = await getDocs(query(
      collection(db, 'userCorrections'),
      where(documentId(), 'in', batch),
    ));
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      const noShow = data.noShow;
      const adjustment = noShow && typeof noShow === 'object'
        ? (noShow as { adjustment?: unknown }).adjustment
        : undefined;
      // 以文件 ID 為準；文件內容的 uid 不得改變對象（R-ID-002）。
      result.set(docSnap.id, adjustment);
    }
  }
  return result;
}
