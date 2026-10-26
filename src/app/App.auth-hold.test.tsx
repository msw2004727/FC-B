import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import type { AuthUser } from '@/data/auth';
import {
  _resetFirebaseForTest,
  armFirebaseAuthHold,
  releaseFirebaseAuthHold,
  whenFirebaseAuthAllowed,
} from '@/data/firebase';
import { emit } from '@/core/events';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { App } from './App';

// T-041：開在首頁時，App 先不還原登入狀態（不呼叫 onAuthChanged），等首頁公開讀取處理完再做；
// 人不在首頁（含分享連結導向）則立刻放行。
// T-052：暫緩中按「登入」也要立刻放行（登入流程的 callable 要等 getFirebase()，而 getFirebase() 要等暫緩放行）。

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
  acknowledgeMobileLoginHint: vi.fn(),
  isLoginRedirectingError: () => false,
}));

const LOGIN_USER: AuthUser = { uid: 'login-user', displayName: null, pictureUrl: null };

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

describe('暫緩中按登入（T-052）：立即放行，不必等公開讀取或 3～10 秒上限', () => {
  async function pause(ms: number): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  /** 讓 App 的 auth:login-request 監聽已掛上（effect 執行後）。 */
  async function requestLogin(): Promise<void> {
    await act(async () => {
      emit('auth:login-request', {});
    });
  }

  it('暫緩中按登入：signIn 不被暫緩卡住（真實的 signIn 要等 getFirebase()，而它要等暫緩放行）', async () => {
    history.replaceState(null, '', '/');
    armFirebaseAuthHold({ capMs: 60_000, afterCoreMs: 60_000 });
    let signedIn = false;
    auth.signIn.mockImplementation(async () => {
      await whenFirebaseAuthAllowed(); // 模擬：callable 要等 getFirebase()
      signedIn = true;
      return LOGIN_USER;
    });
    render(<App />);
    await pause(40);
    // 沒按登入之前照舊暫緩
    expect(auth.onAuthChanged).not.toHaveBeenCalled();
    expect(auth.signIn).not.toHaveBeenCalled();

    await requestLogin();

    await waitFor(() => expect(signedIn).toBe(true), { timeout: 3000 });
    expect(auth.signIn).toHaveBeenCalledOnce();
    // 暫緩已放行：還原登入狀態的訂閱也跟著開始
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalledOnce());
  });

  it('走外部 onLogin 的登入路徑也一樣立即放行', async () => {
    history.replaceState(null, '', '/');
    armFirebaseAuthHold({ capMs: 60_000, afterCoreMs: 60_000 });
    let finished = false;
    const onLogin = vi.fn(async () => {
      await whenFirebaseAuthAllowed();
      finished = true;
    });
    render(<App onLogin={onLogin} />);
    await pause(40);
    expect(onLogin).not.toHaveBeenCalled();

    await requestLogin();

    await waitFor(() => expect(finished).toBe(true), { timeout: 3000 });
    expect(onLogin).toHaveBeenCalledOnce();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('沒有暫緩時按登入：照常登入一次（放行是冪等的空操作）', async () => {
    history.replaceState(null, '', '/');
    auth.signIn.mockResolvedValue(LOGIN_USER);
    render(<App />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalledOnce());

    await requestLogin();

    await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());
    // 放行後再放行仍是空操作，不影響之後的 whenFirebaseAuthAllowed()
    releaseFirebaseAuthHold();
    await expect(whenFirebaseAuthAllowed()).resolves.toBeUndefined();
  });
});

