import { getFirebase } from '@/data/firebase';
import { parseTaipei } from '@/core/taipei-time';
import { withSubmitting } from '@/core/submit-guard';
import {
  canManageEventComments,
  clearCommentBadgeCacheForEvent,
  type CommentBadgeEvent,
} from './comment-badge';
import {
  getEventCommentAuthor,
  resolveEventCommentDisplay,
  type CommentAuthor,
  type IdentityUser,
} from './identity-snapshot';

export interface CommentEvent extends CommentBadgeEvent {
  date?: string;
  status?: string;
}

export interface CommentViewer extends IdentityUser {
  roleLevel: number;
  /** 登入狀態尚未判定（useViewer 的 authPending）；省略＝已判定。 */
  authPending?: boolean;
}

export interface CommentContext {
  event: CommentEvent;
  eventDocId: string;
  viewer: CommentViewer;
}

export interface Liker {
  uid: string;
  authorName: string;
  authorPhoto: string;
}

export interface CommentItem extends ReturnType<typeof resolveEventCommentDisplay> {
  id: string;
  eventId: string;
  authorUid: string;
  body: string;
  visibility: 'private' | 'public';
  replyLocked: boolean;
  deleted: boolean;
  createdAt: unknown;
  replyCount: number;
  likeCount: number;
  likedByMe: boolean;
  likers: Liker[];
  hasLikeSummary: boolean;
  replies: CommentItem[];
  repliesLoaded: boolean;
}

type FirestoreModule = typeof import('firebase/firestore');
type Ref = import('firebase/firestore').DocumentReference;
type Stamp = ReturnType<FirestoreModule['serverTimestamp']>;

export class CommentActionError extends Error {}

/** 照 A _eventCommentTimeMs。 */
export function eventCommentTimeMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'object') {
    if ('toMillis' in value && typeof value.toMillis === 'function') {
      try {
        const result: unknown = value.toMillis();
        return typeof result === 'number' && Number.isFinite(result) ? result : 0;
      } catch {
        return 0;
      }
    }
    if ('seconds' in value && typeof value.seconds === 'number') {
      const nanos = 'nanoseconds' in value && typeof value.nanoseconds === 'number'
        ? value.nanoseconds : 0;
      return value.seconds * 1000 + Math.floor(nanos / 1000000);
    }
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
    return 0;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** 照 A _eventCommentTimeLabel。 */
export function eventCommentTimeLabel(value: unknown): string {
  const d = new Date(eventCommentTimeMs(value));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 照 A _parseEventEndDate／_parseEventStartDate。 */
export function commentEventEndMs(date: string | undefined): number | null {
  // ASSUMPTION: 未附 A 日期解析器；採附件活動格式 YYYY/MM/DD HH:mm~HH:mm，跨日結束加一天。
  const match = date?.trim().match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s*[~～]\s*(?:(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+)?(\d{1,2}):(\d{2}))?$/,
  );
  if (!match) return null;
  const start = parseTaipei(`${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}`);
  if (start === null) return null;
  if (!match[9]) return start;
  let end = parseTaipei(
    `${match[6] || match[1]}/${match[7] || match[2]}/${match[8] || match[3]} ${match[9]}:${match[10]}`,
  );
  if (end === null) return null;
  if (!match[6] && end < start) end += 86400000;
  return Number.isFinite(end) ? end : null;
}

/** 照 A _isEventCommentsClosed；不單獨以 status=ended 判定。 */
export function isEventCommentsClosed(event: CommentEvent | null, now = Date.now()): boolean {
  if (!event || event.status === 'cancelled') return true;
  const end = commentEventEndMs(event.date);
  return end !== null && end <= now;
}

/** 顯示與 handler 共用 A 的管理權限。 */
export function canManageComments(context: CommentContext): boolean {
  return canManageEventComments(
    context.event, context.viewer.uid ?? null, context.viewer.roleLevel,
  );
}

/** 顯示與 handler 共用 A 的回覆條件。 */
export function canReplyToComment(event: CommentEvent, comment: CommentItem): boolean {
  return !isEventCommentsClosed(event) && !comment.replyLocked && !comment.deleted;
}

/** 照 A _normalizeEventCommentLikeCount。 */
export function normalizeLikeCount(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n))
    : Math.max(0, Math.floor(Number(fallback) || 0));
}

