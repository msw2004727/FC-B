import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { AuthUser } from '@/data/auth';
import { emit } from '@/core/events';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import { _setDictLoaderForTest, setLocale, t } from '@/i18n/i18n';
import { App } from './App';

const auth = vi.hoisted(() => ({
  signIn: vi.fn<() => Promise<AuthUser>>(),
  getCurrentUser: vi.fn<() => Promise<AuthUser | null>>(),
  onAuthChanged: vi.fn<(callback: (user: AuthUser | null) => void) => () => void>(),
  stop: vi.fn(),
}));

vi.mock('@/data/auth', () => ({
  signIn: auth.signIn,
  getCurrentUser: auth.getCurrentUser,
  onAuthChanged: auth.onAuthChanged,
}));

beforeEach(async () => {
  vi.resetAllMocks();
  auth.getCurrentUser.mockResolvedValue(null);
  auth.onAuthChanged.mockReturnValue(auth.stop);
  _resetForTest();
  registerFeatures([{
    id: 'auth-test-home',
    status: 'enabled',
    routes: [{ path: '/', titleKey: 'nav.home', load: async () => ({ default: () => null }) }],
    nav: [{ path: '/', labelKey: 'nav.home', icon: 'home', order: 2 }],
  }]);
  history.replaceState(null, '', '/');
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  _resetForTest();
  _setDictLoaderForTest(null);
});

describe('App authentication', () => {
  it('calls lazy signIn once, shows pending state and replaces login with Avatar', async () => {
    let resolveLogin: ((user: AuthUser) => void) | undefined;
    auth.signIn.mockImplementation(() => new Promise((resolve) => {
      resolveLogin = resolve;
    }));
    render(<App />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalledOnce());

    const button = screen.getByRole('button', {
      name: t('ui.topBar.login'),
    }) as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());
    expect(button.disabled).toBe(true);
    button.click();
    expect(auth.signIn).toHaveBeenCalledOnce();

    await act(async () => {
      if (!resolveLogin) throw new Error('Login did not start');
      resolveLogin({ uid: 'u1', displayName: 'Alex', pictureUrl: null });
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: t('ui.topBar.login') })).toBeNull();
      expect(screen.getByRole('link', { name: t('nav.profile') })).toBeTruthy();
    });
  });

  it('reacts to auth events and ignores stale user reads after sign-out', async () => {
    let resolveUser: ((user: AuthUser | null) => void) | undefined;
    auth.getCurrentUser.mockImplementation(() => new Promise((resolve) => {
      resolveUser = resolve;
    }));
    const view = render(<App />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalledOnce());
    await act(() => emit('auth:changed', { uid: 'u1' }));
    await waitFor(() => expect(auth.getCurrentUser).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: t('ui.topBar.login') })).toBeNull();

    await act(() => emit('auth:changed', { uid: null }));
    await act(async () => {
      resolveUser?.({ uid: 'u1', displayName: 'Stale', pictureUrl: null });
    });
    expect(screen.getByRole('button', { name: t('ui.topBar.login') })).toBeTruthy();
    view.unmount();
    expect(auth.stop).toHaveBeenCalledOnce();
  });

  it('handles login failure and permits retry', async () => {
    auth.signIn.mockRejectedValue(new Error('private provider details'));
    render(<App />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: t('ui.topBar.login') }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(t('ui.shell.loginError'));
    });
    const button = screen.getByRole('button', {
      name: t('ui.topBar.login'),
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(document.body.textContent).not.toContain('private provider details');
    fireEvent.click(button);
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledTimes(2));
  });
});
