// 個人頁相關活動（報名 / 主辦）。
//
// 對應 A `profile-data-history.js`：
// - `_getProfileRegisteredActivityItems`：以有效報名狀態過濾、依 eventId 去重、依日期排序。
// - `_getProfileHostedActivityItems`：主辦且 effective status === 'open'，排序為未來優先。
// - 蒐集時 collectionGroup 一律套 `filterSubcollectionDocs`（R-REG-014）。
//
// 判斷邏輯拆成純函式（buildRegisteredActivities / buildHostedActivities / getEventEffectiveStatus /
// isProfileHostedActivity），方便測試；load* 只負責 I/O。

import type { Firestore } from 'firebase/firestore';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import { events as eventsCollection, filterSubcollectionDocs, users } from '@/data/paths';

export type ActiveRegistrationStatus = 'confirmed' | 'registered' | 'waitlisted';

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['confirmed', 'registered', 'waitlisted']);
const STATUS_RANK: Readonly<Record<string, number>> = {
  confirmed: 3,
  registered: 2,
  waitlisted: 1,
};

export interface RegistrationRecord {
  [field: string]: unknown;
  eventId?: string;
  activityId?: string;
  userId?: string;
  uid?: string;
  ownerUid?: string;
  companionId?: string;
  participantType?: string;
  status?: string;
}

export interface EventRecord {
  [field: string]: unknown;
  id?: string;
  title?: string;
  status?: string;
  startAt?: unknown;
  endAt?: unknown;
  date?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  creatorUid?: string;
  hostUid?: string;
  ownerUid?: string;
  hostUids?: unknown;
  creatorUids?: unknown;
}

export interface RegisteredActivity {
  event: EventRecord;
  registration: RegistrationRecord;
  registrationStatus: ActiveRegistrationStatus;
  effectiveStatus: string;
}

export interface HostedActivity {
  event: EventRecord;
  effectiveStatus: string;
}

export interface RelatedActivities {
  registered: RegisteredActivity[];
  hosted: HostedActivity[];
  counts: { registered: number; hosted: number };
}

// ── 純函式：日期 / 狀態 ─────────────────────────────────

function toDateMs(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object') {
    const v = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
    if (typeof v.toMillis === 'function') {
      try { return v.toMillis(); } catch { return 0; }
    }
    if (typeof v.toDate === 'function') {
      try { return v.toDate().getTime(); } catch { return 0; }
    }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
  }
  return 0;
}

function activityDateMs(event: EventRecord | null | undefined): number {
  if (!event) return 0;
  return (
    toDateMs(event['startAt']) ||
    toDateMs(event['date']) ||
    toDateMs(event['startDate']) ||
    0
  );
}

function activityEndMs(event: EventRecord | null | undefined): number {
  if (!event) return 0;
  return (
    toDateMs(event['endAt']) ||
    toDateMs(event['endDate']) ||
    0
  );
}

/**
 * 對應 A `_getProfileActivityEffectiveStatus`（無 `_getEventEffectiveStatus` 時 fallback）。
 * B 端以 `status` 為基礎，遇到 `cancelled` 直通；有 `endAt`/`endDate` 且已過則視為 `ended`。
 */
