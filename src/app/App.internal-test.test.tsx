import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/preact';
import type { AuthUser } from '@/data/auth';
import { emit } from '@/core/events';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import { _setDictLoaderForTest, setLocale, t } from '@/i18n/i18n';
import { sha256Hex } from '@/data/internal-test';
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
  vi.stubEnv('VITE_INTERNAL_TEST_UID_HASHES', await sha256Hex('U_tester'));
});

afterEach(() => {
  cleanup();
  _resetForTest();
  _setDictLoaderForTest(null);
  vi.unstubAllEnvs();
});

describe('App 內測閘門', () => {
  it('訪客只看到內測頁與登入鈕，不載入功能', async () => {
    const { container } = render(<App />);
    expect(await screen.findByText(t('internalTest.title'))).toBeTruthy();
    expect(screen.getByText(t('internalTest.body'))).toBeTruthy();
    expect(container.querySelector('.internal-test-gate button')?.textContent)
      .toContain(t('internalTest.login'));
    expect(screen.queryByText('HOME_ROUTE')).toBeNull();
  });

  it('不在名單的帳號看到「不在內測名單」，不載入功能', async () => {
    render(<App />);
    await act(async () => { emit('auth:changed', { uid: 'U_other' }); });
    expect(await screen.findByText(t('internalTest.notInvited'))).toBeTruthy();
    expect(screen.queryByText('HOME_ROUTE')).toBeNull();
  });

  it('白名單帳號正常進入', async () => {
    render(<App />);
    await act(async () => { emit('auth:changed', { uid: 'U_tester' }); });
    await waitFor(() => expect(screen.getByText('HOME_ROUTE')).toBeTruthy());
    expect(screen.queryByText(t('internalTest.title'))).toBeNull();
  });

  it('內測模式顯示版本角標；正式上線不顯示角標也不擋', async () => {
    const first = render(<App />);
    await screen.findByText(t('internalTest.title'));
    expect(first.container.querySelector('.internal-test-badge')).not.toBeNull();
    first.unmount();

    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_PUBLIC_LAUNCH', '1');
    const second = render(<App />);
    await waitFor(() => expect(screen.getByText('HOME_ROUTE')).toBeTruthy());
    expect(second.container.querySelector('.internal-test-badge')).toBeNull();
  });
});

