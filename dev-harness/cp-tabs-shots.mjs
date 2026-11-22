#!/usr/bin/env node
// 站長 11-22 預覽：站內／外部橫向切換＋主題色、站內狀態頁籤（預設全部）、外部「顯示已結束」與「＋ 新增賽事」同一列。
// 對清單示範頁（vite.cp-list.config.ts 開發伺服器）截 in、ext-admin × 360／1280 × 淺深；非本機請求一律擋下。
// 用法：node dev-harness/cp-tabs-shots.mjs <輸出資料夾> <base url>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-tabs-shots');
const BASE = process.argv[3] || 'http://127.0.0.1:5281';
const JOBS = [['in', true, '.cpl-card--board'], ['ext-admin', false, '.cpl-xcard__edit']];
const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [] };
for (const [name, inApp, ready] of JOBS) for (const w of [360, 1280]) for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 780 }, deviceScaleFactor: 2, colorScheme: theme });
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (['localhost', '127.0.0.1'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    report.blocked.push(u.hostname); return r.abort();
  });
  const page = await ctx.newPage();
  const tag = `${name}-${w}-${theme}`;
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: ${e.message}`));
  await page.goto(`${BASE}/dev-harness/cp-step3-list.html?screen=${name}&theme=${theme}${inApp ? '&src=in' : '&src=ext'}`);
  await page.waitForSelector(ready, { timeout: 15000 });
  await page.waitForTimeout(600);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (ov > 0) report.overflows.push(`${tag}: ${ov}`);
  await page.screenshot({ path: join(OUT, `${tag}.png`), clip: { x: 0, y: 0, width: w, height: 560 } });
  report.shots.push(tag);
  await ctx.close();
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`截圖 ${report.shots.length}；console 錯誤 ${report.consoleErrors.length}；外部請求 ${report.blocked.length}；溢出 ${report.overflows.length}`);
