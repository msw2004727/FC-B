// 顧問 §3.290／§3.293 甲案：重載前只刷新記到的失敗程式檔（只刷新同源 /assets/）。
// 送出中規則由呼叫端負責（本函式不檢查）。

import { allPreloadAssetUrls, getFailedPreloads } from './failed-preloads';
import { beginRouteLoading } from './route-loading';

export const REFRESH_TIMEOUT_MS = 3000;

export interface RefreshReloadDeps {
  reload?: () => void; // 預設 () => location.reload()
  fetchImpl?: typeof fetch; // 預設 globalThis.fetch
  timeoutMs?: number; // 預設 REFRESH_TIMEOUT_MS
  online?: () => boolean; // 預設 () => navigator.onLine !== false
}

let inFlight: Promise<void> | null = null;
/** 測試重置時加一，進行中的那輪看到編號不合就不再 reload、也不清掉新的 inFlight。 */
let flightId = 0;

export function _resetRefreshReloadForTest(): void {
  flightId += 1;
  inFlight = null;
}

/** 不會 reject；reload 一定剛好呼叫 1 次（進行中再呼叫：直接回傳同一個 promise，不重複 fetch、不重複 reload）。 */
export function refreshThenReload(deps?: RefreshReloadDeps): Promise<void> {
  if (inFlight) return inFlight;

  const myId = flightId;
  let resolveFlight: () => void = () => {};
  const flight = new Promise<void>((resolve) => {
    resolveFlight = resolve;
  });
  inFlight = flight;

  const reload = deps?.reload ?? (() => location.reload());
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

  void run(deps, callReload, finish);
  return flight;
}

async function run(
  deps: RefreshReloadDeps | undefined,
  callReload: () => void,
  finish: () => void,
): Promise<void> {
  try {
    const fetchImpl = deps?.fetchImpl ?? (typeof fetch === 'function' ? (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init) : undefined);
    const timeoutMs = deps?.timeoutMs ?? REFRESH_TIMEOUT_MS;
    const online = deps?.online ?? (() => navigator.onLine !== false);
    const canFetch = typeof fetchImpl === 'function' && online() !== false;
    const urls = canFetch ? pickUrls() : [];
    if (!canFetch || urls.length === 0) {
      callReload();
      return;
    }
    // 沿用換頁載入提示（自身 220ms 才顯示，刷新很快就重載時不會閃）。
    beginRouteLoading({ path: location.pathname });
    await refreshUrls(fetchImpl, urls, timeoutMs);
    callReload();
  } catch {
    callReload();
  } finally {
    finish();
  }
}

function pickUrls(): string[] {
  const failed = getFailedPreloads();
  if (failed.length > 0) return failed;
  return allPreloadAssetUrls();
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
