import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mocks } = vi.hoisted(() => {
  const mocks = {
    doc: vi.fn((_db: unknown, ...segments: string[]) => ({ _path: segments })),
    updateDoc: vi.fn(() => Promise.resolve()),
    deleteDoc: vi.fn(() => Promise.resolve()),
    serverTimestamp: vi.fn(() => '__TS__'),
    writeBatch: vi.fn(() => ({
      update: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn(() => Promise.resolve()),
    })),
    collection: vi.fn((_db: unknown, ...segments: string[]) => ({ _path: segments })),
    onSnapshot: vi.fn(() => vi.fn()),
    query: vi.fn((..._args: unknown[]) => ({})),
    orderBy: vi.fn((..._args: unknown[]) => ({})),
    limit: vi.fn((..._args: unknown[]) => ({})),
    where: vi.fn((..._args: unknown[]) => ({})),
  };
  return { mocks };
});

vi.mock('firebase/firestore', () => mocks);
vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(() => Promise.resolve({ db: { _mockDb: true } })),
}));

import {
  applyInboxView,
  clearAll,
  countUnread,
  deleteMessage,
  filterByType,
  isUnread,
  markAllRead,
  markRead,
  normalizeInboxMessage,
  sortByTimeDesc,
  subscribeInbox,
  type InboxMessage,
} from './inbox-repo';

describe('inbox-repo 純函式', () => {
  it('isUnread 依 read／readBy／unread 判定', () => {
    expect(isUnread({ id: 'm', read: true })).toBe(false);
    expect(isUnread({ id: 'm', read: false })).toBe(true);
    expect(isUnread({ id: 'm', readBy: ['u1', 'u2'] }, 'u1')).toBe(false);
    expect(isUnread({ id: 'm', readBy: ['u2'] }, 'u1')).toBe(true);
    expect(isUnread({ id: 'm', unread: true }, 'u1')).toBe(true);
    expect(isUnread({ id: 'm', unread: false }, 'u1')).toBe(false);
    // 照 A _isMessageUnread：沒有 read 欄位又拿不到 uid 時視為已讀
    expect(isUnread({ id: 'm', unread: true })).toBe(false);
    expect(isUnread(null)).toBe(false);
  });

  it('countUnread 只計算未讀', () => {
    const msgs: InboxMessage[] = [
      { id: 'm1', read: false },
      { id: 'm2', read: true },
      { id: 'm3', read: false },
    ];
    expect(countUnread(msgs)).toBe(2);
  });

  it('filterByType 依 type 過濾；all 不過濾', () => {
    const msgs: InboxMessage[] = [
      { id: 'm1', type: 'system' },
      { id: 'm2', type: 'tournament' },
      { id: 'm3', type: 'system' },
    ];
    expect(filterByType(msgs, 'all')).toHaveLength(3);
    expect(filterByType(msgs, '')).toHaveLength(3);
    expect(filterByType(msgs, 'system').map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(filterByType(msgs, 'tournament').map((m) => m.id)).toEqual(['m2']);
  });

  it('sortByTimeDesc 依 time 字串降冪', () => {
    const msgs: InboxMessage[] = [
      { id: 'a', time: '2024/03/01 10:00' },
      { id: 'b', time: '2024/05/01 10:00' },
      { id: 'c', time: '2024/01/01 10:00' },
    ];
    expect(sortByTimeDesc(msgs).map((m) => m.id)).toEqual(['b', 'a', 'c']);
  });

  it('applyInboxView 先分類再排序', () => {
    const msgs: InboxMessage[] = [
      { id: 'm1', type: 'system', time: '2024/01/01 10:00' },
      { id: 'm2', type: 'system', time: '2024/02/01 10:00' },
      { id: 'm3', type: 'tournament', time: '2024/03/01 10:00' },
    ];
    expect(applyInboxView(msgs, 'system').map((m) => m.id)).toEqual(['m2', 'm1']);
    expect(applyInboxView(msgs, 'all').map((m) => m.id)).toEqual(['m3', 'm2', 'm1']);
  });

  it('normalizeInboxMessage 補上 _docId 與 id', () => {
    const out = normalizeInboxMessage('doc1', { title: 'hi' });
    expect(out._docId).toBe('doc1');
    expect(out.id).toBe('doc1');

    const out2 = normalizeInboxMessage('doc2', { id: 'msg2', title: 'hi' });
    expect(out2._docId).toBe('doc2');
    expect(out2.id).toBe('msg2');
  });
});

describe('inbox-repo 訂閱', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribeInbox 以 users/{uid}/inbox 建立監聽', async () => {
    const onChange = vi.fn();
    const onError = vi.fn();
    const cleanup = subscribeInbox('user1', onChange, onError);

    await vi.waitFor(() => expect(mocks.onSnapshot).toHaveBeenCalled());
    expect(mocks.collection).toHaveBeenCalledWith(expect.anything(), 'users/user1/inbox');
    cleanup();
  });

  it('subscribeInbox 回傳的 unsubscribe 會呼叫 Firestore unsubscribe', async () => {
    const unsubInner = vi.fn();
    mocks.onSnapshot.mockReturnValueOnce(unsubInner);

    const cleanup = subscribeInbox('user1', vi.fn(), vi.fn());
    await vi.waitFor(() => expect(mocks.onSnapshot).toHaveBeenCalled());
    cleanup();
    expect(unsubInner).toHaveBeenCalled();
  });

  it('subscribeInbox 有 uid 為空時丟錯', () => {
    expect(() => subscribeInbox('', vi.fn(), vi.fn())).toThrow();
  });
});

