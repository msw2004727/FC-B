/**
 * M-076：活動卡片留言數徽章。
 * 由 TimelineEventCard 動態 `import()` 使用（可見時才載入），避免把 Firestore 靜態拉進活動頁。
 *
 * 移植自 A `event-list-timeline.js` 260～482 行：可讀全部判斷、加總、快取、併發限制。
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
let activeCount = 0;

/** 照 A _clearActivityCommentBadgeCacheForEvent；阻止舊查詢回填失效快取。 */
export function clearCommentBadgeCacheForEvent(eventId: string): void {
  const target = eventId.trim();
  if (!target) return;
  cacheGenerations.set(target, (cacheGenerations.get(target) ?? 0) + 1);
  for (const [key, entry] of cache) {
    if (entry.eventId === target) cache.delete(key);
  }
}

interface QueueItem {
  query: CommentBadgeQuery;
  resolve: (n: number) => void;
  reject: (e: unknown) => void;
  cancelled: boolean;
}

const queue: QueueItem[] = [];

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

/** 照 A `_fetchActivityCommentBadgeCount`。 */
export async function fetchCommentCount(query: CommentBadgeQuery): Promise<number> {
  if (!query.viewerUid || !query.eventId) return 0;
  if (query.event.type === 'external') return 0;
  if (!query.eventDocId) return 0;
  const [firebase, fs] = await Promise.all([defaultGetFirebase(), import('firebase/firestore')]);
  const commentsRef = fs.collection(firebase.db, 'events', query.eventDocId, 'comments');

  if (canManageEventComments(query.event, query.viewerUid, query.viewerRoleLevel)) {
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
      fs.where('authorUid', '==', query.viewerUid),
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

/**
 * 排隊查詢留言數：
 * - 命中快取 → 直接解析（有 TTL 300000ms）。
 * - 未命中 → 排入全域佇列；同時最多 `COMMENT_BADGE_MAX_CONCURRENT`（2）個查詢。
 * - 呼叫 `cancel()` 會盡量移除佇列中尚未開始的項目；若已在執行，結果仍由呼叫端決定是否採用。
 */
export function requestCommentCount(query: CommentBadgeQuery): CommentBadgeRequest {
  const cached = getCachedCount(query.cacheKey);
  if (cached !== null) {
    return { promise: Promise.resolve(cached), cancel: () => { /* 已解析，無需取消 */ } };
  }

  let itemRef: QueueItem | null = null;
  const promise = new Promise<number>((resolve, reject) => {
    itemRef = { query, resolve, reject, cancelled: false };
    queue.push(itemRef);
    drainQueue();
  });

  return {
    promise,
    cancel: () => {
      if (!itemRef) return;
      itemRef.cancelled = true;
      const idx = queue.indexOf(itemRef);
      if (idx >= 0) queue.splice(idx, 1);
    },
  };
}

function drainQueue(): void {
  while (activeCount < COMMENT_BADGE_MAX_CONCURRENT && queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    if (item.cancelled) continue;
    activeCount += 1;
    const run = async (): Promise<void> => {
      const generation = cacheGenerations.get(item.query.eventId) ?? 0;
      try {
        const count = await fetchCommentCount(item.query);
        if (generation === (cacheGenerations.get(item.query.eventId) ?? 0)) {
          setCachedCount(item.query.cacheKey, item.query.eventId, count);
        }
        item.resolve(count);
      } catch (err) {
        item.reject(err);
      } finally {
        activeCount = Math.max(0, activeCount - 1);
        drainQueue();
      }
    };
    void run();
  }
}

/** 測試用：清空快取與佇列。 */
export function _resetCommentBadgeForTest(): void {
  cache.clear();
  queue.length = 0;
  activeCount = 0;
}
