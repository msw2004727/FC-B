/**
 * 放鴿子／出席率 v2（站長 11-06）：管理名單 🕊「放鴿子/計入」的資料來源。
 * 只讀名單 UID 的 userAttendanceStats/{uid}（documentId in，每 30 個一塊），不掃全集合、不寫入。
 * 只有文件帶 countedSince 的人才算 v2 來源；其餘不回傳，呼叫端退回 users 三欄與舊補正。
 */
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import {
  USER_ATTENDANCE_STATS_COLLECTION,
  normalizeUserAttendanceSummary,
} from '@/features/profile/data/attendance-summary';
import { NO_SHOW_FEATURE_ENABLED, type CountedNoShowStat } from './noshow-roster';

export const MAX_UIDS_PER_COUNTED_QUERY = 30;

/**
 * canViewNoShow 由頁面既有權限判斷傳入，資料層不另算一份權限。
 * 無權限、旗標關閉或空 UID：零 Firebase 初始化／零查詢。
 * 每次呼叫最多 ceil(去重 UID 數 / 30) 次查詢；無監聽、無自動重試、無持久快取。
 * 任一塊失敗即 reject，呼叫端不可把失敗當成「沒有資料」。
 */
export async function loadCountedNoShowStats(
  uids: readonly string[],
  canViewNoShow: boolean,
  featureEnabled = NO_SHOW_FEATURE_ENABLED,
): Promise<Map<string, CountedNoShowStat>> {
  const result = new Map<string, CountedNoShowStat>();
  if (canViewNoShow !== true || !featureEnabled) return result;
  const normalized = [...new Set(uids.map((uid) => uid.trim()).filter(Boolean))];
  if (normalized.length === 0) return result;

  const { db } = await getFirebase();
  for (let i = 0; i < normalized.length; i += MAX_UIDS_PER_COUNTED_QUERY) {
    const batch = normalized.slice(i, i + MAX_UIDS_PER_COUNTED_QUERY);
    const snapshot = await getDocs(query(
      collection(db, USER_ATTENDANCE_STATS_COLLECTION),
      where(documentId(), 'in', batch),
    ));
    for (const docSnap of snapshot.docs) {
      // 以文件 ID 為準；文件內容的 uid 不得改變對象（R-ID-002）。
      const v2 = normalizeUserAttendanceSummary(
        docSnap.id,
        docSnap.data() as Record<string, unknown>,
      ).v2;
      if (v2) result.set(docSnap.id, { noShowCount: v2.countedNoShowCount, countedCount: v2.countedCount });
    }
  }
  return result;
}
