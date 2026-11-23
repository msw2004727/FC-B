/**
 * SW 預存只放「殼」（顧問 §3.567 選 (b)，做法文件 SW預先快取延後-做法與風險-2026-11-22.md）。
 *
 * 殼＝任何一頁開機都一定要的檔：
 * - index.html（離線導覽的退回頁，`precacheFallback` 指向它）
 * - index.html 靜態引用的入口 `<script type="module">`、`<link rel="modulepreload">`、`<link rel="stylesheet">`
 * - 頂欄 logo 兩張 webp（每頁都顯示；亮色／暗色各一）
 * - manifest.json（vite-plugin-pwa 固定加在最後，不經這裡）
 * 其他分塊（各分頁、後台、字典、Firestore SDK 等）不預存，改由執行期快取 `fcb-assets` 在第一次用到時存。
 *
 * 取代：原本 `globPatterns` 全部預存（約 249 筆、5 MB raw），每次換版背景重抓所有換名的分塊。
 *
 * 清單以建置產出的 dist/index.html 為準（vite-plugin-pwa 在 closeBundle 才產生 sw.js，那時 index.html 已寫出）。
 * 找不到入口、或殼裡有檔不在 workbox 的候選清單（例如被 globIgnores 排掉）就讓建置失敗，不靜默少預存。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** 不在 index.html 標籤裡、但每頁都用到的固定殼檔（相對 dist）。TopBar.tsx 的 LIGHT_WEBP／DARK_WEBP。 */
export const SHELL_FIXED_URLS = ['index.html', 'assets/logo-black.webp', 'assets/logo-white.webp'] as const;

export const ASSET_CACHE_NAME = 'fcb-assets';
export const ASSET_CACHE_MAX_ENTRIES = 300;
export const ASSET_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function attrsOf(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of tag.matchAll(/\s([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) out.set(m[1]!.toLowerCase(), m[2]!);
  return out;
}

function toDistUrl(ref: string): string | null {
  if (!ref.startsWith('/assets/')) return null;
  return ref.slice(1);
}

/** 純函式：index.html 靜態引用的入口、modulepreload 與樣式表（相對 dist，不含開頭斜線）。找不到入口就丟錯。 */
export function shellUrlsFromHtml(html: string): string[] {
  const urls = new Set<string>();
  let entry = 0;
  for (const m of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const kind = m[1]!.toLowerCase();
    const attrs = attrsOf(m[0]);
    let ref: string | undefined;
    if (kind === 'script' && attrs.get('type') === 'module') ref = attrs.get('src');
    if (kind === 'link' && (attrs.get('rel') === 'modulepreload' || attrs.get('rel') === 'stylesheet')) ref = attrs.get('href');
    const url = ref ? toDistUrl(ref) : null;
    if (!url) continue;
    if (kind === 'script') entry += 1;
    urls.add(url);
  }
  if (entry === 0) throw new Error('sw-shell：index.html 找不到入口 <script type="module" src="/assets/...">');
  return [...urls];
}

export interface ManifestEntryLike {
  url: string;
  revision: string | null;
  size: number;
}

/** 純函式：只留殼。殼裡有檔不在候選清單就丟錯（列出缺哪些）。 */
export function keepShellOnly<T extends ManifestEntryLike>(entries: readonly T[], shell: readonly string[]): T[] {
  const want = new Set(shell);
  const have = new Set(entries.map((e) => e.url));
  const missing = [...want].filter((u) => !have.has(u));
  if (missing.length) throw new Error(`sw-shell：殼檔不在預存候選清單（檢查 globPatterns／globIgnores）：${missing.join(', ')}`);
  return entries.filter((e) => want.has(e.url));
}

/**
 * vite 外掛記下實際輸出目錄（測試會用 --outDir 打包到暫存目錄），manifestTransform 讀那裡的 index.html。
 * 兩者要一起用：外掛放進 plugins，manifestTransform 放進 workbox.manifestTransforms。
 */
export function swShellPrecache(): {
  plugin: Plugin;
  manifestTransform: (entries: ManifestEntryLike[]) => Promise<{ manifest: ManifestEntryLike[]; warnings: string[] }>;
} {
  let outDir = '';
  return {
    plugin: {
      name: 'fcb-sw-shell-precache',
      apply: 'build',
      configResolved(config) {
        outDir = path.resolve(config.root, config.build.outDir);
      },
    },
    async manifestTransform(entries) {
      if (!outDir) throw new Error('sw-shell：外掛沒有註冊，不知道輸出目錄');
      const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
      const shell = [...SHELL_FIXED_URLS, ...shellUrlsFromHtml(html)];
      return { manifest: keepShellOnly(entries, shell), warnings: [] };
    },
  };
}

/**
 * 執行期快取的網址條件：同源、`/assets/` 底下第一層、帶 8 碼雜湊的 .js／.css（內容不會變，可以 CacheFirst），不帶查詢字串
 *（打包產物不會帶；帶了快取鍵會變成另一筆，顧問 §3.645 P3-3）。
 * 排除：/assets/og/*、/assets/icons/*、logo 的固定檔名圖、assets/404.html、runtime-config.json、version.json、sw.js。
 * workbox-build 會把這個函式的原始碼原樣搬進 sw.js，函式內不得引用外部變數。
 */
export const isHashedAsset = ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }): boolean =>
  sameOrigin && !url.search && /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/.test(url.pathname);

/**
 * 只存「型別對」的回應：.css 要 text/css、.js 要 javascript。平台若把不存在的檔回成 HTML 200（例如 SPA 退回頁），
 * 不存進快取（CacheFirst 存錯會一直壞）。狀態碼由 cacheableResponse 的 statuses: [200] 把關。
 * 同上，函式會原樣搬進 sw.js，不得引用外部變數。
 */
export const assetTypeGuard = {
  cacheWillUpdate: async ({ request, response }: { request: Request; response: Response }): Promise<Response | null> => {
    const type = (response.headers.get('content-type') || '').toLowerCase();
    const wanted = new URL(request.url).pathname.endsWith('.css') ? 'text/css' : 'javascript';
    return type.indexOf(wanted) === -1 ? null : response;
  },
};
