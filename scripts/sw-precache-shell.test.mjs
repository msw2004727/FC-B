// @vitest-environment node
/**
 * SW 預存只放殼、其他分塊走執行期快取（顧問 §3.567 (b)）。
 * 真的 vite build 到暫存目錄，用替身 workbox 執行產出的 sw.js，檢查：
 * - precache 清單＝index.html＋它靜態引用的入口／modulepreload／樣式表＋頂欄 logo＋manifest.json，沒有別的；
 * - 舊預存清理（cleanupOutdatedCaches）、skipWaiting、clientsClaim、sw-legacy-compat 仍在；
 * - 導覽規則不變、排在第一；第二條只認同源 /assets/ 第一層帶雜湊的 .js／.css，只收 200、型別要對、有上限；
 * - runtime-config.json、version.json、sw.js 不預存也不進執行期快取（R-UPD-031）。
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  ASSET_CACHE_MAX_ENTRIES,
  ASSET_CACHE_NAME,
  keepShellOnly,
  shellUrlsFromHtml,
} from './sw-shell.ts';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

describe('shellUrlsFromHtml／keepShellOnly（純函式）', () => {
  const html = [
    '<script>var x = "<link rel=\\"modulepreload\\" href=\\"/assets/fake-AAAAAAAA.js\\">";</script>',
    '<script type="module" crossorigin src="/assets/index-AAAAAAAA.js"></script>',
    '<link rel="modulepreload" crossorigin href="/assets/a-BBBBBBBB.js">',
    '<link rel="stylesheet" crossorigin href="/assets/index-CCCCCCCC.css">',
    '<link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png">',
    '<link rel="preconnect" href="https://firestore.googleapis.com" crossorigin />',
    '<script type="application/json" id="fcb-boot-preload">{"detail":{"js":["/assets/EventDetailPage-DDDDDDDD.js"]}}</script>',
  ].join('\n');

  it('只取入口 module script、modulepreload、stylesheet 的 /assets/ 網址', () => {
    expect(shellUrlsFromHtml(html).sort()).toEqual([
      'assets/a-BBBBBBBB.js',
      'assets/index-AAAAAAAA.js',
      'assets/index-CCCCCCCC.css',
    ]);
  });

  it('找不到入口就丟錯（不靜默變成空殼）', () => {
    expect(() => shellUrlsFromHtml('<link rel="stylesheet" href="/assets/x-CCCCCCCC.css">')).toThrow(/入口/);
  });

  it('殼檔不在候選清單就丟錯；其餘只留殼', () => {
    const entries = [
      { url: 'index.html', revision: '1', size: 1 },
      { url: 'assets/a-BBBBBBBB.js', revision: null, size: 1 },
      { url: 'assets/other-EEEEEEEE.js', revision: null, size: 1 },
    ];
    expect(keepShellOnly(entries, ['index.html', 'assets/a-BBBBBBBB.js']).map((e) => e.url)).toEqual([
      'index.html',
      'assets/a-BBBBBBBB.js',
    ]);
    expect(() => keepShellOnly(entries, ['index.html', 'assets/missing-FFFFFFFF.js'])).toThrow(/missing-FFFFFFFF/);
  });
});

/** 用替身 workbox 執行 sw.js，記下每個呼叫。 */
function runSw(source) {
  const calls = { precache: null, precacheOpts: null, routes: [], cleanup: 0, clientsClaim: 0, skipWaiting: 0, imports: [] };
  const strategy = (kind) =>
    class {
      constructor(opts) {
        this.kind = kind;
        this.opts = opts;
      }
    };
  const plugin = (kind) =>
    class {
      constructor(opts) {
        this.kind = kind;
        this.opts = opts;
      }
    };
  const wb = {
    clientsClaim: () => { calls.clientsClaim += 1; },
    precacheAndRoute: (list, opts) => { calls.precache = list; calls.precacheOpts = opts; },
    cleanupOutdatedCaches: () => { calls.cleanup += 1; },
    registerRoute: (match, handler, method) => { calls.routes.push({ match, handler, method }); },
    NetworkFirst: strategy('NetworkFirst'),
    CacheFirst: strategy('CacheFirst'),
    StaleWhileRevalidate: strategy('StaleWhileRevalidate'),
    NetworkOnly: strategy('NetworkOnly'),
    CacheOnly: strategy('CacheOnly'),
    ExpirationPlugin: plugin('ExpirationPlugin'),
    CacheableResponsePlugin: plugin('CacheableResponsePlugin'),
    PrecacheFallbackPlugin: plugin('PrecacheFallbackPlugin'),
  };
  const sandbox = {
    URL,
    importScripts: (...urls) => { calls.imports.push(...urls); },
    define: (_deps, factory) => factory(wb),
  };
  sandbox.self = sandbox;
  sandbox.self.skipWaiting = () => { calls.skipWaiting += 1; };
  vm.runInNewContext(source, sandbox);
  return calls;
}

