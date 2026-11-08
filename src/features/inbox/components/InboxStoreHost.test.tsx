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

import { InboxStoreHost } from './InboxStoreHost';
import { getInboxStoreState, stopInboxStore } from '../data/inbox-store';

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
});

describe('InboxStoreHost（App 層收件匣訂閱）', () => {
  it('登入後啟動一次；重繪同 uid 不重訂', () => {
    const view = render(<InboxStoreHost uid="u1" />);
    view.rerender(<InboxStoreHost uid="u1" />);
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeInbox.mock.calls[0]?.[0]).toBe('u1');
    expect(getInboxStoreState().uid).toBe('u1');
  });

  it('卸載（登出）時退訂並清空', () => {
    const view = render(<InboxStoreHost uid="u1" />);
    view.unmount();
    expect(mocks.inboxUnsubs[0]).toHaveBeenCalledTimes(1);
    expect(mocks.threadUnsubs[0]).toHaveBeenCalledTimes(1);
    expect(getInboxStoreState().uid).toBeNull();
  });

  it('換帳號時先退訂舊的再訂新的；uid 變 null 時退訂', () => {
    const view = render(<InboxStoreHost uid="u1" />);
    view.rerender(<InboxStoreHost uid="u2" />);
    expect(mocks.inboxUnsubs[0]).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeInbox).toHaveBeenCalledTimes(2);
    expect(mocks.subscribeInbox.mock.calls[1]?.[0]).toBe('u2');
    view.rerender(<InboxStoreHost uid={null} />);
    expect(mocks.inboxUnsubs[1]).toHaveBeenCalledTimes(1);
    expect(getInboxStoreState().uid).toBeNull();
  });

  it('守門：App 以 lazy 掛上主機；收件匣共用訂閱相關檔不用 innerHTML', () => {
    const read = (rel: string): string => readFileSync(resolve(__dirname, rel), 'utf8');
    const app = read('../../../app/App.tsx');
    expect(app).toMatch(/import\('@\/features\/inbox\/components\/InboxStoreHost'\)/);
    expect(app).toMatch(/<LazyInboxStoreHost uid=\{chromeUid\} \/>/);
    // TopBar 在首屏：只能 import 不帶資料層的 inbox-badge，不得靜態 import inbox-store／repo
    const topBar = read('../../../ui/TopBar.tsx');
    expect(topBar).toContain("from '@/features/inbox/data/inbox-badge'");
    expect(topBar).not.toMatch(/from '@\/features\/inbox\/data\/(inbox-store|inbox-repo|pm-repo)'/);
    const badge = read('../data/inbox-badge.ts');
    expect(badge).not.toMatch(/^import .* from '(?!preact)/m);
    // InboxPage 不再自己訂閱收件匣與私訊列表
    const page = read('../pages/InboxPage.tsx');
    expect(page).not.toMatch(/\bsubscribeInbox\b/);
    expect(page).not.toMatch(/\bsubscribeThreads\b/);
    for (const src of [
      read('./InboxStoreHost.tsx'),
      read('../data/inbox-store.ts'),
      badge,
      topBar,
      page,
    ]) {
      expect(src).not.toContain('innerHTML');
      expect(src).not.toContain('dangerouslySetInnerHTML');
    }
  });
});
