import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { useEffect } from 'preact/hooks';
import { emit } from '@/core/events';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import { _resetFirebaseForTest } from '@/data/firebase';
import { _resetAutoLoginSuppressForTest } from '@/data/login-redirect';
import { _resetAuthForTest } from '@/data/auth';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { App } from './App';

// Grok 交叉審查 P1：公開個人頁（LegacyUserCard）掛載時就發 auth:login-request。
// 從 LINE 授權回來時，這個要求若走互動登入、而開頁接手又把 code 清掉，進行中的 liff.init 讀不到 code
// → liff.login() → 回到同一頁再來一次，無限重導。這裡用真的 data/auth（只假 LIFF SDK 與 Callable）驗整條鏈。

const h = vi.hoisted(() => ({
  gate: Promise.resolve() as Promise<void>,
  openGate: (() => undefined) as () => void,
  initStarted: 0,
  searchAtInit: [] as string[],
  fake: { auth: { currentUser: null as null | { uid: string } } },
  stubPayload: { auto: true } as { auto?: boolean },
  liff: {
    sawCode: false,
    init: vi.fn(),
    isLoggedIn: vi.fn(),
    isInClient: vi.fn(() => false),
    login: vi.fn(),
    logout: vi.fn(),
    getAccessToken: vi.fn(() => 'line-access-token'),
    getProfile: vi.fn(async () => ({ displayName: null, pictureUrl: null })),
  },
}));

vi.mock('@line/liff', () => ({ default: h.liff }));
vi.mock('@/data/callables', () => ({ callFn: vi.fn(async () => ({ customToken: 'custom-token' })) }));
// 換發登入成功：getFirebase 給假的 auth（其餘 firebase 匯出維持真實），signInWithCustomToken 回固定使用者。
vi.mock('@/data/firebase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/firebase')>();
  return {
    ...actual,
    getFirebase: vi.fn(async () => h.fake),
    getFirebaseCore: vi.fn(async () => h.fake),
    shouldUseEmulator: () => false,
  };
});
vi.mock('firebase/auth', () => ({
  signInWithCustomToken: vi.fn(async () => ({
    user: { uid: 'U-login', displayName: null, photoURL: null },
  })),
  signOut: vi.fn(async () => undefined),
  // Auth 還原由測試手動發 auth:changed 控制時序，這裡不回呼
  onAuthStateChanged: vi.fn(() => () => undefined),
}));
// 固定同一個物件：每次回新物件會讓 ViewerAccessBridge 的 onChange 一直觸發重繪。
const viewer = vi.hoisted(() => ({
  guest: { uid: null, isRestricted: false, hasPermission: () => false },
}));
vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: () => viewer.guest,
}));

/** 模擬 LegacyUserCard：訪客掛載就自動要求登入（auto）。 */
function PublicProfileStub(): null {
  useEffect(() => {
    emit('auth:login-request', h.stubPayload);
  }, []);
  return null;
}

beforeEach(async () => {
  vi.stubEnv('VITE_LIFF_ID', 'test-liff-id');
  sessionStorage.clear();
  _resetAutoLoginSuppressForTest();
  h.fake.auth.currentUser = null;
  h.stubPayload = { auto: true };
  _resetAuthForTest();
  localStorage.clear();
  h.searchAtInit.length = 0;
  h.liff.sawCode = false;
  h.gate = new Promise<void>((resolve) => { h.openGate = resolve; });
  h.liff.init.mockReset().mockImplementation(async () => {
    h.initStarted += 1;
    // 模擬真 SDK 載入／初始化要花時間：等測試放行後才讀網址上的 code
    await h.gate;
    h.searchAtInit.push(location.search);
    // 真 SDK：網址帶有效 code 時 init 會換到 token、之後 isLoggedIn 為真
    h.liff.sawCode = new URLSearchParams(location.search).has('code');
  });
  h.liff.isLoggedIn.mockReset().mockImplementation(() => h.liff.sawCode);
  h.liff.login.mockReset();
  _resetFirebaseForTest();
  _resetForTest();
  registerFeatures([{
    id: 'profile-resume-test',
    status: 'enabled',
    routes: [
      { path: '/', titleKey: 'nav.home', load: async () => ({ default: () => null }) },
      { path: '/profile/:uid', titleKey: 'nav.profile', load: async () => ({ default: PublicProfileStub }) },
    ],
    nav: [{ path: '/', labelKey: 'nav.home', icon: 'home', order: 2 }],
  }]);
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  _resetForTest();
  _resetFirebaseForTest();
  _setDictLoaderForTest(null);
  history.replaceState(null, '', '/');
});

