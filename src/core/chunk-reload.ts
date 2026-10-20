// 跨版防護（2026-10-20 Fable 定案的三道保險之一）：
// 新版部署後，舊頁面再載入已被刪除的舊 chunk 會失敗（Vite 觸發 vite:preloadError）。
// 第一次失敗就重新載入一次拿新版；60 秒內又失敗代表不是版本問題，讓錯誤照常顯示，避免重載迴圈。

const RELOAD_AT_KEY = 'fcb:chunk-reload-at';
const RELOAD_WINDOW_MS = 60_000;

export interface ChunkReloadDeps {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  now: () => number;
  reload: () => void;
}

/** 回傳 true 表示已安排重載（呼叫端要阻止錯誤繼續往外丟）。 */
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
    });
    if (handled) event.preventDefault();
  });
}
