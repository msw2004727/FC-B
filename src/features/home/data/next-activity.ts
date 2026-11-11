/**
 * 首頁「我的下一場活動」資料層。
 *
 * 移植 A 的 js/modules/home-next-activity.js 的核心資料邏輯：
 *   - fetchRegistrationsForUid / cachedRegistrationsForUid
 *   - fetchManagedEventsForIdentity
 *   - fetchEventByPublicId
 *   - pickNextActivityCandidate / pickNextActivity
 *   - isActiveRegistration / isUpcomingEvent / registrationStatusMeta
 *
 * B 端修正之 drift（R-REG-014）：collectionGroup('registrations') 結果一律
 * 先走 @/data/paths::filterSubcollectionDocs 過濾 legacy root 文件。
 *
 * Firestore 呼叫全部集中在 loadNextActivityInputs() 這一個 async 函式；其餘為純函式。
 */

// Firestore SDK 只在查詢當下動態載入（T-041 A2）：本檔的純函式會被首頁路由引用，靜態 import SDK 會讓首頁多帶約 160 KB gz。
import { parseEventRangeMs } from '@/core/event-time';
import type { DocumentData, Firestore, Query } from 'firebase/firestore';
import { loadFirestoreSdk, type FirestoreSdk } from '@/data/firestore-sdk';
import { getFirebase as defaultGetFirebase } from '@/data/firebase';
import { events as eventsCollectionPath, filterSubcollectionDocs } from '@/data/paths';
import type { EventDoc, RegistrationDoc, ViewerContext } from '@/features/events/data/types';

// ── 常數（與 A 對齊） ─────────────────────────────────

/**
 * 報名查詢的安全上限（A 原為 120；B 搭配 status 篩選後上調，打到上限時會記警告）。
 * 2026-10-26 唯讀統計：每人進行中報名最大約 299（>200 的有 2 人），顧問裁定兩站都用 500（T-036）。
 */
export const REGISTRATION_QUERY_LIMIT = 500;
export const EVENT_QUERY_LIMIT = 80;
/** Firestore `in` 查詢一次最多 30 個值，補抓活動時依此分批。 */
export const EVENT_IN_QUERY_CHUNK = 30;

/**
 * 「進行中」的報名狀態，報名查詢用 `where('status','in', …)` 只取這些。
 * collectionGroup 預設依文件路徑排序、查詢又沒有 orderBy，只靠 limit 會被大量取消紀錄佔滿視窗，
 * 把最新活動的報名截掉（2026-10-25 實測：309 筆、217 筆已取消，明天的報名被 limit(120) 截掉）。
 * `userId ==` 加 `status in` 現有索引即可執行，不需新增複合索引。
 *
 * 狀態集合（T-033 盤點 FC js／functions／Rules 與 FC-B）：registrations 現行寫入值只有
 * confirmed／waitlisted／cancelled／removed；`registered` 沒有現行寫入點，但舊資料可能殘留，
 * A 的 `_isActiveRegistrationStatus`、Rules 的移除守衛與 B 個人頁都承認它是進行中，所以一併列入。
 * 沒有 pending／invited 等其他進行中值（那些在別的集合）。
 */
export const ACTIVE_REGISTRATION_STATUSES: readonly string[] = ['confirmed', 'waitlisted', 'registered'];

const TERMINAL_EVENT_STATUSES = new Set([
  'ended',
  'cancelled',
  'canceled',
  'archived',
  'removed',
]);

const TERMINAL_REGISTRATION_STATUSES = new Set([
  'cancelled',
  'canceled',
  'removed',
  'deleted',
  'rejected',
  'withdrawn',
]);

export const WAITLIST_REGISTRATION_STATUS = 'waitlisted';

// ── 純函式 ─────────────────────────────────────────

export interface DateRange {
  startMs: number;
  endMs: number;
}

/** 與 home-next-activity.js::parseEventDateRange 對齊 */
export function parseEventDateRange(value: unknown): DateRange | null {
  return parseEventRangeMs(value);
}

