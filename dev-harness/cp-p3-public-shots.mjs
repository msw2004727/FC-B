#!/usr/bin/env node
// 新外觀第 3 批（榜單與公開內頁）示範狀態截圖（由 cp-step4-u4-shots.mjs 改寫）。
// 對已打包的 harness（vite preview）逐畫面、360／1280、淺色／深色截圖（固定視窗高度，不截整頁；
// 內容超過一個視窗時往下捲、補截後續分段），並檢查 console 錯誤、橫向溢出、元素被裁、介面文字被動斷行、
// 省略號、外部請求（非 localhost 一律擋掉並記下）、「一定要拍到的文字」。
// 用法：
//   node node_modules/vite/bin/vite.js build --config dev-harness/vite.cp-p3-public.build.config.ts --outDir <打包資料夾>
//   node node_modules/vite/bin/vite.js preview --config dev-harness/vite.cp-p3-public.build.config.ts --outDir <打包資料夾>
//   node dev-harness/cp-p3-public-shots.mjs <輸出資料夾> [base url，預設 http://127.0.0.1:5297] [只拍這些畫面，逗號分隔]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-p3-public-shots');
const BASE = process.argv[3] || 'http://127.0.0.1:5297';
const ONLY = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
const SIZES = [[360, 640], [1280, 800]];
const THEMES = ['light', 'dark'];
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;

// [畫面, 示範頁, 一定要拍到的文字, 是否往下補截]
const SCREENS = [
  // 觀眾即時頁（畫正式頁面 LiveMatchPage）
  ['u4-page-live', 'cp-step4-u4', '比賽紀錄', false],
  ['u4-page-log-open', 'cp-step4-u4', '劉冠廷', true],
  ['u4-page-pre', 'cp-step4-u4', '14:30', false],
  ['u4-page-ht', 'cp-step4-u4', '中場休息', false],
  ['u4-page-pk', 'cp-step4-u4', 'PK 3:2', false],
  ['u4-page-pk-log-open', 'cp-step4-u4', '第1輪', true],
  ['u4-page-ft-pk-corrected', 'cp-step4-u4', '比分已更正', false],
  ['u4-page-cancelled', 'cp-step4-u4', '11:30　1號場', false],
  ['u4-page-postponed', 'cp-step4-u4', '09:00　1號場', false],
  ['u4-page-long-crest', 'cp-step4-u4', '一二三四五六七八九十示範隊', false],
  ['u4-page-missing', 'cp-step4-u4', '找不到這場比賽', false],
  // 射手榜元件單獨畫（回歸用）：超過 50 名
  ['u4-scorers-cap', 'cp-step4-u4', '只顯示前 50 名', true],
  // 詳情頁裡的積分榜、射手榜、紅黃牌
  ['p3-stand-long', 'cp-p3-public', '屏東墾丁南國陽光示範隊', true],
  ['p3-stand-rules', 'cp-p3-public', '先比積分，高者在前', false],
  ['p3-detail-scorers', 'cp-p3-public', '劉冠廷', true],
  ['p3-detail-cards', 'cp-p3-public', '黃牌數', true],
  ['p3-detail-scorers-stalled', 'cp-p3-public', '射手榜已停止更新', true],
  ['p3-detail-scorers-empty', 'cp-p3-public', '還沒有已確認的比賽紀錄', true],
  ['p3-detail-scorers-cap', 'cp-p3-public', '只顯示前 50 名', true],
  ['p3-detail-scorers-groups', 'cp-p3-public', '壯年四十歲以上組', true],
  // 我的場次
  ['p3-my-pre', 'cp-p3-public', '進入記分', true],
  ['p3-my-done', 'cp-p3-public', '已取消', true],
  ['p3-my-long', 'cp-p3-public', '一二三四五六七八九十示範隊', true],
].filter(([name]) => !ONLY || ONLY.has(name));

// 斷行檢查：規格 3.0「單行省略」那幾類（板上隊名、積分榜隊名與數字、射手榜球員與隊名、我的場次對戰）
// 加上既有 u4 的選擇器。可換行的句子（排序規則、空狀態、取消原因）不列。
const SELECTORS = [
  '.cps-top h1', '.s4-team', '.s4-col__name', '.s4-clock', '.s4-stage', '.s4-pk', '.s4-score', '.s4-banner', '.s4-ev__main', '.s4-ev__tag',
  '.s4-table th', '.s4-table td', '.cp3-st__r > :not(.t):not(.rk)', '.cp3-tn em', '.cp3-day', '.cp3-strip__txt', '.cp3-m__when', '.cp3-m__vs span',
  '.s4b-day', '.s4b-k', '.s4b-foot', 'button', '.ui-badge', '.ui-tabs [role="tab"]', 'h1', 'h2', 'h3',
].join(', ');

