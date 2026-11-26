#!/usr/bin/env node
// 「賽事個資移除」後台面板截圖：用戶卡入口、試算前、試算結果（上段與捲到底）、執行確認框、處理中、成功、DRY_RUN_STALE、一般管理員視角。
// 390／1280 寬、深淺色；非 localhost 請求一律攔截。檢查 console 錯誤、橫向溢出、按鈕與標題被動斷行。
// 用法：先 node node_modules/vite/bin/vite.js --config dev-harness/vite.harness.config.ts --port <空埠>
//       再 node dev-harness/cp-pii-admin-shots.mjs <輸出資料夾> http://localhost:<埠> [情境,…]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-pii-admin-shots');
const BASE = process.argv[3] || 'http://localhost:5237';
const SIZES = [[390, 844], [1280, 800]];
const THEMES = ['light', 'dark'];
// 情境 → [query, 步驟]
const SCENES = {
  entry: ['role=super_admin', 'entry'],
  before: ['role=super_admin', 'open'],
  summary: ['role=super_admin', 'summary'],
  'summary-end': ['role=super_admin', 'summary-end'],
  confirm: ['role=super_admin', 'confirm'],
  busy: ['role=super_admin&run=busy', 'busy'],
  done: ['role=super_admin&run=done', 'toast'],
  stale: ['role=super_admin&run=stale', 'toast'],
  admin: ['role=admin&open=1', 'admin'],
  'admin-end': ['role=admin&open=1', 'admin-end'],
};
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;
const NAMES = ONLY ?? Object.keys(SCENES);
const SELECTORS = '#cp-removal-modal button, #cp-removal-modal h3, .admin-user-actions button, .ui-toast__message, .app-confirm-msg, [data-cp-totals], [data-cp-admin-only], [data-cp-expires]';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [], wraps: [], states: [] };

const modalBody = '#cp-removal-modal';
async function step(page, to) {
  if (to === 'entry') return;
  if (!to.startsWith('admin')) {
    await page.locator('.admin-user-card').first().locator('button', { hasText: '賽事個資移除' }).click();
  }
  await page.waitForSelector('#cp-removal-modal');
  await page.waitForTimeout(450);
  if (to === 'open') return;
  await page.locator('#cp-removal-modal button', { hasText: '產生試算' }).click();
  await page.waitForSelector('[data-cp-removal-summary]');
  await page.waitForTimeout(200);
  if (to === 'summary' || to === 'admin') return;
  if (to === 'summary-end' || to === 'admin-end') {
    await page.evaluate((sel) => { const m = document.querySelector(sel); if (m) m.scrollTop = m.scrollHeight; }, modalBody);
    await page.waitForTimeout(200);
    return;
  }
  await page.locator('[data-cp-run]').click();
  await page.waitForSelector('[role="alertdialog"]');
  await page.waitForTimeout(400);
  if (to === 'confirm') return;
  await page.locator('[role="alertdialog"] button').last().click();
  if (to === 'busy') {
    await page.waitForSelector('[data-cp-run][aria-busy="true"]');
    await page.evaluate((sel) => { const m = document.querySelector(sel); if (m) m.scrollTop = m.scrollHeight; }, modalBody);
    await page.waitForTimeout(300);
    return;
  }
  await page.waitForSelector('.ui-toast');
  await page.waitForTimeout(500);
}

for (const name of NAMES) {
  const [query, to] = SCENES[name];
  for (const [w, h] of SIZES) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w > 800 ? 1 : 2, colorScheme: theme });
      await ctx.route('**/*', (r) => {
        const url = r.request().url();
        if (url.startsWith('data:')) return r.continue();
        const host = new URL(url).hostname;
        if (host === 'localhost' || host === '127.0.0.1') return r.continue();
        report.blocked.push(url);
        return r.abort();
      });
      const page = await ctx.newPage();
      const tag = `adm-${name}-${w}-${theme}`;
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-pii-admin.html?${query}&theme=${theme}`);
      try {
        await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 25000 });
        await page.evaluate(() => document.fonts.ready);
        await step(page, to);
      } catch (err) {
        const st = await page.evaluate(() => ({ err: window.__CPS_ERROR ?? null, txt: document.body.innerText.slice(0, 160) })).catch(() => null);
        report.consoleErrors.push(`${tag}: 未就緒 ${err.message.split('\n')[0]} ${JSON.stringify(st)}`);
        await ctx.close();
        continue;
      }
      const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth));
      if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
      const wraps = await page.evaluate((sel) => {
        const out = [];
        for (const el of document.querySelectorAll(sel)) {
          const text = (el.textContent || '').trim();
          if (!text) continue;
          const r = document.createRange();
          r.selectNodeContents(el);
          const rows = new Set([...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0 && q.height < 40).map((q) => Math.round(q.top / 4))).size;
          const want = (el.innerText || '').split('\n').filter((s) => s.trim()).length || 1;
          if (rows > want) out.push(text.slice(0, 40));
        }
        return out;
      }, SELECTORS);
      for (const t of wraps) report.wraps.push(`${tag}: ${t}`);
      const state = await page.evaluate(() => ({
        toast: (document.querySelector('.ui-toast')?.textContent || '').trim(),
        run: !!document.querySelector('[data-cp-run]'),
        adminOnly: !!document.querySelector('[data-cp-admin-only]'),
        entry: [...document.querySelectorAll('.admin-user-actions button')].filter((b) => b.textContent === '賽事個資移除').length,
      }));
      report.states.push({ tag, ...state });
      await page.screenshot({ path: join(OUT, `${tag}.png`), fullPage: false });
      report.shots.push(`${tag}.png`);
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；攔截 ${report.blocked.length}；溢出 ${report.overflows.length}；斷行 ${report.wraps.length}`);
for (const k of ['consoleErrors', 'blocked', 'overflows', 'wraps']) for (const l of report[k]) console.log(k, l);
for (const s of report.states) console.log('state', JSON.stringify(s));
