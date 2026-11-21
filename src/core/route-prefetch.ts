// U-009：切分頁預載
// - 首屏完成、瀏覽器空閒時預先下載底部 5 個分頁與抽屜常用頁的程式
// - 手指按下（pointerdown / touchstart）或滑鼠移入分頁／抽屜項目時立刻開始下載

import { getActiveRoutes } from './feature-registry';
import type { FeatureRoute } from './feature-types';
import { isRouteLoadPending } from './route-load-pending';

/** 閒置預載遇到路由正在載入（或本頁內容還在載入）時，隔多久再檢查一次。 */
const ROUTE_LOAD_RECHECK_MS = 500;

/**
 * 本頁第一批內容還沒畫出來時，閒置預載最多等到排程後這麼久；時間到不論內容好了沒都照常預載（不會永不預載）。
 * 顧問 §3.555（分塊量測報告 A）：賽事頁冷開時預載 7 個分頁約 250 KB，跟 Firestore SDK 與站內賽事區搶頻寬。
 */
export const CONTENT_WAIT_CAP_MS = 8_000;

/**
 * 「本頁內容還在載入」＝主內容區（App 的 `main.app-main`）裡有 aria-busy="true"（各頁骨架與清單載入中的既有標記，載完就拿掉）。
 * 只看主內容區：route-loading 掛在 body 的 #status-hint 隱藏後仍常駐 aria-busy="true"，頂欄、側欄也有自己的 aria-busy，都不算本頁內容。
 */
function isContentLoading(): boolean {
  return document.querySelector('.app-main [aria-busy="true"]') !== null;
}

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
  const scheduledAt = Date.now();

  const runPrefetch = (): void => {
    if (cancelled) return;
    // 顧問 §3.268：等路由載入結束才開始，避免預載失敗落在「路由載入中」而讓詳情頁整頁重整（演練：Chromium 預載早於詳情 chunk 完成）。
    // 只延後閒置預載；使用者按下分頁或抽屜時的預載（prefetchRouteByPath）照舊立即開始。路由載入計數超過 20 秒自動失效，不會一直延後。
    // 顧問 §3.555：路由載完後再等本頁第一批內容畫出（沒有 aria-busy），最多等到 CONTENT_WAIT_CAP_MS。
    if (isRouteLoadPending() || (isContentLoading() && Date.now() - scheduledAt < CONTENT_WAIT_CAP_MS)) {
      timer = setTimeout(runPrefetch, ROUTE_LOAD_RECHECK_MS);
      return;
    }
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