// 放在這行之後，避免把上面 parseEventDateRange 的行號往下推（台北時間守門鎖第 77 行）。
import { getLastKnownAuthUid } from '@/data/auth';
import { on } from '@/core/events';
import { readEventsSnapshot } from '@/features/events/data/events-snapshot-cache';
import { isEventVisibleToUser } from '@/features/events/data/visibility';

export function eventStartMs(event: EventDoc | null | undefined): number {
  if (!event) return 0;
  const range = parseEventDateRange(event.date ?? event.startAt ?? event.startTime);
  return range?.startMs ?? 0;
}

export function isUpcomingEvent(event: EventDoc | null | undefined, nowMs: number): boolean {
  if (!event) return false;
  if (!(event.id || event._docId || event.docId)) return false;
  const status = String(event.status ?? '').trim().toLowerCase();
  if (TERMINAL_EVENT_STATUSES.has(status)) return false;
  return eventStartMs(event) > nowMs;
}

export function isActiveRegistration(
  record: RegistrationDoc | null | undefined,
  uid: string,
): boolean {
  if (!record) return false;
  const recordUid = String(record.userId ?? record.uid ?? record.ownerUid ?? '').trim();
  const myUid = String(uid ?? '').trim();
  if (recordUid && myUid && recordUid !== myUid) return false;
  const status = String(record.status ?? '').trim().toLowerCase();
  return !TERMINAL_REGISTRATION_STATUSES.has(status);
}

function eventOwnerIds(event: EventDoc): string[] {
  return [
    event.creatorUid,
    event.ownerUid,
    event.createdByUid,
    event.creatorId,
    event.ownerId,
    event.organizerUid,
  ]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
}

/** 對應 A 的 managedRoleForEvent（僅信任 uid） */
export function managedRoleForEvent(
  event: EventDoc | null | undefined,
  uid: string,
): '' | 'owner' | 'delegate' {
  if (!event) return '';
  const myUid = String(uid ?? '').trim();
  if (!myUid) return '';
  if (eventOwnerIds(event).includes(myUid)) return 'owner';
  if (Array.isArray(event.delegateUids)) {
    if (event.delegateUids.some((d) => String(d ?? '').trim() === myUid)) return 'delegate';
  }
  return '';
}

function eventIdentityKey(event: EventDoc | null | undefined): string {
  if (!event) return '';
  const id = String(event.id || event._docId || event.docId || '').trim();
  if (id) return `id:${id}`;
  const title = String(event.title ?? '').trim();
  const date = String(event.date ?? event.startAt ?? event.startTime ?? '').trim();
  return title || date ? `event:${title}|${date}` : '';
}

export interface NextActivityResult {
  event: EventDoc;
  registration: RegistrationDoc | null;
  managedRole: string;
}

function candidatePriority(c: NextActivityResult): number {
  const role = String(c.managedRole || c.registration?.managedRole || '').toLowerCase();
  if (role === 'owner') return 0;
  if (role === 'delegate') return 1;
  const participantType = String(c.registration?.participantType ?? 'self').trim().toLowerCase();
  const p = !participantType || participantType === 'self' ? 0 : 1;
  return 2 + p;
}

/**
 * 對應 A 的 pickNextActivityCandidate：
 *   - 將 registrations + managed events 合併為候選
 *   - 過濾 terminal event / 已開始 event
 *   - 同一 event 只保留 priority 最高的 registration
 *   - 依 startMs 升序、priority 升序取第一個
 */
