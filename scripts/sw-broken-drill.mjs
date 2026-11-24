/**
 * SW 被匯入檔壞掉時的本機演練（網頁推播 W4 設計書 §5.4；顧問裁定 D7 (A)）：真的 Chromium／WebKit、真的 sw.js，
 * 本機伺服器照 Cloudflare Pages 行為輪流提供不同版本。只在本機跑，不進 CI。
 *
 *   node scripts/sw-broken-drill.mjs --base <基底 dist> --good <W4 dist> --rebuilt <W4 重新建置的 dist> [--engine chromium|webkit|all] [--out report.json] [--timeout ms]
 *
 * --rebuilt 必須是重新建置的產物（sw.js 位元組與 --good 不同，例如換 FCB_BUILD_ID 再 build 一次）；相同就以 2 結束。
 * 壞版由 --good 衍生，不另建置：
 *   missing：sw-push.js 不存在（伺服器照 Pages 回 index.html 的 200 text/html），sw.js 不變；
 *   throw：sw-push.js 立即函式外第一行加 throw，sw.js 不變。
 *
 * 情境（每個引擎各跑一次；任一項不符就以非 0 結束）：
 * 1. 全新資料直接裝壞版（missing、throw 各一）：壞版啟用、預存 0 筆、離線開不了、push 監聽不在。
 * 2. 舊版（--base）裝好後換壞版：壞版停在 waiting、舊版照常控制、預存不變、離線照常。
 * 3. 舊版控制中換壞版、更新提示掛著：每次開頁都跳提示、按「現在更新」後 waiting 不變、不白畫面。
 * 4. 救援：(a) 只補回缺檔、sw.js 不變 → 救不回（反例）；(b) 換成重新建置、sw.js 位元組不同的版本 → 一次重新整理救回；救回後再 update() 一次，送出的 sw.js 全是救援版。
 * 每個情境記下伺服器當下 sw.js 的 sha256、registration 的 active／waiting 狀態、預存筆數。
 *
 * 不打正式環境：本機以外的請求一律中止。Chromium 另用 CDP 記 SW 錯誤、在 SW 內送一則替身 push 事件確認監聽在不在；
 * WebKit 沒有這兩個介面，只看狀態、預存與離線。
 * 注意：WebKit 的 context.route 攔不到 SW 自己發出的請求；目前 workbox 設定沒有跨網域路由、SW 只抓同源檔，所以不會外連。
 * 日後 SW 若加跨網域請求，WebKit 這一輪要另外隔離網路再跑。
 * 整支腳本有總逾時（--timeout 毫秒，預設 20 分鐘），到時關掉瀏覽器並以 1 結束。
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from '@playwright/test';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []),
);
if (!args.base || !args.good || !args.rebuilt) {
  console.error('用法：node scripts/sw-broken-drill.mjs --base <dist> --good <dist> --rebuilt <dist> [--engine chromium|webkit|all] [--out report.json]');
  process.exit(2);
}
const DIRS = { base: path.resolve(args.base), good: path.resolve(args.good), rebuilt: path.resolve(args.rebuilt) };
const engines = (args.engine ?? 'all') === 'all' ? ['chromium', 'webkit'] : [args.engine];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const goodPush = await readFile(path.join(DIRS.good, 'sw-push.js'));
const VARIANTS = {
  base: { root: DIRS.base },
  good: { root: DIRS.good },
  rebuilt: { root: DIRS.rebuilt },
  missing: { root: DIRS.good, missing: new Set(['sw-push.js']) },
  throw: { root: DIRS.good, override: new Map([['sw-push.js', Buffer.concat([Buffer.from("throw new Error('w4-drill');\n"), goodPush])]]) },
};
const SW_SHA = {};
const PRECACHE_N = {};
for (const [name, v] of Object.entries(VARIANTS)) {
  const sw = await readFile(path.join(v.root, 'sw.js'));
  SW_SHA[name] = sha256(sw);
  PRECACHE_N[name] = [...sw.toString('utf8').matchAll(/\{url:"[^"]+",revision:/g)].length;
}
if (SW_SHA.rebuilt === SW_SHA.good) {
  console.error('--rebuilt 的 sw.js 與 --good 位元組相同：請重新建置（例如換 FCB_BUILD_ID）再跑');
  process.exit(2);
}

let current = VARIANTS.base;
let serverDown = false;
// 伺服器實際送出的每一份 /sw.js 的 sha256（情境 4 用來證明瀏覽器抓到的位元組）。
let swServed = [];

async function fileAt(rel) {
  if (current.missing?.has(rel)) return null;
  if (current.override?.has(rel)) return current.override.get(rel);
  const full = path.resolve(current.root, rel);
  if (full !== current.root && !full.startsWith(current.root + path.sep)) return null;
  try {
    if (!(await stat(full)).isFile()) return null;
    return await readFile(full);
  } catch {
    return null;
  }
}

// 照 Pages：/assets/* 不存在回 404；其他不存在的路徑回 index.html 的 200（缺 sw-push.js 時 importScripts 會拿到 HTML）。
const server = createServer(async (req, res) => {
  if (serverDown) {
    req.socket.destroy();
    return;
  }
  const send = (status, body, type, cache) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': cache, 'content-length': body.length });
    res.end(body);
    if (pathname === '/sw.js') swServed.push(sha256(body));
  };
  let pathname = '';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(400, Buffer.from('Bad Request\n'), 'text/plain; charset=utf-8', 'no-store');
  }
  const rel = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const body = await fileAt(rel.slice(1));
  if (body) {
    let cache = 'public, max-age=0, must-revalidate';
    if (pathname.startsWith('/assets/')) cache = 'public, max-age=31536000, immutable';
    if (pathname === '/sw.js' || /^\/sw-[^/]+\.js$/.test(pathname)) cache = 'no-cache';
    if (pathname === '/runtime-config.json' || pathname === '/version.json') cache = 'no-store';
    return send(200, body, TYPES[path.extname(rel)] || 'application/octet-stream', cache);
  }
  if (pathname.startsWith('/assets/')) return send(404, Buffer.from('Not Found\n'), 'text/html; charset=utf-8', 'no-store');
  return send(200, (await fileAt('index.html')) ?? Buffer.from(''), TYPES['.html'], 'public, max-age=0, must-revalidate');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://localhost:${server.address().port}`;

const failures = [];
const report = { swSha256: SW_SHA, precacheEntries: PRECACHE_N, engines: {} };
let engineName = '';
let section = null;
const check = (ok, what) => {
  const line = `[${engineName}] ${what}`;
  if (!ok) failures.push(line);
  section.checks.push({ ok, what });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${line}`);
};
const use = (name) => {
  current = VARIANTS[name];
  section.steps.push({ variant: name, swSha256: SW_SHA[name] });
  console.log(`  [${engineName}] 伺服器改供 ${name}（sw.js sha256 ${SW_SHA[name]}）`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function newContext(browser) {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.route('**/*', (route) => (new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort()));
  return context;
}

