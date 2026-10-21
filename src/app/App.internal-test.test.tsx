import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import type { AuthUser } from '@/data/auth';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import { _setDictLoaderForTest, setLocale, t } from '@/i18n/i18n';
import { App } from './App';

const auth = vi.hoisted(() => ({
  signIn: vi.fn<() => Promise<AuthUser>>(),
  getCurrentUser: vi.fn<() => Promise<AuthUser | null>>(),
  onAuthChanged: vi.fn<(callback: (user: AuthUser | null) => void) => () => void>(),
}));

vi.mock('@/data/auth', () => ({
  signIn: auth.signIn,
  getCurrentUser: auth.getCurrentUser,
  onAuthChanged: auth.onAuthChanged,
}));

beforeEach(async () => {
  vi.resetAllMocks();
  auth.getCurrentUser.mockResolvedValue(null);
  auth.onAuthChanged.mockReturnValue(() => {});
  _resetForTest();
  registerFeatures([{
    id: 'internal-test-home',
    status: 'enabled',
    routes: [{ path: '/', titleKey: 'nav.home', load: async () => ({ default: () => <p>HOME_ROUTE</p> }) }],
    nav: [{ path: '/', labelKey: 'nav.home', icon: 'home', order: 2 }],
  }]);
  history.replaceState(null, '', '/');
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
  vi.stubEnv('VITE_INTERNAL_TEST', '1');
});

afterEach(() => {
  cleanup();
  _resetForTest();
  _setDictLoaderForTest(null);
  vi.unstubAllEnvs();
});

// 測試同步更新：2026-10-20 站長取消內測名單與寫入守門
describe('App 內測模式（只剩浮水印）', () => {
  it('訪客直接看到站內功能，不再出現內測頁', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('HOME_ROUTE')).toBeTruthy(), { timeout: 5000 });
  });

  it('內測模式顯示版本角標；正式上線不顯示角標', async () => {
    const first = render(<App />);
    await waitFor(() => expect(screen.getByText('HOME_ROUTE')).toBeTruthy(), { timeout: 5000 });
    expect(first.container.querySelector('.internal-test-badge')).not.toBeNull();
    first.unmount();

    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_PUBLIC_LAUNCH', '1');
    const second = render(<App />);
    await waitFor(() => expect(screen.getByText('HOME_ROUTE')).toBeTruthy(), { timeout: 5000 });
    expect(second.container.querySelector('.internal-test-badge')).toBeNull();
  });
});