export function getEventEffectiveStatus(
  eventRecord: EventRecord | null | undefined,
  now: number = Date.now(),
): string {
  if (!eventRecord) return 'open';
  const raw = String(eventRecord['status'] || '').trim();
  if (raw === 'cancelled') return 'cancelled';
  const endMs = activityEndMs(eventRecord);
  if (endMs > 0 && endMs < now) return 'ended';
  return raw || 'open';
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 對應 A `_getProfileRegisteredActivityItems` 的逐筆守門條件：
 * - 若紀錄上帶有 recordUid，必須在 allowedUids 中。
 * - participantType 不得為 companion；companionId 必須為空。
 * - status 必須是 confirmed / registered / waitlisted。
 */
function isActiveParticipantRegistration(
  reg: RegistrationRecord,
  allowedUids: ReadonlySet<string>,
): boolean {
  if (!reg) return false;
  const recordUid =
    normalizeString(reg.userId) ||
    normalizeString(reg.uid) ||
    normalizeString(reg.ownerUid);
  if (recordUid && !allowedUids.has(recordUid)) return false;
  if (normalizeString(reg.participantType) === 'companion') return false;
  if (normalizeString(reg.companionId)) return false;
  const status = normalizeString(reg.status);
  if (!ACTIVE_STATUSES.has(status)) return false;
  return true;
}

function compareRegistered(a: RegisteredActivity, b: RegisteredActivity): number {
  const diff = activityDateMs(a.event) - activityDateMs(b.event);
  if (diff !== 0) return diff;
  return String(a.event?.title || '').localeCompare(String(b.event?.title || ''));
}

function compareHosted(a: HostedActivity, b: HostedActivity, now: number): number {
  const aMs = activityDateMs(a.event);
  const bMs = activityDateMs(b.event);
  const aFuture = aMs >= now;
  const bFuture = bMs >= now;
  if (aFuture !== bFuture) return aFuture ? -1 : 1;
  const diff = aFuture ? aMs - bMs : bMs - aMs;
  if (diff !== 0) return diff;
  return String(a.event?.title || '').localeCompare(String(b.event?.title || ''));
}

/**
 * 純函式：由 registration list + event lookup 產出「報名中的活動」。
 * 對應 A `_getProfileRegisteredActivityItems`（去重 + 排序）。
 */
export function buildRegisteredActivities(
  registrations: readonly RegistrationRecord[],
  eventsById: ReadonlyMap<string, EventRecord>,
  allowedUids: ReadonlySet<string>,
  now: number = Date.now(),
): RegisteredActivity[] {
  const byEventId = new Map<string, RegisteredActivity>();

  for (const reg of registrations) {
    if (!isActiveParticipantRegistration(reg, allowedUids)) continue;
    const status = normalizeString(reg.status) as ActiveRegistrationStatus;
    const eventId =
      normalizeString(reg.eventId) || normalizeString(reg.activityId);
    if (!eventId) continue;
    const event = eventsById.get(eventId);
    if (!event) continue;
    const effectiveStatus = getEventEffectiveStatus(event, now);
    if (effectiveStatus === 'cancelled' || effectiveStatus === 'ended') continue;

    const previous = byEventId.get(eventId);
    const prevRank = previous ? (STATUS_RANK[previous.registrationStatus] ?? 0) : 0;
    const currRank = STATUS_RANK[status] ?? 0;
    if (!previous || currRank > prevRank) {
      byEventId.set(eventId, {
        event,
        registration: reg,
        registrationStatus: status,
        effectiveStatus,
      });
    }
  }

  return Array.from(byEventId.values()).sort(compareRegistered);
}

/**
 * 對應 A `_isProfileHostedActivity` 前端邏輯（B 端以 UID 比對 host 欄位）。
 * 檢查 creatorUid / hostUid / ownerUid，及 hostUids / creatorUids 陣列。
 * 只使用 UID 比對；名稱比對一律禁止（R-ID-002）。
 */
export function isProfileHostedActivity(
  eventRecord: EventRecord | null | undefined,
  allowedUids: ReadonlySet<string>,
): boolean {
  if (!eventRecord) return false;
  const singles = ['creatorUid', 'hostUid', 'ownerUid'] as const;
  for (const f of singles) {
    const v = eventRecord[f];
    if (typeof v === 'string' && allowedUids.has(v)) return true;
  }
  const lists = ['hostUids', 'creatorUids'] as const;
  for (const f of lists) {
    const v = eventRecord[f];
    if (Array.isArray(v)) {
      for (const entry of v) {
        if (typeof entry === 'string' && allowedUids.has(entry)) return true;
      }
    }
  }
  return false;
}

/**
 * 純函式：由 events 全集合產出「主辦中的活動」。
 * 對應 A `_getProfileHostedActivityItems`（主辦判斷 + effective status='open' + 排序）。
 */
export function buildHostedActivities(
  events: readonly EventRecord[],
  allowedUids: ReadonlySet<string>,
  now: number = Date.now(),
): HostedActivity[] {
  const items: HostedActivity[] = [];
  for (const event of events) {
    if (!isProfileHostedActivity(event, allowedUids)) continue;
    const effectiveStatus = getEventEffectiveStatus(event, now);
    if (effectiveStatus !== 'open') continue;
    items.push({ event, effectiveStatus });
  }
  return items.sort((a, b) => compareHosted(a, b, now));
}

// ── I/O：Firestore 讀取（僅以 UID） ────────────────────

interface SnapLike {
  exists: () => boolean;
  id: string;
  data: () => unknown;
}

async function loadUserRegistrations(uid: string): Promise<RegistrationRecord[]> {
  const firebase = await getFirebase();
  const db = firebase.db as unknown as Firestore;

  // A `getRegistrationsByUser(uid)` 對應：collectionGroup('registrations') where userId == uid。
  const q = query(collectionGroup(db, 'registrations'), where('userId', '==', uid));
  const snap = await getDocs(q);
  const subDocs = filterSubcollectionDocs(snap.docs);

  const out: RegistrationRecord[] = [];
  for (const d of subDocs) {
    const parentDoc = d.ref.parent.parent;
    const data = d.data() as Record<string, unknown>;
    const eventId =
      typeof data['eventId'] === 'string'
        ? data['eventId']
        : parentDoc?.id || '';
    out.push({
      ...data,
      _docId: d.id,
      _eventDocId: parentDoc?.id || '',
      eventId,
    });
  }
  return out;
}

async function loadEventsByIds(ids: readonly string[]): Promise<Map<string, EventRecord>> {
  const firebase = await getFirebase();
  const db = firebase.db as unknown as Firestore;

  const unique = Array.from(new Set(ids.filter((id) => !!id)));
  const map = new Map<string, EventRecord>();
  if (unique.length === 0) return map;

  const results = await Promise.all(
    unique.map(async (id) => {
      try {
        const snap = (await getDoc(doc(db, eventsCollection, id))) as unknown as SnapLike;
        if (!snap.exists()) return null;
        const data = snap.data() as Record<string, unknown>;
        return { id, data: { ...data, id } as EventRecord };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[related-activities] load event failed', id, err);
        return null;
      }
    }),
  );

  for (const r of results) if (r) map.set(r.id, r.data);
  return map;
}

async function loadAllEvents(): Promise<EventRecord[]> {
  const firebase = await getFirebase();
  const db = firebase.db as unknown as Firestore;
  const snap = await getDocs(collection(db, eventsCollection));
  const out: EventRecord[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const id = typeof data['id'] === 'string' && data['id'] ? data['id'] : d.id;
    out.push({ ...data, id });
  }
  return out;
}

/**
 * 載入個人頁的相關活動（報名 + 主辦）。
 * 只以 UID 查詢（used by viewer.uid）。
 */
export async function loadRelatedActivities(
  uid: string,
  now: number = Date.now(),
): Promise<RelatedActivities> {
  const safeUid = String(uid || '').trim();
  if (!safeUid) {
    return { registered: [], hosted: [], counts: { registered: 0, hosted: 0 } };
  }
  const allowedUids: ReadonlySet<string> = new Set([safeUid]);

  const [registrations, indexedEvents] = await Promise.all([
    loadUserRegistrations(safeUid),
    loadAllEvents(),
  ]);

  const regEventIds = registrations
    .map((r) => (typeof r.eventId === 'string' ? r.eventId : ''))
    .filter((v) => !!v);
  const eventsById = await loadEventsByIds(regEventIds);

  const registered = buildRegisteredActivities(registrations, eventsById, allowedUids, now);
  const hosted = buildHostedActivities(indexedEvents, allowedUids, now);

  return {
    registered,
    hosted,
    counts: { registered: registered.length, hosted: hosted.length },
  };
}

// `users` 保留 import 以便未來主辦/報名複合查詢擴充；目前不直接使用。
void users;
