/**
 * 錯誤日誌／用戶提示讀取（2026-11-16 日誌中心第二批）。
 * 取代 A `_buildCollectionQuery('errorLogs')` 的「任意 200 筆、無排序」：改依台北區間 `createdAt` 由新到舊，
 * 上限 500（超過標 truncated）。錯誤頁與用戶提示頁共用同一次讀取（同一區間只讀一次）。
 * 只用 `createdAt` 單欄範圍＋排序（自動單欄索引），不需新索引。Rules：`errorLogs` read＝super_admin 或 `admin.logs.error_read`。
 */
import type { ErrorLogDoc } from './error-log-model';

export const ERROR_LOGS_RANGE_CAP = 500;

export interface ErrorLogsRangeResult {
  docs: ErrorLogDoc[];
  truncated: boolean;
}

export async function fetchErrorLogsInRange(startMs: number, endMs: number): Promise<ErrorLogsRangeResult> {
  const [{ getFirebase }, fs] = await Promise.all([import('@/data/firebase'), import('firebase/firestore')]);
  const { db } = await getFirebase();
  const snap = await fs.getDocs(fs.query(
    fs.collection(db, 'errorLogs'),
    fs.where('createdAt', '>=', fs.Timestamp.fromMillis(startMs)),
    fs.where('createdAt', '<', fs.Timestamp.fromMillis(endMs)),
    fs.orderBy('createdAt', 'desc'),
    fs.limit(ERROR_LOGS_RANGE_CAP + 1),
  ));
  const docs = snap.docs.slice(0, ERROR_LOGS_RANGE_CAP).map((d) => ({ ...(d.data() as ErrorLogDoc), _docId: d.id }));
  return { docs, truncated: snap.docs.length > ERROR_LOGS_RANGE_CAP };
}
