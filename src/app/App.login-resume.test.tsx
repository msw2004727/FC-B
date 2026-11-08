import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { AuthUser } from '@/data/auth';
import { _resetFirebaseForTest, armFirebaseAuthHold } from '@/data/firebase';
import { _resetAutoLoginSuppressForTest } from '@/data/login-redirect';
import { emit } from '@/core/events';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import { _setDictLoaderForTest, setLocale, t } from '@/i18n/i18n';
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
  sessionStorage.clear();
  _resetAutoLoginSuppressForTest();
  localStorage.clear();
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

  it('T-093：開頁 inline 在 Mini App 消掉 liff.state 而設旗標 → 落在活動頁並接手登入', async () => {
    history.replaceState(null, '', '/events/abc');
    (window as Window & { __fcbLiffStateConsumed?: boolean }).__fcbLiffStateConsumed = true;
    try {
      authRestoresAs(null);
      auth.signIn.mockResolvedValue(LOGIN_USER);
      render(<App />);
      await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());
      expect(auth.signIn).toHaveBeenCalledWith({ interactive: false });
    } finally {
      delete (window as Window & { __fcbLiffStateConsumed?: boolean }).__fcbLiffStateConsumed;
    }
  });

  it('T-093：同一網址沒有旗標（外部瀏覽器）→ 不接手', async () => {
    history.replaceState(null, '', '/events/abc');
    authRestoresAs(null);
    render(<App />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalledOnce());
    await pause(40);
    expect(auth.signIn).not.toHaveBeenCalled();
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

  // 測試同步更新：ddc5ad9（審查 P3-4）原本在「進行中」也清參數；Grok 交叉審查 P1 指出進行中的 signIn
  // 可能還沒讀到 code，清掉會讓它再導向 LINE，改為只有已登入才清。
  it('開頁接手時已有登入進行中：不接手，也不清回跳參數（留給進行中的 liff.init 讀）', async () => {
    history.replaceState(null, '', '/events/e1?code=c&state=s&liffClientId=x&tab=2');
    authRestoresAs(null);
    render(<App loginPending />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalledOnce());
    await pause(40);
    expect(location.search).toBe('?code=c&state=s&liffClientId=x&tab=2');
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('已登入且網址只有 liff.state：清掉，之後不再進接手（Grok 交叉審查 P2）', async () => {
    history.replaceState(null, '', '/?liff.state=%2Fevents%2Fabc&tab=2');
    authRestoresAs('existing-user');
    render(<App />);
    await waitFor(() => expect(location.search).toBe('?tab=2'));
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('分享連結 /?event=…＋回跳參數：改寫後的網址保留 code，接手時仍讀得到（Grok 交叉審查 P2）', async () => {
    history.replaceState(null, '', '/?event=abc&code=c&state=s&liffClientId=x');
    authRestoresAs(null);
    let searchAtSignIn = '';
    auth.signIn.mockImplementation(async () => {
      searchAtSignIn = location.search;
      return LOGIN_USER;
    });
    render(<App />);
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());
    expect(location.pathname).toBe('/events/abc');
    expect(searchAtSignIn).toContain('code=c');
    expect(searchAtSignIn).toContain('liffClientId=x');
  });

  it('網址帶回跳參數時的 auth:login-request 走接手模式（Grok 交叉審查 P1）', async () => {
    history.replaceState(null, '', '/events/e1?code=c&state=s&liffClientId=x');
    // Auth 還原延遲：先發登入要求
    auth.onAuthChanged.mockReturnValue(() => undefined);
    auth.signIn.mockImplementation(() => new Promise<AuthUser>(() => undefined));
    render(<App />);
    await pause(20);
    await act(async () => {
      emit('auth:login-request', {});
    });
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());
    expect(auth.signIn).toHaveBeenCalledWith({ interactive: false });
  });

  it('按登入後、liff.init 讀網址前 Auth 還原出已登入：不清 code，留給進行中的 signIn（Grok 第二輪 P2）', async () => {
    history.replaceState(null, '', '/events/e1?code=c&state=s&liffClientId=x');
    auth.onAuthChanged.mockReturnValue(() => undefined); // Auth 還原由測試手動發
    auth.signIn.mockImplementation(() => new Promise<AuthUser>(() => undefined));
    render(<App />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: t('ui.topBar.login') }));
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());

    await act(async () => {
      emit('auth:changed', { uid: 'existing-user' });
    });
    await pause(40);
    expect(location.search).toBe('?code=c&state=s&liffClientId=x');
    expect(auth.signIn).toHaveBeenCalledOnce();
  });

  it('取消授權後這次開頁：頁面自動要求登入（auto）略過，使用者自己按的照常（Grok 第二輪 P1）', async () => {
    history.replaceState(null, '', '/events/e1?error=access_denied&state=s&liffClientId=x');
    authRestoresAs(null);
    auth.signIn.mockResolvedValue(LOGIN_USER);
    render(<App />);
    await waitFor(() => expect(location.search).toBe(''));
    await act(async () => {
      emit('auth:login-request', { auto: true });
    });
    await pause(40);
    expect(auth.signIn).not.toHaveBeenCalled();
    // 旗標開頁就讀掉，不留到下一次開頁
    expect(sessionStorage.getItem('fcb:suppress-auto-login')).toBeNull();

    await act(async () => {
      emit('auth:login-request', {});
    });
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());
  });

  it('剛登出重整（旗標 logout）：這次開頁的自動要求登入略過', async () => {
    sessionStorage.setItem('fcb:suppress-auto-login', 'logout');
    history.replaceState(null, '', '/events/e1');
    authRestoresAs(null);
    render(<App />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalledOnce());
    await act(async () => {
      emit('auth:login-request', { auto: true });
    });
    await pause(40);
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('沒有旗標：頁面自動要求登入照常（下一次開頁恢復）', async () => {
    history.replaceState(null, '', '/events/e1');
    authRestoresAs(null);
    auth.signIn.mockResolvedValue(LOGIN_USER);
    render(<App />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalledOnce());
    await act(async () => {
      emit('auth:login-request', { auto: true });
    });
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());
    expect(auth.signIn).toHaveBeenCalledWith();
  });

  it('本次接手失敗過：之後的自動要求登入略過（Grok 第二輪 P1）', async () => {
    history.replaceState(null, '', '/?code=c&state=s&liffClientId=x');
    authRestoresAs(null);
    auth.signIn.mockRejectedValue(Object.assign(new Error('not logged in'), { isRedirecting: true }));
    render(<App />);
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());
    await pause(40);
    history.replaceState(null, '', '/'); // 真的 signIn 會清參數
    await act(async () => {
      emit('auth:login-request', { auto: true });
    });
    await pause(40);
    expect(auth.signIn).toHaveBeenCalledOnce();
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
