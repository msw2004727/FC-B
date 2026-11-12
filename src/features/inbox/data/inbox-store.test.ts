import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxMessage } from './inbox-repo';
import type { PmThread } from './pm-repo';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    subscribeInbox: vi.fn(),
    subscribeThreads: vi.fn(),
    lastAuthUid: undefined as string | null | undefined,
  },
}));

vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => mocks.lastAuthUid }));

vi.mock('./inbox-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./inbox-repo')>();
  return { ...actual, subscribeInbox: mocks.subscribeInbox };
});
vi.mock('./pm-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pm-repo')>();
  return { ...actual, subscribeThreads: mocks.subscribeThreads };
});

import {
  beginOptimisticInboxRead,
  beginOptimisticPmRead,
  ensureInboxStore,
  OPTIMISTIC_READ_HOLD_MS,
  getInboxStoreState,
  retryInboxMessages,
  retryInboxThreads,
  startInboxStore,
  stopInboxStore,
} from './inbox-store';
import { getInboxBadgeCounts } from './inbox-badge';
import { emit } from '@/core/events';

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}

interface Sub<T> {
  uid: string;
  onChange: (items: T[]) => void;
  onError: (err: unknown) => void;
  unsub: ReturnType<typeof vi.fn>;
}

let inboxSubs: Sub<InboxMessage>[] = [];
let threadSubs: Sub<PmThread>[] = [];

beforeEach(() => {
  mocks.lastAuthUid = undefined;
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
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
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

  it('auth:changed 登出（null）時自己退訂並清空紅點，不靠呼叫端', () => {
    startInboxStore('u1');
    inboxSubs[0]?.onChange([{ id: 'm1', read: false }]);
    emit('auth:changed', { uid: null });
    expect(inboxSubs[0]?.unsub).toHaveBeenCalledTimes(1);
    expect(threadSubs[0]?.unsub).toHaveBeenCalledTimes(1);
    expect(getInboxStoreState().uid).toBeNull();
    expect(getInboxBadgeCounts().inboxUnread).toBe(0);
  });

  it('auth:changed 換成別的帳號時退訂；同一帳號再發不退訂', () => {
    startInboxStore('u1');
    emit('auth:changed', { uid: 'u1' });
    expect(inboxSubs[0]?.unsub).not.toHaveBeenCalled();
    expect(getInboxStoreState().uid).toBe('u1');
    emit('auth:changed', { uid: 'u2' });
    expect(inboxSubs[0]?.unsub).toHaveBeenCalledTimes(1);
    expect(getInboxStoreState().uid).toBeNull();
  });

  it('已確認登入帳號和要啟動的 uid 不同（畫面還停在舊帳號）時不啟動；登出後也不啟動', () => {
    mocks.lastAuthUid = 'u2';
    ensureInboxStore('u1');
    startInboxStore('u1');
    expect(mocks.subscribeInbox).not.toHaveBeenCalled();
    expect(getInboxStoreState().uid).toBeNull();
    mocks.lastAuthUid = null;
    ensureInboxStore('u1');
    expect(mocks.subscribeInbox).not.toHaveBeenCalled();
    mocks.lastAuthUid = 'u1';
    ensureInboxStore('u1');
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(1);
  });

  it('監聽出錯後，分頁回到前景時自動重訂出錯的那條；正常的不動', () => {
    startInboxStore('u1');
    inboxSubs[0]?.onError(new Error('token expired'));
    threadSubs[0]?.onChange([]);
    setVisibility('hidden');
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(2);
    expect(mocks.subscribeThreads).toHaveBeenCalledTimes(1);
    expect(inboxSubs[0]?.unsub).toHaveBeenCalledTimes(1);
    inboxSubs[1]?.onChange([{ id: 'm1', read: false }]);
    expect(getInboxStoreState().messagesStatus).toBe('ready');
    expect(getInboxBadgeCounts().inboxUnread).toBe(1);
    // 沒有錯誤時回到前景不重訂
    setVisibility('visible');
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(2);
  });

  it('退訂後不再聽前景與 auth 事件', () => {
    startInboxStore('u1');
    inboxSubs[0]?.onError(new Error('x'));
    stopInboxStore();
    setVisibility('visible');
    emit('auth:changed', { uid: 'u9' });
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(1);
    expect(getInboxStoreState().uid).toBeNull();
  });
});

