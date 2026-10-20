// U-011：彈窗或確認框開著時，實體返回鍵先關最上層彈窗。
// 做法：開彈窗時推一筆「同網址」的歷史紀錄；返回鍵只會退掉這筆，網址不變、頁面不會跟著換。
// 彈窗用按鈕關掉時，再把這筆退掉（下一刻若又開新彈窗就直接沿用，不來回推退）。

const STATE_KEY = '__overlay';

interface OverlayEntry {
  id: number;
  /** 回傳 false 代表這次不關（例如送出中），會補回一筆紀錄繼續攔返回鍵。 */
  onBack: () => boolean;
}

let nextId = 1;
const stack: OverlayEntry[] = [];
let ignorePops = 0;
let pendingRelease: { id: number; timer: ReturnType<typeof setTimeout> } | null = null;
let listening = false;

function currentOverlayId(): number | null {
  const state: unknown = history.state;
  if (state && typeof state === 'object' && STATE_KEY in state) {
    const value = (state as Record<string, unknown>)[STATE_KEY];
    return typeof value === 'number' ? value : null;
  }
  return null;
}

function stateWith(id: number): Record<string, unknown> {
  const state: unknown = history.state;
  const base = state && typeof state === 'object' ? (state as Record<string, unknown>) : {};
  return { ...base, [STATE_KEY]: id };
}

function onPopState(event: PopStateEvent): void {
  if (ignorePops > 0) {
    ignorePops -= 1;
    event.stopImmediatePropagation();
    return;
  }
  const top = stack.pop();
  if (!top) return;
  // 退掉的是彈窗那筆同網址紀錄，不讓路由或其他返回處理再動作。
  event.stopImmediatePropagation();
  let closed = true;
  try {
    closed = top.onBack();
  } catch (err) {
    console.error('[overlay-back] 關閉彈窗失敗', err);
  }
  if (!closed) {
    stack.push(top);
    try {
      history.pushState(stateWith(top.id), '', location.href);
    } catch {
      // 歷史紀錄受限時，只是返回鍵不再攔截。
    }
  }
}

/**
 * 登記一個開啟中的彈窗；回傳的函式在彈窗關閉（或卸載）時呼叫。
 * 由返回鍵關閉時呼叫它也安全（已不在堆疊中就不再動歷史紀錄）。
 */
export function pushOverlay(onBack: () => boolean): () => void {
  if (typeof window === 'undefined' || typeof history === 'undefined') return () => undefined;
  if (!listening) {
    window.addEventListener('popstate', onPopState, true);
    listening = true;
  }
  const id = nextId++;
  try {
    if (pendingRelease && currentOverlayId() === pendingRelease.id) {
      // 前一個彈窗剛關、它那筆紀錄還沒退：直接改給新彈窗用。
      clearTimeout(pendingRelease.timer);
      pendingRelease = null;
      history.replaceState(stateWith(id), '', location.href);
    } else {
      history.pushState(stateWith(id), '', location.href);
    }
  } catch {
    // 歷史紀錄受限時，彈窗照常運作，只是返回鍵不攔截。
  }
  stack.push({ id, onBack });

  return () => {
    const index = stack.findIndex((entry) => entry.id === id);
    if (index === -1) return;
    stack.splice(index, 1);
    if (currentOverlayId() !== id) return;
    if (pendingRelease) clearTimeout(pendingRelease.timer);
    const timer = setTimeout(() => {
      pendingRelease = null;
      // 關閉後若已換頁（目前紀錄不是這筆），留著那筆同網址紀錄即可，不退。
      if (currentOverlayId() !== id) return;
      ignorePops += 1;
      history.back();
    }, 0);
    pendingRelease = { id, timer };
  };
}

/** 測試用：清掉堆疊與待退紀錄。 */
export function _resetOverlayBackForTest(): void {
  stack.length = 0;
  ignorePops = 0;
  if (pendingRelease) clearTimeout(pendingRelease.timer);
  pendingRelease = null;
}
