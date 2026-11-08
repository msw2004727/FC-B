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
  filterByDate,
  filterByType,
  getMessageDisplayTime,
  getMessageTimeMs,
  INBOX_LISTEN_LIMIT,
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

// 台北 2026/11/08 10:00 的絕對毫秒（UTC 02:00）。
const TPE_1108_1000 = Date.UTC(2026, 10, 8, 2, 0);
const tsLike = (ms: number) => ({ toMillis: () => ms });
const tsSeconds = (ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1_000_000 });

describe('inbox-repo 時間（照 A _getMessageTimeMs）', () => {
  it('getMessageTimeMs：timestamp 優先，再 createdAt，最後 time 字串（台北牆鐘）；都沒有回 0', () => {
    expect(getMessageTimeMs({ id: 'a', timestamp: tsLike(5000), createdAt: tsLike(9000) })).toBe(5000);
    expect(getMessageTimeMs({ id: 'b', createdAt: tsLike(TPE_1108_1000) })).toBe(TPE_1108_1000);
    expect(getMessageTimeMs({ id: 'c', createdAt: tsSeconds(TPE_1108_1000 + 123) })).toBe(TPE_1108_1000 + 123);
    expect(getMessageTimeMs({ id: 'd', createdAt: TPE_1108_1000 })).toBe(TPE_1108_1000);
    expect(getMessageTimeMs({ id: 'e', time: '2026/11/08 10:00' })).toBe(TPE_1108_1000);
    // createdAt 缺值或壞值 → 退回 time
    expect(getMessageTimeMs({ id: 'f', createdAt: null, time: '2026/11/08 10:00' })).toBe(TPE_1108_1000);
    expect(getMessageTimeMs({ id: 'g', createdAt: 'not-a-date', time: '2026/11/08 10:00' })).toBe(TPE_1108_1000);
    expect(getMessageTimeMs({ id: 'h' })).toBe(0);
    expect(getMessageTimeMs({ id: 'i', time: '亂碼' })).toBe(0);
    expect(getMessageTimeMs(null)).toBe(0);
  });

  it('sortByTimeDesc：有／沒有 time 混排，createdAt 為 Timestamp、毫秒或缺值，新的在前', () => {
    const msgs: InboxMessage[] = [
      { id: 'old-time', time: '2026/11/01 09:00' },
      { id: 'sys-ts', createdAt: tsLike(TPE_1108_1000) }, // 伺服器通知：只有 createdAt
      { id: 'missing' }, // 缺值排最後
      { id: 'sys-ms', createdAt: TPE_1108_1000 - 60_000 },
      { id: 'sys-sec', createdAt: tsSeconds(TPE_1108_1000 + 60_000) },
      { id: 'mid-time', time: '2026/11/05 12:00' },
    ];
    expect(sortByTimeDesc(msgs).map((m) => m.id)).toEqual([
      'sys-sec',
      'sys-ts',
      'sys-ms',
      'mid-time',
      'old-time',
      'missing',
    ]);
  });

  it('getMessageDisplayTime：有 time 原樣顯示；沒有時用 createdAt 轉台北時間（格式同 A 的 time）', () => {
    expect(getMessageDisplayTime({ id: 'a', time: '2025/01/01 10:00', createdAt: tsLike(TPE_1108_1000) }))
      .toBe('2025/01/01 10:00');
    expect(getMessageDisplayTime({ id: 'b', createdAt: tsLike(TPE_1108_1000) })).toBe('2026/11/08 10:00');
    expect(getMessageDisplayTime({ id: 'c', createdAt: tsSeconds(TPE_1108_1000) })).toBe('2026/11/08 10:00');
    expect(getMessageDisplayTime({ id: 'd', createdAt: TPE_1108_1000 })).toBe('2026/11/08 10:00');
    // 台北 00:30（UTC 前一天 16:30）要落在台北當天
    expect(getMessageDisplayTime({ id: 'e', createdAt: Date.UTC(2026, 10, 7, 16, 30) })).toBe('2026/11/08 00:30');
    expect(getMessageDisplayTime({ id: 'f', time: '' })).toBe('');
    expect(getMessageDisplayTime({ id: 'g' })).toBe('');
  });

  it('filterByDate：比對顯示時間的 YYYY/MM/DD，含只有 createdAt 的通知', () => {
    const msgs: InboxMessage[] = [
      { id: 'with-time', time: '2026/11/08 09:00' },
      { id: 'sys', createdAt: tsLike(TPE_1108_1000) },
      { id: 'sys-late-night', createdAt: Date.UTC(2026, 10, 7, 16, 30) }, // 台北 11/08 00:30
      { id: 'other-day', createdAt: tsLike(TPE_1108_1000 - 86_400_000) },
      { id: 'none' },
    ];
    expect(filterByDate(msgs, '2026-11-08').map((m) => m.id)).toEqual([
      'with-time',
      'sys',
      'sys-late-night',
    ]);
    expect(filterByDate(msgs, '2026-11-07').map((m) => m.id)).toEqual(['other-day']);
    // 格式不對不過濾
    expect(filterByDate(msgs, '')).toHaveLength(5);
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

  it('subscribeInbox 照 A 用 orderBy(createdAt desc).limit(200)，不全量讀取', async () => {
    const cleanup = subscribeInbox('user1', vi.fn(), vi.fn());
    await vi.waitFor(() => expect(mocks.onSnapshot).toHaveBeenCalled());
    expect(INBOX_LISTEN_LIMIT).toBe(200);
    expect(mocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mocks.limit).toHaveBeenCalledWith(200);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('subscribeInbox 快照依時間排序後交出（只有 createdAt 的通知排前面）', async () => {
    let emit: ((snap: unknown) => void) | null = null;
    const onSnapshotMock = mocks.onSnapshot as unknown as {
      mockImplementationOnce: (fn: (q: unknown, next: (snap: unknown) => void) => () => void) => void;
    };
    onSnapshotMock.mockImplementationOnce((_q, next) => {
      emit = next;
      return () => undefined;
    });
    const onChange = vi.fn();
    const cleanup = subscribeInbox('user1', onChange, vi.fn());
    await vi.waitFor(() => expect(emit).not.toBeNull());
    const docs = [
      { id: 'old', data: () => ({ time: '2025/01/01 10:00' }) },
      { id: 'sys', data: () => ({ createdAt: tsLike(TPE_1108_1000) }) },
    ];
    (emit as unknown as (snap: unknown) => void)({ docs });
    expect(onChange).toHaveBeenCalledTimes(1);
    const out = onChange.mock.calls[0]?.[0] as InboxMessage[];
    expect(out.map((m) => m.id)).toEqual(['sys', 'old']);
    cleanup();
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
