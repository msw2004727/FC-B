#!/usr/bin/env node
// CP-PO-07 換人截圖：記分頁選單 → 選隊 → 換下 → 換上 → 確認框。360／1280、深淺色；非 localhost 請求一律攔截。
// 用法：先 node node_modules/vite/bin/vite.js --config dev-harness/vite.harness.config.ts --port <空埠>
//       再 node dev-harness/cp-po-sub-shots.mjs <輸出資料夾> http://localhost:<埠>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-po-sub-shots');
const BASE = process.argv[3] || 'http://localhost:5199';
const SIZES = [[360, 640], [1280, 800]];
const THEMES = ['light', 'dark'];
const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [] };
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
    const tag = `sub-${w}-${theme}`;
    page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
    page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
    await page.goto(`${BASE}/dev-harness/cp-step4a.html?screen=score-live&theme=${theme}`);
    await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 25000 });
    await page.evaluate(() => document.fonts.ready);
    const shot = async (step) => {
      await page.waitForTimeout(450);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (wide > 0) report.overflows.push(`${tag}-${step}: ${wide}px`);
      await page.screenshot({ path: join(OUT, `${tag}-${step}.png`) });
      report.shots.push(`${tag}-${step}.png`);
    };
    await page.getByRole('button', { name: '選單' }).click();
    await shot('1-menu');
    await page.locator('#s4-clock-menu button').filter({ hasText: '換人' }).click();
    await shot('2-team');
    await page.locator('.s4-timeout-picks button').first().click();
    await shot('3-out');
    await page.locator('.s4-grid .s4-pl').first().click();
    await shot('4-in');
    await page.locator('.s4-grid .s4-pl').first().click();
    await page.waitForTimeout(700);
    await shot('5-confirm');
    await ctx.close();
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；攔截 ${report.blocked.length}；溢出 ${report.overflows.length}`);
for (const k of ['consoleErrors', 'blocked', 'overflows']) for (const l of report[k]) console.log(k, l);
