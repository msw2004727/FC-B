#!/usr/bin/env node
// 賽事封面圖預覽截圖：對已打包的 harness（vite preview）逐畫面、360 與 1280（?frame=1 正式外框）× 淺色／深色截圖，
// 並檢查 console 錯誤、對外請求（一律擋下）、橫向溢出、破圖與介面文字被動斷行。
// 用法：node dev-harness/cp-cover-shots.mjs <輸出資料夾> [base url，預設 http://localhost:5297] [--screens=a,b] [--sizes=360,1280]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ARGS = process.argv.slice(2);
const FLAGS = Object.fromEntries(ARGS.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '']; }));
const POS = ARGS.filter((a) => !a.startsWith('--'));
const OUT = resolve(POS[0] || 'cp-cover-shots');
const BASE = POS[1] || 'http://localhost:5297';
const ONLY = FLAGS.screens ? new Set(FLAGS.screens.split(',')) : null;
const ONLY_W = FLAGS.sizes ? new Set(FLAGS.sizes.split(',').map(Number)) : null;
const SIZES = [[360, 800], [1280, 800]];
const THEMES = ['light', 'dark'];
// [畫面, 是否整頁]
const SCREENS = [
  ['form-empty', false],
  ['form-uploading', false],
  ['form-ready', false],
  ['form-error', false],
  ['form-timeout', false],
  ['form-server-error', false],
  ['form-confirm', false],
  ['manage-empty', false],
  ['manage-ready', false],
  ['manage-uploading', false],
  ['manage-timeout', false],
  ['manage-changed', false],
  ['manage-removed', false],
  ['manage-ended', false],
  ['manage-hidden-host', false],
  ['detail-cover', false],
  ['detail-recruit-cover', false],
  ['detail-done-cover', false],
  ['detail-none', false],
  ['detail-hidden-host', false],
  ['detail-hidden-admin', false],
  ['list-mixed', true],
];
const SELECTORS = 'button, .ui-badge, .ui-chip, dt, .cps-line, .cps-li__name, .cps-cap, .cps-label, .ui-input label, .ui-switch label, h1, h2, h3, '
  + '.cps-stepname b, .cps-sub, .cps-note, [data-field-error], .cpc-busy, .cpl-card__name, .cpl-meta, .cpl-line, .cpl-st, .d2-board__name, .ui-toast';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [], wraps: [], brokenImages: [] };
for (const [name, full] of SCREENS) {
  if (ONLY && !ONLY.has(name)) continue;
  for (const [w, h] of SIZES) {
    if (ONLY_W && !ONLY_W.has(w)) continue;
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: theme });
      // 只允許本機：任何對外連線一律擋下並記錄，確保預覽不碰正式環境
      await ctx.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
        report.blocked.push(`${name}: ${u.hostname}${u.pathname}`);
        return route.abort();
      });
      const page = await ctx.newPage();
      const tag = `${name}-${w}-${theme}`;
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-cover.html?screen=${name}&theme=${theme}${w >= 1280 ? '&frame=1' : ''}`);
      try {
        await page.waitForFunction(() => window.__CPS_READY === true || typeof window.__CPS_ERROR === 'string', null, { timeout: 25000 });
      } catch {
        report.consoleErrors.push(`${tag}: 未就緒（逾時）`);
        await ctx.close();
        continue;
      }
      const err = await page.evaluate(() => window.__CPS_ERROR ?? null);
      if (err) {
        report.consoleErrors.push(`${tag}: ${err}`);
        await ctx.close();
        continue;
      }
      await page.evaluate(() => document.fonts.ready);
      // 等圖片解碼完
      await page.evaluate(() => Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })))));
      await page.waitForTimeout(300);
      const broken = await page.evaluate(() => [...document.images].filter((img) => img.complete && img.naturalWidth === 0 && img.getBoundingClientRect().width > 0).map((img) => img.className || img.src.slice(0, 40)));
      for (const b of broken) report.brokenImages.push(`${tag}: ${b}`);
      const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth));
      if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
      const wraps = await page.evaluate((sel) => {
        const out = [];
        // 以文字節點為單位：同一段字被拆到兩行以上才算被動斷行（圖示在字上面、標籤後的小字另起一段都不算）
        for (const el of document.querySelectorAll(sel)) {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!(node.textContent || '').trim()) continue;
            const r = document.createRange();
            r.selectNodeContents(node);
            const tops = new Set([...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0).map((q) => Math.round(q.top / 4)));
            if (tops.size > 1) out.push((el.textContent || '').trim().slice(0, 40));
          }
        }
        return out;
      }, SELECTORS);
      for (const t of wraps) report.wraps.push(`${tag}: ${t}`);
      const file = `${tag}.png`;
      await page.screenshot({ path: join(OUT, file), fullPage: full });
      report.shots.push(file);
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；外部請求 ${report.blocked.length}；溢出 ${report.overflows.length}；斷行 ${report.wraps.length}；破圖 ${report.brokenImages.length}`);
for (const k of ['consoleErrors', 'blocked', 'overflows', 'wraps', 'brokenImages']) for (const l of report[k]) console.log(k, l);
