// M-034、M-037、M-045、M-046：返回與登入守門。
// - 返回以瀏覽器歷史為準：本站第一筆紀錄、點底部分頁後的那筆、以及 LINE／PWA 的首頁哨兵，標成「起點」；
//   頁面上的返回鈕在起點時改走預設頁（取代目前紀錄，不跳出網站），否則就是瀏覽器上一頁，
//   這樣頁內返回鈕與實體返回鍵走的是同一條紀錄，不會互相錯開。
// - 底部分頁與抽屜 AUTH_REQUIRED_PAGES 守門（照 A `js/config.js:634-637`）。
// - LINE 內建瀏覽器／PWA 首頁返回保護哨兵（照 A `app.js#_maybePushBootSentinel` 與 popstate 的 sentinel 攔截）。

import { useCallback } from 'preact/hooks';
import { useLocation } from 'preact-iso';

/**
 * A `js/config.js:634-637` AUTH_REQUIRED_PAGES：
 * 點擊底部分頁或抽屜時需要登入的頁面（個人／訊息）。
 */
export const AUTH_REQUIRED_PAGES = Object.freeze([
  'page-profile',
  'page-messages',
] as const);

export function isAuthRequiredRoute(pathOrPage: string): boolean {
  if (!pathOrPage) return false;
  if ((AUTH_REQUIRED_PAGES as readonly string[]).includes(pathOrPage)) return true;
  const clean = normalizeRoutePath(pathOrPage);
  return clean === '/profile' || clean === '/inbox';
}

export function normalizeRoutePath(rawPath: string): string {
  if (!rawPath) return '/';
  const clean = rawPath.split(/[?#]/)[0]?.trim() || '/';
  return clean.startsWith('/') ? clean : `/${clean}`;
}

const ROOT_KEY = '__fcbRoot';

function currentState(): Record<string, unknown> {
  const state: unknown = history.state;
  return state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
}

/** 把目前這筆歷史紀錄標成起點（頁內返回鈕在這裡不再往回退）。 */
export function markHistoryRoot(): void {
  try {
    history.replaceState({ ...currentState(), [ROOT_KEY]: true }, '', location.href);
  } catch {
    // 歷史紀錄受限時，返回鈕退回瀏覽器上一頁。
  }
}

function isHistoryRoot(): boolean {
  const state = currentState();
  return state[ROOT_KEY] === true || state['sentinel'] === true || history.length <= 1;
}

/**
 * M-045：共用返回。前面還有本站的頁就退回上一頁；在起點時取代成預設頁（不跳出網站），
 * 取代後的那筆仍是起點。
 */
export function useGoBack(fallbackPath = '/'): () => void {
  const { route } = useLocation();
  return useCallback(() => {
    if (!isHistoryRoot()) {
      history.back();
      return;
    }
    route(fallbackPath, true);
    markHistoryRoot();
  }, [route, fallbackPath]);
}

/** 照 A `_shouldInstallSentinel`：LINE App 內或已安裝的 PWA 才裝首頁哨兵。 */
export function shouldInstallBootSentinel(): boolean {
  try {
    const inLine = /\bLine\//i.test(navigator.userAgent);
    const standalone =
      (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return inLine || standalone;
  } catch {
    return false;
  }
}

let bootSentinelInstalled = false;

/**
 * 開站時標記起點；在 LINE／PWA 另照 A 雙寫哨兵：
 * 第一筆紀錄改成首頁哨兵（網址 `/`），再推回目前頁。退到哨兵時路由自然顯示首頁，
 * 再補推一筆哨兵，之後怎麼按返回都停在首頁，不會跳出 Mini App。
 * 回傳解除監聽的函式。
 */
export function initBackGuard(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const sentinel = shouldInstallBootSentinel();
  if (sentinel && !bootSentinelInstalled) {
    bootSentinelInstalled = true;
    try {
      const originalUrl = location.href;
      history.replaceState({ source: 'sportshub', sentinel: true }, '', '/');
      history.pushState({}, '', originalUrl);
    } catch {
      // 歷史紀錄受限時不裝哨兵。
    }
  }
  markHistoryRoot();
  if (!sentinel) return () => undefined;

  const handlePopState = (event: PopStateEvent): void => {
    const state: unknown = event.state;
    if (!state || typeof state !== 'object') return;
    const record = state as Record<string, unknown>;
    if (record['source'] !== 'sportshub' || record['sentinel'] !== true) return;
    try {
      history.pushState({ source: 'sportshub', sentinel: true }, '', location.href);
    } catch {
      // 補推失敗時，下一次返回會照瀏覽器預設離開。
    }
  };
  window.addEventListener('popstate', handlePopState);
  return () => window.removeEventListener('popstate', handlePopState);
}

/** 測試用：重設哨兵安裝狀態。 */
export function _resetBackGuardForTest(): void {
  bootSentinelInstalled = false;
}
