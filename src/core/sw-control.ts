// Service Worker 註冊與遠端開關（2026-10-20 Fable 定案的三道保險之一）。
//
// 開機後（首屏 render 之後，不擋畫面）讀 /runtime-config.json（Cloudflare 以 no-store 回應）：
// - swEnabled === false：解除所有 SW 註冊並清掉快取 → 使用者卡舊版時，改這個檔就能解，不必重新部署程式。
//   （當下頁面仍由舊 SW 接管，它讀快取時會重建空快取；下一次載入已不受 SW 控制，會再清一次，之後完全乾淨。本機實測如此。）
// - minBuild 大於目前建置編號：強制重新載入一次（每個 minBuild 值每個分頁只重載一次，避免設錯造成無限重載）。
// - 讀不到設定（離線、逾時）：不改變現狀，照常註冊。
// 只在正式打包執行；開發與測試環境不註冊。

const RUNTIME_CONFIG_URL = '/runtime-config.json';
const SW_URL = '/sw.js';
const MIN_BUILD_RELOAD_KEY = 'fcb:min-build-reload';

export interface RuntimeConfig {
  swEnabled: boolean;
  minBuild: number;
}

export interface SwControlDeps {
  fetchConfig: () => Promise<unknown>;
  serviceWorker: Pick<ServiceWorkerContainer, 'getRegistrations'> | null;
  cacheStorage: Pick<CacheStorage, 'keys' | 'delete'> | null;
  register: () => Promise<void>;
  reload: () => void;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  buildId: number;
}

/** 設定檔欄位缺少或型別不對時取安全預設：SW 開啟、不強制重載。 */
export function parseRuntimeConfig(raw: unknown): RuntimeConfig {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const minBuild = Number(obj['minBuild']);
  return {
    swEnabled: obj['swEnabled'] !== false,
    minBuild: Number.isFinite(minBuild) && minBuild > 0 ? minBuild : 0,
  };
}

async function disableServiceWorker(deps: SwControlDeps): Promise<void> {
  const registrations = deps.serviceWorker ? await deps.serviceWorker.getRegistrations() : [];
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if (deps.cacheStorage) {
    const keys = await deps.cacheStorage.keys();
    await Promise.all(keys.map((key) => deps.cacheStorage!.delete(key)));
  }
}

function shouldReloadForMinBuild(config: RuntimeConfig, deps: SwControlDeps): boolean {
  if (!config.minBuild || config.minBuild <= deps.buildId) return false;
  // 無法記錄就不重載，避免沒有煞車的重載迴圈。
  if (!deps.storage) return false;
  try {
    const marker = String(config.minBuild);
    if (deps.storage?.getItem(MIN_BUILD_RELOAD_KEY) === marker) return false;
    deps.storage?.setItem(MIN_BUILD_RELOAD_KEY, marker);
    return true;
  } catch {
    // 無法記錄就不重載，避免沒有煞車的重載迴圈。
    return false;
  }
}

/** 回傳採取的動作，方便測試與記錄。 */
export async function runSwControl(
  deps: SwControlDeps,
): Promise<'disabled' | 'reload' | 'registered' | 'register-failed'> {
  let config: RuntimeConfig = parseRuntimeConfig(null);
  try {
    config = parseRuntimeConfig(await deps.fetchConfig());
  } catch {
    // 讀不到設定：維持預設，照常註冊。
  }

  if (!config.swEnabled) {
    await disableServiceWorker(deps);
    return 'disabled';
  }
  if (shouldReloadForMinBuild(config, deps)) {
    deps.reload();
    return 'reload';
  }
  try {
    await deps.register();
    return 'registered';
  } catch (err) {
    console.warn('[sw] 註冊失敗', err);
    return 'register-failed';
  }
}

/** main.tsx 在首屏 render 後呼叫。 */
export function initServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const start = (): void => {
    void runSwControl({
      fetchConfig: async () => {
        const res = await fetch(RUNTIME_CONFIG_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`runtime-config ${res.status}`);
        return res.json();
      },
      serviceWorker: navigator.serviceWorker,
      cacheStorage: typeof caches === 'undefined' ? null : caches,
      register: async () => {
        const { Workbox } = await import('workbox-window');
        await new Workbox(SW_URL, { scope: '/' }).register();
      },
      reload: () => location.reload(),
      storage: (() => {
        try { return sessionStorage; } catch { return null; }
      })(),
      buildId: Number(import.meta.env.VITE_BUILD_ID) || 0,
    });
  };
  // 等頁面載入完再做，不和首屏搶網路。
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
