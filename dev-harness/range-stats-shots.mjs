#!/usr/bin/env node
// 活動區間統計彈窗截圖：預設本月、活動狀態圓餅、年（先確認）、自訂、無放鴿子權限。
// 390／360／1280 寬、深淺色；非 localhost 請求一律攔截。harness 擋正式 Firebase 的錯誤（登入模組被間接載入）只計數不列為錯誤。檢查 console 錯誤、橫向溢出、介面文字被動斷行。
// 用法：先 node node_modules/vite/bin/vite.js --config dev-harness/vite.range-stats.config.ts --port <空埠>
//       再 node dev-harness/range-stats-shots.mjs <輸出資料夾> http://localhost:<埠>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'range-stats-shots');
const BASE = process.argv[3] || 'http://localhost:5199';
const SIZES = [[390, 844], [360, 740], [1280, 900]];
const THEMES = ['light', 'dark'];
const SCREENS = ['month', 'status', 'year-confirm', 'custom', 'noshow-off'];
const SELECTORS = 'button, .mrs-chip, .mrs-range-label, .mrs-kpi span, .mrs-table th, .mrs-table td, .mrs-legend-row, .mrs-note, .mrs-h2';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [], wraps: [] };
for (const name of SCREENS) {
  for (const [w, h] of SIZES) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5, colorScheme: theme });
      await ctx.route('**/*', (r) => {
        const url = r.request().url();
        if (url.startsWith('data:')) return r.continue();
        const host = new URL(url).hostname;
        if (host === 'localhost' || host === '127.0.0.1') return r.continue();
        report.blocked.push(url);
        return r.abort();
      });
      const page = await ctx.newPage();
      const tag = `rs-${name}-${w}-${theme}`;
      page.on('console', (m) => { if (m.type() !== 'error') return; const t = m.text(); if (t.includes('FirebaseTargetBlockedError')) { report.harnessBlocked = (report.harnessBlocked || 0) + 1; return; } report.consoleErrors.push(`${tag}: ${t}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      const noshow = name === 'noshow-off' ? '0' : '1';
      await page.goto(`${BASE}/dev-harness/range-stats.html?theme=${theme}&noshow=${noshow}`);
      await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 25000 });
      await page.waitForSelector('.mrs-table');
      if (name === 'status') await page.getByRole('tab', { name: '活動狀態' }).click();
      if (name === 'year-confirm') {
        await page.getByRole('tab', { name: '年' }).click();
        await page.getByRole('button', { name: '繼續' }).waitFor();
      }
      if (name === 'custom') {
        await page.getByRole('tab', { name: '自訂' }).click();
        await page.waitForSelector('.mrs-custom');
        await page.waitForTimeout(200);
        const confirmBtn = page.getByRole('button', { name: '繼續' });
        if (await confirmBtn.count()) await confirmBtn.click();
        await page.waitForSelector('.mrs-table');
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth));
      if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
      // 逐一檢查文字節點本身有沒有被瀏覽器折成兩行（圓點、刻意分行的表頭子元素不算）。
      const wraps = await page.evaluate((sel) => {
        const out = [];
        for (const el of document.querySelectorAll(sel)) {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!(node.textContent || '').trim()) continue;
            const r = document.createRange();
            r.selectNodeContents(node);
            const tops = new Set([...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0).map((q) => Math.round(q.top / 4)));
            if (tops.size > 1) out.push((node.textContent || '').trim().slice(0, 40));
          }
        }
        return out;
      }, SELECTORS);
      for (const t of wraps) report.wraps.push(`${tag}: ${t}`);
      // 彈窗內可捲動：把整個捲動內容展開成長圖
      await page.evaluate(() => {
        const body = document.querySelector('.mrs-body');
        const dialog = document.querySelector('.mrs-dialog');
        if (body) { body.style.overflow = 'visible'; body.style.flex = 'none'; }
        if (dialog) dialog.style.maxHeight = 'none';
        const app = document.getElementById('app');
        if (app) app.style.display = 'none';
        const overlay = document.querySelector('.edu-info-overlay');
        if (overlay) { overlay.style.position = 'static'; overlay.style.minHeight = '100vh'; overlay.style.alignItems = 'flex-start'; }
      });
      const file = join(OUT, `${tag}.png`);
      await page.screenshot({ path: file, fullPage: true });
      report.shots.push(file);
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`shots=${report.shots.length} consoleErrors=${report.consoleErrors.length} blocked=${report.blocked.length} overflows=${report.overflows.length} wraps=${report.wraps.length}`);
for (const k of ['consoleErrors', 'blocked', 'overflows', 'wraps']) for (const x of report[k]) console.log(`${k}: ${x}`);
