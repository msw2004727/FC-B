import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// LINE 授權回跳接手登入與完整登出（照 A `LineAuth.init` 的 _cleanUrl 與 `LineAuth.logout`）。

const h = vi.hoisted(() => {
  const calls: string[] = [];
  const liff = {
    init: vi.fn(async () => { calls.push('liff.init'); }),
    isLoggedIn: vi.fn(() => false),
    isInClient: vi.fn(() => false),
    login: vi.fn(),
    logout: vi.fn(() => { calls.push('liff.logout'); }),
    getAccessToken: vi.fn(() => 'line-access-token'),
    getProfile: vi.fn(async () => ({ displayName: '王大明', pictureUrl: null })),
  };
  return {
    calls,
    liff,
    callFn: vi.fn(async () => ({ customToken: 'custom-token' })),
    fbSignOut: vi.fn(async () => { calls.push('firebase.signOut'); }),
    signInWithCustomToken: vi.fn(async () => ({
      user: { uid: 'U-login', displayName: null, photoURL: null },
    })),
  };
});

vi.mock('@line/liff', () => ({ default: h.liff }));
vi.mock('./callables', () => ({ callFn: h.callFn }));
vi.mock('./firebase', () => ({
  getFirebase: vi.fn(async () => ({ auth: { name: 'fake-auth', currentUser: null } })),
  shouldUseEmulator: () => false,
}));
vi.mock('firebase/auth', () => ({
  signOut: h.fbSignOut,
  signInWithCustomToken: h.signInWithCustomToken,
  onAuthStateChanged: vi.fn(() => () => undefined),
}));

type AuthModule = typeof import('./auth');
let auth: AuthModule;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_LIFF_ID', 'test-liff-id');
  h.calls.length = 0;
  h.liff.init.mockClear();
  h.liff.login.mockClear();
  h.liff.logout.mockClear();
  h.liff.isLoggedIn.mockReset().mockReturnValue(false);
  h.callFn.mockClear();
  h.fbSignOut.mockReset().mockImplementation(async () => { h.calls.push('firebase.signOut'); });
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  auth = await import('./auth');
});

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

