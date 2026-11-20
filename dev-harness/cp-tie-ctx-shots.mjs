#!/usr/bin/env node
// 卡 2-5 同分裁定補的兩個狀態＋頁首賽事名小字兩個狀態（設計總監 03:38／03:52）：截圖與量測。
// 對 vite dev 或 preview 的 cp-step3-real.html 截圖（2 倍像素）：360×800 無框、1280×800 加 app-shell 外框（?frame=shell），深淺色各一。
// 用法：node dev-harness/cp-tie-ctx-shots.mjs <輸出資料夾> [base url，預設 http://127.0.0.1:5296]
// 輸出：每張截圖、report.json（console 錯誤、外部請求、比較表與頁首量測）。非本機請求一律擋下。
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const POS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const OUT = resolve(POS[0] || 'cp-tie-ctx-shots');
const BASE = POS[1] || 'http://127.0.0.1:5296';
const SCREENS = ['real-tie-ranked', 'real-tie-four', 'real-ctx-short', 'real-ctx-long'];
const SIZES = [{ w: 360, h: 800, frame: false }, { w: 1280, h: 800, frame: true }];
const THEMES = ['light', 'dark'];

/** 比較表量測：容器與每一列是否溢出、右緣是否超出卡片內容區／視窗、格子有無被動斷行。 */
function measureTie() {
  const vw = document.documentElement.clientWidth;
  const cmp = document.querySelector('.cpm-cmp');
  const card = cmp?.closest('.cps-card');
  if (!cmp || !card) return { error: '找不到比較表' };
  const cr = card.getBoundingClientRect();
  const cs = getComputedStyle(card);
  const contentRight = cr.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
  const contentLeft = cr.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
  const lines = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return new Set([...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0).map((q) => Math.round(q.top))).size;
  };
  const rows = [...cmp.querySelectorAll('.cpm-cmp__r')].map((row) => {
    const rr = row.getBoundingClientRect();
    const cells = [...row.children].map((span) => {
      const sr = span.getBoundingClientRect();
      const r = document.createRange();
      r.selectNodeContents(span);
      const text = r.getBoundingClientRect();
      return {
        text: (span.textContent || '').trim(),
        boxW: Math.round(sr.width * 10) / 10,
        textW: Math.round(text.width * 10) / 10,
        overflowPx: Math.max(0, Math.round((text.width - sr.width) * 10) / 10),
        lines: (span.textContent || '').trim() ? lines(span) : 0,
      };
    });
    return {
      cls: row.className,
      hit: row.classList.contains('cpm-cmp__r--hit'),
      scrollW: row.scrollWidth,
      clientW: row.clientWidth,
      left: Math.round(rr.left * 10) / 10,
      right: Math.round(rr.right * 10) / 10,
      cells,
    };
  });
  const hitRow = cmp.querySelector('.cpm-cmp__r--hit');
  const hitBg = hitRow ? getComputedStyle(hitRow).backgroundColor : null;
  const dataRows = rows.filter((r) => !r.cls.includes('--hit'));
  const maxDataRight = Math.max(...dataRows.map((r) => r.right));
  return {
    viewport: vw,
    columns: rows[0]?.cells.length ? rows[0].cells.length - 1 : 0,
    cmpScrollW: cmp.scrollWidth,
    cmpClientW: cmp.clientWidth,
    cardLeft: Math.round(cr.left * 10) / 10,
    cardRight: Math.round(cr.right * 10) / 10,
    cardContentLeft: Math.round(contentLeft * 10) / 10,
    cardContentRight: Math.round(contentRight * 10) / 10,
    rowsRightMax: maxDataRight,
    rowsPastCardContentPx: Math.max(0, Math.round((maxDataRight - contentRight) * 10) / 10),
    hitRowPresent: !!hitRow,
    hitRowBg: hitBg,
    hitRowPastCardBorderPx: hitRow ? Math.max(0, Math.round((hitRow.getBoundingClientRect().right - cr.right) * 10) / 10) : null,
    anyCellOverflow: rows.some((r) => r.cells.some((c) => c.overflowPx > 0.5)),
    anyCellWrapped: rows.some((r) => r.cells.some((c) => c.lines > 1)),
    criterionColMinW: Math.min(...rows.slice(1).map((r) => r.cells[0]?.boxW ?? 0)),
    criterionTextMaxW: Math.max(...rows.slice(1).map((r) => r.cells[0]?.textW ?? 0)),
    rows,
  };
}

