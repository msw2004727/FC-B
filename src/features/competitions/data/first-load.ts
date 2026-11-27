// CP-FIRST-LOAD：首次讀取 8 秒沒結果就重讀一次。第一輪逾時才開第二輪，最多兩輪。
// 紀錄只放 page／round／ms／outcome，不帶任何參數（uid、賽事 id、隊伍 id 都不寫）。

export const FIRST_LOAD_TIMEOUT_MS = 8_000;
export type FirstLoadPage = 'detail' | 'roster';
export type FirstLoadOutcome = 'ok' | 'error' | 'timeout';
export interface FirstLoadEntry { page: FirstLoadPage; round: 1 | 2; ms: number; outcome: FirstLoadOutcome }

/** 逾時錯誤：code 固定 'cp/first-load-timeout'，讓 loadFailOf 判成 'error'（顯示讀取失敗＋重試）。 */
export class FirstLoadTimeoutError extends Error {
  readonly code = 'cp/first-load-timeout';
}

export interface FirstLoadRun<T> { promise: Promise<T>; cancel: () => void }

const LOG_KEY = 'fcb:cp-first-load';
const LOG_MAX = 20;

function readLogRaw(): FirstLoadEntry[] {
  try {
    const raw = sessionStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FirstLoadEntry[]) : [];
  } catch {
    return [];
  }
}

function writeLog(entry: FirstLoadEntry): void {
  try {
    const list = readLogRaw();
    list.push(entry);
    sessionStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-LOG_MAX)));
  } catch {
    // sessionStorage 不可用時忽略。
  }
}

function record(page: FirstLoadPage, round: 1 | 2, startedAt: number, outcome: FirstLoadOutcome): void {
  const entry: FirstLoadEntry = {
    page,
    round,
    ms: Math.round(Date.now() - startedAt),
    outcome,
  };
  try {
    console.info('[cp-first-load]', entry);
  } catch {
    // console 不可用時忽略。
  }
  writeLog(entry);
}

/** 測試用：讀出 sessionStorage 紀錄（不觸發任何寫入）。 */
export function readFirstLoadLog(): FirstLoadEntry[] {
  return readLogRaw();
}

/** 測試用：清掉 sessionStorage 紀錄。 */
export function _clearFirstLoadLogForTest(): void {
  try {
    sessionStorage.removeItem(LOG_KEY);
  } catch {
    // 忽略。
  }
}

export function runFirstLoad<T>(
  page: FirstLoadPage,
  load: (round: 1 | 2) => Promise<T>,
  timeoutMs?: number,
): FirstLoadRun<T> {
  const limit = timeoutMs ?? FIRST_LOAD_TIMEOUT_MS;
  let canceled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveOuter: (value: T) => void = () => undefined;
  let rejectOuter: (err: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
  });

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function startRound(round: 1 | 2): void {
    const startedAt = Date.now();
    let settled = false;
    const failTimeout = (): void => {
      if (settled) return;
      settled = true;
      timer = null;
      if (canceled) return;
      record(page, round, startedAt, 'timeout');
      if (round === 1) {
        startRound(2);
      } else {
        rejectOuter(new FirstLoadTimeoutError('first load timed out'));
      }
    };
    timer = setTimeout(failTimeout, limit);
    let pending: Promise<T>;
    try {
      pending = Promise.resolve(load(round));
    } catch (err) {
      pending = Promise.reject(err);
    }
    pending.then((value) => {
      if (settled) return;
      settled = true;
      clearTimer();
      if (canceled) return;
      record(page, round, startedAt, 'ok');
      resolveOuter(value);
    }, (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimer();
      if (canceled) return;
      record(page, round, startedAt, 'error');
      rejectOuter(err);
    });
  }

  startRound(1);

  return {
    promise,
    cancel: () => {
      if (canceled) return;
      canceled = true;
      clearTimer();
    },
  };
}
