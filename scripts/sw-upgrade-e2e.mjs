/**
 * SW 預存縮成殼之後的本機驗證（顧問 §3.567 (b)）：真的 Chromium、真的 sw.js，兩份建置產物輪流放在同一個本機網址。
 *
 *   node scripts/sw-upgrade-e2e.mjs --before <舊版 dist> --after <新版 dist> [--out report.json]
 *
 * 檢查（任一項不符就以非 0 結束）：
 * 1. 換版清理：先用舊版裝好 SW，換成新版後 update → 新 SW 接管；預存快取只剩新版的殼，舊版多出來的分塊全部清掉，
 *    也沒有留下別的預存快取。
 * 2. 執行期快取：新版接管後抓一支殼以外的分塊會存進 fcb-assets；/assets/ 不存在回 404 不存、兩次都 404；
 *    平台把 .js 回成 HTML 200 也不存。
 * 3. 離線（伺服器斷線）：全新資料只開過首頁一次，列出哪些頁面的程式都拿得到（沒有 /assets/ 請求失敗）、哪些拿不到。
 * 4. 首次安裝量：全新瀏覽器資料各開一次舊版與新版，記 SW 裝好前伺服器送出的請求數與位元組、第一筆 SW 預存請求的時間。
 *
 * 不打正式環境：本機以外的請求一律中止（Firestore、LIFF、圖片 CDN 都拿不到，頁面資料會是空的，只看程式與快取）。
 * 本機伺服器照 Cloudflare Pages 的行為：/assets/* 不存在回 assets/404.html 的 404；其他不存在的路徑回 index.html（SPA）。
 */
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []),
);
if (!args.before || !args.after) {
  console.error('用法：node scripts/sw-upgrade-e2e.mjs --before <dist> --after <dist> [--out report.json]');
  process.exit(2);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};
const FAKE_HTML_ASSET = '/assets/fakehtml-AAAAAAAA.js';

let rootDir = path.resolve(args.before);
// 離線檢查時 /assets/ 改回 no-store：排除瀏覽器 HTTP 快取，只量 SW（預存＋fcb-assets）保證得到的範圍。
let noStoreAssets = false;
// 「離線」用伺服器直接斷線模擬：Chromium 的 setOffline 管不到 SW 自己發的請求（實測照樣拿得到檔）。
let serverDown = false;
let log = [];
let t0 = Date.now();

