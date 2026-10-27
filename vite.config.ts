import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'node:child_process';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
// @ts-expect-error 純 JS 建置工具，無型別宣告
import { legacyCssScope } from './scripts/legacy-css-scope.mjs';
// 帶副檔名：Vite 日後預設的原生 config loader 不接受省略副檔名的相對 import（tsconfig 的 allowImportingTsExtensions 允許）。
import { earlyBannersHtml } from './scripts/early-banners-html.ts';
import { FIREBASE_CONFIG } from './src/data/firebase-config.ts';
import { APP_VERSION } from './src/version.ts';

/** 版本角標用的短 commit：Cloudflare Pages 建置提供 CF_PAGES_COMMIT_SHA，本機退回 git。 */
function buildSha(): string {
  const fromCi = process.env.CF_PAGES_COMMIT_SHA;
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return 'local';
  }
}

/**
 * 建置編號（台北時間 YYYYMMDDHHmm，數字可比大小）：給 runtime-config.json 的 minBuild 比對用。
 * 環境變數 FCB_BUILD_ID 可覆寫（測試用）。
 */
function buildId(): number {
  const fromEnv = Number(process.env.FCB_BUILD_ID);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const t = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  return Number(t.slice(0, 16).replace(/[-T:]/g, ''));
}

/**
 * Cloudflare Pages `_headers`。
 * - 一律：雜湊命名的 assets 長快取；runtime-config.json 不得快取（SW 遠端開關，改了要立即生效）；
 *   sw.js 每次向伺服器確認（瀏覽器檢查 SW 更新用）。
 * - 內測期另加：全站不收錄；HTML 每次向伺服器確認新版（no-cache，未變更回 304）。
 * 2026-10-20 HTML 由 no-store 改 no-cache：一樣不會用到舊版 HTML，但可走 304 與瀏覽器「上一頁」快取（no-store 會讓 bfcache 失效）。
 */
const COMMON_HEADERS = [
  '/assets/*',
  '  ! Cache-Control',
  '  Cache-Control: public, max-age=31536000, immutable',
  '/runtime-config.json',
  '  ! Cache-Control',
  '  Cache-Control: no-store',
  '/sw.js',
  '  ! Cache-Control',
  '  Cache-Control: no-cache',
];
const INTERNAL_TEST_HEADERS = [
  '/*',
  '  X-Robots-Tag: noindex, nofollow',
  '  Cache-Control: no-cache',
];

/**
 * 內測期間的搜尋引擎隔離：建置變數 VITE_PUBLIC_LAUNCH 不是 '1' 時（預設），
 * 注入 noindex meta，並輸出 robots.txt（全站 Disallow）與 `_headers`。
 * 正式上線時設 VITE_PUBLIC_LAUNCH=1 即不產生。另注入 VITE_BUILD_SHA 給「內測版」角標。
 * 內測模式其他防護見 src/data/internal-test.ts。
 */
function internalTestNoIndex(): Plugin {
  let enabled = true;
  let isBuild = false;
  return {
    name: 'fcb-internal-test-noindex',
    config() {
      return {
        define: {
          'import.meta.env.VITE_BUILD_SHA': JSON.stringify(buildSha()),
          'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId()),
        },
      };
    },
    configResolved(config) {
      isBuild = config.command === 'build';
      enabled = config.env.VITE_PUBLIC_LAUNCH !== '1';
    },
    transformIndexHtml(html) {
      if (!isBuild || !enabled) return html;
      const meta = '<meta name="robots" content="noindex, nofollow" />';
      // 先放在 </title> 後；index.html 改版沒有 title 時退回 </head> 前，不靜默失效。
      return html.includes('</title>')
        ? html.replace('</title>', `</title>\n    ${meta}`)
        : html.replace('</head>', `  ${meta}\n  </head>`);
    },
    generateBundle() {
      if (!isBuild) return;
      // 內測規則放前面：Pages 依序套用，後面的 `! Cache-Control` 才能覆蓋 /* 的 no-cache。
      const lines = enabled ? [...INTERNAL_TEST_HEADERS, ...COMMON_HEADERS] : COMMON_HEADERS;
      this.emitFile({ type: 'asset', fileName: '_headers', source: `${lines.join('\n')}\n` });
      if (!enabled) return;
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: 'User-agent: *\nDisallow: /\n' });
    },
  };
}

