#!/usr/bin/env node
// 賽事第 2 步預覽截圖：對已打包的 harness（vite preview）逐畫面、逐寬度、逐主題截圖，
// 並檢查 console 錯誤、橫向溢出與介面文字被動斷行。
// 用法：node dev-harness/cp-step2-shots.mjs <輸出資料夾> [base url，預設 http://localhost:5193]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-step2-shots');
const BASE = process.argv[3] || 'http://localhost:5193';
const ALL = [[390, 844], [360, 800]];
const ONE = [[390, 844]];
const THEMES_ALL = ['light', 'dark'];
// [畫面, 寬度組, 主題組, 是否整頁（對話框／底部面板只截可視範圍）]
const SCREENS = [
  ['wizard-1', ALL, THEMES_ALL, true],
  ['wizard-1-club', ONE, THEMES_ALL, true],
  ['wizard-1-error', ONE, ['light'], true],
  ['wizard-2', ALL, THEMES_ALL, true],
  ['wizard-3', ALL, THEMES_ALL, true],
  ['wizard-done', ONE, ['light'], true],
  ['detail-rep', ALL, THEMES_ALL, true],
  ['detail-member', ONE, THEMES_ALL, true],
  ['detail-report', ONE, THEMES_ALL, false],
  ['roster', ALL, THEMES_ALL, true],
  ['roster-ready', ONE, ['light'], true],
  ['roster-locked', ONE, ['light'], true],
  ['form-self-minor', ALL, THEMES_ALL, true],
  ['form-self-adult', ONE, ['light'], true],
  ['form-rep', ALL, THEMES_ALL, true],
  ['form-rep-adult', ONE, ['light'], true],
  ['form-rep-adult-nick', ONE, ['light'], true],
  ['host-pending', ALL, THEMES_ALL, true],
  ['host-reject', ONE, THEMES_ALL, false],
  ['host-approved', ALL, THEMES_ALL, true],
  ['host-lock', ONE, ['light'], false],
  ['host-rejected', ONE, ['light'], true],
  ['host-unlock', ONE, ['light'], false],
  ['position-measure', [[360, 800]], ['light'], true],
];

const SELECTORS = 'button, .ui-badge, .ui-chip, dt, .cps-line, .cps-li__name, .cps-cap, .cps-kv span, .cps-label, .ui-input label, .ui-checkbox label, .ui-switch label, h1, h2, h3, .cps-stepname span, .cps-stepname b, .ui-stepper label';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], overflows: [], wraps: [] };
const copyMap = new Map();
for (const [name, sizes, themes, full] of SCREENS) {
  for (const [w, h] of sizes) {
    for (const theme of themes) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      // 只允許本機：任何對外連線（Firestore、Functions、地圖、字型 CDN）一律擋下並記錄，確保預覽不碰正式環境
      await ctx.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
        report.blocked = report.blocked || [];
        report.blocked.push(`${name}: ${u.hostname}`);
        return route.abort();
      });
      const page = await ctx.newPage();
      const tag = `${name}-${w}-${theme}`;
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-step2.html?screen=${name}&theme=${theme}`);
      await page.waitForFunction(() => window.__CPS_READY === true);
      await page.evaluate(() => document.fonts.ready);
      if (name === 'host-lock') await page.waitForSelector('.app-confirm, [class*="app-confirm"]');
      await page.waitForTimeout(400);
      for (const c of await page.evaluate(() => window.__CPS_COPY)) copyMap.set(c.key, c);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
      const wraps = await page.evaluate((sel) => {
        const out = [];
        for (const el of document.querySelectorAll(sel)) {
          if (el.closest('.cps-sheet-body p, .cps-privacy, .ui-input small')) continue;
          const r = document.createRange();
          r.selectNodeContents(el);
          const tops = new Set([...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0 && q.height < 40).map((q) => Math.round(q.top / 4)));
          if (tops.size > 1) out.push((el.textContent || '').trim().slice(0, 40));
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
await writeFile(join(OUT, 'copy.json'), JSON.stringify([...copyMap.values()], null, 2), 'utf8');
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；溢出 ${report.overflows.length}；斷行 ${report.wraps.length}`);
for (const k of ['consoleErrors', 'overflows', 'wraps']) for (const l of report[k]) console.log(k, l);
