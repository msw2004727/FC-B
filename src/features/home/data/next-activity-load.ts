/**
 * 首頁「我的下一場活動」讀取段（動態載入）。
 *
 * 批次 A：優先只查「未結束活動清單」裡的報名；沒有清單、清單達上限或新查詢失敗時，
 * 退回現行報名查詢＋主辦查詢＋補抓。所有 Firestore 存取集中在這個動態載入檔。
 */

import { reportClientError } from '@/core/error-report';
import { reportLimitOncePerDay } from '@/core/limit-report';
import type { DocumentData, Firestore, Query } from 'firebase/firestore';
import { getFirebase as defaultGetFirebase } from '@/data/firebase';
import { loadFirestoreSdk, type FirestoreSdk } from '@/data/firestore-sdk';
import { events as eventsCollectionPath, filterSubcollectionDocs } from '@/data/paths';
import {
  ACTIVE_REGISTRATION_STATUSES,
  EVENT_IN_QUERY_CHUNK,
  EVENT_QUERY_LIMIT,
  REGISTRATION_QUERY_LIMIT,
  eventIdentityKey,
} from './next-activity';
import type { NextActivityDeps, NextActivityInputs, NextActivityLogger } from './next-activity';
import type { EventDoc, RegistrationDoc } from '@/features/events/data/types';

export const ACTIVE_EVENTS_LIST_CAP = 200;

/**
 * 首頁主辦查詢只取還沒結束的狀態。原樣從 next-activity.ts 搬來。
 * 不從 events-repo 匯入：它靜態匯入 Firestore SDK，會把 SDK 拉進首頁。
 */
export const MANAGED_ACTIVE_EVENT_STATUSES: readonly string[] = ['open', 'full', 'upcoming', 'closed', 'postponed'];

function mapDoc(docSnap: { id: string; data: () => DocumentData }): EventDoc {
  return { ...(docSnap.data() as Record<string, unknown>), _docId: docSnap.id } as EventDoc;
}

function mapRegistration(snapshot: { id: string; data: () => DocumentData }): RegistrationDoc {
  return { ...(snapshot.data() as Record<string, unknown>), _docId: snapshot.id } as RegistrationDoc;
}

function mergeEventsByIdentity(events: EventDoc[]): EventDoc[] {
  const map = new Map<string, EventDoc>();
  events.forEach((event) => {
    if (!event) return;
    const key = eventIdentityKey(event);
    if (!key) return;
    map.set(key, { ...(map.get(key) ?? {}), ...event });
  });
  return Array.from(map.values());
}

function chunkIds(ids: readonly string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

/**
 * 能不能放進 `documentId() in [...]`：Firestore 文件 id 不得含 '/'、不得是 '.'／'..'、不得符合 `__.*__`、不得超過 1500 bytes。
 * 違規的 id 放進 `documentId()` 條件，SDK 在建查詢時就會同步丟錯。
 */
export function isValidFirestoreDocId(id: string): boolean {
  if (!id || id === '.' || id === '..') return false;
  if (id.includes('/')) return false;
  if (/^__.*__$/.test(id)) return false;
  return new TextEncoder().encode(id).length <= 1500;
}

export function buildActiveEventIdValues(events: readonly EventDoc[]): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  events.forEach((event) => {
    const id = String(event.id ?? '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      values.push(id);
    }
    const docId = String(event._docId ?? '').trim();
    if (docId && !seen.has(docId)) {
      seen.add(docId);
      values.push(docId);
    }
  });
  return values;
}

/**
 * 報名指向、但管理的活動沒涵蓋的活動，一次用 `in` 查詢補抓（現行查法的退路用）。
 * 原樣從 next-activity.ts 搬來。
 */