/**
 * Service Worker（vite-plugin-pwa 1.3.0 generateSW，2026-10-20 Fable 定案）：
 * - precache 只含打包產物（不含 sw.js 本身與 runtime-config.json）；QR 掃描的 wasm（1MB）與 PNG 版 logo 不預存。
 * - 導覽請求 network-first：線上一律拿伺服器的 index.html（與現行 chunk 對應），3 秒逾時或離線才退回快取。
 *   不用 stale-while-revalidate／cache-first：舊 shell 引用的舊 chunk 在新部署後已不存在會白屏（R-REL-013 同理）。
 * - Firestore、Functions、Storage 等其他請求一律不攔（沒有對應路由就不經 SW）。
 * - 註冊由 src/core/sw-control.ts 先讀 /runtime-config.json（遠端開關）再決定，所以 injectRegister 關閉。
 */
const pwa = VitePWA({
  strategies: 'generateSW',
  registerType: 'autoUpdate',
  injectRegister: false,
  // 加到主畫面（PWA）設定：內容逐項照 A manifest.json（2026-10-20 站長要求新版沿用舊版 PWA）；
  // 檔名照 A 用 manifest.json，<link rel="manifest"> 由外掛注入 index.html。
  manifestFilename: 'manifest.json',
  manifest: {
    name: 'ToosterX',
    short_name: 'ToosterX',
    description: '台灣運動揪團報名平台',
    lang: 'zh-TW',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0d9488',
    icons: [
      { src: 'assets/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'assets/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: 'assets/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,webp,svg}'],
    globIgnores: ['**/runtime-config.json', 'sw.js', 'workbox-*.js'],
    navigateFallback: null,
    // 預存路由預設會把「/」對應到預存的 index.html，首頁導覽因此搶在下面的 network-first 之前拿到舊版
    // （部署後第一次開會先閃出上一版畫面，2026-10-21 站長回報內測頁殘影）。設為空字串關掉這個對應，
    // 讓「/」也走 network-first；index.html 仍留在預存裡給離線退回用。
    directoryIndex: '',
    skipWaiting: true,
    clientsClaim: true,
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        // 線上永遠用伺服器回應；3 秒沒回應或離線時，先用該網址上次的 HTML（最多保留 1 天），
        // 再沒有就用預存的 index.html。舊 HTML 若引用已刪除的 chunk，由 chunk-reload.ts 重載一次接手。
        urlPattern: ({ request }) => request.mode === 'navigate',
        handler: 'NetworkFirst',
        options: {
          cacheName: 'fcb-pages',
          networkTimeoutSeconds: 3,
          expiration: { maxEntries: 30, maxAgeSeconds: 24 * 60 * 60 },
          cacheableResponse: { statuses: [200] },
          precacheFallback: { fallbackURL: 'index.html' },
        },
      },
    ],
  },
});

export default defineConfig({
  // T-042d：index.html 的冷啟動提早 REST 內嵌 script，把 projectId／版號代號換成真值（emulator 建置整段移除）。
  plugins: [preact(), earlyBannersHtml({ projectId: FIREBASE_CONFIG.projectId, appVersion: APP_VERSION }), internalTestNoIndex(), pwa],
  css: {
    // 舊版 A 的 CSS 原檔照搬，打包時限定到 .legacy-ui（見 scripts/legacy-css-scope.mjs）
    postcss: { plugins: [legacyCssScope()] },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // LINE 內建瀏覽器相容目標
    target: ['es2020', 'chrome87', 'safari14'],
    cssCodeSplit: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        // 同一語系的核心、各功能與舊版 A 字典合併成一個 chunk，切換語系只需一次請求。
        // 預設語系 zh-TW 不分出去：i18n.ts 以 eager 方式直接打包進主程式（首屏不等字典）。
        manualChunks(id: string) {
          const m = id.match(/[\\/](?:messages|locales|legacy)[\\/](zh-CN|en|ja|vi|th|ko)\.json$/);
          return m ? `i18n-${m[1]}` : undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    // 整包平行跑時，第一次動態載入大模組（登入、Firestore）會拖過預設 5 秒而偶發逾時；
    // 單獨跑都在 1 秒內。統一放寬到 15 秒，取代逐個測試加 timeout。
    testTimeout: 15_000,
    // findBy*／waitFor 的等待統一放寬（見 src/test-setup.ts）。
    setupFiles: ['./src/test-setup.ts'],
  },
});