/** Chromium：用 CDP 收 SW 的錯誤原文。 */
async function watchErrors(page, sink) {
  if (engineName !== 'chromium') return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  cdp.on('ServiceWorker.workerErrorReported', (e) => sink.push(e.errorMessage.errorMessage));
}

const state = async (page, tag) => {
  const s = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    const d = (w) => (w ? w.state : null);
    const keys = await caches.keys();
    const pre = keys.find((k) => k.includes('precache'));
    const n = pre ? (await (await caches.open(pre)).keys()).length : 0;
    return {
      active: d(r && r.active),
      waiting: d(r && r.waiting),
      installing: d(r && r.installing),
      activeScript: r && r.active ? new URL(r.active.scriptURL).pathname : null,
      waitingScript: r && r.waiting ? new URL(r.waiting.scriptURL).pathname : null,
      controlled: !!navigator.serviceWorker.controller,
      caches: keys,
      precacheN: n,
      prompt: !!document.getElementById('sw-reload-deferred-prompt'),
      blank: !document.body || document.body.innerText.trim().length === 0 || !!document.querySelector('.error-fallback'),
    };
  });
  const out = { tag, servedSwSha256: sha256(await fileAt('sw.js')), ...s };
  section.states.push(out);
  console.log(`  [${engineName}] ${tag}: ${JSON.stringify(s)}`);
  return out;
};

