/**
 * 「我的下一場」本機快照。由 next-activity.ts 動態 import，不進首頁入口的靜態圖。
 *
 * 本檔沒有頂層呼叫：不在 import 當下訂閱 auth:changed。
 * 訂閱發生在第一次讀或寫。載入後若 getLastKnownAuthUid() 已是 null，由呼叫端跑 adopt() 清殘留。
 *
 * 落盤不含他人 UID（黑名單、creator／owner／delegate）。可見性在讀回時用當下 viewer 重判。
 */
import { on } from '@/core/events';
import { parseEventRangeMs } from '@/core/event-time';
import { getLastKnownAuthUid } from '@/data/auth';
import type { EventDoc, RegistrationDoc, ViewerContext } from '@/features/events/data/types';
import { readEventsSnapshot } from '@/features/events/data/events-snapshot-cache';
import { getVisibleEvents, isEventDelegate, isEventOwner, isEventVisibleToUser } from '@/features/events/data/visibility';
import type { NextActivityResult } from './next-activity';

export const NEXT_ACTIVITY_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
export const NEXT_ACTIVITY_SNAPSHOT_FORMAT = 2;
export const NEXT_ACTIVITY_SNAPSHOT_KEY_PREFIX = 'fcb:next-activity:v1:';

const FUTURE_SKEW_MS = 60_000;
const MAX_CHARS = 20_000;
const NO_TEAMS: ReadonlySet<string> = new Set();

export function nextActivitySnapshotKey(uid: string): string {
  return NEXT_ACTIVITY_SNAPSHOT_KEY_PREFIX + uid;
}

/** 落盤用的活動。只有顯示欄位、隊伍 id、以及「對本人」的布林，沒有他人 UID。 */
interface StoredEvent {
  id?: string;
  _docId?: string;
  docId?: string;
  title?: string;
  date?: string;
  status?: string;
  location?: string;
  image?: string;
  imageVariants?: { homeNext?: string; cover?: string };
  startAt?: string | number;
  startTime?: string | number;
  teamOnly?: boolean;
  isPublic?: boolean;
  privateEvent?: boolean;
  creatorTeamId?: string;
  creatorTeamIds?: string[];
  viewerBlocked?: boolean;
  viewerIsOwner?: boolean;
  viewerIsDelegate?: boolean;
}

interface StoredRegistration {
  eventId?: string;
  status?: string;
  participantType?: string;
  managedRole?: string;
}

interface StoredNextActivity {
  v: number;
  uid: string;
  savedAt: number;
  event: StoredEvent;
  registration: StoredRegistration | null;
  managedRole: string;
}

interface MemorySnapshot {
  uid: string;
  savedAt: number;
  result: NextActivityResult;
}

type Verdict = 'show' | 'keep' | 'drop';

let generation = 0;
let boundUid: string | null = null;
let memory: MemorySnapshot | null = null;
let watchStarted = false;

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

function emptyViewer(uid: string): ViewerContext {
  return { uid, teamIds: NO_TEAMS, hasPermission: () => false, roleLevel: 0 };
}

let repoModule: Promise<typeof import('@/features/events/data/events-repo')> | null = null;

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

/** 首頁／列表已經有的活動。失敗當沒有，不擋報名查詢。 */
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

function addEventIds(event: EventDoc, into: Set<string>): void {
  for (const raw of [event.id, event._docId, event.docId]) {
    const key = String(raw ?? '').trim();
    if (key) into.add(key);
  }
}

/**
 * 先把已載入活動讀進來，再交給呼叫端（查詢回來之後）決定哪些報名不用補抓。
 * 沿用副本只限仍是即將到來的場。呼叫端在這個 chunk 載入失敗時改走原本的補抓。
 */
