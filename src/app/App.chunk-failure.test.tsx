import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/preact';
import { App, _setRouteReloadPageForTest } from '@/app/App';
import { RELOAD_AT_KEY, installChunkReloadGuard } from '@/core/chunk-reload';
import { reportClientError } from '@/core/error-report';
import { isModuleLoadFailure } from '@/core/module-load-error';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import type { FeatureManifest } from '@/core/feature-types';
import { _resetReloadSafetyForTest } from '@/core/reload-safety';
import { _resetSubmitGuardForTest, beginSubmitting } from '@/core/submit-guard';
import { _resetRouteLoadPendingForTest, isRouteLoadPending } from '@/core/route-load-pending';

// 顧問 §3.260 演練前補測：chunk 載入失敗走到路由時的畫面與上報（D2 加一輪、②、④）。
vi.mock('@/core/error-report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/error-report')>()),
  reportClientError: vi.fn(),
}));

/** 照 Vite `__vitePreload` 的 handlePreloadError：發可取消的 vite:preloadError；沒被擋就丟原錯誤，被擋就回 undefined。 */
function failingLoad(): Promise<{ default: () => preact.JSX.Element }> {
  return Promise.resolve().then(() => {
    const err = new TypeError('Importing a module script failed.');
    const event = new Event('vite:preloadError', { cancelable: true }) as Event & { payload?: unknown };
    event.payload = err;
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw err;
    return undefined as unknown as { default: () => preact.JSX.Element };
  });
}

function Fine(): preact.JSX.Element {
  return <p data-testid="fine">fine page</p>;
}

const manifests: FeatureManifest[] = [
  { id: 'home', status: 'enabled', routes: [{ path: '/', load: () => Promise.resolve({ default: Fine }), titleKey: 'home.title' }], nav: [{ path: '/', labelKey: 'home.nav', icon: 'home', order: 0 }] },
  { id: 'events', status: 'enabled', routes: [{ path: '/events/:id', load: failingLoad, titleKey: 'events.detail' }] },
];

const reported = vi.mocked(reportClientError);

function prompt(): HTMLElement | null {
  return document.getElementById('sw-reload-deferred-prompt');
}

// 守門整個檔案裝一次：單獨用 -t 跑任一條也成立（Opus 差異審 P3-b）。
beforeAll(() => {
  installChunkReloadGuard();
});

