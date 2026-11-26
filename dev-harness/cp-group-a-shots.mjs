#!/usr/bin/env node
// 賽事 A 組 commit 3 截圖：B2 拒絕面板、B3 產生賽程取代確認，390／1280 × 淺深。對 cp-group-a harness 開發伺服器截圖；非本機請求一律擋下。
// 用法：node dev-harness/cp-group-a-shots.mjs <輸出資料夾> <base url> <前綴>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-group-a-shots');
const BASE = process.argv[3] || 'http://localhost:5321';
const TAG = process.argv[4] || 'after';
const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], errors: [], overflow: [] };
for (const screen of ['reject', 'sched']) {
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: theme });
      await ctx.route('**/*', (r) => {
        const u = new URL(r.request().url());
        if (['localhost', '127.0.0.1'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
        report.blocked.push(u.hostname); return r.abort();
      });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${screen}-${w}-${theme}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${screen}-${w}-${theme}: ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-group-a.html?screen=${screen}&theme=${theme}${w >= 1000 ? '&frame=1' : ''}`);
      await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 20000 });
      await page.waitForTimeout(600);
      const err = await page.evaluate(() => window.__CPS_ERROR ?? null);
      if (err) report.errors.push(`${screen}-${w}-${theme}: ${err}`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 0) report.overflow.push(`${screen}-${w}-${theme}: ${over}`);
      const file = `${TAG}-${screen}-${w}-${theme}.png`;
      await page.screenshot({ path: join(OUT, file) });
      report.shots.push(file);
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, `report-${TAG}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ shots: report.shots.length, consoleErrors: report.consoleErrors, errors: report.errors, overflow: report.overflow, blocked: [...new Set(report.blocked)] }));
