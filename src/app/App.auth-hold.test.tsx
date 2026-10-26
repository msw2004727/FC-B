import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import type { AuthUser } from '@/data/auth';
import {
  _resetFirebaseForTest,
  armFirebaseAuthHold,
  releaseFirebaseAuthHold,
  whenFirebaseAuthAllowed,
} from '@/data/firebase';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { App } from './App';

// T-041：開在首頁時，App 先不還原登入狀態（不呼叫 onAuthChanged），等首頁公開讀取處理完再做；
// 人不在首頁（含分享連結導向）則立刻放行。

const auth = vi.hoisted(() => ({
  getCurrentUser: vi.fn<() => Promise<AuthUser | null>>(),
  onAuthChanged: vi.fn<(callback: (user: AuthUser | null) => void) => () => void>(),
  stop: vi.fn(),
}));

vi.mock('@/data/auth', () => ({
  signIn: vi.fn(),
  getCurrentUser: auth.getCurrentUser,
  onAuthChanged: auth.onAuthChanged,
}));

function registerHomeAndProfile(): void {
  registerFeatures([{
    id: 'hold-test',
    status: 'enabled',
    routes: [
      { path: '/', titleKey: 'nav.home', load: async () => ({ default: () => null }) },
      { path: '/profile', titleKey: 'nav.profile', load: async () => ({ default: () => null }) },
    ],
    nav: [{ path: '/', labelKey: 'nav.home', icon: 'home', order: 2 }],
  }]);
}

beforeEach(async () => {
  vi.resetAllMocks();
  _resetFirebaseForTest();
  auth.getCurrentUser.mockResolvedValue(null);
  auth.onAuthChanged.mockReturnValue(auth.stop);
  _resetForTest();
  registerHomeAndProfile();
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  _resetForTest();
  _resetFirebaseForTest();
  _setDictLoaderForTest(null);
});

describe('App 還原登入狀態的時機（Auth 暫緩）', () => {
  it('沒有暫緩：掛載後就開始還原登入狀態（行為不變）', async () => {
    history.replaceState(null, '', '/');
    render(<App />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalledOnce());
  });

  it('暫緩中：不呼叫 onAuthChanged；放行後才呼叫', async () => {
    history.replaceState(null, '', '/');
    armFirebaseAuthHold({ capMs: 60_000 });
    render(<App />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(auth.onAuthChanged).not.toHaveBeenCalled();

    releaseFirebaseAuthHold();
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalledOnce());
  });

  it('暫緩中但人不在首頁：立刻放行並還原登入狀態', async () => {
    history.replaceState(null, '', '/profile');
    armFirebaseAuthHold({ capMs: 60_000 });
    render(<App />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalledOnce());
    let allowed = false;
    void whenFirebaseAuthAllowed().then(() => { allowed = true; });
    await waitFor(() => expect(allowed).toBe(true));
  });

  it('卸載時尚未放行：不會在卸載後才呼叫 onAuthChanged', async () => {
    history.replaceState(null, '', '/');
    armFirebaseAuthHold({ capMs: 60_000 });
    const view = render(<App />);
    view.unmount();
    releaseFirebaseAuthHold();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(auth.onAuthChanged).not.toHaveBeenCalled();
  });
});