describe('App：活動詳情 chunk 載入失敗（自動重載被擋或已用過）', () => {

  beforeEach(() => {
    _resetForTest();
    registerFeatures(manifests);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reported.mockClear();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/events/e1?ref=line#signup');
  });

  afterEach(() => {
    cleanup();
    _resetSubmitGuardForTest();
    _resetReloadSafetyForTest();
    vi.restoreAllMocks();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('② 送出中不能重載：顯示錯誤畫面（不是白畫面）、中性提示、上報一次且是載入失敗', async () => {
    const end = beginSubmitting('signup');
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.error-fallback, [role="alert"]')).not.toBeNull());
    end();
    expect(container.querySelector('header')).not.toBeNull();
    expect(prompt()?.dataset.mode).toBe('chunk');
    expect(sessionStorage.getItem(RELOAD_AT_KEY)).toBeNull();
    const moduleReports = reported.mock.calls.filter(([, err]) => isModuleLoadFailure(err));
    expect(moduleReports).toHaveLength(1);
  });

  it('D2 加一輪：重載後 60 秒內同一個 chunk 再失敗 → 不再自動重載、錯誤畫面＋中性提示（顧問 §3.268 乙）', async () => {
    const at = String(Date.now() - 5_000);
    sessionStorage.setItem(RELOAD_AT_KEY, at);
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.error-fallback, [role="alert"]')).not.toBeNull());
    expect(sessionStorage.getItem(RELOAD_AT_KEY)).toBe(at);
    expect(prompt()?.dataset.mode).toBe('chunk');
    expect(reported.mock.calls.filter(([, err]) => isModuleLoadFailure(err))).toHaveLength(1);
  });

  it('④ sessionStorage 不可用（無痕）：不重載、不當掉，顯示錯誤畫面', async () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.error-fallback, [role="alert"]')).not.toBeNull());
    expect(prompt()).toBeNull();
    expect(container.querySelector('header')).not.toBeNull();
  });
});

describe('③ 自動重載保留網址的 query 與 hash', () => {
  it('重載用 location.reload()（原網址重新載入），不改 location.href／assign／replace', () => {
    const src = readFileSync(resolve(__dirname, '../core/chunk-reload.ts'), 'utf8');
    expect(src).toContain('reload: () => location.reload()');
    expect(src).not.toMatch(/location\.(href\s*=|assign\(|replace\()/);
  });
});

// 顧問 §3.262 P3-1、P3-2：從列表點進詳情時 chunk 失敗；守門決定重載時路由拿到 undefined。
describe('App：從首頁點進活動詳情時 chunk 失敗', () => {
  let attempts = 0;
  let mode: 'reject-once' | 'empty' | 'boom-once' = 'reject-once';

  function Home(): preact.JSX.Element {
    return <a href="/events/e1" data-testid="go-detail">go</a>;
  }

  /** 每個測試一個新的 load 函式：App 的 lazyCache 以 load 函式為鍵，共用會沿用上一個測試載好的元件。 */
  function navManifests(): FeatureManifest[] {
    // 第一次照 Vite 失敗行為（沒被擋就丟、被擋回 undefined）；mode=empty 時一律回 undefined（守門已排重載）。之後成功。
    const detailLoad = (): Promise<{ default: () => preact.JSX.Element }> => {
      attempts += 1;
      if (mode === 'empty') return Promise.resolve(undefined as unknown as { default: () => preact.JSX.Element });
      if (mode === 'boom-once' && attempts === 1) return Promise.reject(new Error('boom: not a module load failure'));
      if (attempts === 1) return failingLoad();
      return Promise.resolve({ default: () => <p data-testid="detail">detail page</p> });
    };
    return [
      { id: 'home', status: 'enabled', routes: [{ path: '/', load: () => Promise.resolve({ default: Home }), titleKey: 'home.title' }], nav: [{ path: '/', labelKey: 'home.nav', icon: 'home', order: 0 }] },
      { id: 'events', status: 'enabled', routes: [{ path: '/events/:id', load: detailLoad, titleKey: 'events.detail' }] },
    ];
  }

  beforeEach(async () => {
    const { toast } = await import('@/ui/Toast');
    vi.spyOn(toast, 'show');
    attempts = 0;
    mode = 'reject-once';
    _resetForTest();
    registerFeatures(navManifests());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reported.mockClear();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    cleanup();
    _resetSubmitGuardForTest();
    _resetReloadSafetyForTest();
    vi.restoreAllMocks();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  async function toastCalls(): Promise<number> {
    const { toast } = await import('@/ui/Toast');
    return vi.mocked(toast.show).mock.calls.length;
  }

  for (const variant of ['60 秒窗內', '送出中被擋下'] as const) {
    // 顧問 §3.268：原本的「再點一次可以恢復」與真實瀏覽器不符（staging 演練 D12：同一網址載入失敗後，同一頁再 import() 會沿用失敗結果），已刪除。
    it(`P3-2 ${variant}：留在列表、吐司一次、上報一次`, async () => {
      let end: (() => void) | undefined;
      if (variant === '60 秒窗內') sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now() - 5_000));
      else end = beginSubmitting('signup');
      const { findByTestId } = render(<App />);
      (await findByTestId('go-detail')).click();
      await waitFor(() => expect(reported.mock.calls.filter(([, err]) => isModuleLoadFailure(err))).toHaveLength(1));
      await waitFor(() => expect(window.location.pathname).toBe('/'));
      expect(await findByTestId('go-detail')).toBeTruthy();
      expect(await toastCalls()).toBe(1);
      // 上報總數也只有 1（不只過濾載入失敗那類；Opus 差異審 P3-a）；退回上一頁時沒有多載一次（Flash 差異審 P2）。
      expect(reported).toHaveBeenCalledTimes(1);
      expect(attempts).toBe(1);
      // 兩種都出中性提示（60 秒窗內也出，顧問 §3.268 乙），讓使用者能整頁重新載入。
      expect(prompt()?.dataset.mode).toBe('chunk');
      end?.();
    });
  }

  // 顧問 §3.268：程式檔載入失敗時，頁內重試在真實瀏覽器沒有作用（staging 演練 D13），「重新嘗試」改整頁重新整理；
  // 原本「重新嘗試會重新載入路由並恢復」的斷言與真實瀏覽器不符，改寫成下面三條。
  it('直接開網址、程式檔載入失敗：「重新嘗試」整頁重新整理（不受 60 秒窗限制），不做頁內重試', async () => {
    const reloadPage = vi.fn();
    _setRouteReloadPageForTest(reloadPage);
    try {
      sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now() - 5_000));
      window.history.replaceState({}, '', '/events/e1');
      const { container } = render(<App />);
      await waitFor(() => expect(container.querySelector('.error-fallback__retry')).not.toBeNull());
      (container.querySelector('.error-fallback__retry') as HTMLButtonElement).click();
      expect(reloadPage).toHaveBeenCalledTimes(1);
      expect(attempts).toBe(1);
    } finally {
      _setRouteReloadPageForTest();
    }
  });

  it('送出中按「重新嘗試」：不整頁重整，退回頁內重試', async () => {
    const reloadPage = vi.fn();
    _setRouteReloadPageForTest(reloadPage);
    const end = beginSubmitting('signup');
    try {
      sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now() - 5_000));
      window.history.replaceState({}, '', '/events/e1');
      const { container } = render(<App />);
      await waitFor(() => expect(container.querySelector('.error-fallback__retry')).not.toBeNull());
      (container.querySelector('.error-fallback__retry') as HTMLButtonElement).click();
      await waitFor(() => expect(attempts).toBe(2));
      expect(reloadPage).not.toHaveBeenCalled();
    } finally {
      end();
      _setRouteReloadPageForTest();
    }
  });

  it('不是程式檔載入失敗的錯誤：「重新嘗試」維持頁內重試（Opus 審 P2-1）', async () => {
    const reloadPage = vi.fn();
    _setRouteReloadPageForTest(reloadPage);
    try {
      mode = 'boom-once';
      window.history.replaceState({}, '', '/events/e1');
      const { container, findByTestId } = render(<App />);
      await waitFor(() => expect(container.querySelector('.error-fallback__retry')).not.toBeNull());
      (container.querySelector('.error-fallback__retry') as HTMLButtonElement).click();
      expect(await findByTestId('detail')).toBeTruthy();
      expect(attempts).toBe(2);
      expect(reloadPage).not.toHaveBeenCalled();
    } finally {
      _setRouteReloadPageForTest();
    }
  });

  it('P3-1 守門已排重載（路由 load 拿到 undefined）：不上報、不跳吐司、不導回上一頁、不卡死', async () => {
    mode = 'empty';
    const { findByTestId, container } = render(<App />);
    (await findByTestId('go-detail')).click();
    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 500);
    });
    expect(window.location.pathname).toBe('/events/e1');
    expect(reported).not.toHaveBeenCalled();
    expect(await toastCalls()).toBe(0);
    expect(container.querySelector('.error-fallback, [role="alert"]')).toBeNull();
    expect(attempts).toBe(1);
    // 重載沒生效、使用者回列表再點進來：停在載入中的 lazy 沒留在快取，會再呼叫一次 load（Flash 差異審 P2）。
    // 只驗「會再呼叫」；真實瀏覽器裡這次是否成功取決於同一網址的失敗結果是否被沿用（演練 D12），這裡不宣稱。
    window.history.back();
    (await findByTestId('go-detail')).click();
    await waitFor(() => expect(attempts).toBe(2));
  });
});

