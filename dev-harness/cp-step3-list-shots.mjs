#!/usr/bin/env node
// 賽事清單頁新外觀截圖（清-6，第 1a 批第 7 節、第 5 批第 7 節）：對清單示範頁（vite.cp-list.config.ts 的開發伺服器）
// 逐畫面、360／1280、淺色／深色截整頁圖（2 倍像素比），並檢查 console 錯誤、整頁橫向溢出、介面文字被動斷行，
// 量幾個尺寸（卡高、篩選列寬、選單有沒有被裁、左右留白）寫進 report.json。非本機請求一律擋下記在 report.blocked。
// 用法：node dev-harness/cp-step3-list-shots.mjs <輸出資料夾> <base url，例 http://127.0.0.1:5281> [--screens=a,b] [--sizes=360,1280]
// （取代舊版：舊版拍的是手寫標記的預覽、390／360 寬、1.5 倍。）
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ARGS = process.argv.slice(2);
const FLAGS = Object.fromEntries(ARGS.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '']; }));
const POS = ARGS.filter((a) => !a.startsWith('--'));
const OUT = resolve(POS[0] || 'cp-list-shots');
const BASE = POS[1] || 'http://127.0.0.1:5281';
const ONLY = FLAGS.screens ? new Set(FLAGS.screens.split(',')) : null;
const SIZES = [[360, 780], [1280, 800]].filter(([w]) => !FLAGS.sizes || FLAGS.sizes.split(',').map(Number).includes(w));
const THEMES = ['light', 'dark'];

const pickStatus = (label) => async (page) => {
  await page.locator('.d2-dd__btn').click();
  await page.getByRole('option', { name: label }).click();
};
const openMenu = async (page) => { await page.locator('.d2-dd__btn').click(); };
// [畫面, 站內?, 等到出現的選擇器, 動作, 只拍 360]
const SCREENS = [
  ['in', true, '.cpl-card--board'],
  ['in-cup', true, '.cpl-card', async (p) => { await p.getByRole('tab', { name: '盃賽' }).click(); }],
  ['in-mine', true, '.cpl-card', async (p) => { await p.locator('[data-inapp] .cpl-sw').click(); }],
  ['in-done', true, '.cpl-card', pickStatus('已結束')],
  ['in-nolive', true, '.cpl-card--board'],
  ['in-twolive', true, '.cpl-card--board'],
  ['in-live-noline', true, '.cpl-card--board'],
  ['in-recruit-board', true, '.cpl-card--board'],
  ['in-marks', true, '.cpl-card--board'],
  ['in-noboard', true, '.cpl-card'],
  ['in-long', true, '.cpl-card--board'],
  ['in-guest', true, '.cpl-card--board'],
  ['in-menu', true, '.cpl-card--board', openMenu],
  ['in-menu-empty', true, '.cpl-card--board', async (p) => { await pickStatus('已結束')(p); await openMenu(p); }],
  ['in-menu-two', true, '.cpl-card--board', async (p) => { await pickStatus('已結束')(p); await openMenu(p); }],
  ['in-loading', true, '[data-cp-pending-in]'],
  ['ext', false, '.cpl-src'],
  ['ext-admin', false, '.cpl-xrow__edit'],
  ['ext-long', false, '.cpl-xrow__edit'],
  ['ext-loading', false, '.cpl-xskel'],
  ['ext-empty', false, '.cpl-xmsg'],
  ['ext-error', false, '.cpl-xmsg'],
  ['ext-delete', false, '.cpl-xrow__edit', async (p) => {
    await p.locator('.cpl-xrow__edit').first().click();
    await p.locator('#tc-delete').click();
    await p.locator('#app-confirm-modal .app-confirm-ok').waitFor();
  }, true],
  ['gate-off', false, '.cpl-xrow'],
  ['gate-off-admin', false, '.cpl-xrow__edit'],
  ['gate-off-long', false, '.cpl-xrow'],
  ['gate-off-loading', false, '.cpl-xskel'],
  ['gate-off-empty', false, '.cpl-xmsg'],
  ['gate-off-error', false, '.cpl-xmsg'],
];

// 介面文字不該被動斷行的元素（外部賽事名稱是設計接受的換行，不在這裡）
const NOWRAP = '.cpl-src button, .cpl-head h2:not(.cpl-vh), .cpl-seg__tab, .cpl-sw > span:first-child, .ui-button__label, .d2-menu__opt, .cpl-st, .cpl-line, .cpl-card__name, .cpl-meta, .d2-sb__st, .cpl-sb__cat, .d2-cell, .cpl-xrow__cat, .cpl-xrow__date, .cpl-xmsg p';

