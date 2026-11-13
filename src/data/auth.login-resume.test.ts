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
  h.signInWithCustomToken.mockClear();
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

  it('getProfile 只呼叫一次，結果掛在 liff.fcbProfile 交給會員文件同步沿用（審查 P3-2）', async () => {
    h.liff.isLoggedIn.mockReturnValue(true);
    h.liff.getProfile.mockClear();

    const user = await auth.signIn({ interactive: false });

    expect(user.displayName).toBe('王大明');
    expect(h.liff.getProfile).toHaveBeenCalledTimes(1);
    const stashed = (h.liff as { fcbProfile?: Promise<unknown> }).fcbProfile;
    await expect(stashed).resolves.toEqual({ displayName: '王大明', pictureUrl: null });
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

  it('換發逾時後晚到的 custom token 不拿去登入（世代編號，Grok 第二輪 P3）', async () => {
    vi.useFakeTimers();
    try {
      h.liff.isLoggedIn.mockReturnValue(true);
      h.callFn.mockImplementationOnce(() => new Promise((resolve) => {
        setTimeout(() => resolve({ customToken: 'late-token' }), auth.LOGIN_TOKEN_TIMEOUT_MS + 1000);
      }));
      const result = auth.signIn().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(auth.LOGIN_TOKEN_TIMEOUT_MS);
      expect(String((await result as Error).message)).toContain('逾時');
      await vi.advanceTimersByTimeAsync(2000);
      expect(h.signInWithCustomToken).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('網址帶回跳參數時，各頁按鈕直接呼叫 signIn() 也強制非互動，不 liff.login（Grok 第二輪 P3）', async () => {
    history.replaceState(null, '', '/events/e1?code=c&state=s&liffClientId=x');
    h.liff.isLoggedIn.mockReturnValue(false);
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.liff.login).not.toHaveBeenCalled();
  });

  it('導向 LINE 前 Firebase 已有登入者（Auth 晚一步還原）：不導向（Grok 第三輪 P1）', async () => {
    h.liff.isLoggedIn.mockReturnValue(false);
    h.liff.init.mockImplementationOnce(async () => {
      // liff.init 還沒結束時 Auth 還原出已登入者
      h.currentUser = { uid: 'U-existing', getIdTokenResult: async () => ({ claims: {} }) };
    });
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.liff.login).not.toHaveBeenCalled();
  });

  it('同時兩次 signIn 共用同一支流程：liff.init 只一次（Grok 第三輪 P3）', async () => {
    history.replaceState(null, '', '/?code=c&state=s&liffClientId=x');
    h.liff.isLoggedIn.mockReturnValue(true);
    const [a, b] = await Promise.all([auth.signIn({ interactive: false }), auth.signIn()]);
    expect(a.uid).toBe('U-login');
    expect(b).toBe(a);
    expect(h.liff.init).toHaveBeenCalledTimes(1);
    expect(h.callFn).toHaveBeenCalledTimes(1);
  });

  it('逾時當下 signInWithCustomToken 已送出：回來後立刻登出丟掉（Grok 第三輪 P3）', async () => {
    vi.useFakeTimers();
    try {
      h.liff.isLoggedIn.mockReturnValue(true);
      h.signInWithCustomToken.mockImplementationOnce(() => new Promise((resolve) => {
        setTimeout(() => resolve({ user: { uid: 'U-late', displayName: null, photoURL: null } }),
          auth.LOGIN_TOKEN_TIMEOUT_MS + 1000);
      }));
      const result = auth.signIn().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(auth.LOGIN_TOKEN_TIMEOUT_MS);
      expect(String((await result as Error).message)).toContain('逾時');
      expect(h.signInWithCustomToken).toHaveBeenCalledOnce();
      expect(h.fbSignOut).not.toHaveBeenCalled();
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        await vi.advanceTimersByTimeAsync(2000);
      } finally {
        error.mockRestore();
      }
      expect(h.fbSignOut).toHaveBeenCalledOnce();
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

  it('LINE 內建瀏覽器不顯示登入提示，直接 liff.login', async () => {
    // 測試同步更新：登入提示改版
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari Line/14.18.0',
    );
    h.liff.isInClient.mockReturnValue(false);
    h.liff.isLoggedIn.mockReturnValue(false);
    const events = await import('@/core/events');
    const hints: number[] = [];
    const stop = events.on('auth:mobile-login-hint', () => { hints.push(1); });
    try {
      const err = await auth.signIn().catch((e: unknown) => e);
      expect(auth.isLoginRedirectingError(err)).toBe(true);
      expect(hints).toEqual([]);
      expect(h.liff.login).toHaveBeenCalledOnce();
    } finally {
      stop();
      ua.mockRestore();
    }
  });

  it('一般手機瀏覽器仍顯示登入提示，不直接 liff.login', async () => {
    // 測試同步更新：登入提示改版
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari',
    );
    h.liff.isInClient.mockReturnValue(false);
    h.liff.isLoggedIn.mockReturnValue(false);
    const events = await import('@/core/events');
    const hints: number[] = [];
    const stop = events.on('auth:mobile-login-hint', () => { hints.push(1); });
    try {
      const err = await auth.signIn().catch((e: unknown) => e);
      expect(auth.isLoginRedirectingError(err)).toBe(true);
      expect(hints).toEqual([1]);
      expect(h.liff.login).not.toHaveBeenCalled();
    } finally {
      stop();
      ua.mockRestore();
    }
  });

  it('ensureLiffInit 與 signIn 共用同一支 Promise，成功後不再 init', async () => {
    const liffInit = await import('./liff-init');
    let release!: () => void;
    h.liff.init.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = liffInit.ensureLiffInit();
    expect(liffInit.ensureLiffInit()).toBe(first);
    await vi.waitFor(() => expect(h.liff.init).toHaveBeenCalledOnce());
    h.liff.isLoggedIn.mockReturnValue(true);
    const signing = auth.signIn();
    expect(h.liff.init).toHaveBeenCalledTimes(1);
    release();
    await first;
    await expect(signing).resolves.toMatchObject({ uid: 'U-login' });
    await liffInit.ensureLiffInit();
    expect(h.liff.init).toHaveBeenCalledTimes(1);
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

  // 測試同步更新：2a4d9b2 的 QA 登出仍重整；Grok 第二輪 P3 改為照橫幅「登出 QA」走 signOutQa（不 init LIFF、不重整）。
  it('QA 帳號（claims.qa）：走 signOutQa——Firebase 登出、不 init LIFF、不重整、不寫剛登出旗標', async () => {
    seedAccountState();
    liffFollowsStorage();
    h.currentUser = { uid: 'qa-1', getIdTokenResult: async () => ({ claims: { qa: true } }) };
    const reload = vi.fn();
    await expect(auth.signOutAndReload(reload)).resolves.toBe(true);
    expect(h.fbSignOut).toHaveBeenCalledOnce();
    expect(h.liff.init).not.toHaveBeenCalled();
    expect(h.liff.logout).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('fcb:suppress-auto-login')).toBeNull();
    // QA 登出不碰 LINE 工作階段：LIFF* 保留（Grok 第三輪 P3）
    expect(localStorage.getItem(LIFF_KEY)).toBe('token');
  });

  it('QA 登出期間也關閘：signIn 不做、不 liff.login（Grok 第三輪 P3）', async () => {
    seedAccountState();
    let releaseSignOut: () => void = () => undefined;
    h.currentUser = { uid: 'qa-1', getIdTokenResult: async () => ({ claims: { qa: true } }) };
    h.fbSignOut.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseSignOut = resolve; }));
    const done = auth.signOutQa('qa-1');
    await vi.waitFor(() => expect(h.fbSignOut).toHaveBeenCalledOnce());
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.liff.init).not.toHaveBeenCalled();
    releaseSignOut();
    await expect(done).resolves.toBe(true);
  });

  it('清除快取（signOutForCacheClear）：Firebase 登出 → LINE 登出 → 剛登出旗標；閘門不放開', async () => {
    seedAccountState();
    liffFollowsStorage();
    await expect(auth.signOutForCacheClear()).resolves.toBe(true);
    expect(h.calls).toEqual(['firebase.signOut', 'liff.init', 'liff.logout']);
    expect(sessionStorage.getItem('fcb:suppress-auto-login')).toBe('logout');
    // 接著要清快取並重整：這段期間不再登入
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.liff.login).not.toHaveBeenCalled();
  });

  it('清除快取進行到 LINE 登出還沒返回：signIn 不做、liff.login 0 次（Grok 第三輪 P2）', async () => {
    seedAccountState();
    let releaseInit: () => void = () => undefined;
    h.liff.init.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseInit = resolve; }));
    const done = auth.signOutForCacheClear();
    await vi.waitFor(() => expect(h.liff.init).toHaveBeenCalledOnce());
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.liff.login).not.toHaveBeenCalled();
    releaseInit();
    await expect(done).resolves.toBe(true);
  });

  it('清除快取時 Firebase 登出失敗：回 false、不寫旗標、LIFF* 保留、閘門放開（Grok 第三輪 P2）', async () => {
    seedAccountState();
    h.fbSignOut.mockRejectedValueOnce(new Error('network'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(auth.signOutForCacheClear()).resolves.toBe(false);
    } finally {
      error.mockRestore();
    }
    expect(h.liff.init).not.toHaveBeenCalled();
    expect(localStorage.getItem(LIFF_KEY)).toBe('token');
    expect(localStorage.getItem('fcb:signed-in')).toBe('1');
    expect(sessionStorage.getItem('fcb:suppress-auto-login')).toBeNull();
    // 閘門已放開：使用者之後仍可登入
    h.liff.isLoggedIn.mockReturnValue(true);
    await expect(auth.signIn()).resolves.toMatchObject({ uid: 'U-login' });
  });

  it('帳號狀態讀不到（unknown）：不 init LIFF，Firebase 登出、清理與重整照做（Grok 第二輪 P3）', async () => {
    seedAccountState();
    h.currentUser = {
      uid: 'U1',
      getIdTokenResult: async () => { throw new Error('network'); },
    };
    const reload = vi.fn();
    await expect(auth.signOutAndReload(reload)).resolves.toBe(true);
    expect(h.fbSignOut).toHaveBeenCalledOnce();
    expect(h.liff.init).not.toHaveBeenCalled();
    expect(localStorage.getItem(LIFF_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('重整前寫「剛登出」旗標，重整後這次開頁不自動要求登入（Grok 第二輪 P1）', async () => {
    seedAccountState();
    await auth.signOutAndReload(vi.fn());
    expect(sessionStorage.getItem('fcb:suppress-auto-login')).toBe('logout');
  });

  it('登出進行中（等 LIFF）：signIn 直接不做、不會 liff.login（Opus P3-4）', async () => {
    seedAccountState();
    let releaseInit: () => void = () => undefined;
    h.liff.init.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseInit = resolve; }));
    const reload = vi.fn();
    const done = auth.signOutAndReload(reload);
    await vi.waitFor(() => expect(h.liff.init).toHaveBeenCalledOnce());

    const err = await auth.signIn().catch((e: unknown) => e);
    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.liff.login).not.toHaveBeenCalled();

    releaseInit();
    await done;
    expect(reload).toHaveBeenCalledOnce();
  });

  it('logoutLineSession：只做 LINE 登出（給抽屜清除快取）', async () => {
    seedAccountState();
    liffFollowsStorage();
    await auth.logoutLineSession();
    expect(h.liff.logout).toHaveBeenCalledOnce();
    expect(h.fbSignOut).not.toHaveBeenCalled();
  });
});