/** 照 A _normalizeEventCommentLikers。 */
export function normalizeLikers(value: unknown): Liker[] {
  if (!Array.isArray(value)) return [];
  const result: Liker[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const uid = String(raw.uid || '').trim();
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    // ASSUMPTION: 未附 _displayNameOrUidFallback；無名稱時照 A 預設「用戶」，不拿名稱認身分。
    result.push({
      uid,
      authorName: String(raw.authorName || raw.displayName || raw.name || '用戶').trim(),
      authorPhoto: String(raw.authorPhoto || raw.pictureUrl || raw.photoURL || '').trim(),
    });
    if (result.length === 32) break;
  }
  return result;
}

/** 照 A _buildEventCommentLikerSummary。 */
export function buildLikerSummary(author: CommentAuthor): Liker {
  return {
    uid: author.uid.trim(),
    authorName: String(author.identitySnapshot.displayName || author.authorName || '用戶')
      .trim().slice(0, 80) || '用戶',
    authorPhoto: String(author.identitySnapshot.avatarUrl || author.authorPhoto || '')
      .trim().slice(0, 1200),
  };
}

/** 照 A _mapEventCommentDoc／_mapEventCommentReplyDoc。 */
export function mapComment(id: string, data: Record<string, unknown>, uid: string): CommentItem {
  const likers = normalizeLikers(data.recentLikers);
  return {
    id,
    eventId: String(data.eventId || ''),
    authorUid: String(data.authorUid || ''),
    ...resolveEventCommentDisplay(data),
    body: String(data.body || ''),
    visibility: data.visibility === 'private' ? 'private' : 'public',
    replyLocked: data.replyLocked === true,
    deleted: data.deleted === true,
    createdAt: data.createdAt || null,
    replyCount: normalizeLikeCount(data.replyCount),
    likeCount: normalizeLikeCount(data.likeCount, likers.length),
    likedByMe: !!uid && likers.some((liker) => liker.uid === uid),
    likers,
    hasLikeSummary: Object.prototype.hasOwnProperty.call(data, 'likeCount')
      || Array.isArray(data.recentLikers),
    replies: [],
    repliesLoaded: false,
  };
}

/** 照 A _isEventCommentPermissionDenied。 */
export function isCommentPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const raw = error as { code?: unknown; message?: unknown };
  const code = String(raw.code || '').toLowerCase();
  const message = String(raw.message || '').toLowerCase();
  return code === 'permission-denied' || message.includes('permission')
    || message.includes('insufficient');
}

/** 照 A _submitEventComment 的欄位 allowlist。 */
export function buildCommentPayload(
  eventId: string, author: CommentAuthor, body: string, privateComment: boolean,
  createdAt: Stamp, updatedAt: Stamp,
) {
  return {
    eventId,
    authorUid: author.uid,
    authorName: author.authorName,
    authorPhoto: author.authorPhoto || '',
    identitySnapshot: author.identitySnapshot,
    body,
    visibility: privateComment ? 'private' : 'public',
    replyLocked: false,
    deleted: false,
    replyCount: 0,
    likeCount: 0,
    recentLikers: [] as Liker[],
    createdAt,
    updatedAt,
  };
}

/** 照 A _submitEventCommentReply 的欄位 allowlist。 */
export function buildReplyPayload(
  eventId: string, commentId: string, author: CommentAuthor, body: string,
  createdAt: Stamp, updatedAt: Stamp,
) {
  return {
    eventId,
    commentId,
    authorUid: author.uid,
    authorName: author.authorName,
    authorPhoto: author.authorPhoto || '',
    identitySnapshot: author.identitySnapshot,
    body,
    deleted: false,
    likeCount: 0,
    recentLikers: [] as Liker[],
    createdAt,
    updatedAt,
  };
}

/** 照 A _setEventCommentLikeDoc／_writeEventCommentLikeWithSummary。 */
export function buildLikePayload(
  eventId: string, commentId: string, author: CommentAuthor, createdAt: Stamp,
  replyId = '', legacy = false,
) {
  const summary = buildLikerSummary(author);
  const base = { eventId, commentId, uid: author.uid };
  const target = replyId.trim() ? { ...base, replyId: replyId.trim() } : base;
  return legacy
    ? { ...target, createdAt }
    : { ...target, authorName: summary.authorName, authorPhoto: summary.authorPhoto, createdAt };
}

