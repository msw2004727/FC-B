import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCommentPayload,
  buildLikePayload,
  buildLikerSummary,
  buildReplyPayload,
  canManageComments,
  canReplyToComment,
  commentEventEndMs,
  deleteEventComment,
  eventCommentTimeLabel,
  eventCommentTimeMs,
  isCommentPermissionDenied,
  isEventCommentsClosed,
  loadEventComments,
  mapComment,
  normalizeLikeCount,
  normalizeLikers,
  setEventCommentReplyLocked,
  submitEventComment,
  submitEventCommentReply,
  writeEventCommentLike,
  type CommentContext,
} from './event-comments';
import { getEventCommentAuthor } from './identity-snapshot';
import {
  _resetCommentBadgeForTest,
  clearCommentBadgeCacheForEvent,
  requestCommentCount,
  type CommentBadgeQuery,
} from './comment-badge';

const mock = vi.hoisted(() => ({
  getFirebase: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  runTransaction: vi.fn(),
  txGet: vi.fn(),
  txSet: vi.fn(),
  txUpdate: vi.fn(),
  txDelete: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: mock.getFirebase,
}));
vi.mock('firebase/firestore', () => ({
  collection: (parent: { path?: string }, ...parts: string[]) => ({
    path: [parent.path, ...parts].filter(Boolean).join('/'),
  }),
  doc: (parent: { path?: string }, ...parts: string[]) => ({
    path: [parent.path, ...parts].filter(Boolean).join('/'),
  }),
  query: (ref: { path: string }, ...constraints: unknown[]) => ({ ...ref, constraints }),
  where: (...args: unknown[]) => ({ where: args }),
  limit: (n: number) => ({ limit: n }),
  orderBy: (...args: unknown[]) => ({ orderBy: args }),
  serverTimestamp: () => 'server-time',
  addDoc: mock.addDoc,
  updateDoc: mock.updateDoc,
  setDoc: mock.setDoc,
  deleteDoc: mock.deleteDoc,
  getDocs: mock.getDocs,
  getDoc: mock.getDoc,
  runTransaction: mock.runTransaction,
}));

const context: CommentContext = {
  event: { id: 'public-event', creatorUid: 'host', delegateUids: ['delegate'], date: '2099/01/01 10:00~11:00' },
  eventDocId: 'different-document',
  viewer: { uid: 'member', displayName: '小明', pictureUrl: '', roleLevel: 0 },
};
const author = getEventCommentAuthor(context.viewer);

function snap(id: string, data: Record<string, unknown>) {
  return { id, data: () => data, exists: () => true };
}

beforeEach(() => {
  vi.resetAllMocks();
  _resetCommentBadgeForTest();
  mock.getFirebase.mockResolvedValue({ db: {} });
  mock.addDoc.mockResolvedValue({});
  mock.updateDoc.mockResolvedValue(undefined);
  mock.setDoc.mockResolvedValue(undefined);
  mock.deleteDoc.mockResolvedValue(undefined);
  mock.getDocs.mockResolvedValue({ docs: [] });
  mock.getDoc.mockResolvedValue({ exists: () => false });
  mock.runTransaction.mockImplementation(async (
    _db: unknown,
    fn: (tx: {
      get: typeof mock.txGet;
      set: typeof mock.txSet;
      update: typeof mock.txUpdate;
      delete: typeof mock.txDelete;
    }) => Promise<void>,
  ) => fn({
    get: mock.txGet, set: mock.txSet, update: mock.txUpdate, delete: mock.txDelete,
  }));
});