export function reuse(
  uid: string,
  nowMs: number,
): Promise<(registrations: readonly { eventId?: unknown }[], managedEvents: readonly EventDoc[]) => [EventDoc[], string[]]> {
  return loadReusedEvents(uid, nowMs).then((reusedEvents) => (registrations, managedEvents) => {
    const haveIds = new Set<string>();
    for (const event of managedEvents) addEventIds(event, haveIds);
    const reusedById = new Map<string, EventDoc>();
    for (const event of reusedEvents) {
      if (!isStillUpcoming(event, nowMs)) continue;
      for (const raw of [event.id, event._docId, event.docId]) {
        const key = String(raw ?? '').trim();
        if (key && !reusedById.has(key)) reusedById.set(key, event);
      }
    }
    const fromReuse: EventDoc[] = [];
    const missingEventIds: string[] = [];
    const seen = new Set<string>();
    for (const registration of registrations) {
      const id = String(registration.eventId ?? '').trim();
      if (!id || haveIds.has(id) || seen.has(id)) continue;
      const standIn = reusedById.get(id);
      if (standIn) {
        fromReuse.push(standIn);
        addEventIds(standIn, haveIds);
        seen.add(id);
        continue;
      }
      seen.add(id);
      missingEventIds.push(id);
    }
    return [fromReuse, missingEventIds];
  });
}

/** 與 isUpcomingEvent 同一時間規則，並先排除 cancelled／ended（不靠黑名單可見性）。 */
function isStillUpcoming(event: EventDoc | null | undefined, nowMs: number): boolean {
  if (!event) return false;
  if (!(event.id || event._docId || event.docId)) return false;
  const status = String(event.status ?? '').trim().toLowerCase();
  if (status === 'cancelled' || status === 'canceled' || status === 'ended') return false;
  if (status === 'archived' || status === 'removed') return false;
  const startMs = parseEventRangeMs(event.date ?? event.startAt ?? event.startTime)?.startMs ?? 0;
  return startMs > nowMs;
}

function isActiveRegistration(record: RegistrationDoc | null | undefined, uid: string): boolean {
  if (!record) return false;
  const recordUid = String(record.userId ?? record.uid ?? record.ownerUid ?? '').trim();
  const myUid = String(uid ?? '').trim();
  if (recordUid && myUid && recordUid !== myUid) return false;
  const status = String(record.status ?? '').trim().toLowerCase();
  return status !== 'cancelled'
    && status !== 'canceled'
    && status !== 'removed'
    && status !== 'deleted'
    && status !== 'rejected'
    && status !== 'withdrawn';
}

function visibilityRegs(result: NextActivityResult, uid: string): RegistrationDoc[] {
  const registration = result.registration;
  if (!registration?.eventId) return [];
  return [{ ...registration, userId: registration.userId ?? uid }];
}

/** 空隊伍、無權限時仍可能因隊伍或私密而看不見；那不是黑名單，不能當成確定不可見。 */
function needsViewerContext(event: EventDoc, uid: string): boolean {
  const teamGated = Boolean(event.teamOnly) && !event.isPublic && !isEventOwner(event, uid);
  const privateGated = Boolean(event.privateEvent) && !isEventOwner(event, uid) && !isEventDelegate(event, uid);
  return teamGated || privateGated;
}

function judge(
  result: NextActivityResult,
  uid: string,
  nowMs: number,
  viewer: ViewerContext | undefined,
  allowKeep: boolean,
): Verdict {
  const event = result.event;
  if (!isStillUpcoming(event, nowMs)) return 'drop';
  if (result.registration && !isActiveRegistration(result.registration, uid) && !result.managedRole) return 'drop';
  const regs = visibilityRegs(result, uid);
  const baseline = emptyViewer(uid);
  if (!isEventVisibleToUser(event, baseline, regs)) return 'drop';
  const effective = viewer ?? baseline;
  if (getVisibleEvents([event], effective, regs).length > 0) return 'show';
  if (allowKeep && viewer === undefined && needsViewerContext(event, uid)) return 'keep';
  return 'drop';
}