describe('LINE 權杖失效的自動復原（B1-02）', () => {
  const RETRY_KEY = '_lineLoginRetryCount';

  function unauthenticated(code = 'functions/unauthenticated'): Error {
    return Object.assign(new Error('LINE 驗證失敗'), { code });
  }

  function lineRejects(code: string): void {
    h.liff.getProfile.mockRejectedValue(Object.assign(new Error('Authentication failed'), { code }));
  }

  beforeEach(() => {
    h.liff.isLoggedIn.mockReturnValue(true);
    h.liff.isInClient.mockReset().mockReturnValue(false);
    h.liff.getProfile.mockReset().mockResolvedValue({ displayName: '王大明', pictureUrl: null });
  });

  it('第一次失效（LINE 回 401）：登出 LINE 並自動導向一次，計數記 1', async () => {
    h.callFn.mockRejectedValueOnce(unauthenticated());
    lineRejects('401');

    const err = await auth.signIn().catch((e: unknown) => e);

    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.liff.logout).toHaveBeenCalledOnce();
    expect(h.liff.login).toHaveBeenCalledOnce();
    expect(h.callFn).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RETRY_KEY)).toBe('1');
  });

  it('過期權杖（LIFF 權限檢查打 verify 回 400 invalid_request）：登出 LINE 並最多導向一次（Grok 初審 P1）', async () => {
    h.callFn.mockRejectedValue(unauthenticated());
    h.liff.getProfile.mockRejectedValue(
      Object.assign(new Error('access token expired'), { code: 'invalid_request' }),
    );

    const first = await auth.signIn().catch((e: unknown) => e);
    expect(auth.isLoginRedirectingError(first)).toBe(true);
    expect(h.liff.logout).toHaveBeenCalledOnce();
    expect(h.liff.login).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(RETRY_KEY)).toBe('1');

    const second = await auth.signIn().catch((e: unknown) => e);
    expect(auth.isLineSessionExpiredError(second)).toBe(true);
    expect(h.liff.login).toHaveBeenCalledOnce();
  });

  it('本機沒有權杖（UNAUTHORIZED＋Need access_token）：算失效，登出並導向一次', async () => {
    h.callFn.mockRejectedValueOnce(unauthenticated());
    h.liff.getProfile.mockRejectedValue(Object.assign(
      new Error('Need access_token for api call, Please login first'), { code: 'UNAUTHORIZED' },
    ));

    const err = await auth.signIn().catch((e: unknown) => e);

    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.liff.logout).toHaveBeenCalledOnce();
    expect(h.liff.login).toHaveBeenCalledOnce();
  });

  it.each([
    ['LINE 5xx', Object.assign(new Error('Internal Server Error'), { code: '500' })],
    ['LINE 403', Object.assign(new Error('Forbidden'), { code: '403' })],
    ['LINE 429', Object.assign(new Error('Too Many Requests'), { code: '429' })],
    ['沒有代碼的逾時錯誤', new Error('[auth] 確認 LINE 權杖 逾時（8000ms）')],
    ['同意視窗被取消', Object.assign(new Error("user didn't allow the agreement"), { code: 'UNAUTHORIZED' })],
  ])('確認權杖時遇到%s：不登出、不導向、不重試，照原錯誤拋出', async (_label, probeError) => {
    const original = unauthenticated();
    h.callFn.mockRejectedValueOnce(original);
    h.liff.getProfile.mockRejectedValue(probeError);

    const err = await auth.signIn().catch((e: unknown) => e);

    expect(err).toBe(original);
    expect(h.callFn).toHaveBeenCalledTimes(1);
    expect(h.liff.logout).not.toHaveBeenCalled();
    expect(h.liff.login).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETRY_KEY)).toBeNull();
  });

  it('失效後發現 Firebase 已有登入者：不導向，也不佔用重試次數（Grok 初審 P3）', async () => {
    h.callFn.mockRejectedValueOnce(unauthenticated());
    lineRejects('401');
    h.currentUser = { uid: 'U-other', getIdTokenResult: async () => ({ claims: {} }) };

    const err = await auth.signIn().catch((e: unknown) => e);

    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.liff.login).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETRY_KEY)).toBeNull();
  });

  it('手機外部瀏覽器：第一次失效顯示登入提示並佔用次數；第二次只顯示文案、不再跳提示', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari',
    );
    h.callFn.mockRejectedValue(unauthenticated());
    lineRejects('401');
    const events = await import('@/core/events');
    const hints: number[] = [];
    const stop = events.on('auth:mobile-login-hint', () => { hints.push(1); });
    try {
      const first = await auth.signIn().catch((e: unknown) => e);
      expect(auth.isLoginRedirectingError(first)).toBe(true);
      expect(hints).toEqual([1]);
      expect(sessionStorage.getItem(RETRY_KEY)).toBe('1');

      const second = await auth.signIn().catch((e: unknown) => e);
      expect(auth.isLineSessionExpiredError(second)).toBe(true);
      expect(hints).toEqual([1]);
      expect(h.liff.login).not.toHaveBeenCalled();
    } finally {
      stop();
      ua.mockRestore();
    }
  });

  it('同一分頁第二次失效：不再導向，改拋專屬錯誤並通知 App 顯示文案', async () => {
    sessionStorage.setItem(RETRY_KEY, '1');
    h.callFn.mockRejectedValueOnce(unauthenticated('unauthenticated'));
    lineRejects('401');
    const events = await import('@/core/events');
    const expired: number[] = [];
    const stop = events.on('auth:line-session-expired', () => { expired.push(1); });
    try {
      const err = await auth.signIn().catch((e: unknown) => e);

      expect(auth.isLineSessionExpiredError(err)).toBe(true);
      expect(auth.isLoginRedirectingError(err)).toBe(false);
      expect(expired).toEqual([1]);
      expect(h.liff.logout).toHaveBeenCalledOnce();
      expect(h.liff.login).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(RETRY_KEY)).toBe('1');
    } finally {
      stop();
    }
  });

  it('暫時性失敗（LINE 確認權杖有效）：不登出，用同一顆權杖重試一次即登入', async () => {
    h.callFn.mockRejectedValueOnce(unauthenticated());

    const user = await auth.signIn();

    expect(user.uid).toBe('U-login');
    expect(h.callFn).toHaveBeenCalledTimes(2);
    expect(h.callFn).toHaveBeenNthCalledWith(2, 'createCustomToken', { accessToken: 'line-access-token' });
    expect(h.liff.logout).not.toHaveBeenCalled();
    expect(h.liff.login).not.toHaveBeenCalled();
  });

  it('暫時性失敗（向 LINE 確認也失敗，非 401）：不登出、不導向、不重試，照原錯誤拋出', async () => {
    const original = unauthenticated();
    h.callFn.mockRejectedValueOnce(original);
    h.liff.getProfile.mockRejectedValue(new TypeError('Failed to fetch'));

    const err = await auth.signIn().catch((e: unknown) => e);

    expect(err).toBe(original);
    expect(auth.isLineSessionExpiredError(err)).toBe(false);
    expect(h.callFn).toHaveBeenCalledTimes(1);
    expect(h.liff.logout).not.toHaveBeenCalled();
    expect(h.liff.login).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETRY_KEY)).toBeNull();
  });

  it('非 unauthenticated 的錯誤：不向 LINE 確認、不登出', async () => {
    h.callFn.mockRejectedValueOnce(Object.assign(new Error('internal'), { code: 'functions/internal' }));

    await expect(auth.signIn()).rejects.toThrow('internal');
    expect(h.liff.getProfile).not.toHaveBeenCalled();
    expect(h.liff.logout).not.toHaveBeenCalled();
  });

  it('sessionStorage 不可用：不導向，只拋專屬錯誤', async () => {
    h.callFn.mockRejectedValueOnce(unauthenticated());
    lineRejects('401');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    try {
      const err = await auth.signIn().catch((e: unknown) => e);
      expect(auth.isLineSessionExpiredError(err)).toBe(true);
      expect(h.liff.login).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });

  it('sessionStorage 讀取丟錯：不導向，只拋專屬錯誤', async () => {
    h.callFn.mockRejectedValueOnce(unauthenticated());
    lineRejects('401');
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    try {
      const err = await auth.signIn().catch((e: unknown) => e);
      expect(auth.isLineSessionExpiredError(err)).toBe(true);
      expect(h.liff.login).not.toHaveBeenCalled();
    } finally {
      getItem.mockRestore();
    }
  });

  it('網址帶回跳參數（一律非互動）：不導向、不動計數，只拋專屬錯誤', async () => {
    history.replaceState(null, '', '/?code=c&state=s&liffClientId=x');
    h.callFn.mockRejectedValueOnce(unauthenticated());
    lineRejects('401');

    const err = await auth.signIn().catch((e: unknown) => e);

    expect(auth.isLineSessionExpiredError(err)).toBe(true);
    expect(h.liff.logout).toHaveBeenCalledOnce();
    expect(h.liff.login).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETRY_KEY)).toBeNull();
  });

  it('開頁接手（interactive:false）：不導向', async () => {
    h.callFn.mockRejectedValueOnce(unauthenticated());
    lineRejects('401');

    const err = await auth.signIn({ interactive: false }).catch((e: unknown) => e);

    expect(auth.isLineSessionExpiredError(err)).toBe(true);
    expect(h.liff.login).not.toHaveBeenCalled();
  });

  it('LINE App 內（Mini App）：不自動導向，只拋專屬錯誤', async () => {
    h.liff.isInClient.mockReturnValue(true);
    h.callFn.mockRejectedValueOnce(unauthenticated());
    lineRejects('401');

    const err = await auth.signIn().catch((e: unknown) => e);

    expect(auth.isLineSessionExpiredError(err)).toBe(true);
    expect(h.liff.login).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETRY_KEY)).toBeNull();
  });

  it('登入成功時清掉重試計數', async () => {
    sessionStorage.setItem(RETRY_KEY, '1');

    await auth.signIn();

    expect(sessionStorage.getItem(RETRY_KEY)).toBeNull();
  });

  it('向 LINE 確認期間開始登出：不登出 LINE、不導向', async () => {
    h.callFn.mockRejectedValueOnce(unauthenticated());
    let rejectProfile!: (err: unknown) => void;
    h.liff.getProfile.mockImplementationOnce(() => new Promise((_, reject) => { rejectProfile = reject; }));
    const signing = auth.signIn().catch((e: unknown) => e);
    await vi.waitFor(() => expect(h.liff.getProfile).toHaveBeenCalledOnce());
    const done = auth.signOutForCacheClear();
    rejectProfile(Object.assign(new Error('expired'), { code: '401' }));
    const err = await signing;
    await done;

    expect(auth.isLineSessionExpiredError(err)).toBe(false);
    expect(h.liff.login).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETRY_KEY)).toBeNull();
  });
});