async function fetchMissingEvents(
  sdk: FirestoreSdk,
  db: Firestore,
  missingEventIds: readonly string[],
  logger: NextActivityLogger,
): Promise<EventDoc[]> {
  const { collection, documentId, getDocs, query, where } = sdk;
  interface BatchResult {
    /** 查詢（含建查詢）是否成功；失敗時 events 一定是空的。 */
    ok: boolean;
    ids: string[];
    events: EventDoc[];
  }
  const run = async (
    label: string,
    build: (ids: string[]) => Query<DocumentData>,
    ids: string[],
  ): Promise<BatchResult> => {
    try {
      const snap = await getDocs(build(ids));
      return { ok: true, ids, events: snap.docs.map((d) => mapDoc(d)) };
    } catch (err) {
      logger.warn('[NextActivity] event fetch skipped:', label, ids, err);
      return { ok: false, ids, events: [] };
    }
  };

  const byDocIdBatches = chunkIds(missingEventIds.filter(isValidFirestoreDocId), EVENT_IN_QUERY_CHUNK)
    .map((ids) => run(
      'documentId',
      (chunk) => query(collection(db, eventsCollectionPath), where(documentId(), 'in', chunk)),
      ids,
    ));
  const byPublicIdBatches = chunkIds(missingEventIds, EVENT_IN_QUERY_CHUNK)
    .map((ids) => run(
      'id',
      (chunk) => query(collection(db, eventsCollectionPath), where('id', 'in', chunk)),
      ids,
    ));
  const [byDocIdResults, byPublicIdResults] = await Promise.all([
    Promise.all(byDocIdBatches),
    Promise.all(byPublicIdBatches),
  ]);

  const byDocId = byDocIdResults.flatMap((result) => result.events);
  const resolvedDocIds = new Set(byDocId.map((event) => String(event._docId ?? '').trim()));
  // 直接文件 id 的查詢失敗：這些 id 的 events/{id} 在不在不知道，不能退回 id 欄位備援
  const unconfirmedIds = new Set(
    byDocIdResults.filter((result) => !result.ok).flatMap((result) => result.ids),
  );
  const byPublicId = byPublicIdResults
    .flatMap((result) => result.events)
    .filter((event) => {
      const publicId = String(event.id ?? '').trim();
      return !resolvedDocIds.has(publicId) && !unconfirmedIds.has(publicId);
    });
  return [...byPublicId, ...byDocId];
}

async function fetchManagedEvents(
  db: Firestore,
  sdk: FirestoreSdk,
  safeUid: string,
  logger: NextActivityLogger,
): Promise<EventDoc[]> {
  const { collection, getDocs, limit, query, where } = sdk;
  const fetchManaged = async (
    label: 'creator' | 'owner' | 'delegate',
    build: () => Query<DocumentData>,
  ) => {
    try {
      const snap = await getDocs(build());
      if (snap.docs.length >= EVENT_QUERY_LIMIT) {
        logger.warn(
          `[NextActivity] ${label} query hit the limit; events may be missing:`,
          EVENT_QUERY_LIMIT,
        );
        reportLimitOncePerDay('next-activity-managed-limit', `${label} query hit the limit`);
      }
      return snap;
    } catch (err) {
      logger.warn(`[NextActivity] ${label} query skipped:`, err);
      return null;
    }
  };
  // QueryConstraint 不可變，三條查詢共用同一個。
  const activeStatus = where('status', 'in', MANAGED_ACTIVE_EVENT_STATUSES);
  const managedEventsQuery = (field: 'creatorUid' | 'ownerUid') =>
    query(
      collection(db, eventsCollectionPath),
      where(field, '==', safeUid),
      activeStatus,
      limit(EVENT_QUERY_LIMIT),
    );
  const managedSnaps = await Promise.all([
    fetchManaged('creator', () => managedEventsQuery('creatorUid')),
    fetchManaged('owner', () => managedEventsQuery('ownerUid')),
    fetchManaged('delegate', () => query(
      collection(db, eventsCollectionPath),
      where('delegateUids', 'array-contains', safeUid),
      activeStatus,
      limit(EVENT_QUERY_LIMIT),
    )),
  ]);
  const managedEvents: EventDoc[] = [];
  managedSnaps.forEach((snap) => {
    snap?.docs.forEach((d) => managedEvents.push(mapDoc(d)));
  });
  return managedEvents;
}

