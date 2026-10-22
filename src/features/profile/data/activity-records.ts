// M-129 報名紀錄卡資料層（唯讀）。
//
// A 的 `ensureUserStatsLoaded`／`_categorizeRecords`／`_getFilteredRecords` 屬 R-STAT-000 鎖定集合：
// B 僅作為唯讀純函式對照，**不寫入任何 Firestore 欄位、不重算統計**。
// `uid` 只作 UID 比對（R-STAT-002／003），不做名字補查。

import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';

// 照 A `_renderRecordListHtml` 的 `PAGE_SIZE = 10`。
export const RECORDS_PAGE_SIZE = 10;

// 照 A `firebase-service.js#ensureUserStatsLoaded` 的 collectionGroup 名稱。
export const ACTIVITY_RECORDS_COLLECTION = 'activityRecords' as const;
export const ATTENDANCE_RECORDS_COLLECTION = 'attendanceRecords' as const;

/**
 * 照 A `_categorizeRecords` 回傳的欄位：activityRecords 文件本身的 `eventId`／`status`／`name`／`date`／`uid`，
 * 加上 `_displayStatus`（completed／missed）與 `_mapSubcollectionDoc` 補的 `_docId`。名稱照 A。
 * 保留 index signature 讓活動快取冗餘欄位（例如 `eventStatus`）也能被帶到渲染端。
 */
export interface ActivityRecordItem {
  _docId?: string;
  _displayStatus?: string;
  eventId?: string;
  status?: string;
  name?: string;
  date?: string;
  uid?: string;
  [key: string]: unknown;
}

export interface UserStatsSnapshot {
  uid: string;
  activityRecords: Record<string, unknown>[];
  attendanceRecords: Record<string, unknown>[];
}

/**
 * 照 A `firebase-service.js#_mapSubcollectionDoc`（只保留與本卡顯示相關的部分）：
 * 補 `_docId`、`_path`、`_parentPath`、`_sourceCollection`、`_sourceKind`。
 */
function mapSubcollectionDoc(
  doc: QueryDocumentSnapshot<DocumentData>,
  collectionName: string,
): Record<string, unknown> {
  const data = doc.data();
  const docId = doc.id;
  const parent = doc.ref.parent.parent;
  const parentPath = parent ? parent.path : '';
  return {
    ...data,
    _docId: docId,
    _path: doc.ref.path,
    _parentPath: parentPath,
    _sourceCollection: collectionName,
    _sourceKind: 'subcollection',
  };
}

/**
 * 照 A `firebase-service.js#ensureUserStatsLoaded`（唯讀）：
 * - 用 `collectionGroup('activityRecords'／'attendanceRecords').where('uid','==',uid).get()`。
 * - R-REG-014：只保留 `ref.parent.parent !== null`（排除 legacy root 文件）。
 * - 不寫入任何 Firestore 欄位；不重算統計。
 */
export async function loadUserStats(uid: string): Promise<UserStatsSnapshot> {
  const targetUid = String(uid || '').trim();
  if (!targetUid) throw new Error('loadUserStats: uid is required');

  const [{ collectionGroup, getDocs, query, where }, ctx] = await Promise.all([
    import('firebase/firestore'),
    getFirebase(),
  ]);

  const [actSnap, attSnap] = await Promise.all([
    getDocs(
      query(
        collectionGroup(ctx.db, ACTIVITY_RECORDS_COLLECTION),
        where('uid', '==', targetUid),
      ),
    ),
    getDocs(
      query(
        collectionGroup(ctx.db, ATTENDANCE_RECORDS_COLLECTION),
        where('uid', '==', targetUid),
      ),
    ),
  ]);

  const activityRecords = actSnap.docs
    .filter((d) => d.ref.parent.parent !== null)
    .map((d) => mapSubcollectionDoc(d, ACTIVITY_RECORDS_COLLECTION));
  const attendanceRecords = attSnap.docs
    .filter((d) => d.ref.parent.parent !== null)
    .map((d) => mapSubcollectionDoc(d, ATTENDANCE_RECORDS_COLLECTION));

  return { uid: targetUid, activityRecords, attendanceRecords };
}

