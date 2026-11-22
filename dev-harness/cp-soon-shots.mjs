#!/usr/bin/env node
// 即將開放預覽截圖（由 cp-cover-states-shots.mjs 複製）。原註：站內清單狀態總覽截圖（站長 11-22：每張深色記分板卡、直切淡出封面、狀態邊框色、招募中光軌）：截 list-states，
// 光軌顏色 fx=a（銅金）／b（青綠）× 360／1280 × 淺深；亮雜圖、沒封面、減少動態各一；光軌逐格（週期 0／25／50／75%）。
// 動畫一律用 Web Animations API 暫停在固定時間點再截，畫面可重現。
// 檢查 console 錯誤、對外請求（一律擋下）、橫向溢出、破圖、卡片文字被動斷行。
// 用法：node dev-harness/cp-cover-states-shots.mjs <輸出資料夾> [base url，預設 http://localhost:5299]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ARGS = process.argv.slice(2);
const FLAGS = Object.fromEntries(ARGS.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '']; }));
const POS = ARGS.filter((a) => !a.startsWith('--'));
const OUT = resolve(POS[0] || 'cp-cover-states-shots');
const BASE = POS[1] || 'http://localhost:5299';
const CYCLE_MS = 4200;
const JOBS = [];
// 即將開放框線色 sc=a 紫／b 淡青／c 中性灰 × 360／1280 × 淺深（光軌 fx=a 銅金，與正式相同）
for (const sc of ['a', 'b', 'c']) for (const w of [360, 1280]) for (const theme of ['light', 'dark']) JOBS.push({ tag: `sc-${sc}-${w}-${theme}`, w, theme, q: `fx=a&sc=${sc}`, at: 0.3 });
const SEL = '.cpl-card__name, .cpl-meta, .cpl-line, .cpl-st, .d2-sb__st, .cpl-sb__cat, .d2-cell__k, .d2-cell__v';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [], wraps: [], brokenImages: [], boards: [] };
for (const job of JOBS) {
  const { tag, w, theme, q, at, reduced, clip } = job;
  const ctx = await browser.newContext({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    report.blocked.push(`${u.hostname}${u.pathname}`);
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
  await page.goto(`${BASE}/dev-harness/cp-cover.html?screen=list-soon&theme=${theme}&${q}${w >= 1280 ? '&frame=1' : ''}`);
  await page.waitForFunction(() => window.__CPS_READY === true || typeof window.__CPS_ERROR === 'string', null, { timeout: 25000 });
  const err = await page.evaluate(() => window.__CPS_ERROR ?? null);
  if (err) { report.consoleErrors.push(`${tag}: ${err}`); await ctx.close(); continue; }
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })))));
  await page.waitForTimeout(600);
  // 光軌動畫停在週期的固定位置（光軌是動態載入，等它掛上）
  await page.evaluate((t) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; } }, at * CYCLE_MS);
  const fx = await page.evaluate(() => ({ slots: document.querySelectorAll('.cpl-fx-slot').length, running: document.querySelectorAll('.cpl-fx-slot .orbit').length, bursts: document.querySelectorAll('.cpl-fx-slot .burst').length, styles: document.querySelectorAll('style[data-cpl-fx-instance]').length }));
  report.boards.push({ tag, fx });
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

  const file = `${tag}.png`;
  if (clip) {
    const box = await page.evaluate(() => { const r = document.querySelector('[data-cid="s_recruit"]').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 24 + scrollY), width: innerWidth, height: r.height + 48 }; });
    await page.screenshot({ path: join(OUT, file), clip: box });
  } else await page.screenshot({ path: join(OUT, file), fullPage: true });
  report.shots.push(file);
  await ctx.close();
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；外部請求 ${report.blocked.length}；溢出 ${report.overflows.length}；斷行 ${report.wraps.length}；破圖 ${report.brokenImages.length}`);
for (const k of ['consoleErrors', 'blocked', 'overflows', 'wraps', 'brokenImages']) for (const l of report[k]) console.log(k, l);
console.log(JSON.stringify(report.boards.slice(0, 6)));