async function loadRegistrationsWithQuery(
  db: Firestore,
  sdk: FirestoreSdk,
  safeUid: string,
  logger: NextActivityLogger,
): Promise<RegistrationDoc[]> {
  const { collectionGroup, getDocs, limit, query, where } = sdk;
  const registrations: RegistrationDoc[] = [];
  try {
    const regSnap = await getDocs(
      query(
        collectionGroup(db, 'registrations'),
        where('userId', '==', safeUid),
        where('status', 'in', [...ACTIVE_REGISTRATION_STATUSES]),
        limit(REGISTRATION_QUERY_LIMIT),
      ),
    );
    if (regSnap.docs.length >= REGISTRATION_QUERY_LIMIT) {
      logger.warn(
        '[NextActivity] registration query hit the limit; later registrations may be missing:',
        REGISTRATION_QUERY_LIMIT,
      );
      reportLimitOncePerDay('next-activity-registration-limit', 'registration query hit the limit');
    }
    const subcollectionDocs = filterSubcollectionDocs(regSnap.docs);
    subcollectionDocs.forEach((d) => registrations.push(mapRegistration(d)));
  } catch (err) {
    logger.warn('[NextActivity] registration query skipped:', err);
  }
  return registrations;
}

async function completeWithMissingEvents(
  sdk: FirestoreSdk,
  db: Firestore,
  registrations: RegistrationDoc[],
  managedEvents: EventDoc[],
  logger: NextActivityLogger,
): Promise<NextActivityInputs> {
  const haveIds = new Set<string>();
  managedEvents.forEach((event) => {
    [event.id, event._docId, event.docId].forEach((raw) => {
      const v = String(raw ?? '').trim();
      if (v) haveIds.add(v);
    });
  });

  const missingEventIds: string[] = [];
  const seenMissing = new Set<string>();
  registrations.forEach((r) => {
    const id = String(r.eventId ?? '').trim();
    if (!id || haveIds.has(id) || seenMissing.has(id)) return;
    seenMissing.add(id);
    missingEventIds.push(id);
  });

  const missingEvents = missingEventIds.length > 0
    ? await fetchMissingEvents(sdk, db, missingEventIds, logger)
    : [];

  return {
    registrations,
    events: mergeEventsByIdentity([...managedEvents, ...missingEvents]),
  };
}

async function loadWithRegistrationQuery(
  db: Firestore,
  sdk: FirestoreSdk,
  safeUid: string,
  logger: NextActivityLogger,
): Promise<NextActivityInputs> {
  const [registrations, managedEvents] = await Promise.all([
    loadRegistrationsWithQuery(db, sdk, safeUid, logger),
    fetchManagedEvents(db, sdk, safeUid, logger),
  ]);
  return completeWithMissingEvents(sdk, db, registrations, managedEvents, logger);
}

