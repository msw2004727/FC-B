// 「路由正在載入」計數（顧問 §3.263 甲）：chunk 失敗時，活動詳情頁只有在路由 load 進行中才放行自動重載；
// 背景預載或其他動態載入失敗不算。計數掛在 App getRouteComponent 的每一次 load 上，load 一落定（成功、失敗、
// 回 undefined、換頁後才落定）就移除，不靠路由器的開始／結束事件，所以每一條結束路徑都會清掉。
// 超過 MAX_AGE_MS 還沒落定的 load 不算（防殘留：永遠不落定的請求不能讓之後的背景失敗一直被當成路由載入）。
// 這個檔不得 import 任何模組（reload-safety 在首頁入口，App 也引用）。

const MAX_AGE_MS = 20_000;
const pending = new Map<number, number>();
let seq = 0;

/** 路由 load 開始時呼叫；回傳的函式在 load 落定時呼叫（可重複呼叫）。 */
export function beginRouteLoad(now: number = Date.now()): () => void {
  const id = ++seq;
  pending.set(id, now);
  return () => {
    pending.delete(id);
  };
}

export function isRouteLoadPending(now: number = Date.now()): boolean {
  for (const [id, at] of pending) {
    if (now - at <= MAX_AGE_MS) return true;
    pending.delete(id);
  }
  return false;
}

export const ROUTE_LOAD_PENDING_MAX_AGE_MS = MAX_AGE_MS;

export function _resetRouteLoadPendingForTest(): void {
  pending.clear();
}