describe('LINE 授權回跳接手登入', () => {
  it('LIFF 已處理回跳 code：完成登入並清掉網址上的 OAuth 參數、保留其他查詢', async () => {
    history.replaceState(null, '', '/events/e1?code=c&state=s&liffClientId=x&liffRedirectUri=r&tab=2');
    h.liff.isLoggedIn.mockReturnValue(true);

    const user = await auth.signIn({ interactive: false });

    expect(user.uid).toBe('U-login');
    expect(h.callFn).toHaveBeenCalledWith('createCustomToken', { accessToken: 'line-access-token' });
    expect(location.pathname + location.search).toBe('/events/e1?tab=2');
    expect(h.liff.login).not.toHaveBeenCalled();
  });

  it('回跳後 LIFF 仍未登入：不再導向 LINE（避免無限重導），拋出不顯示錯誤的重導向例外', async () => {
    history.replaceState(null, '', '/?code=c&state=s&liffClientId=x');
    h.liff.isLoggedIn.mockReturnValue(false);

    const err = await auth.signIn({ interactive: false }).catch((e: unknown) => e);

    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.liff.login).not.toHaveBeenCalled();
    expect(h.callFn).not.toHaveBeenCalled();
    expect(location.search).toBe('');
  });

  it('liff.init 失敗：也清掉回跳參數；再登入不受舊參數影響（審查 P2-1）', async () => {
    history.replaceState(null, '', '/?code=old&state=s&liffClientId=x&tab=2');
    h.liff.init.mockRejectedValueOnce(new Error('invalid code'));

    await expect(auth.signIn({ interactive: false })).rejects.toThrow('invalid code');
    expect(location.search).toBe('?tab=2');

    h.liff.isLoggedIn.mockReturnValue(true);
    const user = await auth.signIn();
    expect(user.uid).toBe('U-login');
    expect(location.search).toBe('?tab=2');
  });

  it('liff.init 卡住：8 秒逾時拋錯並清參數（照 A _withTimeout，審查 P2-1）', async () => {
    vi.useFakeTimers();
    try {
      history.replaceState(null, '', '/?code=c&state=s&liffClientId=x');
      h.liff.init.mockImplementationOnce(() => new Promise<void>(() => undefined));
      const result = auth.signIn({ interactive: false }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(auth.LIFF_STEP_TIMEOUT_MS - 1);
      expect(location.search).not.toBe('');
      await vi.advanceTimersByTimeAsync(1);
      const err = await result;
      expect(String((err as Error).message)).toContain('逾時');
      expect(location.search).toBe('');
      expect(h.callFn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('使用者按登入（interactive 預設）仍照舊導向 LINE', async () => {
    h.liff.isLoggedIn.mockReturnValue(false);
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.liff.login).toHaveBeenCalledOnce();
  });
});

describe('signOutAndReload（照 A LineAuth.logout）', () => {
  function seedAccountState(): void {
    localStorage.setItem('fcb:signed-in', '1');
    localStorage.setItem('LIFF_STORE:test', 'token');
    localStorage.setItem('shub_c_users', '[]');
    localStorage.setItem('theme', 'dark');
    sessionStorage.setItem('_lineLoginRetryCount', '1');
  }

  it('依序：Firebase 登出 → 清本機帳號資料與登入旗標 → LIFF 登出 → 重新整理（審查 P3-3）', async () => {
    seedAccountState();
    h.liff.isLoggedIn.mockReturnValue(true);
    h.liff.init.mockImplementationOnce(async () => {
      // 進到 LIFF 步驟時，本機帳號資料與旗標已經清掉
      h.calls.push(localStorage.getItem('fcb:signed-in') === null ? 'liff.init(已清)' : 'liff.init(未清)');
    });
    const reload = vi.fn(() => { h.calls.push('reload'); });

    await auth.signOutAndReload(reload);

    // 本次沒 init 過 LIFF：先 init 再判斷是否登入
    expect(h.calls).toEqual(['firebase.signOut', 'liff.init(已清)', 'liff.logout', 'reload']);
    expect(localStorage.getItem('fcb:signed-in')).toBeNull();
    expect(localStorage.getItem('LIFF_STORE:test')).toBeNull();
    expect(localStorage.getItem('shub_c_users')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(sessionStorage.getItem('_lineLoginRetryCount')).toBeNull();
  });

  it('LIFF 沒有登入：不呼叫 liff.logout，其餘照做', async () => {
    seedAccountState();
    const reload = vi.fn();
    await auth.signOutAndReload(reload);
    expect(h.liff.logout).not.toHaveBeenCalled();
    expect(localStorage.getItem('fcb:signed-in')).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('本次已 init 過 LIFF（剛登入過）：登出不重複 init', async () => {
    h.liff.isLoggedIn.mockReturnValue(true);
    await auth.signIn();
    h.calls.length = 0;
    await auth.signOutAndReload(vi.fn());
    expect(h.calls).toEqual(['firebase.signOut', 'liff.logout']);
  });

  it('Firebase 登出失敗：LIFF 登出、清理與重新整理照做', async () => {
    seedAccountState();
    h.liff.isLoggedIn.mockReturnValue(true);
    h.fbSignOut.mockRejectedValue(new Error('network'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.fn();
    try {
      await auth.signOutAndReload(reload);
    } finally {
      error.mockRestore();
    }
    expect(h.liff.logout).toHaveBeenCalledOnce();
    expect(localStorage.getItem('fcb:signed-in')).toBeNull();
    expect(localStorage.getItem('LIFF_STORE:test')).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('LIFF 卡住：最多等 8 秒就重新整理，本機資料早已清掉（審查 P3-3）', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      seedAccountState();
      h.liff.init.mockImplementationOnce(() => new Promise<void>(() => undefined));
      const reload = vi.fn();
      const done = auth.signOutAndReload(reload);
      await vi.advanceTimersByTimeAsync(1);
      expect(localStorage.getItem('fcb:signed-in')).toBeNull();
      expect(localStorage.getItem('shub_c_users')).toBeNull();
      expect(reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(auth.LIFF_STEP_TIMEOUT_MS);
      await done;
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('LIFF 初始化失敗：清理與重新整理照做', async () => {
    seedAccountState();
    h.liff.init.mockRejectedValueOnce(new Error('liff init failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reload = vi.fn();
    try {
      await auth.signOutAndReload(reload);
    } finally {
      warn.mockRestore();
    }
    expect(h.fbSignOut).toHaveBeenCalledOnce();
    expect(localStorage.getItem('fcb:signed-in')).toBeNull();
    expect(localStorage.getItem('shub_c_users')).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });
});