function projectRegistration(value: RegistrationDoc | null | undefined, managedRole: string): StoredRegistration | null {
  const role = text(managedRole, 40) ?? '';
  if (!value || typeof value !== 'object') return role ? { managedRole: role } : null;
  const out: StoredRegistration = {};
  const eventId = text(value.eventId, 200);
  if (eventId) out.eventId = eventId;
  const status = text(value.status, 40);
  if (status) out.status = status;
  const participantType = text(value.participantType, 40);
  if (participantType) out.participantType = participantType;
  const recordRole = text(value.managedRole, 40) ?? (role || undefined);
  if (recordRole) out.managedRole = recordRole;
  if (!eventId && !status && !recordRole) return null;
  return out;
}

function projectEvent(event: EventDoc, uid: string): StoredEvent | null {
  const id = text(event.id, 200);
  const docId = text(event._docId, 200);
  const legacyDocId = text(event.docId, 200);
  if (!id && !docId && !legacyDocId) return null;
  const stored: StoredEvent = {};
  if (id) stored.id = id;
  if (docId) stored._docId = docId;
  if (legacyDocId) stored.docId = legacyDocId;
  const title = text(event.title, 500);
  if (title) stored.title = title;
  const date = text(event.date, 200);
  if (date) stored.date = date;
  const status = text(event.status, 40);
  if (status) stored.status = status;
  const location = text(event.location, 500);
  if (location) stored.location = location;
  const image = text(event.image, 2000);
  if (image) stored.image = image;
  const startAt = plainTime(event.startAt);
  if (startAt !== undefined) stored.startAt = startAt;
  const startTime = plainTime(event.startTime);
  if (startTime !== undefined) stored.startTime = startTime;
  const variants = event.imageVariants;
  const homeNext = variants && text(variants.homeNext, 2000);
  const cover = variants && text(variants.cover, 2000);
  if (homeNext || cover) {
    stored.imageVariants = {
      ...(homeNext ? { homeNext } : {}),
      ...(cover ? { cover } : {}),
    };
  }
  if (event.teamOnly === true) stored.teamOnly = true;
  if (event.isPublic === true) stored.isPublic = true;
  if (event.privateEvent === true) stored.privateEvent = true;
  const teamId = text(event.creatorTeamId, 200);
  if (teamId) stored.creatorTeamId = teamId;
  const teamIds = stringList(event.creatorTeamIds, 40);
  if (teamIds.length > 0) stored.creatorTeamIds = teamIds;
  if (Array.isArray(event.blockedUids) && event.blockedUids.includes(uid)) stored.viewerBlocked = true;
  if (isEventOwner(event, uid)) stored.viewerIsOwner = true;
  if (isEventDelegate(event, uid)) stored.viewerIsDelegate = true;
  return stored;
}

/** 讀回後組出給可見性重判的活動。他人 UID 不出現；本人是否被擋、是否主辦／委託用布林還原。 */
function materialize(stored: StoredEvent, uid: string): EventDoc {
  const event: EventDoc = {};
  if (stored.id) event.id = stored.id;
  if (stored._docId) event._docId = stored._docId;
  if (stored.docId) event.docId = stored.docId;
  if (stored.title) event.title = stored.title;
  if (stored.date) event.date = stored.date;
  if (stored.status) event.status = stored.status;
  if (stored.location) event.location = stored.location;
  if (stored.image) event.image = stored.image;
  if (stored.startAt !== undefined) event.startAt = stored.startAt;
  if (stored.startTime !== undefined) event.startTime = stored.startTime;
  if (stored.imageVariants) event.imageVariants = stored.imageVariants;
  if (stored.teamOnly) event.teamOnly = true;
  if (stored.isPublic) event.isPublic = true;
  if (stored.privateEvent) event.privateEvent = true;
  if (stored.creatorTeamId) event.creatorTeamId = stored.creatorTeamId;
  if (stored.creatorTeamIds && stored.creatorTeamIds.length > 0) event.creatorTeamIds = stored.creatorTeamIds;
  if (stored.viewerBlocked) event.blockedUids = [uid];
  if (stored.viewerIsOwner) event.creatorUid = uid;
  if (stored.viewerIsDelegate) event.delegateUids = [uid];
  return event;
}

