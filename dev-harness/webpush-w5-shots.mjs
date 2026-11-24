#!/usr/bin/env node
// 網頁推播 W5 真元件截圖（設計書 §8.3）：對 webpush-w5 harness 開發伺服器逐狀態截圖，
// 360／390／1280 × 淺深；外語 × 360／390 淺色 × 有字的狀態。每張自動量：文字截斷或折行、橫向捲動、console 錯誤。
// 推播 API 與 Callable 全是假的；非本機請求一律擋下。
// 用法：node dev-harness/webpush-w5-shots.mjs <輸出資料夾> <base url>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] || 'webpush-w5-shots');
const BASE = process.argv[3] || 'http://localhost:5391';
// 第 4 個參數：只重拍名稱符合的狀態（例如 ios-home-modal）。
const ONLY = process.argv[4] || '';

const UA = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  lineAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Line/14.19.1',
  lineIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.19.1',
};

// [輸出名, harness scene, UA 種類, 要做的事]
const SCENES = [
  ['loading', 'loading', 'capable', 'loading'],
  ['off', 'off', 'capable', 'off'],
  ['sending', 'sending', 'capable', 'click-sending'],
  ['on', 'on', 'capable', 'on'],
  ['toast-on', 'toast-on', 'capable', 'click-on'],
  ['toast-off', 'toast-off', 'capable', 'click-off'],
  ['toast-failed', 'toast-failed', 'capable', 'click-failed'],
  ['blocked', 'blocked', 'capable', 'blocked'],
  ['blocked-ios', 'blocked-ios', 'ios-standalone', 'blocked'],
  ['line-android', 'off', 'lineAndroid', 'static'],
  ['line-ios', 'off', 'lineIos', 'static'],
  ['ios-home', 'off', 'iphone', 'static'],
  ['ios-home-modal', 'off', 'iphone', 'modal'],
  ['off-unbound', 'off-unbound', 'capable', 'off'],
  ['hidden', 'off', 'unsupported', 'hidden'],
];
const TEXT_SCENES = new Set(['off', 'toast-on', 'toast-off', 'toast-failed', 'blocked', 'blocked-ios', 'line-android', 'line-ios', 'ios-home']);
const LANGS = ['en', 'ja', 'ko', 'th', 'vi', 'zh-CN'];

function uaFor(kind, width) {
  if (kind === 'capable' || kind === 'unsupported') return width >= 1000 ? UA.desktop : UA.android;
  if (kind === 'ios-standalone') return UA.iphone;
  return UA[kind];
}

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], problems: [], consoleErrors: [], blocked: [] };