function pluginOf(handler, kind) {
  return handler.opts.plugins.filter((p) => p.kind === kind);
}

function assetReq(pathname, origin = 'https://toosterx.com', sameOrigin = true) {
  const url = new URL(pathname, origin);
  return { url, sameOrigin, request: { mode: 'cors', url: url.href } };
}

describe('建置產出的 sw.js', () => {
  let outDir = '';
  let parent = '';
  let sw;
  let html = '';
  let assets = [];

  beforeAll(async () => {
    parent = await mkdtemp(path.join(tmpdir(), 'fcb-sw-shell-'));
    outDir = path.join(parent, 'dist');
    const env = { ...process.env, NODE_ENV: 'production' };
    delete env.CF_PAGES;
    delete env.VITEST;
    delete env.FCB_BUILD_ID;
    delete env.FCB_VERSION_FILE;
    await execFileAsync(process.execPath, [viteBin, 'build', '--outDir', outDir, '--emptyOutDir'], {
      cwd: root,
      env,
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    sw = runSw(await readFile(path.join(outDir, 'sw.js'), 'utf8'));
    html = await readFile(path.join(outDir, 'index.html'), 'utf8');
    assets = (await readdir(path.join(outDir, 'assets'))).filter((f) => /\.(?:js|css)$/.test(f));
  }, 320_000);

  afterAll(async () => {
    if (parent) await rm(parent, { recursive: true, force: true });
  });

  it('precache 只含殼：index.html、入口與 modulepreload、樣式表、頂欄 logo、manifest.json', () => {
    // 與 sw-shell.ts 不同寫法：逐行抓 index.html 的三種標籤。
    const fromHtml = [
      ...html.matchAll(/<script type="module"[^>]*\ssrc="\/(assets\/[^"]+)"/g),
      ...html.matchAll(/<link rel="(?:modulepreload|stylesheet)"[^>]*\shref="\/(assets\/[^"]+)"/g),
    ].map((m) => m[1]);
    expect(fromHtml.length).toBeGreaterThan(5);
    const expected = [...fromHtml, 'index.html', 'assets/logo-black.webp', 'assets/logo-white.webp', 'manifest.json'].sort();
    const urls = sw.precache.map((e) => e.url).sort();
    expect(urls).toEqual(expected);
    console.log(`precache ${urls.length} 筆；assets/ 下 js+css ${assets.length} 支`);
  });

  it('預存不含其他分頁的分塊、manifest 圖示、設定檔與 SW 本身', () => {
    const urls = new Set(sw.precache.map((e) => e.url));
    const boot = JSON.parse(/<script type="application\/json" id="fcb-boot-preload">([^<]*)<\/script>/.exec(html)[1]);
    expect(boot.detail.js.length).toBeGreaterThan(0);
    for (const u of [...boot.detail.js, ...boot.firestore.js]) expect(urls.has(u.slice(1))).toBe(false);
    for (const u of ['assets/icons/icon-192x192.png', 'assets/icons/icon-512x512.png', 'runtime-config.json', 'version.json', 'sw.js', 'sw-legacy-compat.js', 'assets/404.html', 'manual.html']) {
      expect(urls.has(u)).toBe(false);
    }
    // 至少一半以上的分塊不在預存（確認真的縮小，而不是條件寫反）。
    expect(assets.filter((f) => !urls.has(`assets/${f}`)).length).toBeGreaterThan(assets.length / 2);
  });

  it('舊預存清理、skipWaiting、clientsClaim、sw-legacy-compat、directoryIndex 都還在', () => {
    expect(sw.cleanup).toBe(1);
    expect(sw.skipWaiting).toBe(1);
    expect(sw.clientsClaim).toBe(1);
    expect(sw.imports).toEqual(['sw-legacy-compat.js']);
    expect(sw.precacheOpts).toEqual({ directoryIndex: '' });
  });

  it('導覽規則排第一而且不變：NetworkFirst、3 秒、fcb-pages、只收 200、退回預存 index.html', () => {
    expect(sw.routes).toHaveLength(2);
    const nav = sw.routes[0];
    expect(nav.method).toBe('GET');
    expect(nav.match({ request: { mode: 'navigate' } })).toBe(true);
    expect(nav.match({ request: { mode: 'cors' } })).toBe(false);
    expect(nav.handler.kind).toBe('NetworkFirst');
    expect(nav.handler.opts.cacheName).toBe('fcb-pages');
    expect(nav.handler.opts.networkTimeoutSeconds).toBe(3);
    expect(pluginOf(nav.handler, 'ExpirationPlugin')[0].opts).toEqual({ maxEntries: 30, maxAgeSeconds: 86400 });
    expect(pluginOf(nav.handler, 'CacheableResponsePlugin')[0].opts).toEqual({ statuses: [200] });
    expect(pluginOf(nav.handler, 'PrecacheFallbackPlugin')[0].opts).toEqual({ fallbackURL: 'index.html' });
  });

  it('執行期快取：fcb-assets、CacheFirst、只收 200、上限 300 筆 30 天', () => {
    const rt = sw.routes[1];
    expect(rt.method).toBe('GET');
    expect(rt.handler.kind).toBe('CacheFirst');
    expect(rt.handler.opts.cacheName).toBe(ASSET_CACHE_NAME);
    expect(pluginOf(rt.handler, 'CacheableResponsePlugin').map((p) => p.opts)).toEqual([{ statuses: [200] }]);
    expect(pluginOf(rt.handler, 'ExpirationPlugin').map((p) => p.opts)).toEqual([
      { maxEntries: ASSET_CACHE_MAX_ENTRIES, maxAgeSeconds: ASSET_CACHE_MAX_AGE_SECONDS, purgeOnQuotaError: true },
    ]);
    expect(ASSET_CACHE_MAX_ENTRIES).toBe(300);
    expect(ASSET_CACHE_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it('執行期快取網址：dist 每支 js／css 都認得；設定檔、SW、404 頁、圖片、子目錄、跨網域都不認', () => {
    const rt = sw.routes[1];
    for (const f of assets) expect(rt.match(assetReq(`/assets/${f}`)), f).toBe(true);
    for (const p of [
      '/runtime-config.json',
      '/version.json',
      '/sw.js',
      '/sw-legacy-compat.js',
      '/',
      '/index.html',
      '/manifest.json',
      '/assets/404.html',
      '/assets/logo-white.webp',
      '/assets/icons/icon-192x192.png',
      '/assets/og/share-AAAAAAAA.js',
      '/blog/assets/x-AAAAAAAA.js',
      '/assets/no-hash.js',
      // 顧問 §3.645 P3-3
      '/assets/index-AAAAAAAA.js.map',
      '/assets/index-AAAAAAAA.js?v=1',
      '/assets/index-AAAAAAAA.css?x',
      '/assets/index-AAAAAAAA.mjs',
      '/assets/index-AAAAAAAA.JS',
      '/assets/index-AAAAAAAA.CSS',
    ]) {
      expect(rt.match(assetReq(p)), p).toBe(false);
    }
    expect(rt.match(assetReq('/assets/index-AAAAAAAA.js', 'https://cdn.example.com', false))).toBe(false);
  });

  it('型別把關：.js 要 javascript、.css 要 text/css；平台回 HTML 不存', async () => {
    const [guard] = sw.routes[1].handler.opts.plugins.filter((p) => typeof p.cacheWillUpdate === 'function');
    expect(guard).toBeTruthy();
    const check = (file, type) => {
      const headers = type ? { 'content-type': type } : {};
      const response = new Response('x', { status: 200, headers });
      return guard.cacheWillUpdate({ request: new Request(`https://toosterx.com/assets/${file}`), response }).then((r) => r === response);
    };
    expect(await check('a-AAAAAAAA.js', 'application/javascript; charset=utf-8')).toBe(true);
    expect(await check('a-AAAAAAAA.js', 'text/javascript')).toBe(true);
    expect(await check('a-AAAAAAAA.css', 'text/css; charset=utf-8')).toBe(true);
    expect(await check('a-AAAAAAAA.js', 'text/html; charset=utf-8')).toBe(false);
    expect(await check('a-AAAAAAAA.css', 'text/html')).toBe(false);
    expect(await check('a-AAAAAAAA.css', 'application/javascript')).toBe(false);
    expect(await check('a-AAAAAAAA.js', '')).toBe(false);
  });
});