/** 頁首量測：賽事名小字是否單行省略、頁名是否完整、有無撐破頁首或碰到右上鈕。 */
function measureHeader() {
  const top = document.querySelector('.cps-top');
  const ctx = document.querySelector('.cps-top__ctx');
  const h1 = top?.querySelector('h1');
  const more = top?.querySelector('.cps-iconbtn:last-of-type');
  if (!top || !ctx || !h1) return { error: '找不到頁首' };
  const cs = getComputedStyle(ctx);
  const r = document.createRange();
  r.selectNodeContents(ctx);
  const lines = new Set([...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0).map((q) => Math.round(q.top))).size;
  const cr = ctx.getBoundingClientRect();
  const hr = h1.getBoundingClientRect();
  const mr = more?.getBoundingClientRect();
  const tr = top.getBoundingClientRect();
  return {
    text: ctx.textContent,
    chars: [...(ctx.textContent || '')].length,
    ctxBoxW: Math.round(cr.width * 10) / 10,
    ctxTextFullW: Math.round(r.getBoundingClientRect().width * 10) / 10,
    ctxScrollW: ctx.scrollWidth,
    ctxClientW: ctx.clientWidth,
    truncated: ctx.scrollWidth > ctx.clientWidth,
    textOverflow: cs.textOverflow,
    whiteSpace: cs.whiteSpace,
    overflowX: cs.overflowX,
    lines,
    ctxHeight: Math.round(cr.height * 10) / 10,
    h1Text: h1.textContent,
    h1ScrollW: h1.scrollWidth,
    h1ClientW: h1.clientWidth,
    h1Complete: h1.scrollWidth <= h1.clientWidth,
    gapH1ToCtx: Math.round((cr.left - hr.right) * 10) / 10,
    gapCtxToMenu: mr ? Math.round((mr.left - cr.right) * 10) / 10 : null,
    headerScrollW: top.scrollWidth,
    headerClientW: top.clientWidth,
    headerHeight: Math.round(tr.height * 10) / 10,
  };
}

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { base: BASE, deviceScaleFactor: 2, shots: [], consoleErrors: [], blocked: [], pageOverflow: [], tie: {}, header: {} };
for (const name of SCREENS) {
  for (const size of SIZES) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2 });
      const tag = `${name}-${size.w}${size.frame ? 'frame' : ''}-${theme}`;
      await ctx.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
        report.blocked.push(`${tag}: ${u.hostname}${u.pathname}`);
        return route.abort();
      });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-step3-real.html?screen=${name}&theme=${theme}${size.frame ? '&frame=shell' : ''}`);
      try {
        await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 30000 });
      } catch {
        const st = await page.evaluate(() => ({ err: window.__CPS_ERROR ?? null })).catch(() => null);
        report.consoleErrors.push(`${tag}: 未就緒 ${JSON.stringify(st)}`);
        await ctx.close();
        continue;
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      report.pageOverflow.push({ tag, px: wide });
      if (name.startsWith('real-tie')) {
        report.tie[tag] = await page.evaluate(measureTie);
        // 比較表＋裁定卡那一塊捲到視窗上方再拍
        await page.evaluate(() => {
          const el = document.querySelector('.cpm-tie');
          if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12);
        });
      } else {
        report.header[tag] = await page.evaluate(measureHeader);
      }
      await page.waitForTimeout(150);
      const file = `${tag}.png`;
      await page.screenshot({ path: join(OUT, file), fullPage: false });
      report.shots.push(file);
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；外部請求 ${report.blocked.length}`);
for (const l of report.consoleErrors) console.log('error', l);