function getString(rec: Record<string, unknown>, key: string): string | undefined {
  const value = rec[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * 照 A `_categorizeRecords` 的 `{ ...r, _displayStatus: '...' }`：保留原欄位、僅加 `_displayStatus`。
 */
function toItem(rec: Record<string, unknown>, displayStatus?: string): ActivityRecordItem {
  const item: ActivityRecordItem = {
    ...rec,
    _docId: getString(rec, '_docId'),
    eventId: getString(rec, 'eventId'),
    status: getString(rec, 'status'),
    name: getString(rec, 'name'),
    date: getString(rec, 'date'),
    uid: getString(rec, 'uid'),
  };
  if (displayStatus) item._displayStatus = displayStatus;
  return item;
}

function hasAttendance(
  attRecords: Record<string, unknown>[],
  eventId: string,
  uid: string,
  type: 'checkin' | 'checkout',
): boolean {
  return attRecords.some(
    (a) => a['eventId'] === eventId && a['uid'] === uid && a['type'] === type,
  );
}

/**
 * 照 A `_parseEventStartDate`（A 未提供實作；以最基本解析處理：Date／秒物件／可 Date.parse 字串／毫秒）。
 * 失敗回 `null`（A 的 `_getFilteredRecords` 遇到 null 會把項目排到最後）。
 */
function parseRecordDate(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : null;
  }
  if (typeof value === 'object') {
    const seconds = Number((value as { seconds?: unknown }).seconds);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }
  return null;
}

interface Categorized {
  registered: ActivityRecordItem[];
  completed: ActivityRecordItem[];
  cancelled: ActivityRecordItem[];
}

/**
 * 照 A `_categorizeRecords`（兩遍掃描）。此函式為純函式、不改輸入。
 */
function categorizeRecords(
  records: Record<string, unknown>[],
  attRecords: Record<string, unknown>[],
  uid: string,
  isPublic: boolean,
): Categorized {
  const registered: ActivityRecordItem[] = [];
  const completed: ActivityRecordItem[] = [];
  const cancelled: ActivityRecordItem[] = [];

  const seenCancel = new Set<string>();
  const seenActive = new Set<string>();
  const seenComplete = new Set<string>();

  // 第一遍 A：建立取消／活躍報名集合
  records.forEach((r) => {
    const eid = getString(r, 'eventId');
    if (!eid) return;
    const status = getString(r, 'status');
    if (status === 'cancelled') seenCancel.add(eid);
    if (status === 'registered' || status === 'waitlisted') seenActive.add(eid);
  });
  seenActive.forEach((eid) => seenCancel.delete(eid));
  // 第一遍 B：取消後又重新報名 → 從 seenCancel 移除（已在上一行處理）；完成判定（checkin+checkout）
  records.forEach((r) => {
    const eid = getString(r, 'eventId');
    if (!eid) return;
    const status = getString(r, 'status');
    if (status === 'cancelled' || status === 'removed') return;
    const hasIn = hasAttendance(attRecords, eid, uid, 'checkin');
    const hasOut = hasAttendance(attRecords, eid, uid, 'checkout');
    if (hasIn && hasOut) seenComplete.add(eid);
  });

  // 第二遍：正式分類
  records.forEach((r) => {
    const eid = getString(r, 'eventId');
    if (!eid) return;
    const status = getString(r, 'status');

    // 移除記錄不出現在任何 tab
    if (status === 'removed') return;

    // 取消紀錄：僅當該活動最終狀態為取消時才顯示（同活動只保留一筆）
    if (status === 'cancelled') {
      if (seenActive.has(eid)) return;
      if (!cancelled.some((c) => c.eventId === eid)) {
        cancelled.push(toItem(r));
      }
      return;
    }

    // 完成判定（方向 B）：有 checkin + checkout
    if (seenComplete.has(eid) && !seenCancel.has(eid)) {
      if (!completed.some((c) => c.eventId === eid)) {
        completed.push(toItem(r, 'completed'));
      }
      return;
    }

    // 報名中／未出席
    if (status === 'registered' || status === 'waitlisted') {
      // 跨類別去重
      if (seenCancel.has(eid) || seenComplete.has(eid)) return;
      if (isPublic) return; // 公開卡片不顯示報名中
      // ASSUMPTION: activityRecords 文件帶冗餘 `eventStatus`（A 需要 `ApiService.getEvent(...).status`）。
      // 若無此欄位則回退照 A「查不到活動」處理：不推入 registered／missed。
      const eventStatus =
        getString(r, 'eventStatus') ?? getString(r, '_eventStatus') ?? null;
      if (eventStatus === null) return;
      if (eventStatus !== 'ended' && eventStatus !== 'cancelled') {
        registered.push(toItem(r));
      } else if (eventStatus === 'ended' && status === 'registered') {
        registered.push(toItem(r, 'missed'));
      }
    }
  });

  return { registered, completed, cancelled };
}

/**
 * 照 A `_getFilteredRecords`＋`_categorizeRecords`（純函式、唯讀）。
 * `now` 為非必要參數，供呼叫端傳入固定時間（A 原函式無時間依賴，本卡不使用）。
 */
export function getFilteredRecords(
  stats: UserStatsSnapshot,
  filter: 'all' | 'registered' | 'completed' | 'cancelled',
  isPublic: boolean,
  _now?: number,
): ActivityRecordItem[] {
  const { registered, completed, cancelled } = categorizeRecords(
    stats.activityRecords,
    stats.attendanceRecords,
    stats.uid,
    isPublic,
  );

  let result: ActivityRecordItem[];
  if (filter === 'registered') result = registered;
  else if (filter === 'completed') result = completed;
  else if (filter === 'cancelled') result = cancelled;
  else if (isPublic) result = [...completed, ...cancelled];
  else result = [...registered, ...completed, ...cancelled];

  // ASSUMPTION: A 用 `ApiService.getEvent(...).date` 排序；B 用活動快取冗餘的 `r.date` 取代。
  // 若 `r.date` 不存在，A 的 null 分支把項目排到最後（此處同樣處理）。
  return result.sort((a, b) => {
    const dA = parseRecordDate(a['date']);
    const dB = parseRecordDate(b['date']);
    if (dA && dB) return dB - dA;
    if (dA) return -1;
    if (dB) return 1;
    return 0;
  });
}

/**
 * 照 A `_formatUserAttendanceSummaryTime`：將 `updatedAt` 格式化為 `YYYY/MM/DD HH:mm`，失敗回 `--`。
 */
export function formatUserAttendanceSummaryTime(value: unknown): string {
  let date: Date | null = null;
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    date = (value as { toDate: () => Date }).toDate();
  } else if (
    value &&
    typeof value === 'object' &&
    Number.isFinite(Number((value as { seconds?: unknown }).seconds))
  ) {
    date = new Date(Number((value as { seconds: number }).seconds) * 1000);
  } else if (value instanceof Date) {
    date = value;
  } else if (value) {
    date = new Date(value as string | number);
  }
  if (!date || Number.isNaN(date.getTime())) return '--';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    '/' + pad(date.getMonth() + 1) +
    '/' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) +
    ':' + pad(date.getMinutes())
  );
}