function requireAuthor(viewer: CommentViewer): CommentAuthor {
  const author = getEventCommentAuthor(viewer);
  if (!author.uid) throw new CommentActionError('請先登入');
  return author;
}

function requireManager(context: CommentContext): CommentAuthor {
  const author = requireAuthor(context.viewer);
  if (!canManageComments(context)) throw new CommentActionError('權限不足');
  return author;
}

async function connection(context: CommentContext) {
  if (!context.eventDocId || !context.event.id) throw new Error('event_doc_missing');
  const [firebase, fs] = await Promise.all([getFirebase(), import('firebase/firestore')]);
  return {
    fs,
    db: firebase.db,
    comments: fs.collection(firebase.db, 'events', context.eventDocId, 'comments'),
  };
}

async function hydrateLikes(
  fs: FirestoreModule, ref: Ref, item: CommentItem, uid: string,
): Promise<void> {
  const likes = fs.collection(ref, 'likes');
  const [own, legacy] = await Promise.all([
    item.likedByMe || !uid
      ? Promise.resolve(null)
      : fs.getDoc(fs.doc(likes, uid)).catch(() => null),
    item.hasLikeSummary
      ? Promise.resolve(null)
      : fs.getDocs(fs.query(likes, fs.orderBy('createdAt', 'desc'), fs.limit(32)))
        .catch(() => fs.getDocs(fs.query(likes, fs.limit(32))).catch(() => null)),
  ]);
  if (own?.exists()) item.likedByMe = true;
  if (legacy?.docs.length) {
    item.likers = normalizeLikers(legacy.docs.map((entry) => ({
      ...entry.data(), uid: entry.data().uid || entry.id,
    })));
    item.likeCount = Math.max(item.likeCount, item.likers.length);
    item.likedByMe ||= item.likers.some((liker) => liker.uid === uid);
  }
  if (item.likedByMe) item.likeCount = Math.max(1, item.likeCount);
}

const COMMENT_CHILD_BATCH = 8;

interface CommentFlight {
  eventId: string;
  promise: Promise<CommentItem[]>;
}

const commentInflight = new Map<string, CommentFlight>();

function commentLoadKey(context: CommentContext): string {
  const uid = context.viewer.uid?.trim() || '';
  const manage = canManageComments(context) ? 'm' : 'u';
  return `${context.eventDocId}\n${context.event.id ?? ''}\n${uid}\n${manage}`;
}

function dropCommentInflightForEvent(eventId: string): void {
  for (const [key, flight] of commentInflight) {
    if (flight.eventId === eventId) commentInflight.delete(key);
  }
}

/** 寫入後徽章與進行中的留言讀取一起失效，下一次才會重讀。 */
function invalidateEventCommentCaches(eventId: string): void {
  clearCommentBadgeCacheForEvent(eventId);
  dropCommentInflightForEvent(eventId);
}

async function hydrateTargets(
  fs: FirestoreModule,
  targets: ReadonlyArray<{ item: CommentItem; ref: Ref }>,
  uid: string,
): Promise<void> {
  for (let offset = 0; offset < targets.length; offset += COMMENT_CHILD_BATCH) {
    await Promise.all(targets.slice(offset, offset + COMMENT_CHILD_BATCH).map(
      ({ item, ref }) => hydrateLikes(fs, ref, item, uid),
    ));
  }
}

/** 測試用：清掉進行中的留言讀取。 */
export function _resetEventCommentsForTest(): void {
  commentInflight.clear();
}

/**
 * 詳情留言區一被呼叫就讀（頁面 ready／canLoad 由呼叫端決定，本函式不再排隊）。
 * 同一把鑰匙的進行中請求合併；失敗會在結束時清掉，下次才能重試（L-08）。
 * 不做成功快取：重試與寫入後重讀必須打到網路。
 */
export function loadEventComments(context: CommentContext): Promise<CommentItem[]> {
  const uid = context.viewer.uid?.trim() || '';
  if (!uid) return Promise.resolve([]);
  const key = commentLoadKey(context);
  const existing = commentInflight.get(key);
  if (existing) return existing.promise;
  const eventId = context.event.id ?? '';
  const promise = readEventComments(context).finally(() => {
    const current = commentInflight.get(key);
    if (current?.promise === promise) commentInflight.delete(key);
  });
  commentInflight.set(key, { eventId, promise });
  return promise;
}

