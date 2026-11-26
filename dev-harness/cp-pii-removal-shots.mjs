#!/usr/bin/env node
// 「移除我的賽事資料」截圖（設計 §4.11）：清單底部連結、說明面板、確認框、處理中、done／waiting（N＝2）／限流提示。
// 390／360 寬、深淺色；非 localhost 請求一律攔截。檢查 console 錯誤、橫向溢出、介面文字被動斷行（說明三行另查：行數＝字串自帶的段數）。
// 用法：先 node node_modules/vite/bin/vite.js --config dev-harness/vite.harness.config.ts --port <空埠>
//       再 node dev-harness/cp-pii-removal-shots.mjs <輸出資料夾> http://localhost:<埠> [情境,…]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-pii-removal-shots');
const BASE = process.argv[3] || 'http://localhost:5237';
const SIZES = [[390, 844], [360, 740]];
const THEMES = ['light', 'dark'];
// 情境 → [harness mode, 要走到哪一步]
const SCENES = {
  link: ['done', 'link'],
  sheet: ['done', 'sheet'],
  confirm: ['done', 'confirm'],
  busy: ['busy', 'busy'],
  done: ['done', 'toast'],
  waiting: ['waiting', 'toast'],
  rate: ['rate', 'toast'],
};
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;
const NAMES = ONLY ?? Object.keys(SCENES);
// 單行介面文字：按鈕、標題、連結、toast、確認框訊息
const SELECTORS = 'button:not(.d2-dd__btn), dialog h2, .cp3-textlink, .ui-toast__message, .app-confirm-msg';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [], wraps: [], lines: [], states: [] };

async function step(page, to) {
  // 打開「只看我的」，捲到清單最下方
  await page.evaluate(() => document.querySelector('.cpl-sw input[type="checkbox"]')?.click());
  await page.waitForSelector('.cp3-textlink');
  await page.evaluate(() => document.querySelector('.cp3-textlink')?.scrollIntoView({ block: 'end' }));
  if (to === 'link') return;
  await page.click('.cp3-textlink');
  await page.waitForSelector('dialog[open] [data-cp-removal-lines]');
  await page.waitForTimeout(400);
  if (to === 'sheet') return;
  await page.locator('dialog[open] .cps-footer .ui-button--primary').click();
  await page.waitForSelector('#app-confirm-modal[open], [role="alertdialog"]');
  await page.waitForTimeout(400);
  if (to === 'confirm') return;
  const ok = page.locator('[role="alertdialog"] button').last();
  await ok.click();
  if (to === 'busy') {
    await page.waitForSelector('dialog[open] .ui-button--loading');
    await page.waitForTimeout(400);
    return;
  }
  await page.waitForSelector('.ui-toast');
  await page.waitForTimeout(500);
}

for (const name of NAMES) {
  const [mode, to] = SCENES[name];
  for (const [w, h] of SIZES) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: theme });
      await ctx.route('**/*', (r) => {
        const url = r.request().url();
        if (url.startsWith('data:')) return r.continue();
        const host = new URL(url).hostname;
        if (host === 'localhost' || host === '127.0.0.1') return r.continue();
        report.blocked.push(url);
        return r.abort();
      });
      const page = await ctx.newPage();
      const tag = `rm-${name}-${w}-${theme}`;
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-pii-removal.html?mode=${mode}&theme=${theme}`);
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
      const measured = await page.evaluate((sel) => {
        const rows = (el) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          return new Set([...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0 && q.height < 40).map((q) => Math.round(q.top / 4))).size;
        };
        const wraps = [];
        for (const el of document.querySelectorAll(sel)) {
          const text = (el.textContent || '').trim();
          if (!text) continue;
          const want = (el.innerText || '').split('\n').filter((s) => s.trim()).length || 1;
          if (rows(el) > want) wraps.push(text.slice(0, 40));
        }
        const lines = [];
        for (const li of document.querySelectorAll('[data-cp-removal-lines] p')) {
          const want = (li.textContent || '').split('\n').length;
          const got = rows(li);
          const box = li.getBoundingClientRect();
          const panel = li.closest('.ui-modal__panel')?.getBoundingClientRect();
          lines.push({ text: (li.textContent || '').slice(0, 12), want, got, right: Math.round(box.right), panelRight: panel ? Math.round(panel.right) : null, scrollW: li.scrollWidth, clientW: li.clientWidth });
        }
        return { wraps, lines };
      }, SELECTORS);
      for (const t of measured.wraps) report.wraps.push(`${tag}: ${t}`);
      for (const l of measured.lines) if (l.got !== l.want || l.scrollW > l.clientW) report.lines.push(`${tag}: ${JSON.stringify(l)}`);
      const state = await page.evaluate(() => ({
        toast: (document.querySelector('.ui-toast')?.textContent || '').trim(),
        busyBtn: (document.querySelector('dialog[open] .ui-button--loading')?.textContent || '').trim(),
        busyDisabled: document.querySelector('dialog[open] .ui-button--loading')?.getAttribute('aria-disabled') ?? null,
        mineCards: document.querySelectorAll('[data-cid]').length,
        link: !!document.querySelector('.cp3-textlink'),
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
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；攔截 ${report.blocked.length}；溢出 ${report.overflows.length}；斷行 ${report.wraps.length}；說明行數不符 ${report.lines.length}`);
for (const k of ['consoleErrors', 'blocked', 'overflows', 'wraps', 'lines']) for (const l of report[k]) console.log(k, l);
for (const s of report.states) console.log('state', JSON.stringify(s));