// 顧問 §3.263 甲：詳情頁只在路由載入中才放行自動重載。
describe('App：路由載入中旗標與背景載入失敗', () => {
  let attempts = 0;

  function Home(): preact.JSX.Element {
    return <a href="/events/e1" data-testid="go-detail">go</a>;
  }

  function manifestsWith(detailLoad: () => Promise<{ default: () => preact.JSX.Element }>): FeatureManifest[] {
    return [
      { id: 'home', status: 'enabled', routes: [{ path: '/', load: () => Promise.resolve({ default: Home }), titleKey: 'home.title' }], nav: [{ path: '/', labelKey: 'home.nav', icon: 'home', order: 0 }] },
      { id: 'events', status: 'enabled', routes: [{ path: '/events/:id', load: detailLoad, titleKey: 'events.detail' }] },
    ];
  }

  beforeEach(() => {
    attempts = 0;
    _resetForTest();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reported.mockClear();
    sessionStorage.clear();
    _resetRouteLoadPendingForTest();
  });

  afterEach(() => {
    cleanup();
    _resetSubmitGuardForTest();
    _resetReloadSafetyForTest();
    _resetRouteLoadPendingForTest();
    vi.restoreAllMocks();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('詳情頁已顯示後背景預載失敗：不 preventDefault、不寫時間戳、出中性提示（不整頁重載）', async () => {
    registerFeatures(manifestsWith(() => Promise.resolve({ default: () => <p data-testid="detail">detail</p> })));
    window.history.replaceState({}, '', '/events/e1');
    const { findByTestId } = render(<App />);
    expect(await findByTestId('detail')).toBeTruthy();
    await waitFor(() => expect(isRouteLoadPending()).toBe(false));
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(sessionStorage.getItem(RELOAD_AT_KEY)).toBeNull();
    expect(prompt()?.dataset.mode).toBe('chunk');
  });

  it('路由 load 的計數在成功、失敗、換頁後才落定時都會清掉', async () => {
    // 成功
    registerFeatures(manifestsWith(() => Promise.resolve({ default: () => <p data-testid="detail">detail</p> })));
    window.history.replaceState({}, '', '/events/e1');
    const ok = render(<App />);
    expect(await ok.findByTestId('detail')).toBeTruthy();
    await waitFor(() => expect(isRouteLoadPending()).toBe(false));
    ok.unmount();

    // 失敗（60 秒窗內，不重載）
    _resetForTest();
    sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now() - 5_000));
    registerFeatures(manifestsWith(() => {
      attempts += 1;
      return failingLoad();
    }));
    const bad = render(<App />);
    await waitFor(() => expect(bad.container.querySelector('.error-fallback')).not.toBeNull());
    expect(isRouteLoadPending()).toBe(false);
    bad.unmount();

    // 換頁：詳情 load 還在等時就回首頁，之後才落定
    _resetForTest();
    sessionStorage.clear();
    let release: (() => void) | undefined;
    registerFeatures(manifestsWith(() => new Promise((resolvePromise) => {
      release = () => resolvePromise({ default: () => <p data-testid="detail">detail</p> });
    })));
    window.history.replaceState({}, '', '/');
    const nav = render(<App />);
    (await nav.findByTestId('go-detail')).click();
    await waitFor(() => expect(isRouteLoadPending()).toBe(true));
    window.history.back();
    release?.();
    await waitFor(() => expect(isRouteLoadPending()).toBe(false));
  });
});
