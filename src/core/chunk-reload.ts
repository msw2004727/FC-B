// 跨版防護（2026-10-20 Fable 定案的三道保險之一）＋ M-052 安全重載檢查：
// 新版部署後，舊頁面再載入已被刪除的舊 chunk 會失敗（Vite 觸發 vite:preloadError）。
// 第一次失敗就重新載入一次拿新版；60 秒內又失敗代表不是版本問題，讓錯誤照常顯示，避免重載迴圈。
// 顧問 §3.255 C′（2026-11-18）：活動詳情 `/events/<id>` 也可自動重載（只限這條路，SW 更新路徑不動）。
// 不能自動重載（彈窗、輸入中、送出中、其他頁）時改顯示中性「載入失敗｜重新載入」，
// 而且不 preventDefault：讓原錯誤照常丟給呼叫端，避免 Vite 回 undefined 讓呼叫端解構再出另一種錯。
// 取代：原本不能重載時顯示「有新版本可用」並 preventDefault，文案誤導且呼叫端拿到 undefined。

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

export function installChunkReloadGuard(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', (event) => {
    const handled = handleChunkLoadFailure({
      storage: (() => {
        try { return sessionStorage; } catch { return null; }
      })(),
      now: () => Date.now(),
      reload: () => location.reload(),
      canReload: () => canReloadAfterChunkFailure().safe,
      onBlocked: (reload) => {
        showChunkFailurePrompt(reload, 'chunk-load');
      },
    });
    if (handled) event.preventDefault();
  });
}
