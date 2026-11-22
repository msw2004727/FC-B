#!/usr/bin/env node
// 站長 11-22 預覽：站內清單卡右下角刪除鈕（管理員）＋兩次確認。對 cp-cover harness 開發伺服器截 list-admin-del：
// 清單、第一次確認、第二次確認（未勾）× 360 淺深。動作是假的；非本機請求一律擋下。
// 用法：node dev-harness/cp-del-shots.mjs <輸出資料夾> <base url>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-del-shots');
const BASE = process.argv[3] || 'http://localhost:5313';
const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], delButtons: {} };
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, colorScheme: theme });
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (['localhost', '127.0.0.1'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    report.blocked.push(u.hostname); return r.abort();
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${theme}: ${m.text()}`); });
  page.on('pageerror', (e) => report.consoleErrors.push(`${theme}: ${e.message}`));
  await page.goto(`${BASE}/dev-harness/cp-cover.html?screen=list-admin-del&theme=${theme}`);
  await page.waitForSelector('.cpl-del', { timeout: 15000 });
  await page.waitForTimeout(500);
  report.delButtons[theme] = await page.locator('.cpl-del').count();
  await page.screenshot({ path: join(OUT, `list-${theme}.png`) });
  await page.locator('.cpl-del').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, `confirm1-${theme}.png`) });
  await page.getByRole('button', { name: '刪除賽事' }).last().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, `confirm2-${theme}.png`) });
  report.shots.push(theme);
  await ctx.close();
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