describe('inbox-repo 寫入', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('markRead 寫 read/readAt 到 users/{uid}/inbox/{_docId}', async () => {
    await markRead('user1', { id: 'm1', _docId: 'doc1' } as InboxMessage);

    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    const call = mocks.updateDoc.mock.calls[0] as unknown[];
    const ref = call[0] as { _path: string[] };
    const payload = call[1] as Record<string, unknown>;
    expect(ref._path).toEqual(['users/user1/inbox', 'doc1']);
    expect(payload).toEqual({ read: true, readAt: '__TS__' });
  });

  it('markRead 缺 _docId 時丟錯', async () => {
    await expect(markRead('user1', { id: 'm1' } as InboxMessage)).rejects.toThrow();
  });

  it('markAllRead 只處理未讀且有 _docId 的訊息', async () => {
    const msgs: InboxMessage[] = [
      { id: 'm1', _docId: 'd1', read: false },
      { id: 'm2', _docId: 'd2', read: true },
      { id: 'm3', _docId: '', read: false },
      { id: 'm4', read: false },
    ];
    await markAllRead('user1', msgs);

    expect(mocks.writeBatch).toHaveBeenCalledTimes(1);
    const batch = mocks.writeBatch.mock.results[0]!.value as { update: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn> };
    expect(batch.update).toHaveBeenCalledTimes(1);
    const call = batch.update.mock.calls[0] as unknown[];
    const ref = call[0] as { _path: string[] };
    const payload = call[1] as Record<string, unknown>;
    expect(ref._path).toEqual(['users/user1/inbox', 'd1']);
    expect(payload).toEqual({ read: true, readAt: '__TS__' });
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it('markAllRead 超過 500 筆時分批 commit', async () => {
    const msgs: InboxMessage[] = Array.from({ length: 600 }, (_, i) => ({
      id: `m${i}`,
      _docId: `d${i}`,
      read: false,
    }));
    await markAllRead('user1', msgs);
    expect(mocks.writeBatch).toHaveBeenCalledTimes(2);
    const batch1 = mocks.writeBatch.mock.results[0]!.value as { update: ReturnType<typeof vi.fn> };
    const batch2 = mocks.writeBatch.mock.results[1]!.value as { update: ReturnType<typeof vi.fn> };
    expect(batch1.update).toHaveBeenCalledTimes(500);
    expect(batch2.update).toHaveBeenCalledTimes(100);
  });

  it('markAllRead 無未讀時不建立 batch', async () => {
    await markAllRead('user1', [{ id: 'm', _docId: 'd', read: true }]);
    expect(mocks.writeBatch).not.toHaveBeenCalled();
  });

  it('deleteMessage 刪除 users/{uid}/inbox/{_docId}', async () => {
    await deleteMessage('user1', { id: 'm1', _docId: 'doc1' } as InboxMessage);
    expect(mocks.deleteDoc).toHaveBeenCalledTimes(1);
    const call = mocks.deleteDoc.mock.calls[0] as unknown[];
    const ref = call[0] as { _path: string[] };
    expect(ref._path).toEqual(['users/user1/inbox', 'doc1']);
  });

  it('deleteMessage 缺 _docId 時不寫入', async () => {
    await deleteMessage('user1', { id: 'm1' } as InboxMessage);
    expect(mocks.deleteDoc).not.toHaveBeenCalled();
  });

  it('clearAll 排除 pending 審核訊息並分批 450 刪除', async () => {
    const msgs: InboxMessage[] = [
      { id: 'm1', _docId: 'd1', actionType: 'x', actionStatus: 'pending' },
      { id: 'm2', _docId: 'd2' },
      { id: 'm3', _docId: 'd3' },
    ];
    const deleted = await clearAll('user1', msgs);
    expect(deleted).toBe(2);
    expect(mocks.writeBatch).toHaveBeenCalledTimes(1);
    const batch = mocks.writeBatch.mock.results[0]!.value as { delete: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn> };
    expect(batch.delete).toHaveBeenCalledTimes(2);
    const paths = (batch.delete.mock.calls as unknown[][]).map(
      (c) => (c[0] as { _path: string[] })._path,
    );
    expect(paths).toEqual([
      ['users/user1/inbox', 'd2'],
      ['users/user1/inbox', 'd3'],
    ]);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it('clearAll 超過 450 筆時分批 commit', async () => {
    const msgs: InboxMessage[] = Array.from({ length: 460 }, (_, i) => ({
      id: `m${i}`,
      _docId: `d${i}`,
    }));
    const deleted = await clearAll('user1', msgs);
    expect(deleted).toBe(460);
    expect(mocks.writeBatch).toHaveBeenCalledTimes(2);
  });

  it('clearAll 全部是 pending 時不刪除任何東西', async () => {
    const msgs: InboxMessage[] = [
      { id: 'm1', _docId: 'd1', actionType: 'x', actionStatus: 'pending' },
    ];
    const deleted = await clearAll('user1', msgs);
    expect(deleted).toBe(0);
    expect(mocks.writeBatch).not.toHaveBeenCalled();
  });
});
