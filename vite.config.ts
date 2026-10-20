import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'node:child_process';
import type { Plugin } from 'vite';
// @ts-expect-error 純 JS 建置工具，無型別宣告
import { legacyCssScope } from './scripts/legacy-css-scope.mjs';

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
 * Cloudflare Pages `_headers`：全站不收錄；HTML 每次向伺服器確認新版（no-cache，未變更回 304），
 * 雜湊命名的 assets 照常長快取。
 * 2026-10-20 HTML 由 no-store 改 no-cache：一樣不會用到舊版 HTML，但可走 304 與瀏覽器「上一頁」快取（no-store 會讓 bfcache 失效）。
 */
const INTERNAL_TEST_HEADERS = [
  '/*',
  '  X-Robots-Tag: noindex, nofollow',
  '  Cache-Control: no-cache',
  '/assets/*',
  '  ! Cache-Control',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
].join('\n');

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
      return { define: { 'import.meta.env.VITE_BUILD_SHA': JSON.stringify(buildSha()) } };
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
      if (!isBuild || !enabled) return;
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: 'User-agent: *\nDisallow: /\n' });
      this.emitFile({ type: 'asset', fileName: '_headers', source: INTERNAL_TEST_HEADERS });
    },
  };
}

/**
 * 預設語系字典預載：字典是 import.meta.glob 動態載入，瀏覽器要等主程式執行後才知道要下載。
 * 在 HTML 加上 modulepreload，讓它跟主程式同時下載（語系不是 zh-TW 的使用者多下載一個小檔，可接受）。
 */
function preloadDefaultLocale(): Plugin {
  return {
    name: 'fcb-preload-default-locale',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const chunk = Object.values(ctx.bundle ?? {}).find(
          (item) => item.type === 'chunk' && item.name === 'i18n-zh-TW',
        );
        if (!chunk) return [];
        return [{
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: '', href: `/${chunk.fileName}` },
          injectTo: 'head',
        }];
      },
    },
  };
}

export default defineConfig({
  plugins: [preact(), internalTestNoIndex(), preloadDefaultLocale()],
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
        // 同一語系的核心與各功能字典合併成一個 chunk，切換語系只需一次請求（避免每個功能一個小檔）
        // 舊版 A 的翻譯（i18n/legacy）也併入同一個 chunk（原本另成一檔，首屏多一個請求）
        manualChunks(id: string) {
          const m = id.match(/[\\/](?:messages|locales|legacy)[\\/](zh-TW|zh-CN|en|ja|vi|th|ko)\.json$/);
          return m ? `i18n-${m[1]}` : undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
});