/** 伺服器斷線後開新分頁：能開＝SW 從預存拿到 index.html 與殼。 */
async function offlineOpens(context) {
  const page = await context.newPage();
  serverDown = true;
  let ok = false;
  try {
    await page.goto(`${origin}/`, { timeout: 8_000 });
    ok = await page.evaluate(() => document.querySelectorAll('script[type="module"]').length > 0);
  } catch {
    ok = false;
  }
  serverDown = false;
  await page.close().catch(() => {});
  return ok;
}

/** Chromium：在每支 SW 內送一則替身 push 事件，回傳有沒有呼叫 showNotification（＝sw-push.js 的監聽在）。WebKit 回 null。 */
async function pushListenerPresent(context) {
  if (engineName !== 'chromium') return null;
  const results = [];
  for (const worker of context.serviceWorkers()) {
    results.push(await worker.evaluate(async () => {
      const shown = [];
      Object.defineProperty(self.registration, 'showNotification', {
        configurable: true,
        value: (title, options) => {
          shown.push([title, options && options.data && options.data.url]);
          return Promise.resolve();
        },
      });
      // 替身事件不是 trusted，waitUntil 會丟錯（sw-push.js 會接住），但 showNotification 已先呼叫。
      self.dispatchEvent(new PushEvent('push', { data: JSON.stringify({ v: 1, title: 'drill', body: 'b', url: '/inbox' }) }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      return shown.length > 0;
    }).catch(() => false));
  }
  return results.some(Boolean);
}

const reloadAndWait = async (page, ms) => {
  await page.reload();
  await sleep(ms);
};
const update = (page) => page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  await r.update().catch(() => {});
});
const waitControlled = (page) =>
  page.waitForFunction(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.state === 'activated', null, { timeout: 60_000 });

async function scenarioFresh(browser, variant) {
  const errors = [];
  use(variant);
  const context = await newContext(browser);
  const page = await context.newPage();
  await watchErrors(page, errors);
  await page.goto(`${origin}/`);
  await sleep(6_000);
  await reloadAndWait(page, 3_000);
  const s = await state(page, `情境1 ${variant}：全新資料裝壞版、重新整理後`);
  check(s.active === 'activated' && s.waiting === null, `情境1 ${variant}：壞版照樣啟用（active=${s.active}、waiting=${s.waiting}）`);
  check(s.precacheN === 0 && s.caches.length === 0, `情境1 ${variant}：沒有任何快取（預存 ${s.precacheN} 筆、快取 ${s.caches.length} 個）`);
  check(!(await offlineOpens(context)), `情境1 ${variant}：離線開不了（沒有 fetch 監聽）`);
  const push = await pushListenerPresent(context);
  if (push !== null) check(push === false, `情境1 ${variant}：push 監聽不在`);
  if (engineName === 'chromium') {
    section.errors[variant] = [...new Set(errors)];
    // 缺檔時另有一行 MIME 說明（importScripts 拿到 HTML），之後才是 Uncaught (in promise)；沒有其他錯誤（不是安裝失敗）。
    const unexpected = errors.filter((e) => !e.startsWith('Uncaught (in promise)') && !e.startsWith('The script has an unsupported MIME type'));
    check(errors.some((e) => e.startsWith('Uncaught (in promise)')) && unexpected.length === 0, `情境1 ${variant}：SW 錯誤只有 Uncaught (in promise)${variant === 'missing' ? '＋MIME 說明' : ''}：${JSON.stringify([...new Set(errors)])}`);
  }
  await context.close();
}

