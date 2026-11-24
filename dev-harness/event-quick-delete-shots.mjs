#!/usr/bin/env node
// 活動內頁封面快速鈕截圖：改前／刪除鈕（已結束）／取消活動鈕（報名中）／沒權限／刪除雙重確認兩步（第二步含未勾與已勾）／取消活動確認。
// 390／1280 寬、深淺色；非 localhost 請求一律攔截。檢查 console 錯誤、橫向溢出、按鈕文字被動斷行。
// 用法：先 node node_modules/vite/bin/vite.js --config dev-harness/vite.harness.config.ts --port <空埠>
//       再 node dev-harness/event-quick-delete-shots.mjs <輸出資料夾> http://localhost:<埠>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'eqd-shots');
const BASE = process.argv[3] || 'http://localhost:5199';
const SIZES = [[390, 844], [1280, 800]];
const THEMES = ['light', 'dark'];
const SCREENS = [['before'], ['after'], ['cancel'], ['noperm'], ['confirm1'], ['confirm2'], ['confirm2', 'checked'], ['cancelconfirm']];

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [], wraps: [], states: [] };
for (const [name, variant] of SCREENS) {
  for (const [w, h] of SIZES) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5, colorScheme: theme, locale: 'zh-TW' });
      await ctx.route('**/*', (r) => {
        const url = r.request().url();
        if (url.startsWith('data:')) return r.continue();
        const host = new URL(url).hostname;
        if (host === 'localhost' || host === '127.0.0.1') return r.continue();
        report.blocked.push(url);
        return r.abort();
      });
      const page = await ctx.newPage();
      const tag = `eqd-${name}${variant ? `-${variant}` : ''}-${w}-${theme}`;
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/event-quick-delete.html?screen=${name}&theme=${theme}`);
      try {
        await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 25000 });
      } catch {
        report.consoleErrors.push(`${tag}: 未就緒`);
        await ctx.close();
        continue;
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 10000 }).catch(() => {});
      if (variant === 'checked') await page.click('#delete-event-confirm-modal input[type="checkbox"]');
      await page.waitForTimeout(400);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
      const wraps = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('button, .app-confirm-msg, label')) {
          const r = document.createRange();
          r.selectNodeContents(el);
          const tops = new Set([...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0 && q.height < 40).map((q) => Math.round(q.top / 4)));
          if (tops.size > 1) out.push((el.textContent || '').trim().slice(0, 40));
        }
        return out;
      });
      for (const t of wraps) report.wraps.push(`${tag}: ${t}`);
      const state = await page.evaluate(() => {
        const edit = document.querySelector('.detail-cover-edit-btn')?.getBoundingClientRect();
        const del = document.querySelector('.detail-cover-del-btn')?.getBoundingClientRect();
        const ok = document.querySelector('#delete-event-confirm-modal .app-confirm-ok');
        return {
          edit: !!edit, del: !!del,
          delRightOfEdit: edit && del ? del.left >= edit.right : null,
          centerDiff: edit && del ? Math.round(Math.abs((edit.top + edit.bottom) / 2 - (del.top + del.bottom) / 2) * 10) / 10 : null,
          delAria: document.querySelector('.detail-cover-del-btn')?.getAttribute('aria-label') ?? null,
          okDisabled: ok ? ok.disabled : null,
        };
      });
      report.states.push({ tag, ...state });
      const file = join(OUT, `${tag}.png`);
      await page.screenshot({ path: file });
      report.shots.push(file);
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ shots: report.shots.length, consoleErrors: report.consoleErrors, blocked: report.blocked.length, overflows: report.overflows, wraps: report.wraps }, null, 2));
