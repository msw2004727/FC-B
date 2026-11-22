#!/usr/bin/env node
// 一般卡封面預覽截圖（站長 11-22 統一）：對已打包的 cp-cover harness（vite preview）截 list-all-cards，
// 替代版 ac=1／2／3 × 360 與 1280（?frame=1）× 淺色／深色；亮雜圖（art=busy）各版 360 淺深；ac=1 另截縮圖版（src=thumb）比清晰度。
// 檢查 console 錯誤、對外請求（一律擋下）、橫向溢出、破圖、卡片文字被動斷行。
// 用法：node dev-harness/cp-cover-allcards-shots.mjs <輸出資料夾> [base url，預設 http://localhost:5299] [--ac=1,2,3]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ARGS = process.argv.slice(2);
const FLAGS = Object.fromEntries(ARGS.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '']; }));
const POS = ARGS.filter((a) => !a.startsWith('--'));
const OUT = resolve(POS[0] || 'cp-cover-allcards-shots');
const BASE = POS[1] || 'http://localhost:5299';
const ACS = (FLAGS.ac || '1,2,3').split(',');
const JOBS = [];
for (const ac of ACS) {
  for (const w of [360, 1280]) for (const theme of ['light', 'dark']) JOBS.push({ ac, w, theme, art: 'photo', src: 'cover' });
  for (const theme of ['light', 'dark']) JOBS.push({ ac, w: 360, theme, art: 'busy', src: 'cover' });
}
if (ACS.includes('1')) for (const w of [360, 1280]) JOBS.push({ ac: '1', w, theme: 'light', art: 'photo', src: 'thumb' });

const SEL = '.cpl-card__name, .cpl-meta, .cpl-line, .cpl-st, .d2-sb__st, .cpl-sb__cat, .d2-cell__k, .d2-cell__v';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [], wraps: [], brokenImages: [], boards: [] };
for (const job of JOBS) {
  const { ac, w, theme, art, src } = job;
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2, colorScheme: theme });
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    report.blocked.push(`${u.hostname}${u.pathname}`);
    return route.abort();
  });
  const page = await ctx.newPage();
  const tag = `ac-${ac}-${art}${src === 'thumb' ? '-thumb' : ''}-${w}-${theme}`;
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
  await page.goto(`${BASE}/dev-harness/cp-cover.html?screen=list-all-cards&theme=${theme}&ac=${ac}&art=${art}&src=${src}${w >= 1280 ? '&frame=1' : ''}`);
  await page.waitForFunction(() => window.__CPS_READY === true || typeof window.__CPS_ERROR === 'string', null, { timeout: 25000 });
  const err = await page.evaluate(() => window.__CPS_ERROR ?? null);
  if (err) { report.consoleErrors.push(`${tag}: ${err}`); await ctx.close(); continue; }
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })))));
  await page.waitForTimeout(250);
  const broken = await page.evaluate(() => [...document.images].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.className));
  for (const b of broken) report.brokenImages.push(`${tag}: ${b}`);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (wide > 0) report.overflows.push(`${tag}: ${wide}px`);
  const wraps = await page.evaluate((sel) => {
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!(n.textContent || '').trim()) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        const tops = new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top / 4)));
        if (tops.size > 1) out.push((el.textContent || '').trim().slice(0, 30));
      }
    }
    return out;
  }, SEL);
  for (const t of wraps) report.wraps.push(`${tag}: ${t}`);
  // 板與圖的尺寸（CSS px），給 thumb／cover 清晰度評估
  const boards = await page.evaluate(() => [...document.querySelectorAll('.cpl-sb--img')].map((sb) => {
    const r = sb.getBoundingClientRect();
    const img = sb.querySelector('.cpl-sb__img');
    const ir = img ? img.getBoundingClientRect() : null;
    return { cid: sb.closest('[data-cid]').dataset.cid, board: [Math.round(r.width), Math.round(r.height)], img: ir ? [Math.round(ir.width), Math.round(ir.height)] : null };
  }));
  report.boards.push({ tag, boards });
  const file = `${tag}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  report.shots.push(file);
  await ctx.close();
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；外部請求 ${report.blocked.length}；溢出 ${report.overflows.length}；斷行 ${report.wraps.length}；破圖 ${report.brokenImages.length}`);
for (const k of ['consoleErrors', 'blocked', 'overflows', 'wraps', 'brokenImages']) for (const l of report[k]) console.log(k, l);
console.log(JSON.stringify(report.boards.slice(0, 4)));
