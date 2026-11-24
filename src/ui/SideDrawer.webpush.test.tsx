// 網頁推播 W5（審查 P3-3）：側邊選單「清除快取」登出前先解除推播，beforeSignOut 必須在 signOutForCacheClear 之前。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { LocationProvider } from 'preact-iso';

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string) => key,
}));
import * as authMod from '@/data/auth';
import * as bootMod from '@/features/profile/web-push/boot';
import { _resetForTest } from '@/core/feature-registry';
import { SideDrawer } from './SideDrawer';
import { TopBar } from './TopBar';
import { toast } from './Toast';

function Harness(): preact.JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <LocationProvider>
      <TopBar menuRef={trigger} drawerOpen={open} onMenuClick={() => setOpen(true)} />
      <SideDrawer open={open} onClose={() => setOpen(false)} returnFocusRef={trigger} />
    </LocationProvider>
  );
}

const order: string[] = [];

async function clearCache(): Promise<void> {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '選單' }));
  fireEvent.click(screen.getByRole('button', { name: 'ui.sideDrawer.more' }));
  fireEvent.click(document.querySelector('.drawer-reset-btn') as HTMLButtonElement);
  await act(async () => {
    fireEvent.click(document.getElementById('app-confirm-ok')!);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

beforeEach(() => {
  _resetForTest();
  toast.clear();
  order.length = 0;
  vi.spyOn(bootMod, 'beforeSignOut').mockImplementation(async (limitMs?: number) => {
    order.push(`beforeSignOut:${limitMs}`);
  });
  vi.spyOn(authMod, 'signOutForCacheClear').mockImplementation(async () => {
    order.push('signOutForCacheClear');
    return true;
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  toast.clear();
  localStorage.removeItem('fcb:webpush:v1');
  vi.restoreAllMocks();
  _resetForTest();
});

describe('SideDrawer 清除快取 × 網頁推播', () => {
  it('有推播紀錄：beforeSignOut(3000) 在 signOutForCacheClear 之前', async () => {
    localStorage.setItem('fcb:webpush:v1', '{}');
    await clearCache();
    expect(order).toEqual(['beforeSignOut:3000', 'signOutForCacheClear']);
  });

  it('沒有推播紀錄：不呼叫 beforeSignOut；beforeSignOut 丟錯也照常登出', async () => {
    await clearCache();
    expect(order).toEqual(['signOutForCacheClear']);
    cleanup();
    order.length = 0;
    localStorage.setItem('fcb:webpush:v1', '{}');
    vi.mocked(bootMod.beforeSignOut).mockImplementation(async () => { order.push('beforeSignOut'); throw new Error('x'); });
    await clearCache();
    expect(order).toEqual(['beforeSignOut', 'signOutForCacheClear']);
  });
});
