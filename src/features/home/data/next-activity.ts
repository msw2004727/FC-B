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
import type { DocumentData, Firestore, Query } from 'firebase/firestore';
import { loadFirestoreSdk, type FirestoreSdk } from '@/data/firestore-sdk';
import { getFirebase as defaultGetFirebase } from '@/data/firebase';
import { events as eventsCollectionPath, filterSubcollectionDocs } from '@/data/paths';
import type { EventDoc, RegistrationDoc } from '@/features/events/data/types';

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
  if (!value) return null;
  if (typeof value !== 'string') {
    const ms = toMillis(value);
    return ms ? { startMs: ms, endMs: ms + 2 * 60 * 60 * 1000 } : null;
  }
  const raw = value.trim();
  const m = raw.match(
    /(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s*[~\uFF5E-]\s*(\d{1,2}):(\d{2}))?/,
  );
  if (!m) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? { startMs: parsed, endMs: parsed + 2 * 60 * 60 * 1000 } : null;
  }
  const y = m[1];
  const mo = m[2];
  const d = m[3];
  const sh = m[4];
  const sm = m[5];
  if (!y || !mo || !d || !sh || !sm) return null;
  const year = Number(y);
  const month = Number(mo) - 1;
  const day = Number(d);
  const startHour = Number(sh);
  const startMinute = Number(sm);
  const eh = m[6];
  const em = m[7];
  const endHour = eh ? Number(eh) : startHour + 2;
  const endMinute = em ? Number(em) : startMinute;
  const start = new Date(year, month, day, startHour, startMinute, 0);
  const end = new Date(year, month, day, endHour, endMinute, 0);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'object') {
    const v = value as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
      nanoseconds?: number;
      _nanoseconds?: number;
    };
    if (typeof v.toMillis === 'function') {
      try {
        return v.toMillis();
      } catch {
        return 0;
      }
    }
    if (typeof v.toDate === 'function') {
      try {
        const d = v.toDate();
        return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
      } catch {
        return 0;
      }
    }
    const secRaw = typeof v.seconds === 'number' ? v.seconds : v._seconds;
    if (typeof secRaw === 'number' && Number.isFinite(secRaw)) {
      const nanoRaw = typeof v.nanoseconds === 'number' ? v.nanoseconds : v._nanoseconds;
      const nano = typeof nanoRaw === 'number' ? nanoRaw : 0;
      return secRaw * 1000 + Math.floor(nano / 1_000_000);
    }
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

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
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) return { registrations: [], events: [] };

  const getFB = deps.getFirebase ?? defaultGetFirebase;
  const logger: NextActivityLogger = deps.logger ?? console;
  const [{ db }, sdk] = await Promise.all([getFB(), loadFirestoreSdk()]);
  const { collection, collectionGroup, getDocs, limit, query, where } = sdk;

  // 1a) 使用者報名（collectionGroup；R-REG-014 過濾 legacy root）
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

  // 1b) 使用者管理的活動（owner / creator / delegate）
  const managedPromise = Promise.all([
    getDocs(
      query(
        collection(db, eventsCollectionPath),
        where('creatorUid', '==', safeUid),
        limit(EVENT_QUERY_LIMIT),
      ),
    ).catch((err) => {
      logger.warn('[NextActivity] creator query skipped:', err);
      return null;
    }),
    getDocs(
      query(
        collection(db, eventsCollectionPath),
        where('ownerUid', '==', safeUid),
        limit(EVENT_QUERY_LIMIT),
      ),
    ).catch((err) => {
      logger.warn('[NextActivity] owner query skipped:', err);
      return null;
    }),
    getDocs(
      query(
        collection(db, eventsCollectionPath),
        where('delegateUids', 'array-contains', safeUid),
        limit(EVENT_QUERY_LIMIT),
      ),
    ).catch((err) => {
      logger.warn('[NextActivity] delegate query skipped:', err);
      return null;
    }),
  ]);

  const [registrations, managedSnaps] = await Promise.all([registrationsPromise, managedPromise]);

  const managedEvents: EventDoc[] = [];
  managedSnaps.forEach((snap) => {
    snap?.docs.forEach((d) => managedEvents.push(mapDoc(d)));
  });

  // 2) 報名指向、但 managed/cache 未涵蓋的活動 → 依 id 一次補抓
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

  const mergedEvents = mergeEventsByIdentity([...managedEvents, ...missingEvents]);
  return { registrations, events: mergedEvents };
}

export async function resolveNextActivity(
  deps: NextActivityDeps,
  uid: string,
): Promise<NextActivityResult | null> {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) return null;
  const nowMs = deps.now?.() ?? Date.now();
  const inputs = await loadNextActivityInputs(deps, safeUid);
  return pickNextActivityCandidate(inputs.registrations, inputs.events, safeUid, nowMs);
}
