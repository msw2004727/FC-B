import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// LINE 授權回跳接手登入與完整登出（照 A `LineAuth.init` 的 _cleanUrl 與 `LineAuth.logout`）。

const LIFF_KEY = 'LIFF_STORE:test-liff-id:accessToken';

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
    emulator: false,
    currentUser: null as null | { uid: string; getIdTokenResult: () => Promise<{ claims: Record<string, unknown> }> },
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
  getFirebase: vi.fn(async () => ({ auth: { name: 'fake-auth', currentUser: h.currentUser } })),
  shouldUseEmulator: () => h.emulator,
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
  h.emulator = false;
  h.currentUser = null;
  h.liff.init.mockReset().mockImplementation(async () => { h.calls.push('liff.init'); });
  h.liff.login.mockClear();
  h.liff.logout.mockReset().mockImplementation(() => { h.calls.push('liff.logout'); });
  h.liff.isLoggedIn.mockReset().mockReturnValue(false);
  h.callFn.mockReset().mockResolvedValue({ customToken: 'custom-token' });
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

  it('liff.state 也會被清掉（Grok 交叉審查 P2）', async () => {
    history.replaceState(null, '', '/?liff.state=%2Fevents%2Fabc&tab=2');
    h.liff.isLoggedIn.mockReturnValue(true);
    await auth.signIn({ interactive: false });
    expect(location.search).toBe('?tab=2');
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

  it('liff.init 之前就失敗（emulator）：先清參數（Grok 交叉審查 P2）', async () => {
    history.replaceState(null, '', '/?code=c&state=s&liffClientId=x&tab=2');
    h.emulator = true;
    await expect(auth.signIn({ interactive: false })).rejects.toThrow('emulator');
    expect(location.search).toBe('?tab=2');
  });

  it('liff.init 之前就失敗（缺 VITE_LIFF_ID）：先清參數（Grok 交叉審查 P2）', async () => {
    history.replaceState(null, '', '/?code=c&state=s&liffClientId=x&tab=2');
    vi.stubEnv('VITE_LIFF_ID', '');
    await expect(auth.signIn({ interactive: false })).rejects.toThrow('VITE_LIFF_ID');
    expect(location.search).toBe('?tab=2');
  });

  it('liff.init 之前就失敗（SDK 載入失敗）：先清參數（Grok 交叉審查 P2）', async () => {
    history.replaceState(null, '', '/?code=c&state=s&liffClientId=x&tab=2');
    vi.resetModules();
    vi.doMock('@line/liff', () => {
      throw new Error('chunk load failed');
    });
    try {
      const fresh = await import('./auth');
      await expect(fresh.signIn({ interactive: false })).rejects.toThrow();
      expect(location.search).toBe('?tab=2');
    } finally {
      // 換回假 SDK，不讓後面的案例載到真的 LIFF
      vi.doMock('@line/liff', () => ({ default: h.liff }));
    }
  });

  it('createCustomToken 卡住：15 秒逾時拋錯，不無限等（Grok 交叉審查 P3）', async () => {
    vi.useFakeTimers();
    try {
      h.liff.isLoggedIn.mockReturnValue(true);
      h.callFn.mockImplementationOnce(() => new Promise(() => undefined));
      const result = auth.signIn().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(auth.LOGIN_TOKEN_TIMEOUT_MS - 1);
      expect(h.signInWithCustomToken).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const err = await result;
      expect(String((err as Error).message)).toContain('逾時');
      expect(auth.isLoginRedirectingError(err)).toBe(false);
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
    localStorage.setItem(LIFF_KEY, 'token');
    localStorage.setItem('shub_c_users', '[]');
    localStorage.setItem('theme', 'dark');
    sessionStorage.setItem('_lineLoginRetryCount', '1');
  }

  /** 假 LIFF 的登入狀態跟真 SDK 一樣看本機儲存；logout 會刪掉它。 */
  function liffFollowsStorage(): void {
    h.liff.isLoggedIn.mockImplementation(() => localStorage.getItem(LIFF_KEY) !== null);
    h.liff.logout.mockImplementation(() => {
      h.calls.push('liff.logout');
      localStorage.removeItem(LIFF_KEY);
    });
  }

  it('依序：Firebase 登出 → LIFF 登出 → 清本機帳號資料與登入旗標 → 重新整理（Grok 交叉審查 P2）', async () => {
    seedAccountState();
    liffFollowsStorage();
    const reload = vi.fn(() => { h.calls.push('reload'); });

    await expect(auth.signOutAndReload(reload)).resolves.toBe(true);

    // 本次沒 init 過 LIFF：先 init 再判斷；LIFF* 還沒被刪，認得出登入，所以真的會 liff.logout
    expect(h.calls).toEqual(['firebase.signOut', 'liff.init', 'liff.logout', 'reload']);
    expect(localStorage.getItem('fcb:signed-in')).toBeNull();
    expect(localStorage.getItem(LIFF_KEY)).toBeNull();
    expect(localStorage.getItem('shub_c_users')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(sessionStorage.getItem('_lineLoginRetryCount')).toBeNull();
  });

  it('LIFF 沒有登入：不呼叫 liff.logout，其餘照做', async () => {
    localStorage.setItem('fcb:signed-in', '1');
    liffFollowsStorage();
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

  it('Firebase 登出失敗：不清旗標、不碰 LIFF、不重整，回傳 false 讓使用者重試（Grok 交叉審查 P2）', async () => {
    seedAccountState();
    liffFollowsStorage();
    h.fbSignOut.mockRejectedValue(new Error('network'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.fn();
    try {
      await expect(auth.signOutAndReload(reload)).resolves.toBe(false);
    } finally {
      error.mockRestore();
    }
    expect(localStorage.getItem('fcb:signed-in')).toBe('1');
    expect(localStorage.getItem(LIFF_KEY)).toBe('token');
    expect(h.liff.init).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('LIFF 卡住：最多等 8 秒，重整前照樣刪掉 LIFF* 與帳號資料', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      seedAccountState();
      h.liff.init.mockImplementationOnce(() => new Promise<void>(() => undefined));
      const reload = vi.fn();
      const done = auth.signOutAndReload(reload);
      await vi.advanceTimersByTimeAsync(auth.LIFF_STEP_TIMEOUT_MS - 1);
      expect(reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(localStorage.getItem(LIFF_KEY)).toBeNull();
      expect(localStorage.getItem('fcb:signed-in')).toBeNull();
      expect(localStorage.getItem('shub_c_users')).toBeNull();
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
    expect(localStorage.getItem(LIFF_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('QA 帳號（claims.qa）：不碰 LIFF，Firebase 登出與清理照做（Grok 交叉審查 P3）', async () => {
    seedAccountState();
    liffFollowsStorage();
    h.currentUser = { uid: 'qa-1', getIdTokenResult: async () => ({ claims: { qa: true } }) };
    const reload = vi.fn();
    await expect(auth.signOutAndReload(reload)).resolves.toBe(true);
    expect(h.fbSignOut).toHaveBeenCalledOnce();
    expect(h.liff.init).not.toHaveBeenCalled();
    expect(h.liff.logout).not.toHaveBeenCalled();
    expect(localStorage.getItem('fcb:signed-in')).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });
});