function registrationFromStored(value: unknown, managedRole: string): RegistrationDoc | null {
  const role = text(managedRole, 40) ?? '';
  if (!value || typeof value !== 'object') return role ? { managedRole: role } : null;
  const raw = value as StoredRegistration;
  const out: RegistrationDoc = {};
  const eventId = text(raw.eventId, 200);
  if (eventId) out.eventId = eventId;
  const status = text(raw.status, 40);
  if (status) out.status = status;
  const participantType = text(raw.participantType, 40);
  if (participantType) out.participantType = participantType;
  const recordRole = text(raw.managedRole, 40) ?? (role || undefined);
  if (recordRole) out.managedRole = recordRole;
  if (!out.eventId && !out.status && !out.managedRole) return null;
  return out;
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

/** 看當下登入狀態。null＝已確認登出，清掉殘留；未確定（undefined）不動。不訂閱。 */
export function adopt(): void {
  const known = getLastKnownAuthUid();
  if (known === null) noteAuth(null);
  else if (typeof known === 'string' && known.trim()) noteAuth(known.trim());
}

/** 第一次讀或寫才訂閱。訂閱當下再對一次目前 uid，避免整頁重載後漏掉已經發生的登出。 */
export function ensureNextActivityAuthWatch(): void {
  if (watchStarted) return;
  watchStarted = true;
  on('auth:changed', ({ uid }) => {
    noteAuth(uid);
  });
  adopt();
}

function ageOk(savedAt: number, nowMs: number): boolean {
  return nowMs - savedAt <= NEXT_ACTIVITY_SNAPSHOT_MAX_AGE_MS && savedAt <= nowMs + FUTURE_SKEW_MS;
}

function asStoredEvent(value: unknown): StoredEvent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const stored: StoredEvent = {};
  const id = text(raw.id, 200);
  const docId = text(raw._docId, 200);
  const legacyDocId = text(raw.docId, 200);
  if (!id && !docId && !legacyDocId) return null;
  if (id) stored.id = id;
  if (docId) stored._docId = docId;
  if (legacyDocId) stored.docId = legacyDocId;
  const title = text(raw.title, 500);
  if (title) stored.title = title;
  const date = text(raw.date, 200);
  if (date) stored.date = date;
  const status = text(raw.status, 40);
  if (status) stored.status = status;
  const location = text(raw.location, 500);
  if (location) stored.location = location;
  const image = text(raw.image, 2000);
  if (image) stored.image = image;
  const startAt = plainTime(raw.startAt);
  if (startAt !== undefined) stored.startAt = startAt;
  const startTime = plainTime(raw.startTime);
  if (startTime !== undefined) stored.startTime = startTime;
  if (raw.imageVariants && typeof raw.imageVariants === 'object') {
    const variants = raw.imageVariants as { homeNext?: unknown; cover?: unknown };
    const homeNext = text(variants.homeNext, 2000);
    const cover = text(variants.cover, 2000);
    if (homeNext || cover) {
      stored.imageVariants = {
        ...(homeNext ? { homeNext } : {}),
        ...(cover ? { cover } : {}),
      };
    }
  }
  if (raw.teamOnly === true) stored.teamOnly = true;
  if (raw.isPublic === true) stored.isPublic = true;
  if (raw.privateEvent === true) stored.privateEvent = true;
  const teamId = text(raw.creatorTeamId, 200);
  if (teamId) stored.creatorTeamId = teamId;
  const teamIds = stringList(raw.creatorTeamIds, 40);
  if (teamIds.length > 0) stored.creatorTeamIds = teamIds;
  if (raw.viewerBlocked === true) stored.viewerBlocked = true;
  if (raw.viewerIsOwner === true) stored.viewerIsOwner = true;
  if (raw.viewerIsDelegate === true) stored.viewerIsDelegate = true;
  return stored;
}

