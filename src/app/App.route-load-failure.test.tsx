// DIAG-IOS-IMPORT 修法 B：路由程式檔載入失敗改顯示既有錯誤邊界的重試畫面（不停在空白），按重試重新下載（L-30：第一次拒絕、第二次成功）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { App } from '@/app/App';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import type { FeatureManifest } from '@/core/feature-types';

vi.mock('@/core/error-report', () => ({ reportClientError: vi.fn(), installErrorReporter: vi.fn() }));
import { reportClientError } from '@/core/error-report';

// Opus 終審 P3：觀察重試畫面出現時的副作用（收掉載入指示、停掉卡住檢查）。
const stopStall = vi.fn();
vi.mock('@/core/content-stall', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/content-stall')>();
  return { ...actual, startContentStallCheck: vi.fn(() => stopStall) };
});
vi.mock('@/core/route-loading', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/route-loading')>();
  return { ...actual, beginRouteLoading: vi.fn(() => 41), endRouteLoading: vi.fn() };
});
import { endRouteLoading } from '@/core/route-loading';

function Fine(): preact.JSX.Element {
  return <p data-testid="fine">fine page</p>;
}

function Lazy(): preact.JSX.Element {
  return <p data-testid="lazy-page">lazy page</p>;
}

describe('App 路由程式檔載入失敗', () => {
  let rejectFirst: ((reason: unknown) => void) | null;
  let loadLazy: ReturnType<typeof vi.fn>;
  const unhandled = vi.fn();

  beforeEach(() => {
    rejectFirst = null;
    loadLazy = vi.fn()
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockImplementation(() => Promise.resolve({ default: Lazy }));
    const manifests: FeatureManifest[] = [
      { id: 'home', status: 'enabled', routes: [{ path: '/', load: () => Promise.resolve({ default: Fine }), titleKey: 'home.title' }], nav: [{ path: '/', labelKey: 'home.nav', icon: 'home', order: 0 }] },
      { id: 'lazy', status: 'enabled', routes: [{ path: '/lazy', load: loadLazy as unknown as FeatureManifest['routes'][number]['load'], titleKey: 'lazy.title' }] },
    ];
    _resetForTest();
    registerFeatures(manifests);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(reportClientError).mockClear();
    vi.mocked(endRouteLoading).mockClear();
    stopStall.mockClear();
    unhandled.mockClear();
    window.addEventListener('unhandledrejection', unhandled);
    window.history.replaceState({}, '', '/lazy');
  });

  afterEach(() => {
    window.removeEventListener('unhandledrejection', unhandled);
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('冷開失敗顯示重試畫面（外框仍在、不留白）；按重試重新下載並顯示頁面', async () => {
    const { container, findByTestId } = render(<App />);
    await waitFor(() => expect(rejectFirst).not.toBeNull());
    const error = new TypeError('Importing a module script failed.');
    rejectFirst?.(error);

    await waitFor(() => expect(container.querySelector('.error-fallback')).not.toBeNull());
    expect(container.querySelector('header')).not.toBeNull();
    // 錯誤照原錯誤物件交給上報器（背景中是否略過由 error-report 決定）。
    expect(reportClientError).toHaveBeenCalledWith('render', error);

    const retry = container.querySelector('.error-fallback__retry');
    expect(retry).not.toBeNull();
    fireEvent.click(retry as Element);

    expect(await findByTestId('lazy-page')).toBeTruthy();
    expect(loadLazy).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.error-fallback')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('顯示重試畫面時收掉換頁載入指示、停掉卡住檢查（onFallback）', async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(rejectFirst).not.toBeNull());
    vi.mocked(endRouteLoading).mockClear();
    stopStall.mockClear();
    rejectFirst?.(new TypeError('Importing a module script failed.'));

    await waitFor(() => expect(container.querySelector('.error-fallback')).not.toBeNull());
    expect(endRouteLoading).toHaveBeenCalledWith(41);
    expect(stopStall).toHaveBeenCalled();
  });

  it('import 回 undefined（preloadError 已擋下）：從快取移除，換頁回來重新下載', async () => {
    let resolveFirst = null as ((mod: undefined) => void) | null;
    loadLazy.mockReset();
    loadLazy
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementation(() => Promise.resolve({ default: Lazy }));
    const { findByTestId, queryByTestId } = render(<App />);
    await waitFor(() => expect(resolveFirst).not.toBeNull());
    resolveFirst?.(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryByTestId('lazy-page')).toBeNull();

    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await findByTestId('fine')).toBeTruthy();
    window.history.pushState({}, '', '/lazy');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(await findByTestId('lazy-page')).toBeTruthy();
    expect(loadLazy).toHaveBeenCalledTimes(2);
  });
});
