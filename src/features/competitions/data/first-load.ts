// CP-FIRST-LOAD：首次讀取 8 秒沒結果就重讀一次。第一輪逾時才開第二輪，最多兩輪。
// 紀錄只放 page／round／ms／outcome，不帶任何參數（uid、賽事 id、隊伍 id 都不寫）。

import { readAppVersion } from '@/core/app-meta';
import { getFirebase } from '@/data/firebase';
import { isCpFirebaseStarted } from './cp-firebase';

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

// CP-FIRST-LOAD-REPORT：逾時當下寫一筆精簡紀錄到主庫 errorLogs（嚴格白名單欄位）。
const REPORT_SENT_KEY = 'fcb:cp-first-load-sent';
const REPORT_MAX_PER_PAGE = 2;
const memoryReportCount: { detail: number; roster: number } = { detail: 0, roster: 0 };

interface FirstLoadReportInput {
  page: FirstLoadPage;
  round: 1 | 2;
  ms: number;
  outcome: FirstLoadOutcome;
  sinceNavMs: number | null;
  cpInstanceFresh: boolean;
  authSettled: boolean | null;
}

function readSessionReportCount(page: FirstLoadPage): number {
  try {
    const raw = sessionStorage.getItem(REPORT_SENT_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed[page] === 'number') {
      return parsed[page];
    }
    return 0;
  } catch {
    return 0;
  }
}

function canSendReport(page: FirstLoadPage): boolean {
  const current = Math.max(memoryReportCount[page], readSessionReportCount(page));
  return current < REPORT_MAX_PER_PAGE;
}

function markReportSent(page: FirstLoadPage): void {
  memoryReportCount[page] += 1;
  const newCount = memoryReportCount[page];
  try {
    let data: { detail: number; roster: number } = { detail: 0, roster: 0 };
    const raw = sessionStorage.getItem(REPORT_SENT_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          data = {
            detail: typeof parsed.detail === 'number' ? parsed.detail : 0,
            roster: typeof parsed.roster === 'number' ? parsed.roster : 0,
          };
        }
      } catch {
        data = { detail: 0, roster: 0 };
      }
    }
    data[page] = Math.max(data[page], newCount);
    sessionStorage.setItem(REPORT_SENT_KEY, JSON.stringify(data));
  } catch {
    // 忽略。
  }
}

/** 測試用：清模組層計數與 sessionStorage 上報計數。 */
export function _resetFirstLoadReportForTest(): void {
  memoryReportCount.detail = 0;
  memoryReportCount.roster = 0;
  try {
    sessionStorage.removeItem(REPORT_SENT_KEY);
  } catch {
    // 忽略。
  }
}

function detectBrowser(): 'line' | 'chrome' | 'safari' | 'other' {
  try {
    const ua = navigator.userAgent;
    if (/Line\//i.test(ua)) return 'line';
    // Edge 的 UA 同時含 Chrome／Safari 字樣，先歸其他。
    if (/Edg/.test(ua)) return 'other';
    if (/CriOS/.test(ua) || /Chrome\//.test(ua)) return 'chrome';
    if (/Safari\//.test(ua)) return 'safari';
    return 'other';
  } catch {
    return 'other';
  }
}

function detectStandalone(): boolean {
  try {
    const mql = window.matchMedia?.('(display-mode: standalone)');
    const mq = mql ? mql.matches === true : false;
    const nav = (navigator as { standalone?: boolean }).standalone === true;
    return mq || nav;
  } catch {
    return false;
  }
}

let firestoreSdk: Promise<typeof import('firebase/firestore')> | null = null;

async function sendFirstLoadReport(entry: FirstLoadReportInput): Promise<void> {
  try {
    const fb = await getFirebase();
    if (!fb.auth.currentUser) return;
    // 兩筆上報共用同一次載入；載入失敗就清掉，下次可重試。
    firestoreSdk ??= import('firebase/firestore').catch((err: unknown) => {
      firestoreSdk = null;
      throw err;
    });
    const { addDoc, collection, serverTimestamp } = await firestoreSdk;
    await addDoc(collection(fb.db, 'errorLogs'), {
      context: 'cp-first-load',
      createdAt: serverTimestamp(),
      version: readAppVersion(),
      page: entry.page,
      round: entry.round,
      ms: entry.ms,
      outcome: entry.outcome,
      browser: detectBrowser(),
      standalone: detectStandalone(),
      sinceNavMs: entry.sinceNavMs,
      cpInstanceFresh: entry.cpInstanceFresh,
      authSettled: entry.authSettled,
      errorCode: 'cp-first-load',
      errorMessage: '賽事首次讀取量測紀錄（非錯誤）',
      noise: true,
    });
  } catch {
    // 全部吞掉：不 console.error、不重拋。
  }
}

export interface FirstLoadCtx {
  authSettled?: boolean;
}

export function runFirstLoad<T>(
  page: FirstLoadPage,
  load: (round: 1 | 2) => Promise<T>,
  timeoutMs?: number,
  ctx?: FirstLoadCtx,
): FirstLoadRun<T> {
  const limit = timeoutMs ?? FIRST_LOAD_TIMEOUT_MS;
  // 起始情境只在這一刻同步取一次，之後不再重讀。
  const cpInstanceFresh = !isCpFirebaseStarted();
  const authSettled = typeof ctx?.authSettled === 'boolean' ? ctx.authSettled : null;
  let sinceNavMs: number | null = null;
  try {
    sinceNavMs = Math.round(performance.now());
  } catch {
    sinceNavMs = null;
  }
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

  function reportOutcome(round: 1 | 2, outcome: FirstLoadOutcome, elapsedMs: number): void {
    if (canceled) return;
    if (round === 1 && outcome !== 'timeout') return;
    if (!canSendReport(page)) return;
    markReportSent(page);
    void sendFirstLoadReport({
      page,
      round,
      ms: elapsedMs,
      outcome,
      sinceNavMs,
      cpInstanceFresh,
      authSettled,
    });
  }

  function startRound(round: 1 | 2): void {
    const startedAt = Date.now();
    let settled = false;
    const failTimeout = (): void => {
      if (settled) return;
      settled = true;
      timer = null;
      if (canceled) return;
      const elapsed = Math.round(Date.now() - startedAt);
      record(page, round, startedAt, 'timeout');
      reportOutcome(round, 'timeout', elapsed);
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
      const elapsed = Math.round(Date.now() - startedAt);
      record(page, round, startedAt, 'ok');
      reportOutcome(round, 'ok', elapsed);
      resolveOuter(value);
    }, (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimer();
      if (canceled) return;
      const elapsed = Math.round(Date.now() - startedAt);
      record(page, round, startedAt, 'error');
      reportOutcome(round, 'error', elapsed);
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
