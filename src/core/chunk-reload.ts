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

/** 背景中延後的失敗，超過這麼久才回前景就作廢、不重載（Opus 終審 P3）。 */
const DEFERRED_TTL_MS = 5 * 60_000;

/** 背景中延後、回前景處理時沒有重載（畫面停在重試）的失敗；給上報補一筆用（Opus 終審 P2-1）。 */
export interface DeferredChunkFailure {
  error: unknown;
  /** 延後當下的 document.visibilityState。 */
  vis: string;
  /** 延後當下是否已 pagehide。 */
  leaving: boolean;
  /** 從延後到回前景處理的毫秒數。 */
  waitMs: number;
}

export interface ChunkReloadGuardOptions {
  /** 延後當下的頁面狀態（寫進上報 diag）。 */
  readState?: () => { vis: string; leaving: boolean };
  /** 回前景處理延後的失敗、但沒有重載（60 秒窗口內、或延後已作廢）時呼叫。 */
  onStuck?: (failure: DeferredChunkFailure) => void;
}

export interface ChunkReloadGuard {
  /** vite:preloadError 時呼叫。回傳 true 表示已安排重載或提示更新（呼叫端要 preventDefault）。 */
  onPreloadError: (error?: unknown) => boolean;
  /** 回到前景（visibilitychange 變 visible、bfcache 還原、或使用者按重試）時呼叫。回傳 true 表示已安排重載或提示更新。 */
  onForeground: () => boolean;
}

/**
 * 背景中（document.hidden 或 pagehide 之後）的失敗只記下：不重載、不擋錯（各呼叫端照常收到錯誤，路由會顯示重試畫面）。
 * 回前景時若背景中失敗過，照「第一次失敗」規則處理一次：60 秒內已重載過就不再重載，畫面維持重試；
 * 延後超過 5 分鐘才回前景也不重載。沒重載時呼叫 onStuck 補一筆上報（背景當下不寫，保持降噪）。
 */
export function createChunkReloadGuard(
  deps: ChunkReloadDeps,
  isBackground: () => boolean,
  options: ChunkReloadGuardOptions = {},
): ChunkReloadGuard {
  let deferred: { at: number; error: unknown; vis: string; leaving: boolean } | null = null;
  return {
    onPreloadError(error) {
      if (isBackground()) {
        if (!deferred) {
          const state = options.readState?.() ?? { vis: '', leaving: false };
          deferred = { at: deps.now(), error, vis: state.vis, leaving: state.leaving };
        }
        return false;
      }
      return handleChunkLoadFailure(deps);
    },
    onForeground() {
      if (!deferred || isBackground()) return false;
      const failure = deferred;
      deferred = null;
      const waitMs = deps.now() - failure.at;
      if (waitMs <= DEFERRED_TTL_MS && handleChunkLoadFailure(deps)) return true;
      options.onStuck?.({ error: failure.error, vis: failure.vis, leaving: failure.leaving, waitMs });
      return false;
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

/** 使用者按過重試、之後還沒再切背景：一律視為前景（iOS 可能不送 visible，visibilityState 卡在 hidden；Opus 終審 P2-2）。 */
let gestureForeground = false;
let installedGuard: ChunkReloadGuard | null = null;

export function isGestureForeground(): boolean {
  return gestureForeground;
}

/** 重試畫面按「重試」（使用者手勢）時呼叫：視為前景，先處理背景中延後的失敗，呼叫端再重新 import。 */
export function noteUserRetry(): void {
  gestureForeground = true;
  installedGuard?.onForeground();
}

/** 測試用：清掉手勢前景旗標。 */
export function _resetGestureForegroundForTest(): void {
  gestureForeground = false;
}

export function installChunkReloadGuard(onStuck?: (failure: DeferredChunkFailure) => void): void {
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
    () => !gestureForeground && (pageHidden || document.visibilityState === 'hidden'),
    { readState: () => ({ vis: document.visibilityState, leaving: pageHidden }), onStuck },
  );
  installedGuard = guard;
  window.addEventListener('vite:preloadError', (event) => {
    if (guard.onPreloadError((event as Event & { payload?: unknown }).payload)) event.preventDefault();
  });
  window.addEventListener('pagehide', () => {
    pageHidden = true;
    gestureForeground = false;
  });
  window.addEventListener('pageshow', () => {
    pageHidden = false;
    guard.onForeground();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') guard.onForeground();
    else gestureForeground = false;
  });
}