export function pickNextActivityCandidate(
  registrations: readonly RegistrationDoc[] | null | undefined,
  events: readonly EventDoc[] | null | undefined,
  uid: string,
  nowMs: number,
): NextActivityResult | null {
  const eventMap = new Map<string, EventDoc>();
  (Array.isArray(events) ? events : []).forEach((event) => {
    if (!event) return;
    [event.id, event._docId, event.docId].forEach((raw) => {
      const key = String(raw ?? '').trim();
      if (key && !eventMap.has(key)) eventMap.set(key, event);
    });
  });

  const candidates: NextActivityResult[] = [];
  const byEvent = new Map<string, number>();

  const push = (candidate: NextActivityResult) => {
    if (!candidate.event || !isUpcomingEvent(candidate.event, nowMs)) return;
    const key = eventIdentityKey(candidate.event);
    if (!key) {
      candidates.push(candidate);
      return;
    }
    const idx = byEvent.get(key);
    if (idx == null) {
      byEvent.set(key, candidates.length);
      candidates.push(candidate);
      return;
    }
    const existing = candidates[idx];
    if (existing && candidatePriority(candidate) < candidatePriority(existing)) {
      candidates[idx] = candidate;
    }
  };

  (Array.isArray(registrations) ? registrations : [])
    .filter((r) => isActiveRegistration(r, uid))
    .forEach((r) => {
      const eventId = String(r.eventId ?? '').trim();
      const event = eventMap.get(eventId);
      if (!event) return;
      push({ event, registration: r, managedRole: '' });
    });

  (Array.isArray(events) ? events : []).forEach((event) => {
    const role = managedRoleForEvent(event, uid);
    if (!role) return;
    push({ event, registration: { managedRole: role }, managedRole: role });
  });

  if (candidates.length === 0) return null;

  const sorted = candidates.slice().sort((a, b) => {
    const diff = eventStartMs(a.event) - eventStartMs(b.event);
    if (diff) return diff;
    return candidatePriority(a) - candidatePriority(b);
  });
  return sorted[0] ?? null;
}

export function pickNextActivity(
  registrations: readonly RegistrationDoc[] | null | undefined,
  events: readonly EventDoc[] | null | undefined,
  uid: string,
  nowMs: number,
): EventDoc | null {
  return pickNextActivityCandidate(registrations, events, uid, nowMs)?.event ?? null;
}

/** 對應 A 的 registrationStatusMeta */
export function registrationStatusMeta(
  record: RegistrationDoc | null | undefined,
): { key: string; label: string } {
  const managedRole = String(record?.managedRole ?? '').trim().toLowerCase();
  if (managedRole === 'owner') return { key: 'owner', label: '主辦' };
  if (managedRole === 'delegate') return { key: 'delegate', label: '委託' };
  const status = String(record?.status ?? '').trim().toLowerCase();
  if (status === WAITLIST_REGISTRATION_STATUS) return { key: 'waitlisted', label: '候補' };
  return { key: 'confirmed', label: '正取' };
}

// ── I/O（唯一 Firestore 存取入口） ───────────────────

export interface NextActivityLogger {
  warn: (...args: unknown[]) => void;
}

export interface NextActivityDeps {
  getFirebase?: () => Promise<{ db: Firestore }>;
  logger?: NextActivityLogger;
  now?: () => number;
}

export interface NextActivityInputs {
  registrations: RegistrationDoc[];
  events: EventDoc[];
}

/** 查詢是否完整成功。沒全部成功就不寫、也不清本機快照。 */
interface NextActivityLoadDetail extends NextActivityInputs {
  registrationsFetched: boolean;
  managedFetched: boolean;
  missingFetched: boolean;
  /** 至少有一場用列表／repo 裡的文件頂掉補抓。 */
  usedReusedStandIn: boolean;
}

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

