/**
 * 稽核日誌讀取（2026-11-16 日誌中心第二批；計畫書 3.3、顧問 §3.196）。
 * - 路徑 `auditLogsByDay/{台北 yyyymmdd}/auditEntries`，每日 `orderBy(createdAt desc)`＋`limit(要的筆數＋1)`＋文件 cursor（同 A getAuditLogsByDay）。
 * - 週／月從最新日往前逐日湊滿一頁；一次「下一頁／捲動」最多往前 7 天，區間累計上限 500。
 * - 不用 collectionGroup（需另開 collection-group 單欄索引＝索引 lane）。
 * - 已確認為空的「過去日」記在記憶體，同一頁面生命週期內不重查（今天不記，因為還會有新資料）。
 * - Rules：auditEntries read＝super_admin 或 `admin.logs.audit_read`。
 */
import { toAuditEntry, type AuditEntry } from './audit-log-model';

export const AUDIT_RANGE_CAP = 500;
export const AUDIT_MAX_DAYS_PER_FETCH = 7;

const emptyPastDays = new Set<string>();

export interface AuditCursor {
  /** 目前讀到第幾個日鍵（dayKeys 的索引）。 */
  dayIdx: number;
  /** 該日最後一筆的文件快照（Firestore DocumentSnapshot），null＝從該日開頭讀。 */
  lastDoc: unknown | null;
}

export interface AuditFetchResult {
  entries: AuditEntry[];
  cursor: AuditCursor;
  /** 已經沒有更早的資料。 */
  done: boolean;
  /** 這次已往前查滿 7 天但還沒湊滿一頁（還有更早的日可查）。 */
  pausedAtDayLimit: boolean;
  /** 實際送出的查詢次數（evidence 用）。 */
  queries: number;
}

export type AuditDayReader = (dayKey: string, lastDoc: unknown | null, limit: number) => Promise<{ docs: Array<{ id: string; data: Record<string, unknown>; snap: unknown }>; hasMore: boolean }>;

export const readAuditDay: AuditDayReader = async (dayKey, lastDoc, limit) => {
  const [{ getFirebase }, fs] = await Promise.all([import('@/data/firebase'), import('firebase/firestore')]);
  const { db } = await getFirebase();
  const base = fs.collection(db, 'auditLogsByDay', dayKey, 'auditEntries');
  const q = lastDoc
    ? fs.query(base, fs.orderBy('createdAt', 'desc'), fs.startAfter(lastDoc as never), fs.limit(limit + 1))
    : fs.query(base, fs.orderBy('createdAt', 'desc'), fs.limit(limit + 1));
  const snap = await fs.getDocs(q);
  return {
    docs: snap.docs.slice(0, limit).map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, unknown>, snap: d })),
    hasMore: snap.docs.length > limit,
  };
};

/**
 * 從 cursor 往前讀，湊滿 `want` 筆或查滿 7 天就停。
 * `todayKey` 那天不寫入空日快取。
 */
export async function fetchAuditPage(
  dayKeys: readonly string[],
  cursor: AuditCursor,
  want: number,
  todayKey: string,
  read: AuditDayReader = readAuditDay,
): Promise<AuditFetchResult> {
  const entries: AuditEntry[] = [];
  let { dayIdx, lastDoc } = cursor;
  let daysTouched = 0;
  let queries = 0;
  while (dayIdx < dayKeys.length && entries.length < want) {
    if (daysTouched >= AUDIT_MAX_DAYS_PER_FETCH) {
      return { entries, cursor: { dayIdx, lastDoc }, done: false, pausedAtDayLimit: true, queries };
    }
    const key = dayKeys[dayIdx]!;
    if (!lastDoc && emptyPastDays.has(key)) {
      dayIdx += 1;
      continue;
    }
    daysTouched += 1;
    queries += 1;
    const page = await read(key, lastDoc, want - entries.length);
    for (const d of page.docs) entries.push(toAuditEntry(d.id, d.data));
    if (!lastDoc && page.docs.length === 0 && key !== todayKey) emptyPastDays.add(key);
    if (page.hasMore) {
      lastDoc = page.docs[page.docs.length - 1]?.snap ?? null;
    } else {
      dayIdx += 1;
      lastDoc = null;
    }
  }
  return { entries, cursor: { dayIdx, lastDoc }, done: dayIdx >= dayKeys.length, pausedAtDayLimit: false, queries };
}

/** 測試用。 */
export function _resetAuditEmptyDaysForTest(): void {
  emptyPastDays.clear();
}
