// U-010：列表返回保留捲動位置，其他頁照 A 回頂（`js/core/navigation.js:123-153`）。
// - 活動列表（/activities）與俱樂部列表（/teams）在離開前保存 window.scrollY，
//   返回時等資料到齊後再捲回離開前位置。
// - 其他頁面切換時立即且在 rAF + 120ms 重設捲動位置到頂端（照 A `_resetPageScroll`）。

import { normalizeRoutePath } from './back-guard';

const savedScrollPositions = new Map<string, number>();
const pendingRestorePaths = new Set<string>();
let scrollResetTimer: ReturnType<typeof setTimeout> | null = null;

export function isScrollRestoreListPath(path: string): boolean {
  const clean = normalizeRoutePath(path);
  return clean === '/activities' || clean === '/teams';
}

export function isDetailRouteForList(fromPath: string, toListPath: string): boolean {
  const cleanFrom = normalizeRoutePath(fromPath);
  const cleanTo = normalizeRoutePath(toListPath);
  if (cleanTo === '/activities') {
    return /^\/events\/[^/]+/.test(cleanFrom) || /^\/activities\/[^/]+/.test(cleanFrom);
  }
  if (cleanTo === '/teams') {
    return /^\/teams\/[^/]+/.test(cleanFrom);
  }
  return false;
}

/** 離開列表頁時記錄捲動位置。 */
export function saveListScrollPosition(path: string, scrollY?: number): void {
  const clean = normalizeRoutePath(path);
  if (!isScrollRestoreListPath(clean)) return;
  const y =
    typeof scrollY === 'number'
      ? scrollY
      : typeof window !== 'undefined'
        ? window.scrollY || window.pageYOffset || 0
        : 0;
  savedScrollPositions.set(clean, Math.max(0, y));
}

/** 當從詳情頁退回列表頁時，標記該列表頁待資料到齊後還原捲動位置。 */
export function markListScrollForRestore(fromPath: string, toPath: string): boolean {
  const cleanTo = normalizeRoutePath(toPath);
  if (isDetailRouteForList(fromPath, cleanTo) && savedScrollPositions.has(cleanTo)) {
    pendingRestorePaths.add(cleanTo);
    return true;
  }
  pendingRestorePaths.delete(cleanTo);
  return false;
}

/** 列表頁資料到齊（或 DOM 渲染完成）後呼叫，將捲動位置捲回離開前的位置。 */
export function notifyListContentReady(path: string): boolean {
  const clean = normalizeRoutePath(path);
  if (!pendingRestorePaths.has(clean)) return false;
  pendingRestorePaths.delete(clean);
  const targetY = savedScrollPositions.get(clean);
  if (targetY === undefined || typeof window === 'undefined') return false;

  const applyScroll = (): void => {
    try {
      window.scrollTo(0, targetY);
    } catch {
      /* ignore in JSDOM */
    }
  };

  applyScroll();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => applyScroll());
  }
  return true;
}

/** 照 A `_resetPageScroll`（`js/core/navigation.js:123-153`）將頁面捲回頂部。 */
export function resetPageScrollToTop(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const performReset = (): void => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlBehavior = html ? html.style.scrollBehavior : '';
    const prevBodyBehavior = body ? body.style.scrollBehavior : '';
    if (html) html.style.scrollBehavior = 'auto';
    if (body) body.style.scrollBehavior = 'auto';

    try {
      window.scrollTo(0, 0);
    } catch {
      /* ignore in JSDOM */
    }
    if (html) html.scrollTop = 0;
    if (body) body.scrollTop = 0;
    const activePage = document.querySelector<HTMLElement>('.page.active');
    if (activePage) activePage.scrollTop = 0;

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (html) html.style.scrollBehavior = prevHtmlBehavior;
        if (body) body.style.scrollBehavior = prevBodyBehavior;
      });
    }
  };

  performReset();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => performReset());
  }
  if (scrollResetTimer !== null) clearTimeout(scrollResetTimer);
  scrollResetTimer = setTimeout(() => {
    performReset();
    scrollResetTimer = null;
  }, 120);
}

/**
 * 等列表頁資料到齊（頁內不再有 aria-busy／載入中元素）再捲回離開前位置；
 * 每 100ms 檢查一次，最多等 5 秒，逾時就放棄（不硬捲到一半的頁面）。
 */
export function scheduleAutoListScrollRestore(path: string): () => void {
  const clean = normalizeRoutePath(path);
  if (!pendingRestorePaths.has(clean) || typeof document === 'undefined') {
    return () => undefined;
  }

  const startedAt = Date.now();
  const timer = setInterval(() => {
    const page = document.querySelector('#page-activities, #page-teams');
    const loading = page?.querySelector('[aria-busy="true"], .reg-loading');
    if (page && !loading) {
      clearInterval(timer);
      notifyListContentReady(clean);
    } else if (Date.now() - startedAt > 5000) {
      clearInterval(timer);
      pendingRestorePaths.delete(clean);
    }
  }, 100);

  return () => clearInterval(timer);
}

export function _resetScrollRestoreForTest(): void {
  savedScrollPositions.clear();
  pendingRestorePaths.clear();
  if (scrollResetTimer !== null) {
    clearTimeout(scrollResetTimer);
    scrollResetTimer = null;
  }
}