/**
 * 報名指向、但管理的活動沒涵蓋的活動，一次用 `in` 查詢補抓（取代過去每個缺的 id 各自 resolveEventDocId＋getDoc：id 之間用 Promise.all 並行，但單一 id 內是串行的 1～3 次往返）：
 *   - `documentId() in ids`：報名的 eventId 就是文件 id（多數情況）；不是合法文件 id 的（例如含 '/'）不放進這條
 *   - `id in ids`：報名記的是 public id、文件 id 不同的活動（R-ID-010，原 resolveEventDocId 的第二步）
 * 兩條查詢、各分批並行；單一批次失敗（含建查詢時同步丟錯）只記警告，不影響其他批次。
 * 隔離單位是「批次」、不是單一 id（舊版逐 id 各自 try）：一批最多 `EVENT_IN_QUERY_CHUNK`（30）個 id，
 * 一批失敗會讓該批的 id 全部補不到；其中直接文件 id 那條失敗時，該批 id 也都不採 `id` 欄位備援（見下）。
 *
 * R-ID-010 的優先順序：`events/{eventId}` 這份文件存在就用它；只有它「確認不存在」才採 `id` 欄位相符的那份。
 * 同一個 public id 同時對應兩份文件時，`id` 欄位那份會被丟掉。
 * 「確認不存在」＝直接文件 id 的查詢成功且沒找到（或這個 id 本來就不可能是文件 id，例如含 '/'）。
 * 直接文件 id 的查詢「失敗」時不知道 `events/X` 在不在，這些 id 不採 `id` 欄位備援——該卡缺席比顯示錯的卡好（退修 4）。
 */
async function fetchMissingEvents(
  sdk: FirestoreSdk,
  db: Firestore,
  missingEventIds: readonly string[],
  logger: NextActivityLogger,
): Promise<{ events: EventDoc[]; complete: boolean }> {
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
  const complete = [...byDocIdResults, ...byPublicIdResults].every((result) => result.ok);
  return { events: [...byPublicId, ...byDocId], complete };
}

/**
 * 從 Firestore 讀取「下一場活動」所需的所有輸入。
 * 注意：collectionGroup('registrations') 的結果必須先過 filterSubcollectionDocs（R-REG-014）。
 *
 * 查詢順序（A4：原本是「報名」→「三個管理查詢」→「補抓缺的活動」三個階段串行；補抓階段各 id 之間並行、單一 id 內串行）：
 *   1) 報名與三個管理查詢互不相依，一起發出（Promise.all）
 *   2) 兩邊都回來才知道哪些報名指向的活動還缺，缺的 id 用 `in` 查詢一次補抓
 */
export async function loadNextActivityInputs(
  deps: NextActivityDeps,
  uid: string,
): Promise<NextActivityInputs> {
  const nowMs = deps.now?.() ?? Date.now();
  const loaded = await loadNextActivityInputsDetailed(deps, uid, nowMs);
  return { registrations: loaded.registrations, events: loaded.events };
}

