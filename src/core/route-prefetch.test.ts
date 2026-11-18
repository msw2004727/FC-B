import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTest, registerFeatures } from './feature-registry';
import type { FeatureManifest } from './feature-types';
import { _resetRouteLoadPendingForTest, beginRouteLoad } from './route-load-pending';
import { _resetPrefetchForTest, prefetchRouteByPath, scheduleIdleRoutePrefetch } from './route-prefetch';

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
