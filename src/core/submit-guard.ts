// 送出中計數（UPD-1b）。強制更新與安全重載讀 isSubmitting()，避免寫到一半被重整。
// 本卡只提供標記與釋放；報名、簽到、出席等流程的接線是 UPD-1b-2。
// 計數掛在 <html data-submitting>，不設 aria-busy：整頁 aria-busy 會讓輔助科技暫停朗讀。

export type SubmitLabel =
  | 'signup'
  | 'cancel'
  | 'roster-remove'
  | 'attendance-save'
  | 'attendance-settle'
  | 'checkin'
  | 'event-save';

const DEFAULT_MAX_HOLD_MS = 90_000;

let count = 0;
const idleListeners = new Set<() => void>();
const timers = new Set<ReturnType<typeof setTimeout>>();

function syncDom(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  if (count > 0) root.setAttribute('data-submitting', 'true');
  else root.removeAttribute('data-submitting');
}

function notifyIdle(): void {
  if (count !== 0) return;
  for (const cb of [...idleListeners]) cb();
}

/** 開始一段寫入。回傳的 release 可重複呼叫，只生效一次。逾時自動釋放。 */
export function beginSubmitting(label: SubmitLabel, maxHoldMs: number = DEFAULT_MAX_HOLD_MS): () => void {
  count += 1;
  syncDom();
  let released = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = (): void => {
    if (released) return;
    released = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(timer);
    }
    count = Math.max(0, count - 1);
    syncDom();
    notifyIdle();
  };
  timer = setTimeout(() => {
    console.warn('[submit-guard] 逾時釋放', label);
    release();
  }, maxHoldMs);
  timers.add(timer);
  return release;
}

/** await fn 期間標記送出中，成功或丟錯都釋放。 */
export function withSubmitting<T>(label: SubmitLabel, fn: () => Promise<T>): Promise<T> {
  const release = beginSubmitting(label);
  return Promise.resolve().then(fn).finally(release);
}

export function isSubmitting(): boolean {
  return count > 0;
}

/** 計數從大於 0 回到 0 時呼叫。回傳取消函式。 */
export function onSubmittingIdle(cb: () => void): () => void {
  idleListeners.add(cb);
  return () => {
    idleListeners.delete(cb);
  };
}

export function _resetSubmitGuardForTest(): void {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  count = 0;
  idleListeners.clear();
  syncDom();
}