async function loadNextActivityInputsDetailed(
  deps: NextActivityDeps,
  uid: string,
  nowMs: number,
): Promise<NextActivityLoadDetail> {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) {
    return {
      registrations: [],
      events: [],
      registrationsFetched: false,
      managedFetched: false,
      missingFetched: false,
      usedReusedStandIn: false,
    };
  }

  const getFB = deps.getFirebase ?? defaultGetFirebase;
  const logger: NextActivityLogger = deps.logger ?? console;
  const [{ db }, sdk] = await Promise.all([getFB(), loadFirestoreSdk()]);
  const { collection, collectionGroup, documentId, getDocs, limit, orderBy, query, where } = sdk;

  // 1a) 使用者報名（collectionGroup；R-REG-014 過濾 legacy root）
  let registrationsFetched = false;
  const registrationsPromise = (async (): Promise<RegistrationDoc[]> => {
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
      registrationsFetched = true;
      if (regSnap.docs.length >= REGISTRATION_QUERY_LIMIT) {
        logger.warn(
          '[NextActivity] registration query hit the limit; later registrations may be missing:',
          REGISTRATION_QUERY_LIMIT,
        );
      }
      const subcollectionDocs = filterSubcollectionDocs(regSnap.docs);
      subcollectionDocs.forEach((d) => registrations.push(mapRegistration(d)));
    } catch (err) {
      logger.warn('[NextActivity] registration query skipped:', err);
    }
    return registrations;
  })();

  // 1b) 使用者管理的活動（creator／owner／delegate）。
  // 新活動文件 id 是 ce_<建立毫秒>_…，降冪才是「最新建立的在前」。
  // 沒有 orderBy 時 Firestore 依文件 id 升冪，limit(80) 只留最早的 80 場，下一場會被截掉。
  // creatorUid／ownerUid 等號查詢再依文件 id 降冪，走該欄位的自動單欄索引（索引項已含 __name__），不需複合索引。
  // 回傳筆數打到上限只警告一次，不印 uid。舊文件 id 可能不是 ce_ 格式（R-ID-008），排序位置不代表建立時間。
  const fetchManaged = async (
    label: 'creator' | 'owner' | 'delegate',
    build: () => Query<DocumentData>,
  ) => {
    try {
      const snap = await getDocs(build());
      if (snap.docs.length >= EVENT_QUERY_LIMIT) {
        logger.warn(
          `[NextActivity] ${label} query hit the limit; older events may be missing:`,
          EVENT_QUERY_LIMIT,
        );
      }
      return snap;
    } catch (err) {
      logger.warn(`[NextActivity] ${label} query skipped:`, err);
      return null;
    }
  };
  const managedEventsQuery = (field: 'creatorUid' | 'ownerUid') =>
    query(
      collection(db, eventsCollectionPath),
      where(field, '==', safeUid),
      orderBy(documentId(), 'desc'),
      limit(EVENT_QUERY_LIMIT),
    );
  const managedPromise = Promise.all([
    fetchManaged('creator', () => managedEventsQuery('creatorUid')),
    fetchManaged('owner', () => managedEventsQuery('ownerUid')),
    // 不排序：缺 (delegateUids, __name__ DESC) 索引；要排序須先在 FC firestore.indexes.json 加索引並部署。
    fetchManaged('delegate', () => query(
      collection(db, eventsCollectionPath),
      where('delegateUids', 'array-contains', safeUid),
      limit(EVENT_QUERY_LIMIT),
    )),
  ]);

  const reusedPromise = loadReusedEvents(safeUid, nowMs);
  const [registrations, managedSnaps, reusedEvents] = await Promise.all([
    registrationsPromise,
    managedPromise,
    reusedPromise,
  ]);

  const managedEvents: EventDoc[] = [];
  let managedFetched = true;
  for (const snap of managedSnaps) {
    if (!snap) {
      managedFetched = false;
      continue;
    }
    snap.docs.forEach((d) => managedEvents.push(mapDoc(d)));
  }

  // 2) 報名指向、但管理查詢沒涵蓋的活動。已在首頁／列表載入且仍是即將到來的，不再補抓。
  const haveIds = new Set<string>();
  const remember = (event: EventDoc): void => {
    [event.id, event._docId, event.docId].forEach((raw) => {
      const v = String(raw ?? '').trim();
      if (v) haveIds.add(v);
    });
  };
  managedEvents.forEach(remember);

  const reusedById = new Map<string, EventDoc>();
  for (const event of reusedEvents) {
    if (!isUpcomingEvent(event, nowMs)) continue;
    [event.id, event._docId, event.docId].forEach((raw) => {
      const key = String(raw ?? '').trim();
      if (key && !reusedById.has(key)) reusedById.set(key, event);
    });
  }

  const missingEventIds: string[] = [];
  const seenMissing = new Set<string>();
  const fromReuse: EventDoc[] = [];
  let usedReusedStandIn = false;
  registrations.forEach((r) => {
    const id = String(r.eventId ?? '').trim();
    if (!id || haveIds.has(id) || seenMissing.has(id)) return;
    const standIn = reusedById.get(id);
    if (standIn) {
      usedReusedStandIn = true;
      fromReuse.push(standIn);
      remember(standIn);
      seenMissing.add(id);
      return;
    }
    seenMissing.add(id);
    missingEventIds.push(id);
  });

  let missingFetched = true;
  let missingEvents: EventDoc[] = [];
  if (missingEventIds.length > 0) {
    const fetched = await fetchMissingEvents(sdk, db, missingEventIds, logger);
    missingEvents = fetched.events;
    missingFetched = fetched.complete;
  }

  // 伺服器文件放後面，同一場的欄位以這次查到的為準。
  const mergedEvents = mergeEventsByIdentity([...fromReuse, ...managedEvents, ...missingEvents]);
  return {
    registrations,
    events: mergedEvents,
    registrationsFetched,
    managedFetched,
    missingFetched,
    usedReusedStandIn,
  };
}

