/**
 * `/events/<id>`，id 與 `share-link.ts` 的 PUBLIC_ID、活動路由 `/events/:id` 同一個形狀；與 reload-safety 的 CHUNK_RELOAD_EXTRA_PATH 同字面。
 * 取代：原本先切出 id 再用第二個 regex 驗形狀，行為相同；合成一個是為了首頁入口 gzip 餘裕（顧問 §3.276 要求 ≥200 B）。
 */
const EVENT_DETAIL_PATH = /^\/events\/[A-Za-z0-9_-]{1,120}$/;

/**
 * pathname 恰為 `/events/<PUBLIC_ID>` 才預先下載詳情 chunk。
 * 其他路徑（首頁、列表、多一段路徑）不下載詳情 chunk，避免跟首屏搶頻寬。
 */
export function shouldPreloadEventDetail(pathname: string): boolean {
  return EVENT_DETAIL_PATH.test(pathname);
}

/**
 * 會用到 Firestore 的路徑才預先下載 SDK：首頁、活動列表、活動詳情。
 * `/teams` 之類不下載。詳情頁的頁面 chunk 仍只在 `/events/<id>`。
 */
export function shouldPreloadFirestoreSdk(pathname: string): boolean {
  return pathname === '/' || pathname === '/activities' || shouldPreloadEventDetail(pathname);
}

/** 與 `scripts/boot-preload-html.ts` 的 BOOT_PRELOAD_SCRIPT_ID 同值。 */
export const BOOT_PRELOAD_SCRIPT_ID = 'fcb-boot-preload';

interface PreloadGroup {
  js?: unknown;
  css?: unknown;
}

/** 只接受同源 `/assets/` 底下的雜湊檔名；格式不對的項目略過（顧問 §3.276：入口餘裕回到 200 B 以上後加回）。 */
const ASSET_URL = /^\/assets\/[\w.-]+\.(?:js|css)$/;

function addLinks(head: HTMLElement, list: unknown, rel: string): void {
  if (!Array.isArray(list)) return;
  for (const href of list) {
    if (typeof href !== 'string' || !ASSET_URL.test(href)) continue;
    const link = document.createElement('link');
    link.rel = rel;
    if (rel === 'preload') link.as = 'style';
    link.crossOrigin = '';
    link.href = href;
    head.appendChild(link);
  }
}

/**
 * 只下載模組，不執行、不初始化 Firestore、不讀資料（顧問 §3.255 B′）。
 * 用 `<link rel="modulepreload">` 而不是 `import()`：失敗只觸發 link 的 error，不發 `vite:preloadError`、
 * 不寫 chunk-reload 時間戳，路由真正載入失敗時仍有那一次重載機會。網址由 `scripts/boot-preload-html.ts` 建置時注入，
 * 屬性照 Vite 自己插的預載 link（crossorigin=""），路由 load 會沿用同一份下載。
 * CSS 只插 `rel="preload" as="style"`：路由載入時 Vite 仍會自己插 stylesheet 並等它載完，失敗會照常發事件、交給守門；
 * 若開機就插 stylesheet，Vite 看到同網址已存在會跳過也不等，失敗時詳情頁沒有樣式又沒有提示（Opus 終審 P3-2；取代：原本插 stylesheet）。
 * 不支援 modulepreload 的瀏覽器（iOS 16 以下）只是不預載，路由照常載入。dev 沒有清單，不預載。
 * 取代：原本以 `import()` 預載並 `.catch(() => {})`，但 Vite 的事件在 catch 之前已發出。
 */
export function preloadEventDetailChunks(pathname: string): void {
  try {
    const raw = document.getElementById(BOOT_PRELOAD_SCRIPT_ID)?.textContent;
    if (!raw) return;
    const map = JSON.parse(raw) as { detail?: PreloadGroup; firestore?: PreloadGroup };
    const groups = [
      shouldPreloadEventDetail(pathname) ? map.detail : undefined,
      shouldPreloadFirestoreSdk(pathname) ? map.firestore : undefined,
    ];
    for (const group of groups) {
      if (!group) continue;
      addLinks(document.head, group.css, 'preload');
      addLinks(document.head, group.js, 'modulepreload');
    }
  } catch {
    // 預載只是加速：清單壞掉就不預載，路由照常載入。
  }
}
