import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxMessage } from './inbox-repo';
import type { PmThread } from './pm-repo';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    subscribeInbox: vi.fn(),
    subscribeThreads: vi.fn(),
  },
}));

vi.mock('./inbox-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./inbox-repo')>();
  return { ...actual, subscribeInbox: mocks.subscribeInbox };
});
vi.mock('./pm-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pm-repo')>();
  return { ...actual, subscribeThreads: mocks.subscribeThreads };
});

import {
  ensureInboxStore,
  getInboxStoreState,
  retryInboxMessages,
  retryInboxThreads,
  startInboxStore,
  stopInboxStore,
} from './inbox-store';
import { getInboxBadgeCounts } from './inbox-badge';

interface Sub<T> {
  uid: string;
  onChange: (items: T[]) => void;
  onError: (err: unknown) => void;
  unsub: ReturnType<typeof vi.fn>;
}

let inboxSubs: Sub<InboxMessage>[] = [];
let threadSubs: Sub<PmThread>[] = [];

beforeEach(() => {
  inboxSubs = [];
  threadSubs = [];
  mocks.subscribeInbox.mockReset();
  mocks.subscribeThreads.mockReset();
  mocks.subscribeInbox.mockImplementation(
    (uid: string, onChange: Sub<InboxMessage>['onChange'], onError: Sub<InboxMessage>['onError']) => {
      const unsub = vi.fn();
      inboxSubs.push({ uid, onChange, onError, unsub });
      return unsub;
    },
  );
  mocks.subscribeThreads.mockImplementation(
    (uid: string, onChange: Sub<PmThread>['onChange'], onError: Sub<PmThread>['onError']) => {
      const unsub = vi.fn();
      threadSubs.push({ uid, onChange, onError, unsub });
      return unsub;
    },
  );
});

afterEach(() => {
  stopInboxStore();
  vi.restoreAllMocks();
});

describe('inbox-store 共用訂閱', () => {
  it('同一 uid 重複啟動只建立一次訂閱', () => {
    startInboxStore('u1');
    startInboxStore('u1');
    ensureInboxStore('u1');
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeThreads).toHaveBeenCalledTimes(1);
    expect(inboxSubs[0]?.uid).toBe('u1');
    expect(getInboxStoreState()).toMatchObject({ uid: 'u1', messagesStatus: 'loading', threadsStatus: 'loading' });
  });

  it('未讀數＝收件匣未讀＋私訊未讀合計，寫入鈴鐺狀態', () => {
    startInboxStore('u1');
    inboxSubs[0]?.onChange([
      { id: 'm1', read: false },
      { id: 'm2', read: true },
      { id: 'm3', read: false },
      { id: 'm4', readBy: ['other'] }, // legacy：不含本人 uid → 未讀
    ]);
    threadSubs[0]?.onChange([
      { id: 't1', unreadCount: 2 },
      { id: 't2', unreadCount: -3 }, // 負數不計（照 A max(0, …)）
      { id: 't3' },
      { id: 't4', unreadCount: 1 },
    ]);
    expect(getInboxStoreState().messagesStatus).toBe('ready');
    expect(getInboxStoreState().threadsStatus).toBe('ready');
    expect(getInboxBadgeCounts()).toEqual({ inboxUnread: 3, pmUnread: 3 });
  });

  it('登出（stop）時退訂兩條監聽並清空資料與紅點', () => {
    startInboxStore('u1');
    inboxSubs[0]?.onChange([{ id: 'm1', read: false }]);
    threadSubs[0]?.onChange([{ id: 't1', unreadCount: 4 }]);
    expect(getInboxBadgeCounts()).toEqual({ inboxUnread: 1, pmUnread: 4 });

    stopInboxStore();
    expect(inboxSubs[0]?.unsub).toHaveBeenCalledTimes(1);
    expect(threadSubs[0]?.unsub).toHaveBeenCalledTimes(1);
    expect(getInboxStoreState()).toMatchObject({ uid: null, messages: [], threads: [] });
    expect(getInboxBadgeCounts()).toEqual({ inboxUnread: 0, pmUnread: 0 });

    // 退訂後舊監聽晚到的快照一律丟棄
    inboxSubs[0]?.onChange([{ id: 'late', read: false }]);
    expect(getInboxStoreState().messages).toEqual([]);
    expect(getInboxBadgeCounts().inboxUnread).toBe(0);
  });

  it('換帳號：退訂舊 uid、清空後訂新 uid；舊監聽回呼不覆蓋新資料', () => {
    startInboxStore('u1');
    inboxSubs[0]?.onChange([{ id: 'u1-msg', read: false }]);
    startInboxStore('u2');
    expect(inboxSubs[0]?.unsub).toHaveBeenCalledTimes(1);
    expect(threadSubs[0]?.unsub).toHaveBeenCalledTimes(1);
    expect(inboxSubs[1]?.uid).toBe('u2');
    expect(getInboxStoreState()).toMatchObject({ uid: 'u2', messages: [], messagesStatus: 'loading' });
    expect(getInboxBadgeCounts().inboxUnread).toBe(0);

    inboxSubs[0]?.onChange([{ id: 'u1-late', read: false }]);
    expect(getInboxStoreState().messages).toEqual([]);
    inboxSubs[1]?.onChange([{ id: 'u2-msg', read: false }]);
    expect(getInboxStoreState().messages.map((m) => m.id)).toEqual(['u2-msg']);
  });

  it('ensureInboxStore 不搶已啟動的其他 uid', () => {
    startInboxStore('u1');
    ensureInboxStore('u2');
    expect(getInboxStoreState().uid).toBe('u1');
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(1);
  });

  it('監聽錯誤標成 error，重試只重訂該條', () => {
    startInboxStore('u1');
    inboxSubs[0]?.onError(new Error('denied'));
    expect(getInboxStoreState().messagesStatus).toBe('error');

    retryInboxMessages();
    expect(inboxSubs[0]?.unsub).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(2);
    expect(mocks.subscribeThreads).toHaveBeenCalledTimes(1);
    expect(getInboxStoreState().messagesStatus).toBe('loading');
    // 舊監聽的錯誤晚到不影響
    inboxSubs[0]?.onError(new Error('late'));
    expect(getInboxStoreState().messagesStatus).toBe('loading');
    inboxSubs[1]?.onChange([]);
    expect(getInboxStoreState().messagesStatus).toBe('ready');

    threadSubs[0]?.onError(new Error('denied'));
    expect(getInboxStoreState().threadsStatus).toBe('error');
    retryInboxThreads();
    expect(mocks.subscribeThreads).toHaveBeenCalledTimes(2);
    expect(getInboxStoreState().threadsStatus).toBe('loading');
  });

  it('subscribe 同步丟錯時標成 error，不往外拋', () => {
    mocks.subscribeInbox.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => startInboxStore('u1')).not.toThrow();
    expect(getInboxStoreState().messagesStatus).toBe('error');
    expect(getInboxStoreState().threadsStatus).toBe('loading');
  });

  it('空 uid 視同登出', () => {
    startInboxStore('u1');
    startInboxStore('  ');
    expect(getInboxStoreState().uid).toBeNull();
    expect(inboxSubs[0]?.unsub).toHaveBeenCalledTimes(1);
  });
});