export async function resolveNextActivity(
  deps: NextActivityDeps,
  uid: string,
): Promise<NextActivityResult | null> {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) return null;
  const nowMs = deps.now?.() ?? Date.now();
  const knownAtStart = getLastKnownAuthUid();
  if (knownAtStart === safeUid) noteAuth(safeUid);
  const gen = generation;
  const loaded = await loadNextActivityInputsDetailed(deps, safeUid, nowMs);
  const result = pickNextActivityCandidate(loaded.registrations, loaded.events, safeUid, nowMs);
  const serverPicture = loaded.registrationsFetched && loaded.managedFetched && loaded.missingFetched;
  if (
    getLastKnownAuthUid() === safeUid
    && gen === generation
    && boundUid === safeUid
    && serverPicture
  ) {
    if (result && isDisplayableNextActivity(result, safeUid, nowMs)) {
      storeNextActivity(safeUid, result, nowMs);
    } else if (!loaded.usedReusedStandIn) {
      forgetNextActivity(safeUid);
    }
  }
  return result;
}

// ── 沿用已載入活動、本機快照 ─────────────────────────

/** 與活動列表本機快照同一段期限。 */
export const NEXT_ACTIVITY_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
export const NEXT_ACTIVITY_SNAPSHOT_FORMAT = 1;
export const NEXT_ACTIVITY_SNAPSHOT_KEY_PREFIX = 'fcb:next-activity:v1:';
const NEXT_ACTIVITY_FUTURE_SKEW_MS = 60_000;
const NEXT_ACTIVITY_SNAPSHOT_MAX_CHARS = 20_000;
const EMPTY_TEAMS: ReadonlySet<string> = new Set();

export function nextActivitySnapshotKey(uid: string): string {
  return NEXT_ACTIVITY_SNAPSHOT_KEY_PREFIX + uid;
}

interface MemorySnapshot {
  uid: string;
  savedAt: number;
  result: NextActivityResult;
}

interface StoredNextActivity {
  v: number;
  uid: string;
  savedAt: number;
  event: EventDoc;
  registration: RegistrationDoc | null;
  managedRole: string;
}

let generation = 0;
let boundUid: string | null = null;
let memory: MemorySnapshot | null = null;
let repoModule: Promise<typeof import('@/features/events/data/events-repo')> | null = null;
let authWatchStarted = false;

function loadEventsRepoModule(): Promise<typeof import('@/features/events/data/events-repo')> {
  if (!repoModule) {
    const promise = import('@/features/events/data/events-repo');
    repoModule = promise;
    promise.catch(() => {
      if (repoModule === promise) repoModule = null;
    });
  }
  return repoModule;
}

/** 首頁／列表已經有的活動文件。失敗當沒有，不擋報名查詢（L-08：載入失敗清掉 inflight）。 */
async function loadReusedEvents(uid: string, nowMs: number): Promise<EventDoc[]> {
  const found: EventDoc[] = [];
  const known = getLastKnownAuthUid();
  if (known === undefined || known === uid) {
    try {
      const cached = readEventsSnapshot(uid, nowMs);
      if (cached) found.push(...cached);
    } catch {
      /* 列表快照壞了就當沒有 */
    }
  }
  try {
    const { getEventsRepo } = await loadEventsRepoModule();
    const snap = getEventsRepo().getSnapshot();
    found.push(...snap.active, ...snap.terminal);
  } catch {
    /* repo 載入失敗：這次改走補抓 */
  }
  return found;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return undefined;
  return trimmed;
}

function plainTime(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return text(value, 200);
}

function stringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (out.length >= maxItems) break;
    const id = text(item, 200);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 黑名單只留字串。本人若在名單裡就排最前，避免被長度上限截掉。 */
