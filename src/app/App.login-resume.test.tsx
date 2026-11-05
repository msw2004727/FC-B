import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import type { AuthUser } from '@/data/auth';
import { _resetFirebaseForTest, armFirebaseAuthHold } from '@/data/firebase';
import { emit } from '@/core/events';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { App } from './App';

// 照 A 開頁 liff.init 的效果：從 LINE 授權回來（網址帶 code＋liffClientId 或 liff.state）時，
// 登入狀態確認後自動接手登入一次；一般開頁不載 LIFF、不呼叫 signIn。

const auth = vi.hoisted(() => ({
  signIn: vi.fn<(options?: { interactive?: boolean }) => Promise<AuthUser>>(),
  getCurrentUser: vi.fn<() => Promise<AuthUser | null>>(),
  onAuthChanged: vi.fn<(callback: (user: AuthUser | null) => void) => () => void>(),
}));

vi.mock('@/data/auth', () => ({
  signIn: auth.signIn,
  getCurrentUser: auth.getCurrentUser,
  onAuthChanged: auth.onAuthChanged,
  acknowledgeMobileLoginHint: vi.fn(),
  isLoginRedirectingError: (err: unknown) =>
    Boolean(err && typeof err === 'object' && (err as { isRedirecting?: unknown }).isRedirecting === true),
}));

const LOGIN_USER: AuthUser = { uid: 'login-user', displayName: null, pictureUrl: null };

/** 模擬 Auth 還原結果：onAuthChanged 註冊後發出 auth:changed。 */
function authRestoresAs(uid: string | null): void {
  auth.onAuthChanged.mockImplementation(() => {
    queueMicrotask(() => emit('auth:changed', { uid }));
    return () => undefined;
  });
}

async function pause(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

beforeEach(async () => {
  vi.resetAllMocks();
  _resetFirebaseForTest();
  auth.getCurrentUser.mockResolvedValue(null);
  _resetForTest();
  registerFeatures([{
    id: 'resume-test',
    status: 'enabled',
    routes: [
      { path: '/', titleKey: 'nav.home', load: async () => ({ default: () => null }) },
      { path: '/events/:id', titleKey: 'nav.home', load: async () => ({ default: () => null }) },
    ],
    nav: [{ path: '/', labelKey: 'nav.home', icon: 'home', order: 2 }],
  }]);
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  _resetForTest();
  _resetFirebaseForTest();
  _setDictLoaderForTest(null);
  history.replaceState(null, '', '/');
});

describe('LINE 授權回跳：開頁自動接手登入', () => {
  it('網址帶 code＋liffClientId、Auth 還原為未登入 → 以非互動模式呼叫 signIn 一次', async () => {
    history.replaceState(null, '', '/?code=c&state=s&liffClientId=x');
    authRestoresAs(null);
    auth.signIn.mockResolvedValue(LOGIN_USER);
    render(<App />);
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());
    expect(auth.signIn).toHaveBeenCalledWith({ interactive: false });
  });

  it('首頁有 Auth 暫緩（T-041）時，回跳也立刻放行並接手，不等公開讀取', async () => {
    history.replaceState(null, '', '/?code=c&state=s&liffClientId=x');
    armFirebaseAuthHold({ capMs: 60_000, afterCoreMs: 60_000 });
    authRestoresAs(null);
    auth.signIn.mockResolvedValue(LOGIN_USER);
    render(<App />);
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce(), { timeout: 3000 });
  });

  it('一般開頁（沒有回跳參數）：不呼叫 signIn', async () => {
    history.replaceState(null, '', '/?event=abc');
    authRestoresAs(null);
    render(<App />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalledOnce());
    await pause(40);
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('已是登入狀態：不重登，只清掉網址上的 OAuth 參數', async () => {
    history.replaceState(null, '', '/events/e1?code=c&state=s&liffClientId=x&tab=2');
    authRestoresAs('existing-user');
    render(<App />);
    await waitFor(() => expect(location.search).toBe('?tab=2'));
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('回跳後 LIFF 仍未登入（重導向例外）：不顯示登入錯誤', async () => {
    history.replaceState(null, '', '/?code=c&state=s&liffClientId=x');
    authRestoresAs(null);
    auth.signIn.mockRejectedValue(Object.assign(new Error('not logged in'), { isRedirecting: true }));
    const view = render(<App />);
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());
    await pause(40);
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
  });

  it('在 LINE 授權頁取消（error＋liffClientId）：不載 LIFF、不呼叫 signIn，直接清參數（審查 P3-1）', async () => {
    history.replaceState(null, '', '/events/e1?error=access_denied&error_description=x&state=s&liffClientId=x&tab=2');
    authRestoresAs(null);
    render(<App />);
    await waitFor(() => expect(location.search).toBe('?tab=2'));
    await pause(40);
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('開頁接手時已有外部登入進行中：不接手，但清掉回跳參數（審查 P3-4）', async () => {
    history.replaceState(null, '', '/events/e1?code=c&state=s&liffClientId=x&tab=2');
    authRestoresAs(null);
    render(<App loginPending />);
    await waitFor(() => expect(location.search).toBe('?tab=2'));
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('接手登入進行中再按登入：不重複觸發', async () => {
    history.replaceState(null, '', '/?code=c&state=s&liffClientId=x');
    authRestoresAs(null);
    let finish: (user: AuthUser) => void = () => undefined;
    auth.signIn.mockImplementation(() => new Promise<AuthUser>((resolve) => { finish = resolve; }));
    render(<App />);
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());

    await act(async () => {
      emit('auth:login-request', {});
    });
    expect(auth.signIn).toHaveBeenCalledOnce();

    await act(async () => {
      finish(LOGIN_USER);
    });
  });
});
