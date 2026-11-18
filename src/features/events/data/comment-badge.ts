/**
 * M-076：活動卡片留言數徽章。
 * 由 TimelineEventCard 動態 `import()` 使用（可見時才載入），避免把 Firestore 靜態拉進活動頁。
 *
 * 移植自 A `event-list-timeline.js` 260～482 行：可讀全部判斷、加總、快取、併發限制。
 * SPEED-2-11a：同一個 microtask 裡的徽章查詢收成一批；相同活動只讀一次。
 * 不改計數欄位、不放寬併發 2（不同活動仍各查各的子集合）。
 * 健檢 B2-04（2026-11-13）：數法改 count() 聚合（每張卡 2 次讀取），整份讀取只留作備援，見 countVisibleComments。
 */
import { getFirebase as defaultGetFirebase } from '@/data/firebase';

export const COMMENT_BADGE_CACHE_TTL_MS = 300000;
export const COMMENT_BADGE_MAX_CONCURRENT = 2;

const COMMENT_LIMIT = 80;

export type CommentScope = 'manage' | 'member';

/** 最小活動輪廓（避免與 LegacyEventDoc 產生循環依賴）。 */
export interface CommentBadgeEvent {
  id?: string;
  type?: string;
  creatorUid?: string;
  ownerUid?: string;
  captainUid?: string;
  delegateUids?: string[];
  delegates?: unknown;
}

export interface CommentBadgeQuery {
  cacheKey: string;
  eventId: string;
  eventDocId: string;
  event: CommentBadgeEvent;
  viewerUid: string;
  viewerRoleLevel: number;
}

interface CacheEntry { cachedAt: number; eventId: string; count: number }

const cache = new Map<string, CacheEntry>();
const cacheGenerations = new Map<string, number>();
const queue: BatchJob[] = [];
const inflight = new Map<string, InflightEntry>();
let activeCount = 0;
let flushScheduled = false;
let batchEpoch = 0;

type BadgeSdk = {
  firebase: Awaited<ReturnType<typeof defaultGetFirebase>>;
  fs: typeof import('firebase/firestore');
};

/** 同一輪徽章共用一次 Firebase 載入。失敗就清掉，下次才能重試（L-08）。 */
let sdkFlight: Promise<BadgeSdk> | null = null;

function loadBadgeSdk(): Promise<BadgeSdk> {
  if (!sdkFlight) {
    const pending = Promise.all([defaultGetFirebase(), import('firebase/firestore')]).then(
      ([firebase, fs]) => ({ firebase, fs }),
    );
    sdkFlight = pending;
    pending.then(
      () => { if (sdkFlight === pending) sdkFlight = null; },
      () => { if (sdkFlight === pending) sdkFlight = null; },
    );
  }
  return sdkFlight;
}

/** 照 A _clearActivityCommentBadgeCacheForEvent；阻止舊查詢回填失效快取。 */
export function clearCommentBadgeCacheForEvent(eventId: string): void {
  const target = eventId.trim();
  if (!target) return;
  cacheGenerations.set(target, (cacheGenerations.get(target) ?? 0) + 1);
  for (const [key, entry] of cache) {
    if (entry.eventId === target) cache.delete(key);
  }
  // 進行中的舊查詢不能讓下一次呼叫直接合併，否則清完仍拿到舊數字。
  for (const [key, flight] of inflight) {
    if (flight.eventId === target) inflight.delete(key);
  }
}

interface Waiter {
  resolve: (n: number) => void;
  reject: (e: unknown) => void;
  cancelled: boolean;
  settled: boolean;
}

interface BatchJob {
  query: CommentBadgeQuery;
  waiters: Waiter[];
  started: boolean;
}

interface InflightEntry {
  eventId: string;
  eventDocId: string;
  promise: Promise<number>;
}

/** 快取 key：`${eventId}|${uid}|${scope}`。 */
export function getCommentBadgeCacheKey(eventId: string, uid: string, scope: CommentScope): string {
  return `${eventId}|${uid}|${scope}`;
}

/**
 * 照 A `event-comments.js#_canManageEventComments`：
 * `viewerRoleLevel >= 4`（admin）或 creatorUid／ownerUid 等於 uid、
 * 或 delegateUids 含 uid、或 delegates[].uid 含 uid。
 * CaptainUid 不列在 A 此函式（B 依 A 本體，不用 fallback 版）。
 */