const CLIP_SELECTORS = '.cp3-st__r, .cp3-st, .cp3-m__vs, .cp3-strip, .cp3-row, .cps-actions, .s4-board, .s4-scoreline, .s4-clockrow, .s4-ev, .s4-table, .s4b-m, .s4b-m__top, .s4b-between, .cps-top';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { base: BASE, sizes: SIZES, themes: THEMES, shots: [], consoleErrors: [], external: [], overflows: [], wraps: [], ellipsis: [], anchors: [] };

async function anchorVisible(page, text) {
  return page.evaluate((t) => {
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll('body *')) {
      if (!(el.textContent || '').includes(t)) continue;
      if ([...el.children].some((c) => (c.textContent || '').includes(t))) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > 0 && r.top < vh) return true;
    }
    return false;
  }, text);
}

for (const [name, html, anchor, scrollMore] of SCREENS) {
  for (const [w, h] of SIZES) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
      const tag = `${name}-${w}-${theme}`;
      await ctx.route('**/*', (r) => {
        const url = r.request().url();
        if (LOCAL.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return r.continue();
        report.external.push(`${tag}: ${url}`);
        return r.abort();
      });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/${html}.html?screen=${name}&theme=${theme}`);
      try {
        await page.waitForFunction(() => window.__CPS_READY === true || !!window.__CPS_ERROR, null, { timeout: 25000 });
      } catch { /* 下面一起判斷 */ }
      const state = await page.evaluate(() => ({ ready: window.__CPS_READY === true, err: window.__CPS_ERROR ?? null, txt: document.body.innerText.slice(0, 120) })).catch(() => null);
      if (!state?.ready) {
        report.consoleErrors.push(`${tag}: 未就緒 ${JSON.stringify(state)}`);
        await ctx.close();
        continue;
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth));
      if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
      const clipped = await page.evaluate((sel) => {
        const out = [];
        for (const el of document.querySelectorAll(sel)) {
          if (el.scrollWidth - el.clientWidth > 1) out.push(`${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
        }
        return out;
      }, CLIP_SELECTORS);
      for (const t of clipped) report.overflows.push(`${tag}: 容器內溢出 ${t}`);
      // 被 overflow:hidden／clip 祖先裁掉的元素（顧問 §3.294）
      const cut = await page.evaluate(() => {
        const out = [];
        const vw = document.documentElement.clientWidth;
        for (const el of document.querySelectorAll('button, a, input, select, textarea, .ui-badge, .cp3-crest, .cp3-tn em, img')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (getComputedStyle(el).visibility === 'hidden') continue;
          const label = `${el.tagName.toLowerCase()}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12)}」`;
          if (r.left < -1 || r.right > vw + 1) out.push(`${label} 超出視窗 ${Math.round(r.left)}～${Math.round(r.right)}／${vw}`);
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'visible') continue;
            if (ox === 'auto' || ox === 'scroll') break;
            const q = p.getBoundingClientRect();
            if (r.left < q.left - 1 || r.right > q.right + 1) out.push(`${label} 被 ${String(p.className || p.tagName).slice(0, 30)} 裁掉 ${Math.round(Math.max(q.left - r.left, r.right - q.right))}px`);
            break;
          }
        }
        return out;
      });
      for (const t of cut) report.overflows.push(`${tag}: 元素被裁 ${t}`);
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
      for (const t of ell) report.ellipsis.push(`${tag}: ${t}`);

      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      const scrollTo = await page.evaluate(() => window.__CPS_SCROLL_TO ?? null);
      const parts = scrollMore ? Math.min(4, Math.max(1, Math.ceil((total - 40) / h))) : 1;
      let seen = false;
      for (let i = 0; i < parts; i++) {
        if (i === 0 && scrollTo) {
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 120));
          }, scrollTo);
        } else {
          await page.evaluate((y) => window.scrollTo(0, y), i === parts - 1 && i > 0 ? total : i * (h - 80));
        }
        await page.waitForTimeout(150);
        const file = `${tag}${i ? `-p${i + 1}` : ''}.png`;
        await page.screenshot({ path: join(OUT, file), fullPage: false });
        report.shots.push(file);
        if (await anchorVisible(page, anchor)) seen = true;
      }
      report.anchors.push({ tag, anchor, seen });
      if (!seen) report.consoleErrors.push(`${tag}: 截圖沒拍到「${anchor}」`);
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`畫面 ${SCREENS.length}；截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；外部請求 ${report.external.length}；溢出 ${report.overflows.length}；被動斷行 ${report.wraps.length}；省略號 ${report.ellipsis.length}；錨點未拍到 ${report.anchors.filter((a) => !a.seen).length}`);
for (const k of ['consoleErrors', 'external', 'overflows', 'wraps', 'ellipsis']) for (const l of report[k]) console.log(k, l);