async function controlledBase(browser) {
  use('base');
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto(`${origin}/`);
  await waitControlled(page);
  await sleep(2_000);
  const s = await state(page, '舊版裝好');
  check(s.precacheN === PRECACHE_N.base, `舊版裝好：預存 ${s.precacheN} 筆＝舊版清單 ${PRECACHE_N.base} 筆`);
  return { context, page };
}

async function scenarioUpgrade(browser, variant) {
  const { context, page } = await controlledBase(browser);
  use(variant);
  await update(page);
  await sleep(4_000);
  await reloadAndWait(page, 4_000);
  await reloadAndWait(page, 4_000);
  const s = await state(page, `情境2 ${variant}：舊版換壞版、重新整理兩次後`);
  check(s.waiting === 'installed' && s.active === 'activated' && s.controlled, `情境2 ${variant}：壞版停在 waiting、舊版照常控制（active=${s.active}、waiting=${s.waiting}）`);
  check(s.precacheN === PRECACHE_N.base, `情境2 ${variant}：預存仍是舊版 ${PRECACHE_N.base} 筆（實際 ${s.precacheN}）`);
  check(await offlineOpens(context), `情境2 ${variant}：離線照常`);
  await context.close();
}

async function scenarioPrompt(browser, variant) {
  const { context, page } = await controlledBase(browser);
  use(variant);
  await update(page);
  await sleep(4_000);
  for (let i = 1; i <= 2; i += 1) {
    await reloadAndWait(page, 5_000);
    const s = await state(page, `情境3 ${variant}：第 ${i} 次開頁`);
    check(s.prompt && s.waiting === 'installed' && !s.blank, `情境3 ${variant}：第 ${i} 次開頁跳更新提示、waiting 不變、不白畫面`);
    const now = await page.$('[data-sw-reload-now]');
    check(!!now, `情境3 ${variant}：第 ${i} 次找得到「現在更新」按鈕`);
    if (!now) continue;
    await Promise.all([page.waitForNavigation({ timeout: 10_000 }).catch(() => null), now.click()]);
    await sleep(5_000);
    const after = await state(page, `情境3 ${variant}：第 ${i} 次按「現在更新」後`);
    check(after.waiting === 'installed' && after.active === 'activated' && !after.blank, `情境3 ${variant}：第 ${i} 次按「現在更新」無效（waiting 仍在）、不白畫面`);
    check(after.prompt, `情境3 ${variant}：第 ${i} 次按完提示又出現`);
  }
  await context.close();
}

