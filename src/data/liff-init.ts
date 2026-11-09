// LIFF 只初始化一次。signIn、登出與 Mini App 預先初始化共用同一支 Promise。
// 成功之後再呼叫不再 init。失敗不留著拒絕的 Promise，否則「init 失敗後再登入」會永遠失敗
// （auth.login-resume.test.ts：再登入不受舊參數影響）。
// 本模組不在頂層載入 @line/liff。一般瀏覽器不呼叫 ensureLiffInit 就不會下載 SDK（T-041）。

import { setExternalLiffGetter, type ExternalLiffClient } from '@/core/open-external';

type LiffSdk = typeof import('@line/liff').default;

/** 與 auth.ts 的 LIFF_STEP_TIMEOUT_MS 相同（照 A LineAuth.init 的 8 秒）。 */
const LIFF_INIT_TIMEOUT_MS = 8000;

export class LiffSdkLoadError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super('[auth] LIFF SDK 載入失敗');
    this.name = 'LiffSdkLoadError';
    this.cause = cause;
  }
}

export function isLiffSdkLoadError(err: unknown): err is LiffSdkLoadError {
  return err instanceof LiffSdkLoadError;
}

let generation = 0;
let pending: Promise<LiffSdk> | null = null;
let ready: LiffSdk | null = null;

setExternalLiffGetter(() => ready as ExternalLiffClient | null);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[auth] ${label} 逾時（${ms}ms）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function start(): Promise<LiffSdk> {
  const liffId = import.meta.env.VITE_LIFF_ID;
  if (!liffId) {
    throw new Error('[auth] 缺少 VITE_LIFF_ID 設定（請見 .env.example）');
  }
  let sdk: LiffSdk;
  try {
    sdk = (await import('@line/liff')).default;
  } catch (err) {
    throw new LiffSdkLoadError(err);
  }
  await withTimeout(sdk.init({ liffId }), LIFF_INIT_TIMEOUT_MS, 'liff.init()');
  return sdk;
}

/** 進行中與成功後都回同一支 Promise。失敗後下一次才會再 init。 */
export function ensureLiffInit(): Promise<LiffSdk> {
  if (pending) return pending;
  const gen = generation;
  const run = start().then(
    (sdk) => {
      if (generation === gen) ready = sdk;
      return sdk;
    },
    (err: unknown) => {
      if (generation === gen) pending = null;
      throw err;
    },
  );
  pending = run;
  return run;
}

/** 已初始化完成的 LIFF；尚未 init 或 init 失敗回 null。不觸發 init，也不下載 SDK（個人頁查好友狀態用）。 */
export function getReadyLiff(): LiffSdk | null {
  return ready;
}

export function _resetLiffInitForTest(): void {
  generation += 1;
  pending = null;
  ready = null;
}
