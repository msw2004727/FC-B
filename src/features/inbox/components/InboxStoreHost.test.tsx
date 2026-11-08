import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    subscribeInbox: vi.fn(),
    subscribeThreads: vi.fn(),
    inboxUnsubs: [] as Array<ReturnType<typeof vi.fn>>,
    threadUnsubs: [] as Array<ReturnType<typeof vi.fn>>,
  },
}));

vi.mock('../data/inbox-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/inbox-repo')>();
  return { ...actual, subscribeInbox: mocks.subscribeInbox };
});
vi.mock('../data/pm-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/pm-repo')>();
  return { ...actual, subscribeThreads: mocks.subscribeThreads };
});

import { INBOX_START_DELAY_MS, InboxStoreHost } from './InboxStoreHost';
import { ensureInboxStore, getInboxStoreState, stopInboxStore } from '../data/inbox-store';

beforeEach(() => {
  mocks.inboxUnsubs = [];
  mocks.threadUnsubs = [];
  mocks.subscribeInbox.mockReset();
  mocks.subscribeThreads.mockReset();
  mocks.subscribeInbox.mockImplementation(() => {
    const unsub = vi.fn();
    mocks.inboxUnsubs.push(unsub);
    return unsub;
  });
  mocks.subscribeThreads.mockImplementation(() => {
    const unsub = vi.fn();
    mocks.threadUnsubs.push(unsub);
    return unsub;
  });
});

afterEach(() => {
  cleanup();
  stopInboxStore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('InboxStoreHost（App 層收件匣訂閱）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('登入後延到閒置（無 requestIdleCallback 時 1500ms）才啟動，只啟動一次；重繪同 uid 不重訂', () => {
    expect(typeof (window as { requestIdleCallback?: unknown }).requestIdleCallback).not.toBe('function');
    const view = render(<InboxStoreHost uid="u1" />);
    expect(mocks.subscribeInbox).not.toHaveBeenCalled();
    vi.advanceTimersByTime(INBOX_START_DELAY_MS - 1);
    expect(mocks.subscribeInbox).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeInbox.mock.calls[0]?.[0]).toBe('u1');
    view.rerender(<InboxStoreHost uid="u1" />);
    vi.advanceTimersByTime(INBOX_START_DELAY_MS * 2);
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(1);
    expect(getInboxStoreState().uid).toBe('u1');
  });

  it('有 requestIdleCallback 時用它（上限 1500ms），卸載時取消', () => {
    const callbacks: Array<() => void> = [];
    const ric = vi.fn((cb: () => void, _opts?: { timeout: number }) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    const cic = vi.fn();
    vi.stubGlobal('requestIdleCallback', ric);
    vi.stubGlobal('cancelIdleCallback', cic);

    const view = render(<InboxStoreHost uid="u1" />);
    expect(ric).toHaveBeenCalledTimes(1);
    expect(ric.mock.calls[0]?.[1]).toEqual({ timeout: INBOX_START_DELAY_MS });
    expect(mocks.subscribeInbox).not.toHaveBeenCalled();
    callbacks[0]?.();
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(1);

    view.rerender(<InboxStoreHost uid="u2" />);
    expect(cic).toHaveBeenCalledWith(1);
    view.unmount();
    expect(cic).toHaveBeenCalledWith(2);
    // 已取消的閒置回呼即使晚到也不啟動
    callbacks[1]?.();
    expect(getInboxStoreState().uid).toBeNull();
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(1);
  });

  it('延遲期間卸載或換 uid：取消，不用舊 uid 啟動', () => {
    const view = render(<InboxStoreHost uid="u1" />);
    vi.advanceTimersByTime(500);
    view.rerender(<InboxStoreHost uid="u2" />);
    vi.advanceTimersByTime(INBOX_START_DELAY_MS);
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeInbox.mock.calls[0]?.[0]).toBe('u2');

    view.rerender(<InboxStoreHost uid="u3" />);
    vi.advanceTimersByTime(500);
    view.unmount();
    vi.advanceTimersByTime(INBOX_START_DELAY_MS * 2);
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(1);
    expect(getInboxStoreState().uid).toBeNull();
  });

  it('延遲期間已由收件匣頁立即啟動：到時不重訂', () => {
    render(<InboxStoreHost uid="u1" />);
    ensureInboxStore('u1');
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(INBOX_START_DELAY_MS);
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(1);
  });

  it('卸載（登出）時退訂並清空', () => {
    const view = render(<InboxStoreHost uid="u1" />);
    vi.advanceTimersByTime(INBOX_START_DELAY_MS);
    view.unmount();
    expect(mocks.inboxUnsubs[0]).toHaveBeenCalledTimes(1);
    expect(mocks.threadUnsubs[0]).toHaveBeenCalledTimes(1);
    expect(getInboxStoreState().uid).toBeNull();
  });

  it('換帳號時先退訂舊的再訂新的；uid 變 null 時退訂', () => {
    const view = render(<InboxStoreHost uid="u1" />);
    vi.advanceTimersByTime(INBOX_START_DELAY_MS);
    view.rerender(<InboxStoreHost uid="u2" />);
    expect(mocks.inboxUnsubs[0]).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(INBOX_START_DELAY_MS);
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(2);
    expect(mocks.subscribeInbox.mock.calls[1]?.[0]).toBe('u2');
    view.rerender(<InboxStoreHost uid={null} />);
    expect(mocks.inboxUnsubs[1]).toHaveBeenCalledTimes(1);
    expect(getInboxStoreState().uid).toBeNull();
  });

  it('守門：App 以 lazy 掛上主機；InboxPage 不自己訂閱；相關檔不用 innerHTML（首屏靜態圖見 entry-graph.test.ts）', () => {
    const read = (rel: string): string => readFileSync(resolve(__dirname, rel), 'utf8');
    const app = read('../../../app/App.tsx');
    expect(app).toMatch(/import\('@\/features\/inbox\/components\/InboxStoreHost'\)/);
    expect(app).toMatch(/<LazyInboxStoreHost uid=\{chromeUid\} \/>/);
    const page = read('../pages/InboxPage.tsx');
    expect(page).not.toMatch(/\bsubscribeInbox\b/);
    expect(page).not.toMatch(/\bsubscribeThreads\b/);
    for (const src of [
      read('./InboxStoreHost.tsx'),
      read('../data/inbox-store.ts'),
      read('../data/inbox-badge.ts'),
      read('../../../ui/TopBar.tsx'),
      page,
    ]) {
      expect(src).not.toContain('innerHTML');
      expect(src).not.toContain('dangerouslySetInnerHTML');
    }
  });
});
