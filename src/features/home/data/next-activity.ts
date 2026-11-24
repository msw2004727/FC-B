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

// Firestore SDK 只在查詢當下動態載入（T-041 A2）：本檔只留純函式、常數與型別，讀取段在 next-activity-load.ts 動態載入。
import { parseEventRangeMs } from '@/core/event-time';
import type { Firestore } from 'firebase/firestore';
import type { EventDoc, RegistrationDoc } from '@/features/events/data/types';
// 讀取段（Firestore 查詢）搬到 ./next-activity-load，避免靜態 SDK 進入首頁入口。
// 本檔不得再 value-import @/data/firestore-sdk、@/data/firebase、@/data/paths。
// 型別與常數留在本檔；動態載入包裝見檔尾。

// ── 常數（與 A 對齊） ─────────────────────────────────

/**
 * 報名查詢的安全上限（A 原為 120；B 搭配 status 篩選後上調，打到上限時會記警告）。
 * 10-26 唯讀約 299 → 500（T-036）；11-24 實測最多 367，過渡保險調 1,000（§3.656 批次 S，批次 A 後只在退回現行查法時生效）。
 */
export const REGISTRATION_QUERY_LIMIT = 1_000;
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

export function eventIdentityKey(event: EventDoc | null | undefined): string {
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
  const eventList = Array.isArray(events) ? events : [];
  eventList.forEach((event) => {
    if (!event) return;
    [event._docId, event.docId].forEach((raw) => {
      const key = String(raw ?? '').trim();
      if (key && !eventMap.has(key)) eventMap.set(key, event);
    });
  });
  eventList.forEach((event) => {
    if (!event) return;
    const key = String(event.id ?? '').trim();
    if (key && !eventMap.has(key)) eventMap.set(key, event);
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

// ── 型別與動態載入（讀取段在 next-activity-load.ts） ──

export interface NextActivityLogger {
  warn: (...args: unknown[]) => void;
}

export interface NextActivityDeps {
  getFirebase?: () => Promise<{ db: Firestore }>;
  logger?: NextActivityLogger;
  now?: () => number;
  /** 首頁 useEvents 確認向伺服器新取得的 active 清單；沒有就走現行查法（批次 A）。 */
  activeEvents?: readonly EventDoc[];
}

export type NextActivityActiveInput = readonly EventDoc[] | 'pending' | undefined;

export interface NextActivityInputs {
  registrations: RegistrationDoc[];
  events: EventDoc[];
}

let loadModule: Promise<typeof import('./next-activity-load')> | null = null;
export function loadNextActivityLoad(): Promise<typeof import('./next-activity-load')> {
  loadModule ??= import('./next-activity-load').catch((err: unknown) => {
    loadModule = null;
    throw err;
  });
  return loadModule;
}

export async function resolveNextActivity(
  deps: NextActivityDeps,
  uid: string,
): Promise<NextActivityResult | null> {
  const safeUid = String(uid ?? '').trim();
  if (!safeUid) return null;
  const nowMs = deps.now?.() ?? Date.now();
  const { loadNextActivityInputs } = await loadNextActivityLoad();
  const inputs = await loadNextActivityInputs(deps, safeUid);
  return pickNextActivityCandidate(inputs.registrations, inputs.events, safeUid, nowMs);
}