export function canManageEventComments(
  event: CommentBadgeEvent,
  viewerUid: string | null,
  viewerRoleLevel: number,
): boolean {
  const uid = typeof viewerUid === 'string' ? viewerUid.trim() : '';
  if (!uid) return false;
  if (viewerRoleLevel >= 4) return true;
  if (event.creatorUid && event.creatorUid === uid) return true;
  if (event.ownerUid && event.ownerUid === uid) return true;
  if (Array.isArray(event.delegateUids) && event.delegateUids.includes(uid)) return true;
  const delegates = event.delegates;
  if (Array.isArray(delegates)) {
    if (delegates.some((d) => {
      if (!d || typeof d !== 'object') return false;
      return (d as Record<string, unknown>).uid === uid;
    })) return true;
  }
  return false;
}

/**
 * 照 A `_sumActivityCommentBadgeSnapshot`：以文件 ID 去重、`deleted === true` 跳過，
 * 每筆算 `1 + max(0, floor(replyCount))`。
 */
export function sumCommentSnapshot(docs: ReadonlyArray<{ id: string; data: unknown }>): number {
  let total = 0;
  const seen = new Set<string>();
  for (const doc of docs) {
    const id = String(doc.id || '').trim();
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const data = (doc.data && typeof doc.data === 'object')
      ? (doc.data as Record<string, unknown>)
      : {};
    if (data.deleted === true) continue;
    total += 1 + Math.max(0, Math.floor(Number(data.replyCount) || 0));
  }
  return total;
}

function getCachedCount(key: string): number | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > COMMENT_BADGE_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return Math.max(0, Number(entry.count) || 0);
}

function setCachedCount(key: string, eventId: string, count: number): void {
  cache.set(key, { cachedAt: Date.now(), eventId, count: Math.max(0, Number(count) || 0) });
}

function sameBadgeQuery(a: CommentBadgeQuery, b: CommentBadgeQuery): boolean {
  return a.cacheKey === b.cacheKey
    && a.eventId === b.eventId
    && a.eventDocId === b.eventDocId
    && a.viewerUid === b.viewerUid;
}

function cancelledError(): Error {
  return new Error('comment_badge_cancelled');
}

type BadgeFs = BadgeSdk['fs'];
type CommentsRef = ReturnType<BadgeFs['collection']>;

/**
 * 健檢 B2-04：改用 count() 聚合，不再把留言整份讀回來數。
 * 「可見且未刪除」＝ count(可見範圍) − count(可見範圍 且 deleted == true)；
 * 沒有 deleted 欄位的舊留言算未刪除，與 sumCommentSnapshot 相同。
 * replyCount 不必再加：Rules 規定建立時只能是 0 或不帶、之後任何人都不能改（events/{id}/comments 的
 * create／update 白名單），所以「1 + replyCount」恆等於 1。
 * 一則聚合查詢每 1000 筆索引項算 1 次讀取（0 筆也算 1 次）：每張卡固定 2 次讀取，
 * 取代原本最多 80（管理者）／90（一般：公開 60＋自己 30）次文件讀取；留言多時也不再被讀取上限截斷。
 * 查詢只用等值條件（visibility／authorUid／deleted），單欄位索引合併即可，不需要新增複合索引；
 * Rules 不變：一般人的 or(公開, 自己寫的) 每一支都符合 canReadCommentData。
 */
export async function countVisibleComments(
  fs: BadgeFs,
  commentsRef: CommentsRef,
  viewerUid: string,
  manage: boolean,
): Promise<number> {
  const visible = manage
    ? null
    : fs.or(fs.where('visibility', '==', 'public'), fs.where('authorUid', '==', viewerUid));
  const deleted = fs.where('deleted', '==', true);
  const allQuery = visible ? fs.query(commentsRef, visible) : fs.query(commentsRef);
  const deletedQuery = visible ? fs.query(commentsRef, fs.and(visible, deleted)) : fs.query(commentsRef, deleted);
  const [all, removed] = await Promise.all([
    fs.getCountFromServer(allQuery),
    fs.getCountFromServer(deletedQuery),
  ]);
  return Math.max(0, all.data().count - removed.data().count);
}

