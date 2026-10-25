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

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { getFirebase as defaultGetFirebase } from '@/data/firebase';
import { events as eventsCollectionPath, filterSubcollectionDocs, resolveEventDocId } from '@/data/paths';
import type { EventDoc, RegistrationDoc } from '@/features/events/data/types';

// ── 常數（與 A 對齊） ─────────────────────────────────

/** 報名查詢的安全上限（A 為 120；B 搭配 status 篩選後上調，打到上限時會記警告）。 */
export const REGISTRATION_QUERY_LIMIT = 200;
export const EVENT_QUERY_LIMIT = 80;

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

/**
 * 從 Firestore 讀取「下一場活動」所需的所有輸入。
 * 注意：collectionGroup('registrations') 的結果必須先過 filterSubcollectionDocs（R-REG-014）。
 */
export async function loadNextActivityInputs(
  deps: NextActivityDeps,
  uid: string,
): Promise<NextActivityInputs> {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) return { registrations: [], events: [] };

  const getFB = deps.getFirebase ?? defaultGetFirebase;
  const logger: NextActivityLogger = deps.logger ?? console;
  const { db } = await getFB();

  // 1) 使用者報名（collectionGroup；R-REG-014 過濾 legacy root）
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

  // 2) 使用者管理的活動（owner / creator / delegate）
  const managedSnaps = await Promise.all([
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

  const managedEvents: EventDoc[] = [];
  managedSnaps.forEach((snap) => {
    snap?.docs.forEach((d) => managedEvents.push(mapDoc(d)));
  });

  // 3) 報名指向、但 managed/cache 未涵蓋的活動 → 依 id 補抓
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

  const missingEvents = await Promise.all(
    missingEventIds.map(async (publicId) => {
      try {
        const docId = await resolveEventDocId(publicId);
        if (!docId) return null;
        const snap = await getDoc(doc(db, eventsCollectionPath, docId));
        if (!snap.exists()) return null;
        return { ...(snap.data() as Record<string, unknown>), _docId: snap.id } as EventDoc;
      } catch (err) {
        logger.warn('[NextActivity] event fetch skipped:', publicId, err);
        return null;
      }
    }),
  );

  const mergedEvents = mergeEventsByIdentity(
    [...managedEvents, ...missingEvents.filter((e): e is EventDoc => e != null)],
  );
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
