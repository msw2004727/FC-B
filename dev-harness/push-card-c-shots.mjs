#!/usr/bin/env node
// 推播 C 案（橫幅提示卡）正式元件截圖（2026-11-25）：沿用 webpush-w5 截圖台（vite.webpush-w5.config.ts），逐狀態截圖。
// 推播 API 與 Callable 全是假的；非本機請求一律擋下。自動量：文字截斷或折行、壓到開關、橫向捲動、console 錯誤、
// 橫幅與佔位高度。外語 360／375 淺色只量不存圖。
// 用法：node dev-harness/push-card-c-shots.mjs <輸出資料夾> <base url>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] || 'push-card-c-shots');
const BASE = process.argv[3] || 'http://localhost:5472';
const UA = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  lineAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Line/14.19.1',
  lineIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.19.1',
};
// [輸出名, harness scene, UA 種類, 動作]
const SCENES = [
  ['off', 'off', 'capable', 'off'],
  ['on', 'on', 'capable', 'on'],
  ['loading', 'loading', 'capable', 'loading'],
  ['sending', 'sending', 'capable', 'click-sending'],
  ['error', 'toast-failed', 'capable', 'click-failed'],
  ['blocked', 'blocked', 'capable', 'blocked'],
  ['blocked-ios', 'blocked-ios', 'ios-standalone', 'blocked'],
  ['line-android', 'off', 'lineAndroid', 'static'],
  ['line-ios', 'off', 'lineIos', 'static'],
  ['ios-home', 'off', 'iphone', 'static'],
];
const TEXT_SCENES = new Set(['off', 'on', 'blocked', 'blocked-ios', 'line-android', 'line-ios', 'ios-home']);
const LANGS = ['en', 'ja', 'ko', 'th', 'vi', 'zh-CN'];

function uaFor(kind, width) {
  if (kind === 'capable') return width >= 1000 ? UA.desktop : UA.android;
  if (kind === 'ios-standalone') return UA.iphone;
  return UA[kind];
}

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], problems: [], consoleErrors: [], blocked: [], heights: {} };

async function shoot({ name, scene, kind, action, width, theme, lang, save }) {
  const ctx = await browser.newContext({
    viewport: { width, height: width >= 1000 ? 560 : 520 },
    deviceScaleFactor: 2,
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
  const page = await ctx.newPage();
  const tag = `${name}-${theme}-${width}${lang === 'zh-TW' ? '' : `-${lang}`}`;
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: ${e.message}`));
  await page.goto(`${BASE}/dev-harness/webpush-w5.html?scene=${scene}&theme=${theme}&lang=${lang}`);
  await page.waitForFunction(() => window.__WP_READY === true, null, { timeout: 30000 });
  await page.click('#profile-quick-btn-line');
  const state = (s) => page.waitForSelector(`.wp-block[data-wp-state="${s}"]`, { timeout: 15000 });
  if (action === 'loading') await page.waitForSelector('.wp-spin', { timeout: 15000 });
  else if (action === 'off' || action === 'on' || action === 'blocked') await state(action);
  else if (action === 'static') await page.waitForSelector('.wp-hint', { timeout: 15000 });
  else if (action === 'click-sending') {
    await state('off');
    await page.click('.wp-row .toggle-switch');
    await state('sending');
  } else if (action === 'click-failed') {
    await state('off');
    await page.click('.wp-row .toggle-switch');
    await state('off');
    await page.waitForSelector('.ui-toast', { timeout: 5000 });
  }
  await page.waitForTimeout(action === 'click-failed' ? 450 : 300);
  const check = await page.evaluate(() => {
    const out = [];
    const block = document.querySelector('.wp-block');
    const br = block.getBoundingClientRect();
    const ctrl = block.querySelector('.wp-row .toggle-switch, .wp-row .line-notify-status, .wp-row .wp-spin');
    const cr = ctrl ? ctrl.getBoundingClientRect() : null;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((x) => x.width > 0);
      if (!rects.length) continue;
      const tops = new Set(rects.map((x) => Math.round(x.top + x.height / 2)));
      const right = Math.max(...rects.map((x) => x.right));
      const box = el.closest('.wp-hint, .line-notify-friend-btn, .line-notify-status') || block;
      const bb = box.getBoundingClientRect();
      const overCtrl = !!cr && !el.closest('.line-notify-status') && rects.some((x) => x.right > cr.left - 2 && x.left < cr.right && x.bottom > cr.top && x.top < cr.bottom);
      const truncated = cs.display !== 'contents' && cs.overflow === 'hidden' && el.scrollWidth > el.clientWidth + 1;
      const overflow = right > bb.right + 0.5;
      if (tops.size > 1 || overflow || overCtrl || truncated) out.push({ text: n.textContent.trim(), lines: tops.size, overflow, overCtrl, truncated });
    }
    const sep = document.querySelector('.wp-sep');
    const sepH = sep ? sep.getBoundingClientRect().height : 0;
    // 「?」說明鈕到卡片上緣的距離；佔位高度（同 WebPushSlot 的 style）與「上方間距＋卡片＋下方間距」的差。
    const help = document.querySelector('.profile-quick-help');
    const helpGap = help ? br.top - help.getBoundingClientRect().bottom : null;
    const ph = document.createElement('div');
    ph.setAttribute('style', 'min-height:calc(2.45rem + 44px + var(--space-2))');
    block.parentElement.insertBefore(ph, block);
    const phH = ph.getBoundingClientRect().height;
    ph.remove();
    const used = (sep ? sep.getBoundingClientRect().bottom : br.bottom) - (help ? help.getBoundingClientRect().bottom : br.top);
    return { out, hscroll: document.scrollingElement.scrollWidth > window.innerWidth, blockH: br.height, sepH, helpGap, phDiff: phH - used, sepBottom: sep ? sep.getBoundingClientRect().bottom + window.scrollY : null, banner: block.classList.contains('is-banner'), toggle: cr ? { w: cr.width, h: cr.height } : null };
  });
  if (check.out.length) report.problems.push({ tag, wraps: check.out });
  if (check.hscroll) report.problems.push({ tag, hscroll: true });
  report.heights[tag] = { block: check.blockH, sep: check.sepH, total: check.blockH + check.sepH, helpGap: check.helpGap, phDiff: check.phDiff, sepBottom: check.sepBottom, banner: check.banner, toggle: check.toggle };
  if (save) {
    // 點開關後頁面會捲動，截圖前捲回頂端，各狀態位置一致。
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(OUT, `${tag}.jpg`), type: 'jpeg', quality: 84 });
    report.shots.push(tag);
  }
  await ctx.close();
}

for (const [name, scene, kind, action] of SCENES) {
  for (const theme of ['light', 'dark']) {
    for (const width of [360, 390, 1280]) await shoot({ name, scene, kind, action, width, theme, lang: 'zh-TW', save: true });
  }
}
for (const lang of LANGS) {
  for (const [name, scene, kind, action] of SCENES) {
    if (!TEXT_SCENES.has(name)) continue;
    for (const width of [360, 375]) await shoot({ name, scene, kind, action, width, theme: 'light', lang, save: false });
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ shots: report.shots.length, problems: report.problems.length, consoleErrors: report.consoleErrors.length, blocked: [...new Set(report.blocked)] }));