/**
 * 聚合查詢被拒（例如正式環境要求索引、權限判斷與模擬器不同）時，本次載入改回原本的整份讀取，
 * 數字照舊顯示；之後的卡片直接走原本做法，不再重試聚合。網路類錯誤不切換。
 */
let aggregateDisabled = false;
const AGGREGATE_FALLBACK_CODES = new Set(['failed-precondition', 'permission-denied', 'unimplemented', 'invalid-argument']);

function shouldFallbackFromAggregate(error: unknown): boolean {
  const code = error && typeof error === 'object' ? String((error as { code?: unknown }).code || '') : '';
  return AGGREGATE_FALLBACK_CODES.has(code.replace(/^firestore\//, ''));
}

/** 照 A `_fetchActivityCommentBadgeCount`（數法改聚合，見 countVisibleComments）。 */
export async function fetchCommentCount(query: CommentBadgeQuery): Promise<number> {
  if (!query.viewerUid || !query.eventId) return 0;
  if (query.event.type === 'external') return 0;
  if (!query.eventDocId) return 0;
  const { firebase, fs } = await loadBadgeSdk();
  const commentsRef = fs.collection(firebase.db, 'events', query.eventDocId, 'comments');
  const manage = canManageEventComments(query.event, query.viewerUid, query.viewerRoleLevel);

  if (!aggregateDisabled) {
    try {
      return await countVisibleComments(fs, commentsRef, query.viewerUid, manage);
    } catch (error) {
      if (!shouldFallbackFromAggregate(error)) throw error;
      aggregateDisabled = true;
    }
  }
  return fetchCommentCountByDocs(fs, commentsRef, query.viewerUid, manage);
}

/** 原本的整份讀取數法（聚合不可用時的備援）。 */
async function fetchCommentCountByDocs(
  fs: BadgeFs,
  commentsRef: CommentsRef,
  viewerUid: string,
  manage: boolean,
): Promise<number> {
  if (manage) {
    const snap = await fs.getDocs(fs.query(commentsRef, fs.limit(COMMENT_LIMIT)));
    return sumCommentSnapshot(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
  }

  const [publicSnap, ownSnap] = await Promise.all([
    fs.getDocs(fs.query(
      commentsRef,
      fs.where('visibility', '==', 'public'),
      fs.limit(Math.min(COMMENT_LIMIT, 60)),
    )),
    fs.getDocs(fs.query(
      commentsRef,
      fs.where('authorUid', '==', viewerUid),
      fs.limit(Math.min(COMMENT_LIMIT, 30)),
    )),
  ]);
  const byId = new Map<string, { id: string; data: unknown }>();
  for (const d of publicSnap.docs) byId.set(d.id, { id: d.id, data: d.data() });
  for (const d of ownSnap.docs) byId.set(d.id, { id: d.id, data: d.data() });
  return sumCommentSnapshot(Array.from(byId.values()));
}

export interface CommentBadgeRequest {
  promise: Promise<number>;
  cancel: () => void;
}

function dropQueuedJob(job: BatchJob): void {
  const idx = queue.indexOf(job);
  if (idx >= 0) queue.splice(idx, 1);
}

function attachWaiter(job: BatchJob): CommentBadgeRequest {
  let waiter!: Waiter;
  const promise = new Promise<number>((resolve, reject) => {
    waiter = { resolve, reject, cancelled: false, settled: false };
    job.waiters.push(waiter);
  });
  return {
    promise,
    cancel: () => {
      if (waiter.settled) return;
      waiter.cancelled = true;
      waiter.settled = true;
      waiter.reject(cancelledError());
      if (job.started) return;
      job.waiters = job.waiters.filter((entry) => entry !== waiter);
      if (job.waiters.length === 0) dropQueuedJob(job);
    },
  };
}

function listenFlight(shared: Promise<number>): CommentBadgeRequest {
  let cancelled = false;
  let rejectWait: (error: unknown) => void = () => {};
  const promise = new Promise<number>((resolve, reject) => {
    rejectWait = reject;
    shared.then(
      (count) => { if (!cancelled) resolve(count); },
      (error: unknown) => { if (!cancelled) reject(error); },
    );
  });
  return {
    promise,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      rejectWait(cancelledError());
    },
  };
}

function settleWaiters(job: BatchJob, count: number | null, error: unknown): void {
  for (const waiter of job.waiters) {
    if (waiter.cancelled || waiter.settled) continue;
    waiter.settled = true;
    if (error) waiter.reject(error);
    else waiter.resolve(count ?? 0);
  }
}

function startJob(job: BatchJob, epoch: number): void {
  job.started = true;
  activeCount += 1;
  const query = job.query;
  const generation = cacheGenerations.get(query.eventId) ?? 0;
  let promise!: Promise<number>;
  promise = (async (): Promise<number> => {
    try {
      const count = await fetchCommentCount(query);
      if (epoch === batchEpoch && generation === (cacheGenerations.get(query.eventId) ?? 0)) {
        setCachedCount(query.cacheKey, query.eventId, count);
      }
      settleWaiters(job, count, null);
      return count;
    } catch (error) {
      settleWaiters(job, null, error);
      throw error;
    } finally {
      // finally 不能 return，否則會蓋掉上面的數字。過期的測試重置直接跳過收尾。
      if (epoch === batchEpoch) {
        const current = inflight.get(query.cacheKey);
        if (current?.promise === promise) inflight.delete(query.cacheKey);
        activeCount = Math.max(0, activeCount - 1);
        drainQueue(epoch);
      }
    }
  })();
  inflight.set(query.cacheKey, {
    eventId: query.eventId,
    eventDocId: query.eventDocId,
    promise,
  });
  // 等候者已接到拒絕；這條只避免失敗變成未處理的拒絕（L-07、L-08）。
  promise.catch(() => undefined);
}

function drainQueue(epoch: number): void {
  if (epoch !== batchEpoch) return;
  while (activeCount < COMMENT_BADGE_MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();
    if (!job) break;
    if (job.waiters.length === 0 || job.waiters.every((waiter) => waiter.cancelled)) continue;
    startJob(job, epoch);
  }
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const epoch = batchEpoch;
  queueMicrotask(() => {
    flushScheduled = false;
    if (epoch !== batchEpoch) return;
    drainQueue(epoch);
  });
}

/**
 * 排隊查詢留言數：
 * - 命中快取 → 直接解析（TTL 300000ms）。鑰匙含 uid，換帳號不沿用（L-43）。
 * - 同一活動已在讀 → 合併到進行中的那一筆（失敗會清掉，下次才能重試，L-08）。
 * - 否則收進同頁批次：同一個 microtask 裡的請求一起去重後再打。
 * - 同時最多 `COMMENT_BADGE_MAX_CONCURRENT`（2）個活動。不同活動的子集合無法合成一筆查詢。
 * - `cancel()` 在還沒開始時拿掉這位等候者；都取消就不讀。已開始的讀取仍會完成並可寫入快取。
 */
export function requestCommentCount(query: CommentBadgeQuery): CommentBadgeRequest {
  const cached = getCachedCount(query.cacheKey);
  if (cached !== null) {
    return { promise: Promise.resolve(cached), cancel: () => { /* 已解析，無需取消 */ } };
  }

  const flight = inflight.get(query.cacheKey);
  if (flight && flight.eventId === query.eventId && flight.eventDocId === query.eventDocId) {
    return listenFlight(flight.promise);
  }

  const queued = queue.find((job) => !job.started && sameBadgeQuery(job.query, query));
  if (queued) return attachWaiter(queued);

  const job: BatchJob = { query, waiters: [], started: false };
  queue.push(job);
  scheduleFlush();
  return attachWaiter(job);
}

/** 測試用：清空快取、進行中請求與同頁批次。 */
export function _resetCommentBadgeForTest(): void {
  batchEpoch += 1;
  flushScheduled = false;
  for (const job of queue) {
    for (const waiter of job.waiters) {
      if (waiter.settled) continue;
      waiter.settled = true;
      waiter.cancelled = true;
      waiter.reject(new Error('comment_badge_reset'));
    }
  }
  queue.length = 0;
  cache.clear();
  cacheGenerations.clear();
  inflight.clear();
  sdkFlight = null;
  activeCount = 0;
  aggregateDisabled = false;
}
