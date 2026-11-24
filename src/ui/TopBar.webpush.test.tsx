// 網頁推播 W5（顧問 §3.699 Q3 (B)）：右上角登出前先解除推播、等瀏覽器退訂完成，最多 2 秒。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';

vi.mock('@/core/exp-display', () => ({ SHOW_EXP: true }));
vi.mock('@/features/events/data/events-repo', () => ({
  getEventsRepo: () => ({ getSnapshot: () => ({ active: [], terminal: [] }) }),
}));
const order = vi.hoisted(() => [] as string[]);
const release = vi.hoisted(() => ({ fn: async () => { order.push('beforeSignOut'); } }));
vi.mock('@/features/profile/web-push/boot', () => ({
  beforeSignOut: () => release.fn(),
}));

import * as authMod from '@/data/auth';
import { TopBar } from './TopBar';

const USER = { uid: 'u1', displayName: '王大明', pictureUrl: null };

function clickLogout(container: Element): void {
  fireEvent.click(container.querySelector<HTMLElement>('#line-avatar-topbar')!);
  fireEvent.click(container.querySelector<HTMLButtonElement>('.user-menu-logout')!);
}

beforeEach(() => {
  order.length = 0;
  release.fn = async () => { order.push('beforeSignOut'); };
  vi.spyOn(authMod, 'signOutAndReload').mockImplementation(async () => {
    order.push('signOutAndReload');
    return true;
  });
});

afterEach(() => {
  cleanup();
  localStorage.removeItem('fcb:webpush:v1');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TopBar 登出 × 網頁推播', () => {
  it('有推播紀錄：先解除（beforeSignOut）再 signOutAndReload', async () => {
    localStorage.setItem('fcb:webpush:v1', '{}');
    const { container } = render(<TopBar drawerOpen={false} onMenuClick={() => undefined} user={USER} />);
    clickLogout(container);
    await waitFor(() => expect(order).toEqual(['beforeSignOut', 'signOutAndReload']));
  });

  it('沒有推播紀錄：不載入推播模組，直接登出', async () => {
    const { container } = render(<TopBar drawerOpen={false} onMenuClick={() => undefined} user={USER} />);
    clickLogout(container);
    await waitFor(() => expect(order).toEqual(['signOutAndReload']));
  });

  it('解除卡住：最多等 2 秒照常登出；解除丟錯也照常登出', async () => {
    localStorage.setItem('fcb:webpush:v1', '{}');
    vi.useFakeTimers({ shouldAdvanceTime: false });
    release.fn = () => new Promise(() => {});
    const { container } = render(<TopBar drawerOpen={false} onMenuClick={() => undefined} user={USER} />);
    clickLogout(container);
    await vi.advanceTimersByTimeAsync(1900);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();
    await waitFor(() => expect(order).toEqual(['signOutAndReload']));
    cleanup();

    order.length = 0;
    release.fn = async () => { throw new Error('x'); };
    const again = render(<TopBar drawerOpen={false} onMenuClick={() => undefined} user={USER} />);
    clickLogout(again.container);
    await waitFor(() => expect(order).toEqual(['signOutAndReload']));
  });
});