/** 照 A _fetchEventComments／_loadEventCommentRepliesForList；保留軟刪除佔位。 */
async function readEventComments(context: CommentContext): Promise<CommentItem[]> {
  const uid = context.viewer.uid?.trim() || '';
  // 現行 Rules canReadCommentData 要求登入，照 A _renderEventComments 顯示登入提示。
  if (!uid) return [];
  const { fs, comments } = await connection(context);
  const snapshots = canManageComments(context)
    ? [await fs.getDocs(fs.query(comments, fs.limit(80)))]
    : await Promise.all([
      fs.getDocs(fs.query(comments, fs.where('visibility', '==', 'public'), fs.limit(60))),
      fs.getDocs(fs.query(comments, fs.where('authorUid', '==', uid), fs.limit(30))),
    ]);
  const byId = new Map<string, CommentItem>();
  for (const snapshot of snapshots) {
    for (const entry of snapshot.docs) byId.set(entry.id, mapComment(entry.id, entry.data(), uid));
  }
  const list = [...byId.values()]
    .sort((a, b) => eventCommentTimeMs(b.createdAt) - eventCommentTimeMs(a.createdAt))
    .slice(0, 80);
  // 留言本身的讚不依賴回覆，和回覆一起讀，頁面 ready 後少等一輪。
  const repliesTask = (async (): Promise<void> => {
    for (let offset = 0; offset < list.length; offset += COMMENT_CHILD_BATCH) {
      await Promise.all(list.slice(offset, offset + COMMENT_CHILD_BATCH).map(async (comment) => {
        const ref = fs.doc(comments, comment.id);
        comment.repliesLoaded = true;
        if (!comment.deleted) {
          try {
            const replies = await fs.getDocs(fs.query(fs.collection(ref, 'replies'), fs.limit(20)));
            comment.replies = replies.docs.map((entry) => mapComment(entry.id, entry.data(), uid))
              .sort((a, b) => eventCommentTimeMs(a.createdAt) - eventCommentTimeMs(b.createdAt));
            comment.replyCount = Math.max(comment.replyCount, comment.replies.length);
          } catch {
            // 照 A：個別回覆載入失敗不阻止其他留言。
          }
        }
      }));
    }
  })();
  await Promise.all([
    repliesTask,
    hydrateTargets(fs, list.map((comment) => ({
      item: comment,
      ref: fs.doc(comments, comment.id),
    })), uid),
  ]);
  await hydrateTargets(fs, list.flatMap((comment) => comment.replies
    .filter((reply) => !reply.deleted)
    .map((reply) => ({
      item: reply,
      ref: fs.doc(comments, comment.id, 'replies', reply.id),
    }))), uid);
  return list;
}

/** 照 A _submitEventComment，權限拒絕才重送 legacy payload。 */
export async function submitEventComment(
  context: CommentContext, input: string, privateComment: boolean,
): Promise<void> {
  const author = requireAuthor(context.viewer);
  if (isEventCommentsClosed(context.event)) throw new CommentActionError('活動已結束，無法新增留言');
  const body = input.trim();
  if (!body) throw new CommentActionError('請輸入留言');
  if (body.length > 300) throw new CommentActionError('留言最多 300 字');
  const { fs, comments } = await connection(context);
  const payload = buildCommentPayload(
    context.event.id!, author, body, privateComment, fs.serverTimestamp(), fs.serverTimestamp(),
  );
  try {
    await withSubmitting('event-save', () => fs.addDoc(comments, payload));
  } catch (error) {
    if (!isCommentPermissionDenied(error)) throw error;
    const { replyCount: _replyCount, likeCount: _likeCount, recentLikers: _recentLikers, ...legacy } = payload;
    await withSubmitting('event-save', () => fs.addDoc(comments, legacy));
  }
  invalidateEventCommentCaches(context.event.id!);
}

