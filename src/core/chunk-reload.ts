// 跨版防護（2026-10-20 Fable 定案的三道保險之一）＋ M-052 安全重載檢查：
// 新版部署後，舊頁面再載入已被刪除的舊 chunk 會失敗（Vite 觸發 vite:preloadError）。
// 第一次失敗就重新載入一次拿新版（彈窗開著或編輯中時改彈「有新版本可用」提示框，不直接重載）；
// 60 秒內又失敗代表不是版本問題，讓錯誤照常顯示，避免重載迴圈。
//
// DIAG-IOS-IMPORT 修法 B（顧問 §3.122）：iOS LINE 的失敗多半發生在頁面切到背景時（53 筆中 35 筆 vis=hidden），
// 背景中不重載也不擋錯，回前景再照「第一次失敗」規則處理一次；路由程式檔失敗改由路由錯誤邊界顯示重試畫面。

import type { ComponentType } from 'preact';
import { requestSafeReload } from './reload-safety';

export const RELOAD_AT_KEY = 'fcb:chunk-reload-at';
const RELOAD_WINDOW_MS = 60_000;

export interface ChunkReloadDeps {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  now: () => number;
  reload: () => void;
  /** M-052：選填自訂安全判斷；預設直接呼叫 deps.reload（保持純單元測試相容）。 */
  safeReload?: (reload: () => void) => void;
}

/** 回傳 true 表示已安排重載（呼叫端要阻止錯誤繼續往外丟）。 */
/** 回傳 true 表示已安排重載或提示更新（呼叫端要阻止錯誤繼續往外丟）。 */
export function handleChunkLoadFailure(deps: ChunkReloadDeps): boolean {
  try {
    if (!deps.storage) return false;
    const last = Number(deps.storage.getItem(RELOAD_AT_KEY) || 0);
    const now = deps.now();
    if (last && now - last < RELOAD_WINDOW_MS) return false;
    deps.storage.setItem(RELOAD_AT_KEY, String(now));
  } catch {
    return false;
  }
  if (deps.safeReload) {
    deps.safeReload(deps.reload);
  } else {
    deps.reload();
  }
  return true;
}

export interface ChunkReloadGuard {
  /** vite:preloadError 時呼叫。回傳 true 表示已安排重載或提示更新（呼叫端要 preventDefault）。 */
  onPreloadError: () => boolean;
  /** 回到前景（visibilitychange 變 visible、或 bfcache 還原）時呼叫。回傳 true 表示已安排重載或提示更新。 */
  onForeground: () => boolean;
}

/**
 * 背景中（document.hidden 或 pagehide 之後）的失敗只記下：不重載、不擋錯（各呼叫端照常收到錯誤，路由會顯示重試畫面）。
 * 回前景時若背景中失敗過，照「第一次失敗」規則處理一次：60 秒內已重載過就不再重載，畫面維持重試。
 */
export function createChunkReloadGuard(
  deps: ChunkReloadDeps,
  isBackground: () => boolean,
): ChunkReloadGuard {
  let deferred = false;
  return {
    onPreloadError() {
      if (isBackground()) {
        deferred = true;
        return false;
      }
      return handleChunkLoadFailure(deps);
    },
    onForeground() {
      if (!deferred || isBackground()) return false;
      deferred = false;
      return handleChunkLoadFailure(deps);
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteModule = { default: ComponentType<any> };

/**
 * 路由程式檔載入結果整理（給 preact-iso `lazy` 用）：
 * - 失敗：改回傳「畫出時丟出原錯誤」的元件，交給路由錯誤邊界顯示重試畫面。
 *   preact-iso 的 lazy／Router 對 rejection 沒有處理，原本只會停在上一頁或留白，並變成 unhandledrejection。
 * - 拿到 undefined：代表 vite:preloadError 已被本模組擋下（已安排重載或提示更新），維持載入中等重載，不閃錯誤畫面。
 */
export function settleRouteLoad(load: Promise<RouteModule | undefined>): Promise<RouteModule> {
  return load.then(
    (mod) => mod ?? new Promise<RouteModule>(() => {}),
    (error: unknown) => ({
      default: function RouteLoadFailed(): never {
        throw error;
      },
    }),
  );
}

export function installChunkReloadGuard(): void {
  if (typeof window === 'undefined') return;
  let pageHidden = false;
  const guard = createChunkReloadGuard(
    {
      storage: (() => {
        try { return sessionStorage; } catch { return null; }
      })(),
      now: () => Date.now(),
      reload: () => location.reload(),
      safeReload: (reload) => {
        requestSafeReload(reload);
      },
    },
    () => pageHidden || document.visibilityState === 'hidden',
  );
  window.addEventListener('vite:preloadError', (event) => {
    if (guard.onPreloadError()) event.preventDefault();
  });
  window.addEventListener('pagehide', () => {
    pageHidden = true;
  });
  window.addEventListener('pageshow', () => {
    pageHidden = false;
    guard.onForeground();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') guard.onForeground();
  });
}
