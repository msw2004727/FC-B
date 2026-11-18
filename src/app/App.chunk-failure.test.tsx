import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/preact';
import { App } from '@/app/App';
import { RELOAD_AT_KEY, installChunkReloadGuard } from '@/core/chunk-reload';
import { reportClientError } from '@/core/error-report';
import { isModuleLoadFailure } from '@/core/module-load-error';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import type { FeatureManifest } from '@/core/feature-types';
import { _resetReloadSafetyForTest } from '@/core/reload-safety';
import { _resetSubmitGuardForTest, beginSubmitting } from '@/core/submit-guard';

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

describe('App：活動詳情 chunk 載入失敗（自動重載被擋或已用過）', () => {
  beforeAll(() => {
    installChunkReloadGuard();
  });

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

  it('D2 加一輪：重載後 60 秒內同一個 chunk 再失敗 → 停住、錯誤畫面、不再重載、不出提示', async () => {
    const at = String(Date.now() - 5_000);
    sessionStorage.setItem(RELOAD_AT_KEY, at);
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.error-fallback, [role="alert"]')).not.toBeNull());
    expect(sessionStorage.getItem(RELOAD_AT_KEY)).toBe(at);
    expect(prompt()).toBeNull();
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