function projectBlocked(value: unknown, uid: string): string[] | undefined {
  const list = stringList(value, 80);
  if (list.length === 0) return undefined;
  if (!Array.isArray(value) || !value.includes(uid)) return list;
  return [uid, ...list.filter((id) => id !== uid)].slice(0, 80);
}

function projectEvent(event: EventDoc, uid: string): EventDoc | null {
  const id = text(event.id, 200);
  const docId = text(event._docId, 200);
  const legacyDocId = text(event.docId, 200);
  if (!id && !docId && !legacyDocId) return null;
  const projected: EventDoc = {};
  if (id) projected.id = id;
  if (docId) projected._docId = docId;
  if (legacyDocId) projected.docId = legacyDocId;
  const title = text(event.title, 500);
  if (title) projected.title = title;
  const date = text(event.date, 200);
  if (date) projected.date = date;
  const status = text(event.status, 40);
  if (status) projected.status = status;
  const location = text(event.location, 500);
  if (location) projected.location = location;
  const image = text(event.image, 2000);
  if (image) projected.image = image;
  const startAt = plainTime(event.startAt);
  if (startAt !== undefined) projected.startAt = startAt;
  const startTime = plainTime(event.startTime);
  if (startTime !== undefined) projected.startTime = startTime;
  const variants = event.imageVariants;
  const homeNext = variants && text(variants.homeNext, 2000);
  const cover = variants && text(variants.cover, 2000);
  if (homeNext || cover) {
    projected.imageVariants = {
      ...(homeNext ? { homeNext } : {}),
      ...(cover ? { cover } : {}),
    };
  }
  const blocked = projectBlocked(event.blockedUids, uid);
  if (blocked) projected.blockedUids = blocked;
  for (const field of ['creatorUid', 'ownerUid', 'createdByUid', 'creatorId', 'ownerId', 'organizerUid'] as const) {
    const value = text(event[field], 200);
    if (value) projected[field] = value;
  }
  const delegates = stringList(event.delegateUids, 40);
  if (delegates.length > 0) projected.delegateUids = delegates;
  return projected;
}

function projectRegistration(value: unknown, managedRole: string): RegistrationDoc | null {
  const role = text(managedRole, 40) ?? '';
  if (!value || typeof value !== 'object') return role ? { managedRole: role } : null;
  const record = value as RegistrationDoc;
  const out: RegistrationDoc = {};
  const eventId = text(record.eventId, 200);
  if (eventId) out.eventId = eventId;
  const userId = text(record.userId, 200);
  if (userId) out.userId = userId;
  const status = text(record.status, 40);
  if (status) out.status = status;
  const participantType = text(record.participantType, 40);
  if (participantType) out.participantType = participantType;
  const recordRole = text(record.managedRole, 40) ?? (role || undefined);
  if (recordRole) out.managedRole = recordRole;
  if (!eventId && !userId && !status && !recordRole) return null;
  return out;
}

function viewerFor(uid: string): ViewerContext {
  return { uid, teamIds: EMPTY_TEAMS, hasPermission: () => false, roleLevel: 0 };
}

function isDisplayableNextActivity(result: NextActivityResult, uid: string, nowMs: number): boolean {
  if (!isUpcomingEvent(result.event, nowMs)) return false;
  const registration = result.registration;
  if (registration && !isActiveRegistration(registration, uid) && !result.managedRole) return false;
  const regs = registration ? [registration] : [];
  return isEventVisibleToUser(result.event, viewerFor(uid), regs);
}

