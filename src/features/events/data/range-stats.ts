/**
 * 活動管理「區間統計」的讀取層（只讀，不寫）。計畫書 §4（A 方案：前端直接讀）。
 *
 * - 有全部活動管理權：`date` 單欄位範圍查詢（自動索引，不需複合索引）。
 * - 其他人：分別以 `creatorUid`／`ownerUid`／`captainUid` 相等、`delegateUids` array-contains 查自己的活動
 *   （各自單欄位自動索引），再在前端篩日期；不翻全站資料。
 * - 兩者最後都過 `filterManageableEvents`，權限與私密活動判斷和活動管理頁同一套。
 * - 名單：逐場讀 `events/{_docId}/registrations` 與 `attendanceRecords`（R-ID-010：子集合路徑用文件 ID）。
 *   單場失敗列入 `failed`，不當成 0 筆（不得把讀取失敗當成沒有資料）。
 */
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import {
  attendanceRecords as attendancePath,
  events as eventsPath,
  registrations as registrationsPath,
} from '@/data/paths';
import type { ViewerView } from '@/features/profile/data/viewer';
import { filterManageableEvents } from './my-activities-model';
import { isEventInRange, type DateRangeKeys, type EventRoster } from './range-stats-model';
import type { EventDoc } from './types';

/** 同時讀幾場活動的名單（每場 2 個查詢）。 */
export const ROSTER_CONCURRENCY = 6;

function mapEvent(snap: QueryDocumentSnapshot<DocumentData>): EventDoc {
  return { ...(snap.data() as Record<string, unknown>), _docId: snap.id } as EventDoc;
}

function eventDocId(e: EventDoc): string {
  return String(e._docId ?? e.docId ?? e.id ?? '');
}

export async function loadRangeEvents(
  range: DateRangeKeys,
  viewer: ViewerView,
  manageAll: boolean,
): Promise<EventDoc[]> {
  const { db } = await getFirebase();
  const col = collection(db, eventsPath);
  const byDocId = new Map<string, EventDoc>();

  if (manageAll) {
    const snap = await getDocs(query(
      col,
      where('date', '>=', range.startKey),
      where('date', '<', range.endKey),
      orderBy('date', 'desc'),
    ));
    snap.docs.forEach((d) => byDocId.set(d.id, mapEvent(d)));
  } else {
    const uid = String(viewer.uid ?? '').trim();
    if (!uid) return [];
    const snaps = await Promise.all([
      getDocs(query(col, where('creatorUid', '==', uid))),
      getDocs(query(col, where('ownerUid', '==', uid))),
      getDocs(query(col, where('captainUid', '==', uid))),
      getDocs(query(col, where('delegateUids', 'array-contains', uid))),
    ]);
    for (const snap of snaps) snap.docs.forEach((d) => byDocId.set(d.id, mapEvent(d)));
  }

  const inRange = [...byDocId.values()].filter((e) => isEventInRange(e, range));
  return filterManageableEvents(inRange, viewer, 'all');
}

export interface RosterLoadResult {
  rosters: EventRoster[];
  failed: EventDoc[];
}

async function loadOneRoster(event: EventDoc): Promise<EventRoster> {
  const { db } = await getFirebase();
  const docId = eventDocId(event);
  const [regSnap, attSnap] = await Promise.all([
    getDocs(collection(db, registrationsPath(docId))),
    getDocs(collection(db, attendancePath(docId))),
  ]);
  return {
    event,
    registrations: regSnap.docs.map((d) => d.data() as Record<string, unknown>),
    attendance: attSnap.docs.map((d) => d.data() as Record<string, unknown>),
  };
}

export async function loadRangeRosters(
  events: readonly EventDoc[],
  onProgress?: (done: number, total: number) => void,
): Promise<RosterLoadResult> {
  const rosters: EventRoster[] = [];
  const failed: EventDoc[] = [];
  let next = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (next < events.length) {
      const event = events[next++]!;
      if (!eventDocId(event)) {
        failed.push(event);
      } else {
        try {
          rosters.push(await loadOneRoster(event));
        } catch {
          failed.push(event);
        }
      }
      done += 1;
      onProgress?.(done, events.length);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(ROSTER_CONCURRENCY, events.length) }, () => worker()),
  );
  return { rosters, failed };
}