describe('公開個人頁從 LINE 授權回來（Grok 交叉審查 P1）', () => {
  // 測試同步更新：自動要求（auto）現在等 Auth 還原才處理（Grok 第三輪 P1），這案改用「非 auto 的要求先發」保住原本的競態覆蓋。
  it('頁面先要求登入、Auth 晚一步還原：liff.init 讀得到 code，不呼叫 liff.login', async () => {
    history.replaceState(null, '', '/profile/U-public?code=c&state=s&liffClientId=x');
    h.stubPayload = {};
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(<App />);
      // 公開個人頁掛載 → 發出登入要求（此時 Auth 還沒還原）
      await waitFor(() => expect(h.liff.init).toHaveBeenCalled(), { timeout: 3000 });
      // Auth 這時才還原為未登入 → 開頁接手看到登入進行中（舊版會在這裡清掉 code）
      await act(async () => {
        emit('auth:changed', { uid: null });
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      // 進行中的 liff.init 現在才讀網址
      await act(async () => {
        h.openGate();
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    } finally {
      error.mockRestore();
    }

    expect(h.liff.login).not.toHaveBeenCalled();
    expect(h.searchAtInit[0]).toContain('code=c');
    expect(h.liff.init).toHaveBeenCalledTimes(1);
    // init 後清掉回跳參數
    expect(location.search).toBe('');
  });

  it('Auth 先還原為未登入、頁面稍後才要求登入：同樣不呼叫 liff.login、init 讀得到 code', async () => {
    history.replaceState(null, '', '/profile/U-public?code=c&state=s&liffClientId=x');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(<App />);
      await act(async () => {
        emit('auth:changed', { uid: null });
      });
      await waitFor(() => expect(h.liff.init).toHaveBeenCalled(), { timeout: 3000 });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      await act(async () => {
        h.openGate();
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    } finally {
      error.mockRestore();
    }

    expect(h.liff.login).not.toHaveBeenCalled();
    expect(h.searchAtInit[0]).toContain('code=c');
    expect(h.liff.init).toHaveBeenCalledTimes(1);
  });
});

describe('公開個人頁：取消授權或剛登出後不再被送去 LINE（Grok 第二輪 P1）', () => {
  async function settle(): Promise<void> {
    await act(async () => {
      h.openGate();
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
  }

  it('/profile/:uid?error=access_denied&liffClientId=x 掛載：不載 LIFF、liff.login 0 次、參數已清', async () => {
    history.replaceState(null, '', '/profile/U-public?error=access_denied&error_description=x&state=s&liffClientId=x');
    render(<App />);
    await act(async () => {
      emit('auth:changed', { uid: null });
    });
    await settle();
    expect(h.liff.login).not.toHaveBeenCalled();
    expect(h.liff.init).not.toHaveBeenCalled();
    expect(location.search).toBe('');
  });

  it('登出後重整（旗標 logout）掛載：liff.login 0 次', async () => {
    sessionStorage.setItem('fcb:suppress-auto-login', 'logout');
    history.replaceState(null, '', '/profile/U-public');
    render(<App />);
    await act(async () => {
      emit('auth:changed', { uid: null });
    });
    await settle();
    expect(h.liff.login).not.toHaveBeenCalled();
    expect(h.liff.init).not.toHaveBeenCalled();
  });

  it('沒有旗標的一般開頁：照 A 掛載就導向 LINE 登入（行為不變）', async () => {
    history.replaceState(null, '', '/profile/U-public');
    render(<App />);
    await act(async () => {
      emit('auth:changed', { uid: null });
    });
    await settle();
    await waitFor(() => expect(h.liff.login).toHaveBeenCalledOnce(), { timeout: 3000 });
  });
});

describe('已登入者整頁打開公開個人頁（Grok 第三輪 P1）', () => {
  it('無回跳參數、先發 auto、Auth 晚一步還原出已登入：liff.login 0 次、不載 LIFF', async () => {
    history.replaceState(null, '', '/profile/U-public');
    render(<App />);
    // 名片掛載先發 auto（Auth 還沒還原）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    await act(async () => {
      emit('auth:changed', { uid: 'U-existing' });
    });
    await act(async () => {
      h.openGate();
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(h.liff.login).not.toHaveBeenCalled();
    expect(h.liff.init).not.toHaveBeenCalled();
  });

  it('auto 已開始登入、liff.init 還沒結束時 Firebase 還原出已登入者：仍不導向 LINE', async () => {
    history.replaceState(null, '', '/profile/U-public');
    render(<App />);
    await act(async () => {
      emit('auth:changed', { uid: null });
    });
    await waitFor(() => expect(h.liff.init).toHaveBeenCalled(), { timeout: 3000 });
    // init 還沒結束：Firebase 這時還原出已登入者
    h.fake.auth.currentUser = { uid: 'U-existing' };
    await act(async () => {
      h.openGate();
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(h.liff.login).not.toHaveBeenCalled();
  });
});