async function scenarioRescue(browser) {
  use('missing');
  const context = await newContext(browser);
  const page = await context.newPage();
  swServed = [];
  await page.goto(`${origin}/`);
  await sleep(6_000);
  await reloadAndWait(page, 3_000);
  const brokenSha = [...new Set(swServed)];
  const broken = await state(page, '情境4：全新資料裝上缺檔壞版');
  check(brokenSha.length === 1, `情境4：裝壞版時伺服器送出的 sw.js 只有一份（${brokenSha.join(', ')}）`);
  check(broken.active === 'activated' && broken.precacheN === 0, '情境4：缺檔壞版已啟用、預存 0 筆');

  // (a) 只補回缺檔：伺服器提供的 sw.js 與壞版位元組相同。
  use('good');
  swServed = [];
  await reloadAndWait(page, 3_000);
  await update(page);
  await sleep(4_000);
  await reloadAndWait(page, 3_000);
  await reloadAndWait(page, 3_000);
  const servedA = [...new Set(swServed)];
  check(swServed.length > 0 && servedA.length === 1 && servedA[0] === brokenSha[0], `情境4(a)：補檔後瀏覽器更新檢查抓了 ${swServed.length} 次 sw.js，位元組全部等於已裝的壞版（${servedA.join(', ')}）`);
  const a = await state(page, '情境4(a)：只補回缺檔、重新整理三次＋update() 後');
  check(a.precacheN === 0 && a.waiting === null && a.installing === null, `情境4(a)：救不回（預存 ${a.precacheN} 筆、沒有新版 SW 安裝）`);
  check(!(await offlineOpens(context)), '情境4(a)：仍然離線開不了');
  const pushA = await pushListenerPresent(context);
  if (pushA !== null) check(pushA === false, '情境4(a)：push 監聽仍不在');

  // (b) 重新建置：sw.js 位元組不同。
  use('rebuilt');
  swServed = [];
  await page.reload();
  let b = null;
  for (let i = 0; i < 20; i += 1) {
    await sleep(1_000);
    b = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      const keys = await caches.keys();
      const pre = keys.find((k) => k.includes('precache'));
      return { active: r && r.active ? r.active.state : null, n: pre ? (await (await caches.open(pre)).keys()).length : 0 };
    });
    if (b.active === 'activated' && b.n === PRECACHE_N.rebuilt) break;
  }
  const servedB = [...new Set(swServed)];
  check(servedB.length === 1 && servedB[0] === SW_SHA.rebuilt && servedB[0] !== brokenSha[0], `情境4(b)：救援時伺服器送出的 sw.js 全是救援版、與壞版不同（${brokenSha[0]} → ${servedB.join(', ')}；救援版 ${SW_SHA.rebuilt}）`);
  const s = await state(page, '情境4(b)：換成重新建置的版本、重新整理一次後');
  check(s.active === 'activated' && s.waiting === null && s.precacheN === PRECACHE_N.rebuilt, `情境4(b)：一次重新整理救回（預存 ${s.precacheN}／${PRECACHE_N.rebuilt} 筆、waiting=${s.waiting}）`);
  // 救回後再主動 update() 一次：伺服器送出的每一份 sw.js 都必須是救援版（rebuilt）的位元組，且不會再裝出新的 waiting。
  const beforeUpdate = swServed.length;
  await update(page);
  await sleep(2_000);
  const servedAll = [...new Set(swServed)];
  check(swServed.length > beforeUpdate && servedAll.length === 1 && servedAll[0] === SW_SHA.rebuilt, `情境4(b)：救回後 update() 再抓 sw.js（${beforeUpdate} → ${swServed.length} 次），送出的全是救援版（實際 ${servedAll.join(', ')}）`);
  const u = await state(page, '情境4(b)：救回後 update()');
  check(u.active === 'activated' && u.waiting === null && u.installing === null && u.precacheN === PRECACHE_N.rebuilt, `情境4(b)：update() 後仍是救援版、沒有新的 waiting（預存 ${u.precacheN} 筆、waiting=${u.waiting}）`);
  check(await offlineOpens(context), '情境4(b)：離線恢復');
  const pushB = await pushListenerPresent(context);
  if (pushB !== null) check(pushB === true, '情境4(b)：push 監聽在');
  await context.close();
}

const TOTAL_MS = Number(args.timeout ?? 20 * 60_000);
let activeBrowser = null;
const watchdog = setTimeout(async () => {
  console.error(`總逾時 ${TOTAL_MS} ms：關掉瀏覽器並結束`);
  await activeBrowser?.close().catch(() => {});
  server.close();
  process.exit(1);
}, TOTAL_MS);

try {
  for (const name of engines) {
    engineName = name;
    section = { checks: [], steps: [], states: [], errors: {} };
    report.engines[name] = section;
    const browser = await (name === 'webkit' ? webkit : chromium).launch();
    activeBrowser = browser;
    try {
      for (const v of ['missing', 'throw']) await scenarioFresh(browser, v);
      for (const v of ['missing', 'throw']) await scenarioUpgrade(browser, v);
      for (const v of ['missing', 'throw']) await scenarioPrompt(browser, v);
      await scenarioRescue(browser);
    } finally {
      await browser.close();
    }
  }
} finally {
  clearTimeout(watchdog);
  server.close();
}

console.log(`sw.js sha256：${JSON.stringify(SW_SHA, null, 2)}`);
console.log(`預存筆數：${JSON.stringify(PRECACHE_N)}`);
if (args.out) await writeFile(args.out, JSON.stringify({ report, failures }, null, 2));
if (failures.length) {
  console.error(`失敗 ${failures.length} 項`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('全部通過');
