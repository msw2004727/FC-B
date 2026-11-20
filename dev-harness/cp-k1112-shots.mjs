#!/usr/bin/env node
// 賽事第 4 步 K11 邀請記分員、K12 管理員下架與檢舉截圖（由 cp-step4-u4-shots.mjs 簡化）。
// 對已打包的 harness（vite preview）逐畫面、390／360 寬、深淺色截圖；非 localhost 請求一律攔截。
// 檢查 console 錯誤、橫向溢出、介面文字被動斷行、接受頁網址不含代碼、DOM 不含檢舉人 uid。
// 用法：node dev-harness/cp-k1112-shots.mjs <輸出資料夾> [base url，預設 http://localhost:5199]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-k1112-shots');
const BASE = process.argv[3] || 'http://localhost:5199';
const SIZES = [[390, 844], [360, 640]];
const THEMES = ['light', 'dark'];
const SCREENS = ['staff-list', 'invite-form', 'invite-link', 'accept-guest', 'accept-signed', 'accept-error', 'detail-admin-reports', 'detail-admin-hide', 'detail-host-hidden'];
const CODE = 'AbCdEfGhIjKlMnOpQrStUv';
// 介面標籤（不含使用者內容：賽事名、原因、說明可以換行）
const SELECTORS = '.s4b-staff__meta, .s4b-staff__exp, .s4b-k, .s4b-err, .s4b-foot, .s4b-status, .s4b-day, button, .ui-badge, h1, .cpa-h, .cpa-reason, .cpa-meta > span, .cpa-muted, .ui-checkbox label, .ui-radio label, .ui-input label';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [], wraps: [], leaks: [] };
for (const name of SCREENS) {
  for (const [w, h] of SIZES) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
      await ctx.route('**/*', (r) => {
        const host = new URL(r.request().url()).hostname;
        if (host === 'localhost' || host === '127.0.0.1') return r.continue();
        if (r.request().url().startsWith('data:')) return r.continue();
        report.blocked.push(r.request().url());
        return r.abort();
      });
      const page = await ctx.newPage();
      const tag = `k1112-${name}-${w}-${theme}`;
      page.on('console', (m) => {
        const text = m.text();
        if (text.includes(CODE)) report.leaks.push(`${tag}: console 含代碼`);
        if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${text}`);
      });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-k1112.html?screen=${name}&theme=${theme}`);
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
      if (name.startsWith('accept-')) {
        const href = page.url();
        if (href.includes(CODE) || href.includes('#')) report.leaks.push(`${tag}: 網址仍含代碼或 # ${href}`);
        if ((await page.content()).includes(CODE)) report.leaks.push(`${tag}: DOM 含代碼`);
      }
      if ((await page.content()).includes('uid_never_rendered')) report.leaks.push(`${tag}: DOM 含檢舉人 uid`);
      const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth));
      if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
      const cut = await page.evaluate(() => {
        const out = [];
        const vw = document.documentElement.clientWidth;
        for (const el of document.querySelectorAll('button, a, input, select, textarea, .ui-badge, .s4b-inv__url')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.left < -1 || r.right > vw + 1) out.push(`${el.tagName.toLowerCase()}「${(el.textContent || '').trim().slice(0, 12)}」超出視窗 ${Math.round(r.left)}～${Math.round(r.right)}／${vw}`);
        }
        return out;
      });
      for (const t of cut) report.overflows.push(`${tag}: ${t}`);
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
      const ell = await page.evaluate(() => [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis').map((el) => (el.textContent || '').trim().slice(0, 30)));
      for (const t of ell) report.wraps.push(`${tag}: （省略號）${t}`);
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      const parts = Math.min(3, Math.max(1, Math.ceil((total - 40) / h)));
      for (let i = 0; i < parts; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), i === parts - 1 && i > 0 ? total : i * (h - 80));
        await page.waitForTimeout(150);
        const file = `${tag}${i ? `-p${i + 1}` : ''}.png`;
        await page.screenshot({ path: join(OUT, file), fullPage: false });
        report.shots.push(file);
      }
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；攔截 ${report.blocked.length}；溢出 ${report.overflows.length}；斷行／省略 ${report.wraps.length}；外洩 ${report.leaks.length}`);
for (const k of ['consoleErrors', 'blocked', 'overflows', 'wraps', 'leaks']) for (const l of report[k]) console.log(k, l);