/** 照 A _submitEventCommentReply。 */
export async function submitEventCommentReply(
  context: CommentContext, comment: CommentItem, input: string,
): Promise<void> {
  const author = requireAuthor(context.viewer);
  if (isEventCommentsClosed(context.event)) throw new CommentActionError('活動已結束，無法新增回覆');
  if (!canReplyToComment(context.event, comment)) throw new CommentActionError('權限不足');
  const body = input.trim();
  if (!body) throw new CommentActionError('請輸入回覆');
  if (body.length > 100) throw new CommentActionError('回覆最多 100 字');
  const { fs, comments } = await connection(context);
  const payload = buildReplyPayload(
    context.event.id!, comment.id, author, body, fs.serverTimestamp(), fs.serverTimestamp(),
  );
  const replies = fs.collection(fs.doc(comments, comment.id), 'replies');
  try {
    await withSubmitting('event-save', () => fs.addDoc(replies, payload));
  } catch (error) {
    if (!isCommentPermissionDenied(error)) throw error;
    const { likeCount: _likeCount, recentLikers: _recentLikers, ...legacy } = payload;
    await withSubmitting('event-save', () => fs.addDoc(replies, legacy));
  }
  invalidateEventCommentCaches(context.event.id!);
}

/** 照 A _writeEventCommentLikeWithSummary。 */
export async function writeEventCommentLike(
  context: CommentContext, commentId: string, liked: boolean, replyId = '',
): Promise<void> {
  const author = requireAuthor(context.viewer);
  const { fs, db, comments } = await connection(context);
  const target = replyId
    ? fs.doc(comments, commentId, 'replies', replyId)
    : fs.doc(comments, commentId);
  const likeRef = fs.doc(fs.collection(target, 'likes'), author.uid);
  const eventId = context.event.id!;
  const timestamp = fs.serverTimestamp();
  const summary = buildLikerSummary(author);
  try {
    try {
      await fs.runTransaction(db, async (tx) => {
        const targetSnap = await tx.get(target);
        if (!targetSnap.exists()) throw new Error('like_target_missing');
        const ownLike = await tx.get(likeRef);
        const data = targetSnap.data();
        const current = normalizeLikers(data.recentLikers);
        const next = current.filter((liker) => liker.uid !== author.uid);
        let count = normalizeLikeCount(data.likeCount, current.length);
        if (liked) {
          if (!ownLike.exists()) {
            tx.set(likeRef, buildLikePayload(eventId, commentId, author, timestamp, replyId));
            count += 1;
          } else if (count === 0) {
            count = 1;
          }
          next.unshift(summary);
        } else if (ownLike.exists()) {
          tx.delete(likeRef);
          count = Math.max(0, count - 1);
        } else {
          return;
        }
        tx.update(target, {
          likeCount: count,
          recentLikers: next.slice(0, 32),
          updatedAt: timestamp,
        });
      });
    } catch (error) {
      if (!isCommentPermissionDenied(error)) throw error;
      if (!liked) {
        await fs.deleteDoc(likeRef);
      } else {
        try {
          await fs.setDoc(
            likeRef, buildLikePayload(eventId, commentId, author, fs.serverTimestamp(), replyId),
          );
        } catch (fallbackError) {
          if (!isCommentPermissionDenied(fallbackError)) throw fallbackError;
          await fs.setDoc(
            likeRef, buildLikePayload(eventId, commentId, author, fs.serverTimestamp(), replyId, true),
          );
        }
      }
    }
  } catch (error) {
    if (!liked || !isCommentPermissionDenied(error)) throw error;
    const existing = await fs.getDoc(likeRef).catch(() => null);
    if (!existing?.exists()) throw error;
  }
  invalidateEventCommentCaches(eventId);
}

/** 照 A _setEventCommentReplyLocked。 */
export async function setEventCommentReplyLocked(
  context: CommentContext, commentId: string, locked: boolean,
): Promise<void> {
  requireManager(context);
  const { fs, comments } = await connection(context);
  requireManager(context);
  await fs.updateDoc(fs.doc(comments, commentId), {
    replyLocked: !!locked, updatedAt: fs.serverTimestamp(),
  });
  invalidateEventCommentCaches(context.event.id!);
}

/** 照 A _deleteEventComment／_deleteEventCommentReply，均為軟刪除。 */
export async function deleteEventComment(
  context: CommentContext, commentId: string, replyId = '',
): Promise<void> {
  const author = requireManager(context);
  const { fs, comments } = await connection(context);
  requireManager(context);
  const target = replyId
    ? fs.doc(comments, commentId, 'replies', replyId)
    : fs.doc(comments, commentId);
  await withSubmitting('event-save', () => fs.updateDoc(target, {
    deleted: true,
    deletedByUid: author.uid,
    deletedAt: fs.serverTimestamp(),
    updatedAt: fs.serverTimestamp(),
  }));
  invalidateEventCommentCaches(context.event.id!);
}
