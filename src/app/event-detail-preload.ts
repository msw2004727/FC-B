import { isWithinChunkReloadWindow } from '@/core/chunk-reload';

/** 與 `share-link.ts` 的 PUBLIC_ID、活動路由 `/events/:id` 同一個 id 形狀。 */
const EVENT_PUBLIC_ID = /^[A-Za-z0-9_-]{1,120}$/;

/**
 * pathname 恰為 `/events/<PUBLIC_ID>` 才預先下載詳情 chunk。
 * 其他路徑（首頁、列表、多一段路徑）不下載詳情 chunk，避免跟首屏搶頻寬。
 */
export function shouldPreloadEventDetail(pathname: string): boolean {
  const match = /^\/events\/([^/]+)$/.exec(pathname);
  const id = match?.[1];
  return id !== undefined && EVENT_PUBLIC_ID.test(id);
}

/**
 * 會用到 Firestore 的路徑才預先下載 SDK：首頁、活動列表、活動詳情。
 * `/teams` 之類不下載。詳情頁的頁面 chunk 仍只在 `/events/<id>`。
 */
const FIRESTORE_SDK_EXACT_PATHS = new Set(['/', '/activities']);

export function shouldPreloadFirestoreSdk(pathname: string): boolean {
  return FIRESTORE_SDK_EXACT_PATHS.has(pathname) || shouldPreloadEventDetail(pathname);
}

/** 與 `scripts/boot-preload-html.ts` 的 BOOT_PRELOAD_SCRIPT_ID 同值。 */
export const BOOT_PRELOAD_SCRIPT_ID = 'fcb-boot-preload';

interface PreloadGroup {
  js?: unknown;
  css?: unknown;
}

/** 只接受同源 `/assets/` 底下的雜湊檔名；格式不對的項目略過。 */
const ASSET_URL = /^\/assets\/[\w.-]+\.(?:js|css)$/;

function addLinks(head: HTMLElement, list: unknown, rel: string): void {
  if (!Array.isArray(list)) return;
  for (const href of list) {
    if (typeof href !== 'string' || !ASSET_URL.test(href)) continue;
    const link = document.createElement('link');
    link.rel = rel;
    link.crossOrigin = '';
    link.href = href;
    head.appendChild(link);
  }
}

/**
 * 只下載模組，不執行、不初始化 Firestore、不讀資料（顧問 §3.255 B′）。
 * 用 `<link rel="modulepreload">` 而不是 `import()`：失敗只觸發 link 的 error，不發 `vite:preloadError`、
 * 不寫 chunk-reload 時間戳，路由真正載入失敗時仍有那一次重載機會。網址由 `scripts/boot-preload-html.ts` 建置時注入，
 * 屬性照 Vite 自己插的預載 link（crossorigin=""），路由 load 會沿用同一份下載；CSS 照 Vite 路由載入時的做法插 stylesheet。
 * 不支援 modulepreload 的瀏覽器（iOS 16 以下）只是不預載，路由照常載入。dev 沒有清單，不預載。
 * 取代：原本以 `import()` 預載並 `.catch(() => {})`，但 Vite 的事件在 catch 之前已發出。
 */
export function preloadEventDetailChunks(pathname: string): void {
  try {
    // 顧問 §3.268 甲：60 秒內剛因 chunk 失敗重整過就不插預載，讓路由自己 import()。
    // WebKit 會把 modulepreload 的失敗結果帶過 location.reload()（不發請求直接失敗），import() 則會重抓（staging 演練 probe5／6）。
    if (isWithinChunkReloadWindow(sessionStorage)) return;
    const raw = document.getElementById(BOOT_PRELOAD_SCRIPT_ID)?.textContent;
    if (!raw) return;
    const map = JSON.parse(raw) as { detail?: PreloadGroup; firestore?: PreloadGroup };
    const groups = [
      shouldPreloadEventDetail(pathname) ? map.detail : undefined,
      shouldPreloadFirestoreSdk(pathname) ? map.firestore : undefined,
    ];
    for (const group of groups) {
      if (!group) continue;
      addLinks(document.head, group.css, 'stylesheet');
      addLinks(document.head, group.js, 'modulepreload');
    }
  } catch {
    // 預載只是加速：清單壞掉就不預載，路由照常載入。
  }
}