describe('M-093 純函式', () => {
  it('管理 helper 與 A 一致，不把 captainUid 當管理者', () => {
    expect(canManageComments(context)).toBe(false);
    for (const uid of ['host', 'delegate']) {
      expect(canManageComments({ ...context, viewer: { uid, roleLevel: 0 } })).toBe(true);
    }
    expect(canManageComments({ ...context, viewer: { uid: 'admin', roleLevel: 4 } })).toBe(true);
    expect(canManageComments({ ...context, viewer: { uid: null, roleLevel: 5 } })).toBe(false);
    expect(canManageComments({
      ...context, event: { captainUid: 'member' },
    })).toBe(false);
    expect(canManageComments({
      ...context, event: { delegates: [{ uid: 'member' }] },
    })).toBe(true);
  });

  it('取消、結束時間與跨日；未解析日期不擅自關閉', () => {
    const end = new Date(2099, 0, 1, 11).getTime();
    expect(commentEventEndMs(context.event.date)).toBe(end);
    expect(isEventCommentsClosed(context.event, end)).toBe(true);
    expect(isEventCommentsClosed(context.event, end - 1)).toBe(false);
    expect(isEventCommentsClosed({ status: 'cancelled' })).toBe(true);
    expect(isEventCommentsClosed(null)).toBe(true);
    expect(isEventCommentsClosed({ date: 'invalid', status: 'ended' })).toBe(false);
    expect(commentEventEndMs('2099/01/01 23:00~01:00'))
      .toBe(new Date(2099, 0, 2, 1).getTime());
    expect(commentEventEndMs('2099/01/01 23:00~2099/01/03 01:00'))
      .toBe(new Date(2099, 0, 3, 1).getTime());
  });

  it('時間、計數與 liker 正規化', () => {
    expect(eventCommentTimeMs({ seconds: 3, nanoseconds: 9000000 })).toBe(3009);
    expect(eventCommentTimeMs({ toMillis: () => 123 })).toBe(123);
    expect(eventCommentTimeMs({ toMillis: () => { throw new Error(); } })).toBe(0);
    expect(eventCommentTimeMs('invalid')).toBe(0);
    expect(eventCommentTimeLabel(new Date(2099, 0, 2, 3, 4))).toBe('01/02 03:04');
    expect(normalizeLikeCount(-3)).toBe(0);
    expect(normalizeLikeCount('4.9')).toBe(4);
    expect(normalizeLikeCount('invalid', 2)).toBe(2);
    expect(normalizeLikers([{ uid: 'u', name: '名' }, { uid: 'u' }, {}]))
      .toEqual([{ uid: 'u', authorName: '名', authorPhoto: '' }]);
    expect(normalizeLikers(Array.from({ length: 40 }, (_, n) => ({ uid: String(n) })))).toHaveLength(32);
    expect(buildLikerSummary(author)).toEqual({ uid: 'member', authorName: '小明', authorPhoto: '' });
    expect(isCommentPermissionDenied({ code: 'permission-denied' })).toBe(true);
    expect(isCommentPermissionDenied({ message: 'Insufficient permissions' })).toBe(true);
    expect(isCommentPermissionDenied(new Error('offline'))).toBe(false);
  });

  it('軟刪除保留佔位，回覆條件共用', () => {
    const comment = mapComment('c', { deleted: true, recentLikers: [{ uid: 'member' }] }, 'member');
    expect(comment.deleted).toBe(true);
    expect(comment.likeCount).toBe(1);
    expect(comment.likedByMe).toBe(true);
    expect(canReplyToComment(context.event, comment)).toBe(false);
    expect(canReplyToComment(context.event, { ...comment, deleted: false })).toBe(true);
    expect(canReplyToComment(context.event, { ...comment, deleted: false, replyLocked: true })).toBe(false);
  });
});

describe('M-093 讀取', () => {
  it('一般使用者公開／本人查詢去重，按時間排序，軟刪除不讀回覆', async () => {
    mock.getDocs
      .mockResolvedValueOnce({ docs: [
        snap('c1', { visibility: 'public', createdAt: 10, deleted: true }),
        snap('c2', { visibility: 'public', createdAt: 20, likeCount: 0 }),
      ] })
      .mockResolvedValueOnce({ docs: [
        snap('c2', { visibility: 'public', createdAt: 20, likeCount: 0 }),
        snap('c3', { visibility: 'private', createdAt: 30, likeCount: 0 }),
      ] });
    const result = await loadEventComments(context);
    expect(result.map((entry) => entry.id)).toEqual(['c3', 'c2', 'c1']);
    expect(mock.getDocs.mock.calls[0]?.[0]).toMatchObject({
      path: 'events/different-document/comments',
      constraints: [{ where: ['visibility', '==', 'public'] }, { limit: 60 }],
    });
    expect(mock.getDocs.mock.calls[1]?.[0]).toMatchObject({
      constraints: [{ where: ['authorUid', '==', 'member'] }, { limit: 30 }],
    });
    expect(mock.getDocs.mock.calls.some(([ref]) =>
      (ref as { path: string }).path.endsWith('/c1/replies'))).toBe(false);
  });

  it('管理者 limit 80；第二身份回覆保留公開快照；摘要外本人讚仍讀 likes/uid', async () => {
    mock.getDocs
      .mockResolvedValueOnce({ docs: [snap('c', { likeCount: 40, recentLikers: [] })] })
      .mockResolvedValueOnce({ docs: [snap('r', {
        likeCount: 40,
        recentLikers: [],
        authorName: '私人名稱',
        identitySnapshot: { identityId: 'secondary', displayName: '官方', avatarUrl: '' },
      })] });
    mock.getDoc.mockResolvedValue({ exists: () => true });
    const result = await loadEventComments({
      ...context, viewer: { ...context.viewer, roleLevel: 4 },
    });
    expect(mock.getDocs.mock.calls[0]?.[0]).toMatchObject({ constraints: [{ limit: 80 }] });
    expect(result[0]?.replies[0]).toMatchObject({ authorName: '官方', likedByMe: true });
    expect(mock.getDoc).toHaveBeenCalledWith({
      path: 'events/different-document/comments/c/replies/r/likes/member',
    });
  });

  it('未登入依 A 不發送 Rules 必拒的查詢', async () => {
    expect(await loadEventComments({ ...context, viewer: { uid: null, roleLevel: 0 } })).toEqual([]);
    expect(mock.getFirebase).not.toHaveBeenCalled();
  });
});

