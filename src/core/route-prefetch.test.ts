import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTest, registerFeatures } from './feature-registry';
import type { FeatureManifest } from './feature-types';
import { _resetRouteLoadPendingForTest, beginRouteLoad } from './route-load-pending';
import { CONTENT_WAIT_CAP_MS, _resetPrefetchForTest, prefetchRouteByPath, scheduleIdleRoutePrefetch } from './route-prefetch';

// 顧問 §3.268：閒置預載等路由載入結束才開始；使用者按下分頁的預載照舊立即開始。
describe('scheduleIdleRoutePrefetch：等路由載入結束', () => {
  let teamsLoad: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    _resetForTest();
    _resetPrefetchForTest();
    _resetRouteLoadPendingForTest();
    teamsLoad = vi.fn(() => Promise.resolve({ default: () => null }));
    const manifests: FeatureManifest[] = [
      { id: 'clubs', status: 'enabled', routes: [{ path: '/teams', load: teamsLoad as never, titleKey: 'clubs.title' }] },
    ];
    registerFeatures(manifests);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetRouteLoadPendingForTest();
  });

  it('路由載入中：閒置預載延後；載入結束後才開始', async () => {
    const settled = beginRouteLoad();
    const cancel = scheduleIdleRoutePrefetch();
    await vi.advanceTimersByTimeAsync(1200);
    expect(teamsLoad).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(teamsLoad).not.toHaveBeenCalled();
    settled();
    await vi.advanceTimersByTimeAsync(500);
    expect(teamsLoad).toHaveBeenCalledTimes(1);
    cancel();
  });

  it('沒有路由在載入：照原本時間開始', async () => {
    const cancel = scheduleIdleRoutePrefetch();
    await vi.advanceTimersByTimeAsync(1200);
    expect(teamsLoad).toHaveBeenCalledTimes(1);
    cancel();
  });

  it('延後期間取消：之後不再預載', async () => {
    beginRouteLoad();
    const cancel = scheduleIdleRoutePrefetch();
    await vi.advanceTimersByTimeAsync(1700);
    cancel();
    _resetRouteLoadPendingForTest();
    await vi.advanceTimersByTimeAsync(2000);
    expect(teamsLoad).not.toHaveBeenCalled();
  });

  it('使用者按下分頁的預載不等路由載入', async () => {
    beginRouteLoad();
    prefetchRouteByPath('/teams');
    await vi.advanceTimersByTimeAsync(0);
    expect(teamsLoad).toHaveBeenCalledTimes(1);
  });
});

// 顧問 §3.555（分塊量測報告 A）：路由載完後還要等本頁第一批內容畫出（主內容區沒有 aria-busy="true"），
// 最多等到 CONTENT_WAIT_CAP_MS；時間到照常預載，不得永不預載。
describe('scheduleIdleRoutePrefetch：等本頁第一批內容畫出（有上限）', () => {
  let teamsLoad: ReturnType<typeof vi.fn>;

  function appMain(): HTMLElement {
    const found = document.querySelector<HTMLElement>('main.app-main');
    if (found) return found;
    const main = document.createElement('main');
    main.className = 'app-main';
    return document.body.appendChild(main);
  }

  /** 在 App 主內容區（main.app-main）裡放一個 aria-busy 元素；inMain=false 則放在主內容區外。 */
  function busy(value = 'true', inMain = true): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('aria-busy', value);
    (inMain ? appMain() : document.body).appendChild(el);
    return el;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    _resetForTest();
    _resetPrefetchForTest();
    _resetRouteLoadPendingForTest();
    teamsLoad = vi.fn(() => Promise.resolve({ default: () => null }));
    registerFeatures([
      { id: 'clubs', status: 'enabled', routes: [{ path: '/teams', load: teamsLoad as never, titleKey: 'clubs.title' }] },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetRouteLoadPendingForTest();
    document.body.innerHTML = '';
  });

  it('內容載入中（aria-busy="true"）不預載；骨架拿掉後下一次檢查才預載', async () => {
    const skeleton = busy();
    const cancel = scheduleIdleRoutePrefetch();
    await vi.advanceTimersByTimeAsync(4000);
    expect(teamsLoad).not.toHaveBeenCalled();
    skeleton.remove();
    await vi.advanceTimersByTimeAsync(500);
    expect(teamsLoad).toHaveBeenCalledTimes(1);
    cancel();
  });

  it('內容一直沒畫出：到上限時間一定照常預載', async () => {
    busy();
    const cancel = scheduleIdleRoutePrefetch();
    await vi.advanceTimersByTimeAsync(CONTENT_WAIT_CAP_MS - 600);
    expect(teamsLoad).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1100);
    expect(teamsLoad).toHaveBeenCalledTimes(1);
    cancel();
  });

  it('上限時間從排程起算，與路由載入多久無關；路由載完時已過上限就不再等內容', async () => {
    busy();
    const settled = beginRouteLoad();
    const cancel = scheduleIdleRoutePrefetch();
    await vi.advanceTimersByTimeAsync(CONTENT_WAIT_CAP_MS + 1000);
    expect(teamsLoad).not.toHaveBeenCalled();
    settled();
    await vi.advanceTimersByTimeAsync(500);
    expect(teamsLoad).toHaveBeenCalledTimes(1);
    cancel();
  });

  it('aria-busy="false" 或沒有屬性不算載入中', async () => {
    busy('false');
    const cancel = scheduleIdleRoutePrefetch();
    await vi.advanceTimersByTimeAsync(1200);
    expect(teamsLoad).toHaveBeenCalledTimes(1);
    cancel();
  });

  it('主內容區外的 aria-busy（例如 route-loading 常駐在 body 的 #status-hint、頂欄登入鈕）不算本頁內容', async () => {
    busy('true', false).id = 'status-hint';
    appMain();
    const cancel = scheduleIdleRoutePrefetch();
    await vi.advanceTimersByTimeAsync(1200);
    expect(teamsLoad).toHaveBeenCalledTimes(1);
    cancel();
  });

  it('App 的主內容區仍是 main.app-main（改名會讓等待失效，這裡先鎖住）', () => {
    const app = readFileSync(resolve(__dirname, '../app/App.tsx'), 'utf8');
    expect(app).toContain('<main class="app-main">');
  });

  it('上限是 8 秒', () => {
    expect(CONTENT_WAIT_CAP_MS).toBe(8000);
  });
});