async function loadWithScopedRegistrationQuery(
  db: Firestore,
  sdk: FirestoreSdk,
  safeUid: string,
  logger: NextActivityLogger,
  activeEvents: readonly EventDoc[],
): Promise<NextActivityInputs> {
  const { collection, collectionGroup, documentId, getDocs, query, where } = sdk;
  const managedPromise = fetchManagedEvents(db, sdk, safeUid, logger);

  const values = buildActiveEventIdValues(activeEvents);
  let registrations: RegistrationDoc[] = [];
  if (values.length > 0) {
    const chunks = chunkIds(values, EVENT_IN_QUERY_CHUNK);
    try {
      const snaps = await Promise.all(chunks.map((chunk) => getDocs(
        query(
          collectionGroup(db, 'registrations'),
          where('userId', '==', safeUid),
          where('eventId', 'in', chunk),
        ),
      )));
      const docs = snaps.flatMap((snap) => snap.docs);
      registrations = filterSubcollectionDocs(docs)
        .map((d) => mapRegistration(d))
        .filter((r) => ACTIVE_REGISTRATION_STATUSES.includes(String(r.status ?? '')));
    } catch (err) {
      logger.warn('[NextActivity] scoped registration query failed; using registration query fallback:', err);
      const report = Object.assign(new Error('scoped registration query failed'), {
        code: typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : '',
      });
      reportClientError('next-activity-scoped-fallback', report);
      const [managedEvents, fallbackRegistrations] = await Promise.all([
        managedPromise,
        loadRegistrationsWithQuery(db, sdk, safeUid, logger),
      ]);
      return completeWithMissingEvents(sdk, db, fallbackRegistrations, managedEvents, logger);
    }
  }

  const managedEvents = await managedPromise;

  const activeDocIds = new Set(
    activeEvents
      .map((event) => String(event._docId ?? '').trim())
      .filter(Boolean),
  );
  const needCheck: string[] = [];
  const seenNeedCheck = new Set<string>();
  registrations.forEach((r) => {
    const id = String(r.eventId ?? '').trim();
    if (!id || activeDocIds.has(id) || seenNeedCheck.has(id)) return;
    seenNeedCheck.add(id);
    needCheck.push(id);
  });

  const confirmedDocs: EventDoc[] = [];
  const unconfirmedIds = new Set<string>();
  const validNeedCheck = needCheck.filter(isValidFirestoreDocId);
  if (validNeedCheck.length > 0) {
    const results = await Promise.all(chunkIds(validNeedCheck, EVENT_IN_QUERY_CHUNK).map(async (ids) => {
      try {
        const snap = await getDocs(
          query(collection(db, eventsCollectionPath), where(documentId(), 'in', ids)),
        );
        return { ok: true, ids, docs: snap.docs.map((d) => mapDoc(d)) };
      } catch (err) {
        logger.warn('[NextActivity] event fetch skipped:', 'documentId', err);
        return { ok: false, ids, docs: [] as EventDoc[] };
      }
    }));
    results.forEach((result) => {
      if (result.ok) {
        confirmedDocs.push(...result.docs);
      } else {
        result.ids.forEach((id) => unconfirmedIds.add(id));
      }
    });
  }

  const keptRegistrations = registrations.filter(
    (r) => !unconfirmedIds.has(String(r.eventId ?? '').trim()),
  );
  const referencedIds = new Set(
    keptRegistrations
      .map((r) => String(r.eventId ?? '').trim())
      .filter(Boolean),
  );
  // 公開代號已被確認存在的文件（R-ID-010：文件優先）涵蓋時，清單裡那份不再合併，避免兩份欄位混在一起。
  const confirmedDocIds = new Set(confirmedDocs.map((event) => String(event._docId ?? '').trim()).filter(Boolean));
  const referencedActive = activeEvents.filter((event) => {
    const docId = String(event._docId ?? '').trim();
    const id = String(event.id ?? '').trim();
    if (docId && referencedIds.has(docId)) return true;
    return Boolean(id && referencedIds.has(id) && !confirmedDocIds.has(id));
  });

  return {
    registrations: keptRegistrations,
    events: mergeEventsByIdentity([...managedEvents, ...referencedActive, ...confirmedDocs]),
  };
}

export async function loadNextActivityInputs(
  deps: NextActivityDeps,
  uid: string,
): Promise<NextActivityInputs> {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) return { registrations: [], events: [] };

  const getFB = deps.getFirebase ?? defaultGetFirebase;
  const logger: NextActivityLogger = deps.logger ?? console;
  const [{ db }, sdk] = await Promise.all([getFB(), loadFirestoreSdk()]);

  const activeEvents = deps.activeEvents;
  if (Array.isArray(activeEvents)) {
    if (activeEvents.length >= ACTIVE_EVENTS_LIST_CAP) {
      logger.warn('[NextActivity] active event list may be incomplete; using registration query fallback');
      reportClientError('next-activity-active-list-incomplete', new Error('active event list may be incomplete'));
      return loadWithRegistrationQuery(db, sdk, safeUid, logger);
    }
    return loadWithScopedRegistrationQuery(db, sdk, safeUid, logger, activeEvents);
  }

  return loadWithRegistrationQuery(db, sdk, safeUid, logger);
}
