#!/usr/bin/env node
// 賽事分享截圖（CP-SHARE）：詳情頁分享鈕（招募中、進行中）、分享選單（可用 picker／不可用）、Flex 卡片與活動卡並排。
// 360／390／1280 寬、深淺色；非 localhost 請求一律攔截。檢查 console 錯誤、橫向溢出、介面文字被動斷行。
// 用法：先 node node_modules/vite/bin/vite.js --config dev-harness/vite.cp-share.config.ts --port <空埠>
//       再 node dev-harness/cp-share-shots.mjs <輸出資料夾> http://localhost:<埠>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-share-shots');
const BASE = process.argv[3] || 'http://localhost:5199';
const SIZES = [[360, 740], [390, 844], [1280, 800]];
const THEMES = ['light', 'dark'];
const SCREENS = ['detail', 'detail-live', 'sheet', 'sheet-nopicker', 'flex'];
const SELECTORS = 'button, .share-action-sheet-title, .share-action-sheet-btn-label, .share-action-sheet-btn-sub';

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
      const tag = `share-${name}-${w}-${theme}`;
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-share.html?screen=${name}&theme=${theme}`);
      try {
        await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 25000 });
      } catch {
        const st = await page.evaluate(() => ({ err: window.__CPS_ERROR ?? null, txt: document.body.innerText.slice(0, 120) })).catch(() => null);
        report.consoleErrors.push(`${tag}: 未就緒 ${JSON.stringify(st)}`);
        await ctx.close();
        continue;
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth));
      if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
      if (name !== 'flex') {
        const wraps = await page.evaluate((sel) => {
          const out = [];
          for (const el of document.querySelectorAll(sel)) {
            const r = document.createRange();
            r.selectNodeContents(el);
            const tops = new Set([...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0 && q.height < 40).map((q) => Math.round(q.top / 4)));
            if (tops.size > 1) out.push((el.textContent || '').trim().slice(0, 40));
          }
          return out;
        }, SELECTORS);
        for (const t of wraps) report.wraps.push(`${tag}: ${t}`);
      }
      await page.screenshot({ path: join(OUT, `${tag}.png`), fullPage: name === 'flex' && w < 1280 });
      report.shots.push(`${tag}.png`);
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；攔截 ${report.blocked.length}；溢出 ${report.overflows.length}；斷行 ${report.wraps.length}`);
for (const k of ['consoleErrors', 'blocked', 'overflows', 'wraps']) for (const l of report[k]) console.log(k, l);
