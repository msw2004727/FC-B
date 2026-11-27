#!/usr/bin/env node
// CP-PO-05／08 截圖：延期或取消賽事入口與確認框、名單頁退出與撤回報名。（由 cp-delete-shots.mjs 改寫）
// 360／1280 寬、深淺色；非 localhost 請求一律攔截。檢查 console 錯誤、橫向溢出、介面文字被動斷行、確認鈕停用狀態、焦點。
// 用法：先 node node_modules/vite/bin/vite.js --config dev-harness/vite.harness.config.ts --port <空埠>
//       再 node dev-harness/cp-po-host-shots.mjs <輸出資料夾> http://localhost:<埠>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-po-host-shots');
const BASE = process.argv[3] || 'http://localhost:5199';
const SIZES = [[360, 640], [1280, 800]];
const THEMES = ['light', 'dark'];
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;
const ALL = ['detail-host', 'detail-postponed', 'status-empty', 'status-postpone', 'status-cancel', 'status-cancel-ready', 'status-resume', 'status-error', 'roster-member', 'roster-rep', 'roster-rep-pending'];
const SCREENS = ONLY ?? ALL;
// 介面文字（賽事名是使用者內容，可以換行，不列）
const SELECTORS = 'button, .ui-checkbox label, .cpa-hidden, dialog .cps-note, dialog h2';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [], wraps: [], states: [] };
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
      const tag = `po-${name}-${w}-${theme}`;
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-po-host.html?screen=${name}&theme=${theme}`);
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
      const state = await page.evaluate(() => {
        const btn = document.querySelector('dialog [data-confirm-armed]');
        return {
          armed: btn ? btn.getAttribute('data-confirm-armed') : null,
          disabled: btn ? btn.getAttribute('aria-disabled') === 'true' : null,
          focus: (document.activeElement?.textContent || '').trim().slice(0, 10),
        };
      });
      report.states.push({ tag, ...state });
      if (name.startsWith('status-')) {
        await page.screenshot({ path: join(OUT, `${tag}.png`), fullPage: false });
        report.shots.push(`${tag}.png`);
      } else {
        // 入口：捲到按鈕所在處，另拍整頁。
        await page.evaluate(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => /延期或取消|恢復或取消|撤回報名|^退出名單$/.test((b.textContent || '').trim()));
          btn?.scrollIntoView({ block: 'center' });
        });
        await page.waitForTimeout(150);
        await page.screenshot({ path: join(OUT, `${tag}.png`), fullPage: false });
        await page.screenshot({ path: join(OUT, `${tag}-full.png`), fullPage: true });
        report.shots.push(`${tag}.png`, `${tag}-full.png`);
      }
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；攔截 ${report.blocked.length}；溢出 ${report.overflows.length}；斷行 ${report.wraps.length}`);
for (const k of ['consoleErrors', 'blocked', 'overflows', 'wraps']) for (const l of report[k]) console.log(k, l);
for (const s of report.states) if (s.armed !== null) console.log('state', JSON.stringify(s));
