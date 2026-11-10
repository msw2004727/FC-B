// Service Worker 註冊與遠端開關，以及強制更新的啟動點（UPD-1b）。
//
// 開機後（首屏 render 之後，不擋畫面）讀 /runtime-config.json（Cloudflare 以 no-store 回應）：
// - swEnabled === false：解除所有 SW 註冊並清掉快取。這不再讓 minBuild 失效。
// - 沒有 serviceWorker 的瀏覽器仍讀設定、仍啟動強制更新。
// - minBuild 的判斷在 force-update（load 後動態載入），不在這裡重載。
// - 讀不到設定：不改變現狀，有 SW 就照常註冊；強制更新這次不做。
// 只在正式打包執行；開發與測試環境不註冊。

import { readAppBuildId } from './app-meta';
import { reportClientError } from './error-report';
import { dismissForcedUpdatePrompt, evaluateReloadSafety, showSwReloadPrompt } from './reload-safety';
import { isSubmitting, onSubmittingIdle } from './submit-guard';

const RUNTIME_CONFIG_URL = '/runtime-config.json';
const SW_URL = '/sw.js';
const FETCH_TIMEOUT_MS = 8_000;
const MIN_BUILD_FLOOR = 100_000_000_000;
const MIN_BUILD_CEILING = 999_999_999_999;

export interface RuntimeConfig {
  swEnabled: boolean;
  minBuild: number;
}

export interface SwControlDeps {
  serviceWorker: Pick<ServiceWorkerContainer, 'getRegistrations'> | null;
  cacheStorage: Pick<CacheStorage, 'keys' | 'delete'> | null;
  register: () => Promise<void>;
}

let runtimeConfigReported = false;

/** 測試清掉「每個分頁只回報一次」的旗標。 */
export function _resetRuntimeConfigReportForTest(): void {
  runtimeConfigReported = false;
}

function reportBadMinBuild(raw: unknown): void {
  if (runtimeConfigReported) return;
  runtimeConfigReported = true;
  reportClientError('runtime-config', new Error(`minBuild 格式無效：${String(raw)}`));
}

function readMinBuild(raw: unknown): number {
  if (raw === undefined) return 0;
  if (
    typeof raw === 'number'
    && Number.isInteger(raw)
    && (raw === 0 || (raw >= MIN_BUILD_FLOOR && raw <= MIN_BUILD_CEILING))
  ) {
    return raw;
  }
  reportBadMinBuild(raw);
  return 0;
}

/** 設定檔欄位缺少或型別不對時取安全預設：SW 開啟、不強制重載。壞的 minBuild 當 0 並每分頁回報一次。 */
export function parseRuntimeConfig(raw: unknown): RuntimeConfig {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    swEnabled: obj['swEnabled'] !== false,
    minBuild: readMinBuild(obj['minBuild']),
  };
}