describe('M-093 寫入 payload', () => {
  it('留言逐欄；public ID 與文件路徑分離；permission-denied 才去掉摘要重送', async () => {
    mock.addDoc.mockRejectedValueOnce({ code: 'permission-denied' });
    await submitEventComment(context, ' 留言 ', true);
    const first = mock.addDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(first).toEqual({
      eventId: 'public-event', authorUid: 'member', authorName: '小明', authorPhoto: '',
      identitySnapshot: { identityId: 'main', displayName: '小明', avatarUrl: '' },
      body: '留言', visibility: 'private', replyLocked: false, deleted: false,
      replyCount: 0, likeCount: 0, recentLikers: [], createdAt: 'server-time', updatedAt: 'server-time',
    });
    expect(mock.addDoc.mock.calls[0]?.[0]).toEqual({ path: 'events/different-document/comments' });
    const { replyCount: _r, likeCount: _l, recentLikers: _ls, ...legacy } = first;
    expect(mock.addDoc.mock.calls[1]?.[1]).toEqual(legacy);
    mock.addDoc.mockRejectedValueOnce(new Error('offline'));
    await expect(submitEventComment(context, '留言', false)).rejects.toThrow('offline');
    expect(mock.addDoc).toHaveBeenCalledTimes(3);
  });

  it('回覆逐欄與 legacy 退路；不新增 replyCount 寫入', async () => {
    mock.addDoc.mockRejectedValueOnce({ code: 'permission-denied' });
    await submitEventCommentReply(context, mapComment('c', {}, 'member'), ' 回覆 ');
    expect(mock.addDoc.mock.calls[0]?.[0]).toEqual({
      path: 'events/different-document/comments/c/replies',
    });
    expect(mock.addDoc.mock.calls[0]?.[1]).toMatchObject({
      eventId: 'public-event', commentId: 'c', authorUid: 'member',
      body: '回覆', deleted: false, likeCount: 0, recentLikers: [],
    });
    expect(mock.addDoc.mock.calls[1]?.[1]).not.toHaveProperty('likeCount');
    expect(mock.addDoc.mock.calls[1]?.[1]).not.toHaveProperty('recentLikers');
    expect(mock.updateDoc).not.toHaveBeenCalled();
  });

  it('寫入前檢查 UID、長度及回覆鎖定', async () => {
    await expect(submitEventComment({ ...context, viewer: { uid: null, roleLevel: 0 } }, 'x', false))
      .rejects.toThrow('請先登入');
    await expect(submitEventComment(context, '', false)).rejects.toThrow('請輸入留言');
    await expect(submitEventComment(context, 'x'.repeat(301), false)).rejects.toThrow('留言最多 300 字');
    await expect(submitEventCommentReply(context, mapComment('c', {}, ''), 'x'.repeat(101)))
      .rejects.toThrow('回覆最多 100 字');
    await expect(submitEventCommentReply(context, mapComment('c', { replyLocked: true }, ''), 'x'))
      .rejects.toThrow('權限不足');
    expect(mock.getFirebase).not.toHaveBeenCalled();
  });

  it('按讚與取消讚在同一 transaction 更新摘要', async () => {
    mock.txGet
      .mockResolvedValueOnce(snap('c', { likeCount: 0, recentLikers: [] }))
      .mockResolvedValueOnce({ exists: () => false });
    await writeEventCommentLike(context, 'c', true);
    expect(mock.txSet.mock.calls[0]?.[1]).toEqual({
      eventId: 'public-event', commentId: 'c', uid: 'member',
      authorName: '小明', authorPhoto: '', createdAt: 'server-time',
    });
    expect(mock.txUpdate.mock.calls[0]?.[1]).toEqual({
      likeCount: 1, recentLikers: [buildLikerSummary(author)], updatedAt: 'server-time',
    });
    mock.txGet
      .mockResolvedValueOnce(snap('c', { likeCount: 1, recentLikers: [buildLikerSummary(author)] }))
      .mockResolvedValueOnce({ exists: () => true });
    await writeEventCommentLike(context, 'c', false);
    expect(mock.txDelete).toHaveBeenCalledWith({ path: 'events/different-document/comments/c/likes/member' });
    expect(mock.txUpdate.mock.calls[1]?.[1]).toEqual({
      likeCount: 0, recentLikers: [], updatedAt: 'server-time',
    });
  });

  it('回覆讚 fallback 保留 replyId，第二次拒絕移除作者快照', async () => {
    mock.runTransaction.mockRejectedValueOnce({ code: 'permission-denied' });
    mock.setDoc.mockRejectedValueOnce({ code: 'permission-denied' });
    await writeEventCommentLike(context, 'c', true, 'r');
    expect(mock.setDoc.mock.calls[1]).toEqual([
      { path: 'events/different-document/comments/c/replies/r/likes/member' },
      { eventId: 'public-event', commentId: 'c', replyId: 'r', uid: 'member', createdAt: 'server-time' },
    ]);
  });

  it('既存讚 update 被 Rules 拒絕時，以本人文件存在判定已成功', async () => {
    mock.runTransaction.mockRejectedValueOnce({ code: 'permission-denied' });
    mock.setDoc.mockRejectedValue({ code: 'permission-denied' });
    mock.getDoc.mockResolvedValueOnce({ exists: () => true });
    await expect(writeEventCommentLike(context, 'c', true)).resolves.toBeUndefined();
  });

  it('管理動作共用 helper，軟刪除欄位與 A 相同', async () => {
    await expect(setEventCommentReplyLocked(context, 'c', true)).rejects.toThrow('權限不足');
    await expect(deleteEventComment(context, 'c')).rejects.toThrow('權限不足');
    const manager = { ...context, viewer: { uid: 'host', roleLevel: 0 } };
    await setEventCommentReplyLocked(manager, 'c', true);
    expect(mock.updateDoc.mock.calls[0]?.[1]).toEqual({ replyLocked: true, updatedAt: 'server-time' });
    await deleteEventComment(manager, 'c', 'r');
    expect(mock.updateDoc.mock.calls[1]).toEqual([
      { path: 'events/different-document/comments/c/replies/r' },
      { deleted: true, deletedByUid: 'host', deletedAt: 'server-time', updatedAt: 'server-time' },
    ]);
    expect(mock.deleteDoc).not.toHaveBeenCalled();
  });

  it('payload builder 不接受任意欄位，回覆與讚形狀各自獨立', async () => {
    const fs = await import('firebase/firestore');
    const time = fs.serverTimestamp();
    expect(buildCommentPayload('e', author, 'b', false, time, time)).not.toHaveProperty('commentId');
    expect(buildReplyPayload('e', 'c', author, 'b', time, time)).not.toHaveProperty('replyLocked');
    expect(buildLikePayload('e', 'c', author, time, 'r', true)).toEqual({
      eventId: 'e', commentId: 'c', replyId: 'r', uid: 'member', createdAt: 'server-time',
    });
  });
});

describe('M-093 留言徽章失效', () => {
  const query: CommentBadgeQuery = {
    cacheKey: 'public-event|member|manage',
    eventId: 'public-event',
    eventDocId: 'different-document',
    event: context.event,
    viewerUid: 'member',
    viewerRoleLevel: 4,
  };

  it('移除事件全部範圍快取，下一次重新查詢', async () => {
    await requestCommentCount(query).promise;
    await requestCommentCount(query).promise;
    expect(mock.getDocs).toHaveBeenCalledTimes(1);
    clearCommentBadgeCacheForEvent('public-event');
    await requestCommentCount(query).promise;
    expect(mock.getDocs).toHaveBeenCalledTimes(2);
  });

  it('清除期間尚未完成的查詢不能回填舊快取', async () => {
    let resolve!: (value: { docs: ReturnType<typeof snap>[] }) => void;
    mock.getDocs.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const first = requestCommentCount(query).promise;
    await vi.waitFor(() => expect(mock.getDocs).toHaveBeenCalledTimes(1));
    clearCommentBadgeCacheForEvent(query.eventId);
    resolve({ docs: [snap('old', {})] });
    await first;
    await requestCommentCount(query).promise;
    expect(mock.getDocs).toHaveBeenCalledTimes(2);
  });
});