async function fileAt(rel) {
  const full = path.join(rootDir, rel);
  if (!full.startsWith(rootDir)) return null;
  try {
    if (!(await stat(full)).isFile()) return null;
    return await readFile(full);
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  if (serverDown) {
    req.socket.destroy();
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const send = (status, body, type, cache) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': cache, 'content-length': body.length });
    res.end(body);
    log.push({ t: Date.now() - t0, path: pathname, status, bytes: body.length, dest: req.headers['sec-fetch-dest'] || '', sw: req.headers['service-worker'] || '' });
  };
  if (pathname === FAKE_HTML_ASSET) return send(200, Buffer.from('<!doctype html><p>fallback</p>'), 'text/html; charset=utf-8', 'no-store');
  const rel = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const body = await fileAt(rel.slice(1));
  const ext = path.extname(rel);
  if (body) {
    let cache = 'public, max-age=0, must-revalidate';
    if (pathname.startsWith('/assets/')) cache = noStoreAssets ? 'no-store' : 'public, max-age=31536000, immutable';
    if (pathname === '/sw.js' || /^\/sw-[^/]+\.js$/.test(pathname)) cache = 'no-cache';
    if (pathname === '/runtime-config.json' || pathname === '/version.json') cache = 'no-store';
    return send(200, body, TYPES[ext] || 'application/octet-stream', cache);
  }
  if (pathname.startsWith('/assets/')) {
    return send(404, (await fileAt('assets/404.html')) ?? Buffer.from('Not Found\n'), 'text/html; charset=utf-8', 'no-store');
  }
  return send(200, (await fileAt('index.html')) ?? Buffer.from(''), TYPES['.html'], 'public, max-age=0, must-revalidate');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://localhost:${server.address().port}`;

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}`);
};

async function precacheList(dir) {
  const sw = await readFile(path.join(dir, 'sw.js'), 'utf8');
  return [...sw.matchAll(/\{url:"([^"]+)",revision:/g)].map((m) => `/${m[1]}`);
}

async function newContext(browser) {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  // 本機以外一律中止（不打正式 Firestore 等）。
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    return u.hostname === 'localhost' ? route.continue() : route.abort();
  });
  return context;
}

const snapshot = (page) =>
  page.evaluate(async () => {
    const out = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      out[name] = (await cache.keys()).map((r) => {
        const u = new URL(r.url);
        u.searchParams.delete('__WB_REVISION__');
        return u.pathname + u.search;
      });
    }
    return out;
  });

const waitControlled = (page) =>
  page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated', null, { timeout: 60_000 });

function summarize(entries) {
  const assets = entries.filter((e) => e.path !== '/sw.js');
  return { requests: entries.length, bytes: entries.reduce((s, e) => s + e.bytes, 0), assetRequests: assets.length };
}

const browser = await chromium.launch();
const report = {};
try {
  // ---- 4. 首次安裝量（全新資料） ----
  for (const [label, dir] of [['before', args.before], ['after', args.after]]) {
    rootDir = path.resolve(dir);
    const context = await newContext(browser);
    const page = await context.newPage();
    log = [];
    t0 = Date.now();
    await page.goto(`${origin}/`);
    const loadAt = Date.now() - t0;
    await waitControlled(page);
    const readyAt = Date.now() - t0;
    await page.waitForTimeout(1_000);
    const swScriptAt = log.find((e) => e.path === '/sw.js')?.t ?? null;
    const afterSw = swScriptAt === null ? [] : log.filter((e) => e.t > swScriptAt && e.dest === 'empty' && e.path !== '/runtime-config.json');
    report[`install_${label}`] = {
      loadEventMs: loadAt,
      swControlledMs: readyAt,
      allServed: summarize(log),
      swFetchesAfterSwScript: summarize(afterSw),
      firstSwFetchMs: afterSw[0]?.t ?? null,
      precacheEntries: (await snapshot(page)),
    };
    report[`install_${label}`].precacheEntries = Object.fromEntries(
      Object.entries(report[`install_${label}`].precacheEntries).map(([k, v]) => [k, v.length]),
    );
    await context.close();
  }

  // ---- 1. 換版清理 ----
  rootDir = path.resolve(args.before);
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto(`${origin}/`);
  await waitControlled(page);
  const s1 = await snapshot(page);
  const beforeList = await precacheList(args.before);
  const afterList = await precacheList(args.after);
  const preName1 = Object.keys(s1).find((k) => k.includes('precache'));
  check(preName1 && s1[preName1].length === beforeList.length, `舊版裝好：預存 ${s1[preName1]?.length} 筆＝舊版清單 ${beforeList.length} 筆`);

  rootDir = path.resolve(args.after);
  log = [];
  t0 = Date.now();
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const changed = new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    await reg.update();
    await changed;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated', null, { timeout: 60_000 });
  await page.waitForTimeout(1_000);
  report.upgrade_served = summarize(log);
  const s2 = await snapshot(page);
  const preNames = Object.keys(s2).filter((k) => k.includes('precache'));
  check(preNames.length === 1, `換版後只剩一個預存快取：${preNames.join(', ')}`);
  const got = [...(s2[preNames[0]] ?? [])].sort();
  check(JSON.stringify(got) === JSON.stringify([...afterList].sort()), `換版後預存＝新版殼 ${afterList.length} 筆（實際 ${got.length} 筆）`);
  const leftovers = beforeList.filter((u) => !afterList.includes(u) && got.includes(u));
  check(leftovers.length === 0, `舊版多出來的 ${beforeList.filter((u) => !afterList.includes(u)).length} 筆全部清掉（殘留 ${leftovers.length}）`);
  report.upgrade_caches = Object.fromEntries(Object.entries(s2).map(([k, v]) => [k, v.length]));

  // ---- 2. 執行期快取 ----
  await page.reload();
  await waitControlled(page);
  // 等閒置預載（本頁資料拿不到時最多等 8 秒）
  await page.waitForTimeout(12_000);
  const html = await readFile(path.join(args.after, 'index.html'), 'utf8');
  const detailChunk = JSON.parse(/id="fcb-boot-preload">([^<]*)</.exec(html)[1]).detail.js[0];
  const fetched = await page.evaluate(async ([chunk, fake]) => {
    // 讀完內容，避免換頁時被當成中止的請求
    const r1 = await fetch(chunk);
    await r1.text();
    const n1 = await fetch('/assets/nope-ZZZZZZZZ.js');
    await n1.text();
    const n2 = await fetch('/assets/nope-ZZZZZZZZ.js');
    await n2.text();
    const f1 = await fetch(fake);
    await f1.text();
    // SW 存快取是在回應交出之後才做（waitUntil），馬上查會漏；等 2 秒再查，「沒存」的判定才不會因時間差誤過。
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const cache = await caches.open('fcb-assets');
    return {
      chunk: r1.status,
      chunkCached: !!(await cache.match(chunk)),
      missing: [n1.status, n2.status],
      missingCached: !!(await cache.match('/assets/nope-ZZZZZZZZ.js')),
      fake: f1.status,
      fakeCached: !!(await cache.match(fake)),
    };
  }, [detailChunk, FAKE_HTML_ASSET]);
  check(fetched.chunk === 200 && fetched.chunkCached, `殼以外分塊 ${detailChunk} 經 SW 抓到 200 並存進 fcb-assets`);
  check(fetched.missing[0] === 404 && fetched.missing[1] === 404 && !fetched.missingCached, '/assets/ 不存在：兩次都 404、不存進快取');
  check(fetched.fake === 200 && !fetched.fakeCached, '.js 回成 HTML 200：不存進快取');
  const s3 = await snapshot(page);
  report.after_reload_caches = Object.fromEntries(Object.entries(s3).map(([k, v]) => [k, v.length]));

  await context.close();

  // ---- 3. 離線：/assets/ 不留 HTTP 快取，只看 SW 保證得到的範圍 ----
  // 情境 visit1：全新資料只開過首頁一次；visit2：再開一次（這次 SW 從一開始就接管，閒置預載會存進 fcb-assets）。
  // 每頁開新分頁（sessionStorage 不共用，chunk-reload 的 60 秒窗不互相影響），等 5 秒後看：
  // 頁面錯誤畫面（.error-fallback）＝這頁打不開；「載入失敗｜重新載入」提示（#sw-reload-deferred-prompt）另記，
  // 多半是本頁畫好後閒置預載其他分頁失敗觸發的。
  const routes = ['/', '/activities', '/teams', '/tournaments', '/profile', '/inbox', '/my-activities', '/profile/qr', '/events/offline-test', '/teams/offline-test', '/leaderboard', '/admin/logs', '/admin/users', '/me/dashboard', '/games', '/checkin'];
  rootDir = path.resolve(args.after);
  noStoreAssets = true;
  report.offline = {};
  for (const visits of [1, 2]) {
    const offContext = await newContext(browser);
    const warm = await offContext.newPage();
    for (let i = 0; i < visits; i += 1) {
      await warm.goto(`${origin}/`);
      await waitControlled(warm);
      await warm.waitForTimeout(12_000);
    }
    const caches1 = Object.fromEntries(Object.entries(await snapshot(warm)).map(([k, v]) => [k, v.length]));
    await warm.close();
    serverDown = true;
    const result = { caches: caches1, routes: {} };
    for (const route of routes) {
      const pg = await offContext.newPage();
      const failed = new Set();
      pg.on('requestfailed', (req) => {
        const u = new URL(req.url());
        if (u.hostname === 'localhost' && u.pathname.startsWith('/assets/')) failed.add(u.pathname);
      });
      let state;
      try {
        await pg.goto(`${origin}${route}`, { timeout: 15_000 });
        await pg.waitForTimeout(5_000);
        state = await pg.evaluate(() => ({
          errorScreen: !!document.querySelector('.error-fallback'),
          prompt: !!document.getElementById('sw-reload-deferred-prompt'),
        }));
      } catch (err) {
        state = { errorScreen: true, prompt: false, goto: String(err).slice(0, 80) };
      }
      result.routes[route] = { opens: !state.errorScreen, ...state, failedAssets: failed.size };
      console.log(`離線 visit${visits} ${route}: ${state.errorScreen ? '打不開（錯誤畫面）' : '打得開'}${state.prompt ? '，有「載入失敗」提示' : ''}；拿不到的程式 ${failed.size} 支`);
      await pg.close();
    }
    serverDown = false;
    report.offline[`visit${visits}`] = result;
    await offContext.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(JSON.stringify(report, null, 2));
if (args.out) await writeFile(args.out, JSON.stringify({ report, failures }, null, 2));
if (failures.length) {
  console.error(`失敗 ${failures.length} 項`);
  process.exit(1);
}