function removeAllStored(): void {
  memory = null;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(NEXT_ACTIVITY_SNAPSHOT_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

function forgetNextActivity(uid: string): void {
  if (memory?.uid === uid) memory = null;
  try {
    localStorage.removeItem(nextActivitySnapshotKey(uid));
  } catch {
    /* 忽略 */
  }
}

/** 換帳號只留這位的鑰匙。登出由 noteAuth(null) 全部刪除。 */
function removeExcept(uid: string): void {
  const keep = nextActivitySnapshotKey(uid);
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(NEXT_ACTIVITY_SNAPSHOT_KEY_PREFIX) && key !== keep) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
  if (memory && memory.uid !== uid) memory = null;
}

function noteAuth(uid: string | null): void {
  const next = typeof uid === 'string' && uid.trim() ? uid.trim() : null;
  if (next === null) {
    generation += 1;
    boundUid = null;
    removeAllStored();
    return;
  }
  if (next !== boundUid) generation += 1;
  boundUid = next;
  removeExcept(next);
}

function storeNextActivity(uid: string, result: NextActivityResult, nowMs: number): void {
  const event = projectEvent(result.event, uid);
  if (!event) return;
  const registration = projectRegistration(result.registration, result.managedRole);
  const managedRole = text(result.managedRole, 40) ?? '';
  const stored: NextActivityResult = { event, registration, managedRole };
  if (!isDisplayableNextActivity(stored, uid, nowMs)) return;
  const payload: StoredNextActivity = {
    v: NEXT_ACTIVITY_SNAPSHOT_FORMAT,
    uid,
    savedAt: nowMs,
    event,
    registration,
    managedRole,
  };
  memory = { uid, savedAt: nowMs, result: stored };
  try {
    const raw = JSON.stringify(payload);
    if (raw.length > NEXT_ACTIVITY_SNAPSHOT_MAX_CHARS) {
      forgetNextActivity(uid);
      return;
    }
    localStorage.setItem(nextActivitySnapshotKey(uid), raw);
  } catch {
    forgetNextActivity(uid);
  }
}

function ageOk(savedAt: number, nowMs: number): boolean {
  return nowMs - savedAt <= NEXT_ACTIVITY_SNAPSHOT_MAX_AGE_MS && savedAt <= nowMs + NEXT_ACTIVITY_FUTURE_SKEW_MS;
}

function readStored(uid: string, nowMs: number): NextActivityResult | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(nextActivitySnapshotKey(uid));
  } catch {
    return null;
  }
  if (!raw || raw.length > NEXT_ACTIVITY_SNAPSHOT_MAX_CHARS) return null;
  let parsed: Partial<StoredNextActivity> | null = null;
  try {
    parsed = JSON.parse(raw) as Partial<StoredNextActivity>;
  } catch {
    return null;
  }
  if (!parsed || parsed.v !== NEXT_ACTIVITY_SNAPSHOT_FORMAT || parsed.uid !== uid) return null;
  if (typeof parsed.savedAt !== 'number' || !Number.isFinite(parsed.savedAt) || !ageOk(parsed.savedAt, nowMs)) {
    return null;
  }
  if (!parsed.event || typeof parsed.event !== 'object') return null;
  const event = projectEvent(parsed.event, uid);
  if (!event) return null;
  const managedRole = text(parsed.managedRole, 40) ?? '';
  const registration = projectRegistration(parsed.registration, managedRole);
  const result: NextActivityResult = { event, registration, managedRole };
  if (!isDisplayableNextActivity(result, uid, nowMs)) return null;
  memory = { uid, savedAt: parsed.savedAt, result };
  return result;
}

/** 回訪先畫用的同步讀取。帳號未確認、登出、過期、不可見都回 null。 */
export function readNextActivitySnapshot(uid: string, nowMs: number = Date.now()): NextActivityResult | null {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid || getLastKnownAuthUid() !== safeUid) return null;
  if (memory?.uid === safeUid && ageOk(memory.savedAt, nowMs) && isDisplayableNextActivity(memory.result, safeUid, nowMs)) {
    return memory.result;
  }
  if (memory?.uid === safeUid) memory = null;
  const result = readStored(safeUid, nowMs);
  if (!result) {
    forgetNextActivity(safeUid);
    return null;
  }
  return result;
}

function watchNextActivityAuth(): void {
  if (authWatchStarted) return;
  authWatchStarted = true;
  on('auth:changed', ({ uid }) => {
    noteAuth(uid);
  });
}

watchNextActivityAuth();

/** 測試用。 */
export function _resetNextActivityCacheForTest(): void {
  generation = 0;
  boundUid = null;
  memory = null;
  removeAllStored();
}
