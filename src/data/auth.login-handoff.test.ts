import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const liff = {
    init: vi.fn(async () => undefined),
    isLoggedIn: vi.fn(() => false),
    isInClient: vi.fn(() => false),
    login: vi.fn(),
    logout: vi.fn(),
    getAccessToken: vi.fn(() => 'line-access-token'),
    getProfile: vi.fn(async () => ({ displayName: '王大明', pictureUrl: null })),
  };
  return {
    liff,
    emulator: false,
    currentUser: null as null | { uid: string },
    begin: vi.fn(async (uri: string): Promise<string | null> => `${uri}${uri.includes('?') ? '&' : '?'}fcbHandoff=abc`),
  };
});

vi.mock('@line/liff', () => ({ default: h.liff }));
vi.mock('./callables', () => ({ callFn: vi.fn() }));
vi.mock('./firebase', () => ({
  getFirebase: vi.fn(async () => ({ auth: { currentUser: h.currentUser } })),
  shouldUseEmulator: () => h.emulator,
}));
vi.mock('firebase/auth', () => ({
  signOut: vi.fn(async () => undefined),
  signInWithCustomToken: vi.fn(),
  onAuthStateChanged: vi.fn(() => () => undefined),
}));
vi.mock('@/features/login-handoff/start', () => ({
  beginLoginHandoff: (uri: string) => h.begin(uri),
}));

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

type AuthModule = typeof import('./auth');
let auth: AuthModule;

function setPlatform(ua: string, touch: number, standalone: boolean): void {
  Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: ua });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { configurable: true, value: touch });
  Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: standalone });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: standalone && query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_LIFF_ID', 'test-liff-id');
  h.emulator = false;
  h.currentUser = null;
  h.liff.init.mockReset().mockImplementation(async () => undefined);
  h.liff.login.mockClear();
  h.liff.isLoggedIn.mockReset().mockReturnValue(false);
  h.liff.isInClient.mockReset().mockReturnValue(false);
  h.begin.mockReset().mockImplementation(async (uri: string) => (
    `${uri}${uri.includes('?') ? '&' : '?'}fcbHandoff=abc`
  ));
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  setPlatform(DESKTOP, 0, false);
  auth = await import('./auth');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doMock('@/features/login-handoff/start', () => ({
    beginLoginHandoff: (uri: string) => h.begin(uri),
  }));
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

describe('主畫面登入轉交', () => {
  it('主畫面模式帶 fcbHandoff 呼叫 liff.login，首頁也帶乾淨 redirectUri', async () => {
    setPlatform(IPHONE, 5, true);
    auth.acknowledgeMobileLoginHint();
    const err = await auth.signIn().catch((e: unknown) => e);
    const clean = new URL('/', location.origin).toString();
    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.begin).toHaveBeenCalledWith(clean);
    expect(h.liff.login).toHaveBeenCalledTimes(1);
    const arg = h.liff.login.mock.calls[0]?.[0] as { redirectUri?: string } | undefined;
    expect(arg?.redirectUri).toContain('fcbHandoff=');
    expect(arg?.redirectUri?.startsWith(clean)).toBe(true);
  });

  it('已有等待中的轉交：不呼叫 liff.login', async () => {
    setPlatform(IPHONE, 5, true);
    auth.acknowledgeMobileLoginHint();
    h.begin.mockResolvedValueOnce(null);
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.liff.login).not.toHaveBeenCalled();
  });

  it('beginLoginHandoff 失敗不退回一般 liff.login', async () => {
    setPlatform(IPHONE, 5, true);
    auth.acknowledgeMobileLoginHint();
    h.begin.mockRejectedValueOnce(new Error('handoff boom'));
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('handoff boom');
    expect(auth.isLoginRedirectingError(err)).toBe(false);
    expect(h.liff.login).not.toHaveBeenCalled();
    expect(h.liff.init).toHaveBeenCalled();
  });

  it('動態載入失敗不退回一般 liff.login', async () => {
    vi.resetModules();
    vi.doMock('@/features/login-handoff/start', () => ({
      get beginLoginHandoff(): (uri: string) => Promise<string | null> {
        throw new Error('chunk fail');
      },
    }));
    try {
      const fresh = await import('./auth');
      setPlatform(IPHONE, 5, true);
      history.replaceState(null, '', '/');
      fresh.acknowledgeMobileLoginHint();
      const err = await fresh.signIn().catch((e: unknown) => e);
      expect((err as Error).message).toContain('chunk fail');
      expect(fresh.isLoginRedirectingError(err)).toBe(false);
      expect(h.liff.login).not.toHaveBeenCalled();
      expect(h.liff.init).toHaveBeenCalled();
    } finally {
      vi.doMock('@/features/login-handoff/start', () => ({
        beginLoginHandoff: (uri: string) => h.begin(uri),
      }));
    }
  });

  it('網址有 fcbHandoff 時 signIn 不 liff.init', async () => {
    history.replaceState(null, '', '/?fcbHandoff=ab&code=c&liffClientId=1');
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.liff.init).not.toHaveBeenCalled();
    expect(h.begin).not.toHaveBeenCalled();
  });

  it('這次轉交之後，下一次要再經過提示框', async () => {
    setPlatform(IPHONE, 5, true);
    const events = await import('@/core/events');
    const hints: number[] = [];
    const stop = events.on('auth:mobile-login-hint', () => { hints.push(1); });
    try {
      auth.acknowledgeMobileLoginHint();
      await auth.signIn().catch((e: unknown) => e);
      expect(h.begin).toHaveBeenCalledTimes(1);
      expect(h.liff.login).toHaveBeenCalledTimes(1);
      expect(hints).toEqual([]);
      const second = await auth.signIn().catch((e: unknown) => e);
      expect(auth.isLoginRedirectingError(second)).toBe(true);
      expect(hints).toEqual([1]);
      expect(h.begin).toHaveBeenCalledTimes(1);
      expect(h.liff.login).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('桌機首頁維持不帶 redirectUri', async () => {
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.liff.login).toHaveBeenCalledOnce();
    expect(h.liff.login).toHaveBeenCalledWith();
    expect(h.begin).not.toHaveBeenCalled();
  });

  it('iPhone 分頁先顯示提示，不開始轉交', async () => {
    setPlatform(IPHONE, 5, false);
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.begin).not.toHaveBeenCalled();
    expect(h.liff.login).not.toHaveBeenCalled();
  });

  it('非主畫面、非首頁仍只帶乾淨 redirectUri', async () => {
    setPlatform(IPHONE, 5, false);
    auth.acknowledgeMobileLoginHint();
    history.replaceState(null, '', '/events/e1?tab=2');
    const err = await auth.signIn().catch((e: unknown) => e);
    expect(auth.isLoginRedirectingError(err)).toBe(true);
    expect(h.begin).not.toHaveBeenCalled();
    expect(h.liff.login).toHaveBeenCalledWith({
      redirectUri: new URL('/events/e1?tab=2', location.origin).toString(),
    });
  });
});