/** 失敗（離線、逾時、非 200、JSON 壞）回 null。成功回 parse 後的設定。 */
export async function fetchRuntimeConfig(timeoutMs = FETCH_TIMEOUT_MS): Promise<RuntimeConfig | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(RUNTIME_CONFIG_URL, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return null;
    try {
      return parseRuntimeConfig(await res.json());
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 先取消全部註冊，再刪全部 caches。沒有 SW 時只清快取（有的話）。 */
export async function disableServiceWorker(deps: SwControlDeps): Promise<void> {
  const registrations = deps.serviceWorker ? await deps.serviceWorker.getRegistrations() : [];
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if (deps.cacheStorage) {
    const keys = await deps.cacheStorage.keys();
    await Promise.all(keys.map((key) => deps.cacheStorage!.delete(key)));
  }
}

/** 回傳採取的動作。minBuild 不在這裡處理。serviceWorker 為 null 回 unsupported。 */
export async function runSwControl(
  config: RuntimeConfig,
  deps: SwControlDeps,
): Promise<'disabled' | 'registered' | 'register-failed' | 'unsupported'> {
  if (!deps.serviceWorker) return 'unsupported';
  if (!config.swEnabled) {
    await disableServiceWorker(deps);
    return 'disabled';
  }
  try {
    await deps.register();
    return 'registered';
  } catch (err) {
    console.warn('[sw] 註冊失敗', err);
    return 'register-failed';
  }
}

/** 離線快取流程最多等這麼久，之後不論結果都啟動 minBuild 檢查。 */
const SW_BOOT_WAIT_MS = 8_000;

export interface SwForceBootInput {
  config: RuntimeConfig | null;
  swSupported: boolean;
  swDeps: SwControlDeps;
  /** 動態載入 force-update 並啟動。失敗由呼叫端的 try 吃掉。 */
  startForce: (config: RuntimeConfig | null) => Promise<void> | void;
}

/**
 * load 之後的順序：先處理 swEnabled（停用要等完），再啟動強制更新。
 * 沒有 SW 仍啟動強制更新。startForce 丟錯（chunk 404）不得往外拋。
 */
export async function bootSwAndForceUpdate(input: SwForceBootInput): Promise<void> {
  if (input.swSupported) {
    try {
      // 停用／註冊卡住或丟錯時，minBuild 檢查照樣要啟動（不得被離線快取流程擋住）
      await Promise.race([
        runSwControl(input.config ?? parseRuntimeConfig(null), input.swDeps),
        new Promise<void>((resolve) => setTimeout(resolve, SW_BOOT_WAIT_MS)),
      ]);
    } catch (err) {
      console.warn('[sw] 啟動流程失敗，仍檢查 minBuild', err);
    }
  }
  try {
    await input.startForce(input.config);
  } catch {
    // chunk 失敗由 chunk-reload 接手；不得丟錯
  }
}

function liveSwDeps(register: () => Promise<void>): SwControlDeps {
  return {
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? navigator.serviceWorker
      : null,
    cacheStorage: typeof caches === 'undefined' ? null : caches,
    register,
  };
}

/** main.tsx 在首屏 render 後呼叫。 */
export function initServiceWorker(): void {
  if (!import.meta.env.PROD || typeof window === 'undefined') return;
  const start = (): void => {
    void (async () => {
      const config = await fetchRuntimeConfig();
      const swSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
      await bootSwAndForceUpdate({
        config,
        swSupported,
        swDeps: liveSwDeps(async () => {
          const { Workbox } = await import('workbox-window');
          const wb = new Workbox(SW_URL, { scope: '/' });
          wb.addEventListener('waiting', () => {
            showSwReloadPrompt(() => {
              wb.messageSkipWaiting();
              location.reload();
            }, 'sw-waiting');
          });
          await wb.register();
        }),
        startForce: async (initialConfig) => {
          const m = await import('./force-update');
          const session = (() => {
            try { return sessionStorage; } catch { return null; }
          })();
          const local = (() => {
            try { return localStorage; } catch { return null; }
          })();
          m.startForceUpdate({
            initialConfig,
            fetchConfig: () => fetchRuntimeConfig(),
            buildId: () => readAppBuildId(),
            now: () => Date.now(),
            online: () => navigator.onLine,
            session,
            local,
            evaluateSafety: () => evaluateReloadSafety(),
            isSubmitting: () => isSubmitting(),
            onSubmittingIdle: (cb) => onSubmittingIdle(cb),
            showForcedPrompt: (onReload) => {
              showSwReloadPrompt(onReload, 'min-build', { forced: true });
            },
            dismissForcedPrompt: () => {
              dismissForcedUpdatePrompt();
            },
            disableSw: () => disableServiceWorker(liveSwDeps(async () => {})),
            applySwEnabled: async (enabled) => {
              if (enabled) return;
              await disableServiceWorker(liveSwDeps(async () => {}));
            },
            reload: () => {
              location.reload();
            },
            report: (what) => {
              reportClientError('force-update', new Error(what));
            },
            target: { doc: document, win: window },
          });
        },
      });
    })();
  };
  // 等頁面載入完再做，不和首屏搶網路。
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