describe('inbox-store 樂觀已讀（鈴鐺立即扣、失敗還原）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function startWith(messages: InboxMessage[], threads: PmThread[] = []): void {
    startInboxStore('u1');
    inboxSubs[0]?.onChange(messages);
    threadSubs[0]?.onChange(threads);
  }

  it('讀一則→紅點立即 -1；伺服器快照確認已讀後不重複扣', () => {
    startWith([
      { id: 'm1', read: false },
      { id: 'm2', read: false },
    ]);
    expect(getInboxBadgeCounts().inboxUnread).toBe(2);

    const settle = beginOptimisticInboxRead('u1', ['m1']);
    expect(getInboxBadgeCounts().inboxUnread).toBe(1);
    expect(getInboxStoreState().messages.find((m) => m.id === 'm1')).toMatchObject({ read: true });

    // 寫入途中先到的舊快照（仍未讀）不撤掉標記
    inboxSubs[0]?.onChange([
      { id: 'm1', read: false },
      { id: 'm2', read: false },
    ]);
    expect(getInboxBadgeCounts().inboxUnread).toBe(1);

    settle(true);
    inboxSubs[0]?.onChange([
      { id: 'm1', read: true },
      { id: 'm2', read: false },
    ]);
    expect(getInboxBadgeCounts().inboxUnread).toBe(1);
  });

  it('寫入失敗→紅點與列表還原成伺服器資料', () => {
    startWith([{ id: 'm1', read: false }]);
    const settle = beginOptimisticInboxRead('u1', ['m1']);
    expect(getInboxBadgeCounts().inboxUnread).toBe(0);
    settle(false);
    expect(getInboxBadgeCounts().inboxUnread).toBe(1);
    expect(getInboxStoreState().messages[0]).toMatchObject({ read: false });
    // 只認第一次結算
    settle(true);
    expect(getInboxBadgeCounts().inboxUnread).toBe(1);
  });

  it('快速連讀多則：各自結算，完成順序顛倒、一成一敗互不影響', async () => {
    startWith([
      { id: 'm1', read: false },
      { id: 'm2', read: false },
      { id: 'm3', read: false },
    ]);
    let resolveFirst!: () => void;
    let rejectSecond!: (err: unknown) => void;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<void>((_resolve, reject) => {
      rejectSecond = reject;
    });
    const settle1 = beginOptimisticInboxRead('u1', ['m1']);
    const settle2 = beginOptimisticInboxRead('u1', ['m2']);
    expect(getInboxBadgeCounts().inboxUnread).toBe(1);
    const done1 = first.then(() => settle1(true));
    const done2 = second.catch(() => settle2(false));

    rejectSecond(new Error('denied'));
    await done2;
    expect(getInboxBadgeCounts().inboxUnread).toBe(2);
    resolveFirst();
    await done1;
    expect(getInboxBadgeCounts().inboxUnread).toBe(2);
    expect(
      getInboxStoreState()
        .messages.filter((m) => m.read === false)
        .map((m) => m.id),
    ).toEqual(['m2', 'm3']);
  });

  it('成功後伺服器一直沒確認：最多保留 10 秒，之後回到伺服器資料', () => {
    vi.useFakeTimers();
    startWith([{ id: 'm1', read: false }]);
    const settle = beginOptimisticInboxRead('u1', ['m1']);
    settle(true);
    expect(getInboxBadgeCounts().inboxUnread).toBe(0);
    vi.advanceTimersByTime(OPTIMISTIC_READ_HOLD_MS - 1);
    expect(getInboxBadgeCounts().inboxUnread).toBe(0);
    vi.advanceTimersByTime(1);
    expect(getInboxBadgeCounts().inboxUnread).toBe(1);
  });

  it('uid 切換：舊帳號的結算不影響新帳號；uid 不符時不做事', () => {
    startWith([{ id: 'm1', read: false }], [{ id: 'c1', unreadCount: 2 }]);
    const settleInbox = beginOptimisticInboxRead('u1', ['m1']);
    const settlePm = beginOptimisticPmRead('u1', 'c1');
    expect(getInboxBadgeCounts()).toEqual({ inboxUnread: 0, pmUnread: 0 });

    startInboxStore('u2');
    inboxSubs[1]?.onChange([{ id: 'm1', read: false }]);
    threadSubs[1]?.onChange([{ id: 'c1', unreadCount: 2 }]);
    expect(getInboxBadgeCounts()).toEqual({ inboxUnread: 1, pmUnread: 2 });

    settleInbox(true);
    settlePm(false);
    expect(getInboxBadgeCounts()).toEqual({ inboxUnread: 1, pmUnread: 2 });

    // 用舊 uid 開始的樂觀已讀不作用在新帳號
    beginOptimisticInboxRead('u1', ['m1'])(true);
    beginOptimisticPmRead('u1', 'c1')(true);
    expect(getInboxBadgeCounts()).toEqual({ inboxUnread: 1, pmUnread: 2 });
  });

  it('私訊：開對話立即把該對話未讀歸零；失敗還原', () => {
    startWith([], [
      { id: 'c1', conversationId: 'c1', unreadCount: 2 },
      { id: 'c2', conversationId: 'c2', unreadCount: 1 },
    ]);
    expect(getInboxBadgeCounts().pmUnread).toBe(3);
    const settle = beginOptimisticPmRead('u1', 'c1');
    expect(getInboxBadgeCounts().pmUnread).toBe(1);
    expect(getInboxStoreState().threads.find((t) => t.id === 'c1')?.unreadCount).toBe(0);
    settle(false);
    expect(getInboxBadgeCounts().pmUnread).toBe(3);
  });

  it('私訊：伺服器確認後不重複扣，之後新進訊息照常顯示', () => {
    startWith([], [{ id: 'c1', conversationId: 'c1', unreadCount: 2 }]);
    const settle = beginOptimisticPmRead('u1', 'c1');
    // 已讀寫入途中伺服器先推了已讀快照
    threadSubs[0]?.onChange([{ id: 'c1', conversationId: 'c1', unreadCount: 0 }]);
    expect(getInboxBadgeCounts().pmUnread).toBe(0);
    settle(true);
    // 成功當下已確認 → 標記移除，新進一則立即出現在鈴鐺
    threadSubs[0]?.onChange([{ id: 'c1', conversationId: 'c1', unreadCount: 1 }]);
    expect(getInboxBadgeCounts().pmUnread).toBe(1);
  });

  it('私訊：同一對話重新開始時舊的結算失效', () => {
    startWith([], [{ id: 'c1', conversationId: 'c1', unreadCount: 2 }]);
    const settleOld = beginOptimisticPmRead('u1', 'c1');
    const settleNew = beginOptimisticPmRead('u1', 'c1');
    settleOld(false);
    expect(getInboxBadgeCounts().pmUnread).toBe(0);
    settleNew(false);
    expect(getInboxBadgeCounts().pmUnread).toBe(2);
  });

  it('登出時清掉所有樂觀標記與計時器', () => {
    vi.useFakeTimers();
    startWith([{ id: 'm1', read: false }]);
    beginOptimisticInboxRead('u1', ['m1'])(true);
    stopInboxStore();
    expect(getInboxBadgeCounts()).toEqual({ inboxUnread: 0, pmUnread: 0 });
    startInboxStore('u1');
    inboxSubs[1]?.onChange([{ id: 'm1', read: false }]);
    expect(getInboxBadgeCounts().inboxUnread).toBe(1);
    vi.advanceTimersByTime(OPTIMISTIC_READ_HOLD_MS);
    expect(getInboxBadgeCounts().inboxUnread).toBe(1);
  });
});
