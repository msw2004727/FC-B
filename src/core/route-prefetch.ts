// U-009：切分頁預載
// - 首屏完成、瀏覽器空閒時預先下載底部 5 個分頁與抽屜常用頁的程式
// - 手指按下（pointerdown / touchstart）或滑鼠移入分頁／抽屜項目時立刻開始下載

import { getActiveRoutes } from './feature-registry';
import type { FeatureRoute } from './feature-types';

const PREFETCH_PRIORITY_PATHS = [
  '/',
  '/activities',
  '/teams',
  '/tournaments',
  '/profile',
  '/inbox',
  '/my-activities',
  '/profile/qr',
] as const;

const prefetchedLoaders = new Set<FeatureRoute['load']>();

export function prefetchRouteByPath(targetPath: string): void {
  if (!targetPath) return;
  const clean = targetPath.split('?')[0]?.split('#')[0] || '/';
  const routes = getActiveRoutes();
  for (const r of routes) {
    if (r.path === clean && !prefetchedLoaders.has(r.load)) {
      prefetchedLoaders.add(r.load);
      Promise.resolve()
        .then(() => r.load())
        .catch(() => {
          // 預載失敗時從集合移除，讓之後正式點擊仍可重試（遵守 L-08）
          prefetchedLoaders.delete(r.load);
        });
    }
  }
}

export function scheduleIdleRoutePrefetch(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idleId: number | null = null;

  const runPrefetch = (): void => {
    if (cancelled) return;
    for (const path of PREFETCH_PRIORITY_PATHS) {
      if (cancelled) return;
      prefetchRouteByPath(path);
    }
  };

  const ric = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }
  ).requestIdleCallback;

  if (typeof ric === 'function') {
    idleId = ric(runPrefetch, { timeout: 2500 });
  } else {
    timer = setTimeout(runPrefetch, 1200);
  }

  return () => {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
    const cic = (window as Window & { cancelIdleCallback?: (id: number) => void })
      .cancelIdleCallback;
    if (idleId !== null && typeof cic === 'function') {
      cic(idleId);
    }
  };
}

export function _resetPrefetchForTest(): void {
  prefetchedLoaders.clear();
}
