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
const EVENTS_COLLECTION = 'events' as const;

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

/**
 * 照 A `ApiService.getEvent(eventId)` 在 `_categorizeRecords`／`_getFilteredRecords` 用到的欄位：
 * 活動 `status`（判斷進行中／已結束／已取消）與 `date`（`YYYY/MM/DD HH:mm~HH:mm`，排序用）。
 */
export interface EventLookupEntry {
  status?: string;
  date?: string;
}

export interface UserStatsSnapshot {
  uid: string;
  activityRecords: Record<string, unknown>[];
  attendanceRecords: Record<string, unknown>[];
  /**
   * public eventId → 活動欄位。A 靠全站活動快取的 `getEvent` 取得；activityRecords 文件本身
   * 只有 `eventId／name／date(MM/DD)／status／uid／eventType`，沒有活動狀態與年份，所以 B 要自己查。
   * 查不到的活動＝A 的「查不到活動」（報名中／未出席不顯示、排序墊底）。
   */
  events?: Record<string, EventLookupEntry>;
}

// Firestore `in` 查詢單次上限 30（與 Functions `EVENT_ID_QUERY_CHUNK` 相同）。
const EVENT_ID_QUERY_CHUNK = 30;

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
 * - 另外用 `events where id in […]` 查出這些紀錄所屬活動的 status／date（A 的 `getEvent`）：
 *   activityRecords 本身沒有活動狀態與年份，「報名／未出席」分類與排序都需要。
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

  // A 的 `getEvent(eventId)`：用 public `id` 欄位對應活動（與 Functions `loadEventsByPublicIds` 相同做法）。
  // `removed` 紀錄不會出現在任何分頁，不必查；查詢失敗要往上丟，不可靜默當成「查不到活動」。
  const eventIds = new Set<string>();
  for (const rec of activityRecords) {
    const eid = getString(rec, 'eventId');
    if (eid && getString(rec, 'status') !== 'removed') eventIds.add(eid);
  }
  const events = await loadEventLookup(ctx.db, [...eventIds]);

  return { uid: targetUid, activityRecords, attendanceRecords, events };
}

async function loadEventLookup(
  db: unknown,
  eventIds: readonly string[],
): Promise<Record<string, EventLookupEntry>> {
  const lookup: Record<string, EventLookupEntry> = {};
  if (eventIds.length === 0) return lookup;

  const { collection, getDocs, query, where } = await import('firebase/firestore');
  const chunks: string[][] = [];
  for (let i = 0; i < eventIds.length; i += EVENT_ID_QUERY_CHUNK) {
    chunks.push(eventIds.slice(i, i + EVENT_ID_QUERY_CHUNK));
  }
  const snaps = await Promise.all(
    chunks.map((chunk) =>
      getDocs(
        query(
          collection(db as Parameters<typeof collection>[0], EVENTS_COLLECTION),
          where('id', 'in', chunk),
        ),
      ),
    ),
  );
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const id = typeof data['id'] === 'string' && data['id'] ? data['id'] : d.id;
      const entry: EventLookupEntry = {};
      if (typeof data['status'] === 'string') entry.status = data['status'];
      if (typeof data['date'] === 'string') entry.date = data['date'];
      lookup[id] = entry;
    }
  }
  return lookup;
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

/** 照 A `_canonicalRecordTime`：updatedAt→registeredAt→createdAt→cancelledAt→removedAt，取第一個有值的毫秒。 */
function recordTimeMs(record: Record<string, unknown>): number {
  const parseValue = (value: unknown): number => {
    if (!value) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof value === 'object') {
      const v = value as {
        toMillis?: () => number;
        toDate?: () => Date;
        seconds?: unknown;
        _seconds?: unknown;
        nanoseconds?: unknown;
        _nanoseconds?: unknown;
      };
      if (typeof v.toMillis === 'function') {
        try { return v.toMillis(); } catch { return 0; }
      }
      if (typeof v.toDate === 'function') {
        try { return v.toDate().getTime(); } catch { return 0; }
      }
      const seconds = typeof v.seconds === 'number' && v.seconds ? v.seconds : v._seconds;
      if (typeof seconds === 'number') {
        const nanos = Number(v.nanoseconds || v._nanoseconds || 0);
        return seconds * 1000 + Math.floor(nanos / 1000000);
      }
    }
    return 0;
  };
  return (
    parseValue(record['updatedAt']) ||
    parseValue(record['registeredAt']) ||
    parseValue(record['createdAt']) ||
    parseValue(record['cancelledAt']) ||
    parseValue(record['removedAt']) ||
    0
  );
}

/**
 * 照 A `ApiService.getActivityRecords(uid)` 經過的 `_canonicalizeRecordList('activityRecords')`：
 * 同一個 `eventId|uid|status` 只留一筆（時間較新者勝；同時間取後出現者）。重複文件不會讓清單出現兩列。
 */