function measure(nowrap) {
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  const page = document.getElementById('page-tournaments');
  const doc = document.scrollingElement;
  const wraps = [];
  for (const el of document.querySelectorAll(nowrap)) {
    if (el.offsetParent === null || el.closest('[hidden]')) continue;
    // 用文字範圍的行框數判斷（元素本身可能因點擊區比字高）
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0);
    if (rects.length < 2) continue;
    const firstBottom = Math.min(...rects.map((x) => x.bottom));
    if (rects.some((x) => x.top >= firstBottom - 1)) wraps.push({ cls: String(el.className), text: (el.textContent || '').trim().slice(0, 30) });
  }
  const truncated = [...document.querySelectorAll('.cpl-card__name, .cpl-meta__venue, .cpl-line')]
    .filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => (el.textContent || '').trim().slice(0, 30));
  const menu = document.querySelector('.d2-menu:not([hidden])');
  const inapp = document.querySelector('[data-inapp]');
  const toolbar = document.querySelector('.cpl-toolbar') || document.querySelector('.cpl-bar');
  const seg = r(document.querySelector('.cpl-seg'));
  return {
    hOverflow: doc.scrollWidth - doc.clientWidth,
    pageInnerScroll: page ? page.scrollHeight - page.clientHeight : null,
    contentLeft: seg ? Math.round(seg.left) : null,
    contentRight: seg ? Math.round(document.documentElement.clientWidth - seg.right) : null,
    headW: Math.round(r(document.querySelector('.cpl-head'))?.width ?? 0),
    segH: seg ? Math.round(seg.height) : null,
    toolbar: toolbar ? { scrollW: toolbar.scrollWidth, clientW: toolbar.clientWidth, h: Math.round(r(toolbar).height) } : null,
    cards: [...document.querySelectorAll('.cpl-card')].map((el) => ({ cid: el.getAttribute('data-cid'), board: el.classList.contains('cpl-card--board'), h: Math.round(r(el).height) })),
    xrows: [...document.querySelectorAll('.cpl-xrow')].map((el) => Math.round(r(el).height)),
    skel: [...document.querySelectorAll('.cpl-skel__card, .cpl-xskel__row')].map((el) => Math.round(r(el).height)),
    menu: menu ? {
      rows: menu.querySelectorAll('[role="option"]').length,
      clippedPx: inapp ? Math.max(0, Math.round(r(menu).bottom - r(inapp).bottom)) : null,
      focus: document.activeElement?.textContent ?? null,
    } : null,
    wraps,
    truncated,
  };
}

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { base: BASE, dpr: 2, shots: [], consoleErrors: [], blocked: [], overflows: [], wraps: [], failures: [] };
for (const [name, inApp, ready, act, only360] of SCREENS) {
  if (ONLY && !ONLY.has(name)) continue;
  for (const [w, h] of SIZES) {
    if (only360 && w !== 360) continue;
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (/^(https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/|data:|blob:)/.test(url)) return route.continue();
        report.blocked.push(url);
        return route.abort();
      });
      page.on('console', (msg) => { if (msg.type() === 'error') report.consoleErrors.push({ name, w, theme, text: msg.text() }); });
      page.on('pageerror', (err) => report.consoleErrors.push({ name, w, theme, text: String(err) }));
      const file = `${name}-${w}-${theme}.png`;
      try {
        await page.goto(`${BASE}/dev-harness/cp-step3-list.html?screen=${name}&theme=${theme}${inApp ? '&src=in' : ''}`);
        await page.waitForFunction(() => window.__CPL_READY === true);
        await page.locator(ready).first().waitFor({ timeout: 15000 });
        await page.waitForTimeout(400);
        if (act) { await act(page); await page.waitForTimeout(300); }
        // 縮圖是 loading="lazy"：截整頁前改成立即載入並等它們畫好。舊站樣式把 img 預設成透明，
        // 正式站由 index.html 的開頁腳本在 decode 後加 img-loaded；示範頁沒有那支腳本，這裡照做。
        await page.evaluate(() => { for (const img of document.images) img.loading = 'eager'; });
        await page.waitForFunction(() => [...document.images].every((img) => img.complete));
        await page.evaluate(() => { for (const img of document.images) img.classList.add('img-loaded'); });
        await page.waitForTimeout(350);
        const m = await page.evaluate(measure, NOWRAP);
        await page.screenshot({ path: join(OUT, file), fullPage: true });
        report.shots.push({ file, name, w, theme, ...m });
        if (m.hOverflow > 0) report.overflows.push({ file, px: m.hOverflow });
        for (const x of m.wraps) report.wraps.push({ file, ...x });
      } catch (err) {
        report.failures.push({ file, error: String(err).slice(0, 300) });
      }
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`shots ${report.shots.length}、失敗 ${report.failures.length}、console 錯誤 ${report.consoleErrors.length}、橫向溢出 ${report.overflows.length}、被動斷行 ${report.wraps.length}、擋下 ${report.blocked.length}`);