async function shoot({ name, scene, kind, action, width, theme, lang }) {
  const ctx = await browser.newContext({
    viewport: { width, height: width >= 1000 ? 760 : 640 },
    deviceScaleFactor: lang === 'zh-TW' ? 2 : 1.5,
    colorScheme: theme,
    userAgent: uaFor(kind, width),
    hasTouch: width < 1000,
  });
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (['localhost', '127.0.0.1'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    report.blocked.push(u.hostname);
    return r.abort();
  });
  if (kind === 'ios-standalone') await ctx.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  if (kind === 'unsupported') await ctx.addInitScript(() => { delete window.PushManager; });
  const page = await ctx.newPage();
  const tag = `${name}-${theme}-${width}${lang === 'zh-TW' ? '' : `-${lang}`}`;
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: ${e.message}`));
  await page.goto(`${BASE}/dev-harness/webpush-w5.html?scene=${scene}&theme=${theme}&lang=${lang}`);
  await page.waitForFunction(() => window.__WP_READY === true, null, { timeout: 30000 });
  await page.click('#profile-quick-btn-line');
  const state = (s) => page.waitForSelector(`.wp-block[data-wp-state="${s}"]`, { timeout: 15000 });
  if (action === 'loading') await page.waitForSelector('.wp-spin', { timeout: 15000 });
  else if (action === 'off') await state('off');
  else if (action === 'on') await state('on');
  else if (action === 'blocked') await state('blocked');
  else if (action === 'static') await page.waitForSelector('.wp-hint', { timeout: 15000 });
  else if (action === 'modal') {
    await page.waitForSelector('.wp-hint .line-notify-friend-btn', { timeout: 15000 });
    await page.click('.wp-hint .line-notify-friend-btn');
    await page.waitForSelector('#pwa-ios-modal, .pwa-modal-overlay', { timeout: 15000 });
  } else if (action === 'hidden') {
    await page.waitForSelector('#line-notify-bound', { timeout: 15000 });
  } else if (action.startsWith('click-')) {
    const from = action === 'click-off' ? 'on' : 'off';
    await state(from);
    await page.click('.wp-row .toggle-switch');
    if (action === 'click-sending') await state('sending');
    else {
      await state(action === 'click-on' ? 'on' : 'off');
      await page.waitForSelector('.ui-toast', { timeout: 5000 });
    }
  }
  await page.waitForTimeout(action.startsWith('click-') && action !== 'click-sending' ? 450 : 250);
  // 圖片（「怎麼加入」彈窗的教學圖）載完才截，否則是空白框（審查 P3-4）。延遲載入的圖先捲進畫面觸發載入。
  await page.evaluate(() => { for (const i of document.images) i.loading = 'eager'; });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0 && getComputedStyle(i).opacity === '1'), null, { timeout: 15000 });
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => undefined))));
  await page.waitForTimeout(300);
  // 自動量：介面文字不得截斷或折行（R-UI-027）、不得有橫向捲動。
  const check = await page.evaluate(() => {
    const out = [];
    const nodes = [...document.querySelectorAll('.wp-block .wp-row > span, .wp-block .line-notify-sub, .wp-hint > span, .wp-hint button, .wp-row .line-notify-status, .ui-toast__message')];
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      const own = el.matches('.wp-row > span') ? el.firstChild : el;
      let lines = 1;
      if (own) {
        const range = document.createRange();
        range.selectNodeContents(own.nodeType === 3 ? own : el);
        if (own.nodeType === 3) { range.setStart(own, 0); range.setEnd(own, own.length); }
        lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
      }
      const truncated = el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible';
      if (lines > 1 || truncated) out.push({ text: el.textContent, lines, truncated, h: r.height, lh });
    }
    const hscroll = document.scrollingElement.scrollWidth > window.innerWidth;
    return { out, hscroll, hasRow: !!document.querySelector('.wp-block'), hasSep: !!document.querySelector('.wp-sep'), hasPh: !!document.querySelector('.wp-placeholder') };
  });
  if (check.out.length) report.problems.push({ tag, wraps: check.out });
  if (check.hscroll) report.problems.push({ tag, hscroll: true });
  if (name === 'hidden' && (check.hasRow || check.hasSep || check.hasPh)) report.problems.push({ tag, hiddenLeak: check });
  await page.screenshot({ path: join(OUT, `${tag}.jpg`), type: 'jpeg', quality: 82 });
  report.shots.push(tag);
  await ctx.close();
}

for (const [name, scene, kind, action] of SCENES) {
  if (ONLY && name !== ONLY) continue;
  for (const theme of ['light', 'dark']) {
    for (const width of [360, 390, 1280]) await shoot({ name, scene, kind, action, width, theme, lang: 'zh-TW' });
  }
}
for (const lang of LANGS) {
  for (const [name, scene, kind, action] of SCENES) {
    if (!TEXT_SCENES.has(name) || (ONLY && name !== ONLY)) continue;
    for (const width of [360, 375, 390]) await shoot({ name, scene, kind, action, width, theme: 'light', lang });
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ shots: report.shots.length, problems: report.problems.length, consoleErrors: report.consoleErrors.length, blocked: [...new Set(report.blocked)] }));
