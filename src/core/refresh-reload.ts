// 顧問 §3.290／§3.293 甲案：重載前只刷新記到的失敗程式檔（只刷新同源 /assets/）。
// §3.320：vite:preloadError 比 link error 早 10～30ms。記錄是空、文件已有候選時先等 FAILED_WAIT_MS 再讀，仍空才刷全部；這段等待算在 REFRESH_TIMEOUT_MS 內。
// §3.295(a)：等待後重整前再查一次。離線或沒有網址而直接重整的路徑不查（呼叫端剛同步查過）。

import { allPreloadAssetUrls, getFailedPreloads } from './failed-preloads';
// reload-safety 不 import 本檔，這裡引 showReloadBusyToast 不會循環。
import { showReloadBusyToast } from './reload-safety';
import { beginRouteLoading, endRouteLoading } from './route-loading';
import { isSubmitting } from './submit-guard';

export const REFRESH_TIMEOUT_MS = 3000;
// 涵蓋實測 10～30 ms 的事件先後差。
export const FAILED_WAIT_MS = 100;

export interface RefreshReloadDeps {
  reload?: () => void; // 預設 () => location.reload()
  fetchImpl?: typeof fetch; // 預設 globalThis.fetch
  timeoutMs?: number; // 預設 REFRESH_TIMEOUT_MS
  online?: () => boolean; // 預設 () => navigator.onLine !== false
  /** 等待結束、真的重整前再查一次；回 false 就不重整。預設：沒有送出中（isSubmitting() 為 false 且沒有 [data-submitting="true"]）。 */
  canReload?: () => boolean;
  /** canReload 回 false 時呼叫，參數是「再試一次」的函式（會重新走 refreshThenReload，帶同樣的 deps）。預設：showReloadBusyToast()。 */
  onBlocked?: (retry: () => void) => void;
}

let inFlight: Promise<void> | null = null;
/** 測試重置時加一，進行中的那輪看到編號不合就不再 reload、也不清掉新的 inFlight。 */
let flightId = 0;
/** 測試替換預設的 location.reload。有傳 deps.reload 時仍用傳入的。 */
let testReload: (() => void) | null = null;

/** 測試用：沒傳 deps.reload 時改呼叫 fn。不傳或傳 undefined 就還原。 */
export function _setRefreshReloadForTest(fn?: () => void): void {
  testReload = fn ?? null;
}

export function _resetRefreshReloadForTest(): void {
  flightId += 1;
  inFlight = null;
  testReload = null;
}

/** 不會 reject。沒被擋時 reload 剛好 1 次；等待後不能重整則不 reload、改呼叫 onBlocked。進行中再呼叫：直接回傳同一個 promise，不重複 fetch、不重複 reload。 */
export function refreshThenReload(deps?: RefreshReloadDeps): Promise<void> {
  if (inFlight) return inFlight;

  const myId = flightId;
  let resolveFlight: () => void = () => {};
  const flight = new Promise<void>((resolve) => {
    resolveFlight = resolve;
  });
  inFlight = flight;

  const reload = deps?.reload ?? testReload ?? (() => location.reload());
  let reloaded = false;
  const callReload = (): void => {
    if (reloaded || myId !== flightId) return;
    reloaded = true;
    try {
      reload();
    } catch {
      // jsdom 的 location.reload 未實作會丟錯；仍算呼叫過一次，promise 不 reject。
    }
  };
  const finish = (): void => {
    if (myId === flightId && inFlight === flight) inFlight = null;
    resolveFlight();
  };
  // 被擋時要在 onBlocked 之前清掉，同步 retry 才能開新的一輪。
  const releaseForRetry = (): void => {
    if (myId === flightId && inFlight === flight) inFlight = null;
  };
  const retry = (): void => {
    void refreshThenReload(deps);
  };

  void run(deps, callReload, finish, releaseForRetry, retry);
  return flight;
}

async function run(
  deps: RefreshReloadDeps | undefined,
  callReload: () => void,
  finish: () => void,
  releaseForRetry: () => void,
  retry: () => void,
): Promise<void> {
  let loadingSeq = 0;
  try {
    try {
      const fetchImpl = deps?.fetchImpl ?? (typeof fetch === 'function' ? (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init) : undefined);
      const timeoutMs = deps?.timeoutMs ?? REFRESH_TIMEOUT_MS;
      const online = deps?.online ?? (() => navigator.onLine !== false);
      // 離線或沒有 fetch：直接重整，不等。
      if (typeof fetchImpl !== 'function' || online() === false) {
        callReload();
        return;
      }
      // 截止時間從這輪開始算。等待與刷新共用，到 reload 或 onBlocked 仍 ≤ timeoutMs。
      const deadline = Date.now() + timeoutMs;
      // 沿用換頁載入提示（自身 220ms 才顯示，等待與刷新很快時不會閃）。
      loadingSeq = beginRouteLoading({ path: location.pathname });
      // 記錄是空、文件有候選時先等一下（link error 晚 10～30ms 才到）再讀。
      if (!getFailedPreloads().length && allPreloadAssetUrls().length) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, FAILED_WAIT_MS);
        });
      }
      let urls = getFailedPreloads();
      if (!urls.length) urls = allPreloadAssetUrls();
      if (!urls.length) {
        endRouteLoading(loadingSeq);
        callReload();
        return;
      }
      await refreshUrls(fetchImpl, urls, Math.max(0, deadline - Date.now()));
    } catch {
      callReload();
      return;
    }

    // §3.295(a)：等待後重整前再查一次
    if (!canReloadNow(deps)) {
      // 不重整時收掉載入提示，不讓它一直掛著。
      endRouteLoading(loadingSeq);
      releaseForRetry();
      try {
        const notify = deps?.onBlocked ?? defaultOnBlocked;
        notify(retry);
      } catch {
        // onBlocked 丟錯就吞掉，不 reject。
      }
      return;
    }
    callReload();
  } finally {
    finish();
  }
}

/** 丟錯或回 false 都視為不能重整。 */
function canReloadNow(deps: RefreshReloadDeps | undefined): boolean {
  const canReload = deps?.canReload ?? defaultCanReload;
  try {
    return canReload() !== false;
  } catch {
    return false;
  }
}

function defaultCanReload(): boolean {
  if (isSubmitting()) return false;
  if (typeof document !== 'undefined' && document.querySelector('[data-submitting="true"]')) return false;
  return true;
}

function defaultOnBlocked(): void {
  showReloadBusyToast();
}

async function refreshUrls(fetchImpl: typeof fetch, urls: readonly string[], timeoutMs: number): Promise<void> {
  const jobs = urls.map((url) => fetchAsset(fetchImpl, url));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([Promise.all(jobs), timeout]);
  } finally {
    // race 結束就清掉計時器，避免逾時回呼留著。
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 單一網址失敗（含同步丟錯）吞掉，不擋住其餘刷新。 */
async function fetchAsset(fetchImpl: typeof fetch, url: string): Promise<void> {
  try {
    await fetchImpl(url, { cache: 'no-cache', credentials: 'same-origin' });
  } catch {
    // 個別失敗不往外丟。
  }
}
