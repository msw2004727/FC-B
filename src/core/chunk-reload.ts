// 跨版防護（2026-10-20 Fable 定案的三道保險之一）＋ M-052 安全重載檢查：
// 新版部署後，舊頁面再載入已被刪除的舊 chunk 會失敗（Vite 觸發 vite:preloadError）。
// 第一次失敗就重新載入一次拿新版；60 秒內又失敗代表不是版本問題，讓錯誤照常顯示，避免重載迴圈。
// 顧問 §3.255 C′（2026-11-18）：活動詳情 `/events/<id>` 也可自動重載（只限這條路，SW 更新路徑不動）。
// 不能自動重載（彈窗、輸入中、送出中、其他頁）時改顯示中性「載入失敗｜重新載入」，
// 而且不 preventDefault：讓原錯誤照常丟給呼叫端，避免 Vite 回 undefined 讓呼叫端解構再出另一種錯。
// 取代：原本不能重載時顯示「有新版本可用」並 preventDefault，文案誤導且呼叫端拿到 undefined。

import { refreshThenReload } from './refresh-reload';
import { canReloadAfterChunkFailure, showChunkFailurePrompt } from './reload-safety';

export const RELOAD_AT_KEY = 'fcb:chunk-reload-at';
const RELOAD_WINDOW_MS = 60_000;

export interface ChunkReloadDeps {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  now: () => number;
  reload: () => void;
  /** 此刻能否自動重載；未提供視為可以（保持純單元測試相容）。 */
  canReload?: () => boolean;
  /** 不能自動重載時呼叫（顯示中性提示）；此時不寫時間戳、回傳 false。 */
  onBlocked?: (reload: () => void) => void;
}

/** 回傳 true 表示已安排重載（呼叫端要阻止錯誤繼續往外丟）；false 表示讓錯誤照常丟出。 */
export function handleChunkLoadFailure(deps: ChunkReloadDeps): boolean {
  const storage = deps.storage;
  if (!storage) return false;
  let now: number;
  let inWindow: boolean;
  try {
    now = deps.now();
    const last = Number(storage.getItem(RELOAD_AT_KEY) || 0);
    inWindow = !!last && now - last < RELOAD_WINDOW_MS;
  } catch {
    // 讀不到時間戳（或時鐘丟錯）一律不自動重載、不寫入（fail-closed）：防止「讀不到卻寫得進去」的異常 storage 連續重整（Flash 差異審 P2）。
    return false;
  }
  // 顧問 §3.268 乙：60 秒內再失敗不自動重載（防迴圈），但和「不能重載」一樣出中性提示讓使用者自己按「重新載入」；
  // 不寫時間戳、不 preventDefault。取代：原本窗內直接回 false、畫面只剩錯誤畫面。
  if (inWindow || (deps.canReload && !deps.canReload())) {
    deps.onBlocked?.(deps.reload);
    return false;
  }
  try {
    storage.setItem(RELOAD_AT_KEY, String(now));
  } catch {
    return false;
  }
  deps.reload();
  return true;
}

/** 本頁排重載的時間（頁面真的重載後模組重新載入，自然歸零）。 */
let scheduledAt = 0;
/** 等「已排的重整被取消」的 resolve。取消或測試重置時清空。 */
let cancelWaiters: Array<() => void> = [];

export function _resetChunkReloadGuardForTest(): void {
  scheduledAt = 0;
  cancelWaiters = [];
}

/** 守門已排重整、而且還沒被取消（scheduledAt 在 60 秒窗內）。 */
export function isChunkReloadScheduled(): boolean {
  return Date.now() - scheduledAt < RELOAD_WINDOW_MS;
}

/** 等「已排的重整被取消」（等待後不能重整）；已經沒有排程時立刻 resolve。頁面真的重整就永遠不會 resolve（沒關係）。 */
export function waitForChunkReloadCancelled(): Promise<void> {
  if (!isChunkReloadScheduled()) return Promise.resolve();
  return new Promise((resolve) => {
    // 排程可能在建立 promise 的同時被取消：沒排程就直接 resolve，不要推進清單。
    if (!isChunkReloadScheduled()) {
      resolve();
      return;
    }
    cancelWaiters.push(resolve);
  });
}

/**
 * 取消本頁排程並叫醒等待中的路由。
 * sessionStorage 時間戳不回滾：沒回滾時，60 秒內再失敗走「不能自動重整、出提示」的保守路徑，
 * 避免使用者正在操作時又被自動重整打斷、也避免迴圈；使用者仍可按提示框或錯誤畫面「重新嘗試」自己重整。
 */
function cancelScheduledReload(): void {
  scheduledAt = 0;
  const waiters = cancelWaiters;
  cancelWaiters = [];
  for (const resolve of waiters) resolve();
}

export function installChunkReloadGuard(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', (event) => {
    const storage = (() => {
      try { return sessionStorage; } catch { return null; }
    })();
    const now = Date.now();
    // Opus 終審 P3-1：同一次載入會連發多個事件（Vite 對每個失敗的 CSS 依賴各發一次，模組本身再一次）。
    // 本頁已排重載、而且未過 60 秒時，後續事件一律攔下，不再出錯誤畫面、提示與上報。
    // 取代：原本第二個事件落在 60 秒窗內，被當成「重載後又失敗」丟出原錯誤。
    if (now - scheduledAt < RELOAD_WINDOW_MS) {
      event.preventDefault();
      return;
    }
    const handled = handleChunkLoadFailure({
      storage,
      now: () => now,
      // 取代：直接 location.reload()；WebKit 會沿用失敗結果（§3.293）
      // §3.295(a)：等待後重整前再查一次
      // 仍走 void refreshThenReload()，多傳 canReload 與 onBlocked；真正換頁是 location.reload()，query 與 hash 留著。
      reload: () => {
        void refreshThenReload({
          canReload: () => canReloadAfterChunkFailure().safe,
          onBlocked: (retry) => {
            // §3.297 P2：等待後不能重整 → 取消排程，之後的失敗回到正常處理；並通知停在載入中的路由改顯示錯誤畫面。
            cancelScheduledReload();
            showChunkFailurePrompt(retry, 'chunk-load');
          },
        });
      },
      canReload: () => canReloadAfterChunkFailure().safe,
      onBlocked: (reload) => {
        showChunkFailurePrompt(reload, 'chunk-load');
      },
    });
    if (handled) {
      scheduledAt = now;
      event.preventDefault();
    }
  });
}