function readStored(uid: string, nowMs: number): { savedAt: number; result: NextActivityResult } | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(nextActivitySnapshotKey(uid));
  } catch {
    return null;
  }
  if (!raw || raw.length > MAX_CHARS) return null;
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
  const storedEvent = asStoredEvent(parsed.event);
  if (!storedEvent) return null;
  const managedRole = text(parsed.managedRole, 40) ?? '';
  const registration = registrationFromStored(parsed.registration ?? null, managedRole);
  const event = materialize(storedEvent, uid);
  return {
    savedAt: parsed.savedAt,
    result: { event, registration, managedRole },
  };
}

export function readNextActivitySnapshot(
  uid: string,
  nowMs: number = Date.now(),
  viewer?: ViewerContext,
): NextActivityResult | null {
  ensureNextActivityAuthWatch();
  const safeUid = String(uid ?? '').trim();
  if (!safeUid || getLastKnownAuthUid() !== safeUid) return null;
  const fromMemory = memory?.uid === safeUid && ageOk(memory.savedAt, nowMs) ? memory : null;
  const loaded = fromMemory
    ? { savedAt: fromMemory.savedAt, result: fromMemory.result }
    : readStored(safeUid, nowMs);
  if (!loaded) {
    forgetNextActivity(safeUid);
    return null;
  }
  const verdict = judge(loaded.result, safeUid, nowMs, viewer, true);
  if (verdict === 'show') {
    memory = { uid: safeUid, savedAt: loaded.savedAt, result: loaded.result };
    return loaded.result;
  }
  if (verdict === 'keep') return null;
  forgetNextActivity(safeUid);
  return null;
}

function storeNextActivity(uid: string, result: NextActivityResult, nowMs: number): void {
  const storedEvent = projectEvent(result.event, uid);
  if (!storedEvent) return;
  const managedRole = text(result.managedRole, 40) ?? '';
  const registration = projectRegistration(result.registration, managedRole);
  const event = materialize(storedEvent, uid);
  const stored: NextActivityResult = { event, registration, managedRole };
  const payload: StoredNextActivity = {
    v: NEXT_ACTIVITY_SNAPSHOT_FORMAT,
    uid,
    savedAt: nowMs,
    event: storedEvent,
    registration,
    managedRole,
  };
  memory = { uid, savedAt: nowMs, result: stored };
  try {
    const raw = JSON.stringify(payload);
    if (raw.length > MAX_CHARS) {
      forgetNextActivity(uid);
      return;
    }
    localStorage.setItem(nextActivitySnapshotKey(uid), raw);
  } catch {
    forgetNextActivity(uid);
  }
}

/** 寫入前呼叫。帳號不是這位就回 null，呼叫端不落盤。 */
function beginWrite(uid: string): number | null {
  ensureNextActivityAuthWatch();
  if (getLastKnownAuthUid() !== uid) return null;
  noteAuth(uid);
  return generation;
}

/**
 * 伺服器結果可用時呼叫。
 * 看得到就覆寫；沒有下一場、已取消／結束、或這個 viewer 確定看不到就清掉。
 * 不因「曾沿用列表副本」而留下舊快照。
 */
function commitResult(
  token: number,
  uid: string,
  result: NextActivityResult | null,
  nowMs: number,
  viewer?: ViewerContext,
): void {
  if (token !== generation || boundUid !== uid || getLastKnownAuthUid() !== uid) return;
  if (result && judge(result, uid, nowMs, viewer, false) === 'show') {
    storeNextActivity(uid, result, nowMs);
    return;
  }
  forgetNextActivity(uid);
}

/** 查詢結束後才落盤。登出或帳號不符時 beginWrite 回 null，不會寫。 */
export function finish(
  uid: string,
  result: NextActivityResult | null,
  nowMs: number,
  viewer?: ViewerContext,
): void {
  const token = beginWrite(uid);
  if (token !== null) commitResult(token, uid, result, nowMs, viewer);
}

export function resetNextActivitySnapshotForTest(): void {
  generation += 1;
  boundUid = null;
  memory = null;
  removeAllStored();
}