function canonicalizeActivityRecords(
  records: Record<string, unknown>[],
): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  let fallbackSeq = 0;
  for (const record of records) {
    if (!record) continue;
    const eventId = String(record['eventId'] ?? '').trim();
    const uid = String(record['uid'] ?? record['userId'] ?? '').trim();
    const status = String(record['status'] ?? '').trim();
    const key =
      eventId && uid
        ? `${eventId}|${uid}|${status}`
        : String(record['_path'] || record['_docId'] || record['id'] || `#${fallbackSeq++}`);
    const current = byKey.get(key);
    byKey.set(key, current && recordTimeMs(record) < recordTimeMs(current) ? current : record);
  }
  return Array.from(byKey.values());
}

/**
 * 照 A `ApiService.getUserAttendanceRecords(uid)`：簽到／簽退紀錄排除 `removed`／`cancelled`，
 * 只留下仍有效的紀錄，再以 `eventId` 建立「有簽到」「有簽退」集合。
 */
function buildAttendanceIndex(
  attRecords: Record<string, unknown>[],
  uid: string,
): { checkin: Set<string>; checkout: Set<string> } {
  const checkin = new Set<string>();
  const checkout = new Set<string>();
  for (const a of attRecords) {
    if (a['uid'] !== uid) continue;
    const status = a['status'];
    if (status === 'removed' || status === 'cancelled') continue;
    const eventId = getString(a, 'eventId');
    if (!eventId) continue;
    if (a['type'] === 'checkin') checkin.add(eventId);
    else if (a['type'] === 'checkout') checkout.add(eventId);
  }
  return { checkin, checkout };
}

/**
 * 照 A `event-list-stats.js#_parseEventStartDate(event.date)` 逐步移植：
 * 以空白切成「日期／時間」，日期以 `/` 切三節（`YYYY/MM/DD`，不足三節回 null），
 * 時間取 `~` 前的 `HH:mm`（缺值當 0），用本地時區組成 Date。
 * 不是此格式的字串（含 ISO）、非字串一律回 null——和 A 一樣，由 `_getFilteredRecords` 排到最後；
 * 不再退回 `Date.parse` 猜。唯一刻意的差異：A 對 `parseInt` 得 NaN 的輸入會產生 Invalid Date
 * （使比較函式回 NaN、排序順序未定義），B 改回 null 讓它確定地排最後。
 */
export function parseEventStartMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const parts = value.split(' ');
  const dateParts = (parts[0] ?? '').split('/');
  if (dateParts.length < 3) return null;
  const y = parseInt(dateParts[0] ?? '', 10);
  const m = parseInt(dateParts[1] ?? '', 10) - 1;
  const d = parseInt(dateParts[2] ?? '', 10);
  let hh = 0;
  let mm = 0;
  if (parts[1]) {
    const [h, mi] = (parts[1].split('~')[0] ?? '').split(':').map(Number);
    hh = h || 0;
    mm = mi || 0;
  }
  const ts = new Date(y, m, d, hh, mm).getTime();
  return Number.isFinite(ts) ? ts : null;
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
  rawRecords: Record<string, unknown>[],
  rawAttRecords: Record<string, unknown>[],
  events: Record<string, EventLookupEntry>,
  uid: string,
  isPublic: boolean,
): Categorized {
  const records = canonicalizeActivityRecords(rawRecords);
  const attendance = buildAttendanceIndex(rawAttRecords, uid);
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
    if (attendance.checkin.has(eid) && attendance.checkout.has(eid)) seenComplete.add(eid);
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
      // 照 A `ApiService.getEvent(r.eventId)`：查不到活動就不推入 registered／missed。
      const event = events[eid];
      if (!event) return;
      const eventStatus = event.status;
      if (eventStatus !== 'ended' && eventStatus !== 'cancelled') {
        registered.push(toItem(r));
      } else if (eventStatus === 'ended' && status === 'registered') {
        // 只有正式報名且活動已結束、未完成簽到者才顯示 missed；waitlisted 不算應到
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
  const events = stats.events ?? {};
  const { registered, completed, cancelled } = categorizeRecords(
    stats.activityRecords,
    stats.attendanceRecords,
    events,
    stats.uid,
    isPublic,
  );

  let result: ActivityRecordItem[];
  if (filter === 'registered') result = registered;
  else if (filter === 'completed') result = completed;
  else if (filter === 'cancelled') result = cancelled;
  else if (isPublic) result = [...completed, ...cancelled];
  else result = [...registered, ...completed, ...cancelled];

  // 照 A：依活動（`getEvent(r.eventId).date`）開始時間由新到舊；查不到活動的項目排最後。
  // activityRecord 自己的 `date` 只有 MM/DD（沒有年份），不能拿來排序。
  const startOf = (item: ActivityRecordItem): number | null =>
    item.eventId ? parseEventStartMs(events[item.eventId]?.date) : null;
  return result.sort((a, b) => {
    const dA = startOf(a);
    const dB = startOf(b);
    if (dA !== null && dB !== null) return dB - dA;
    if (dA !== null) return -1;
    if (dB !== null) return 1;
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
