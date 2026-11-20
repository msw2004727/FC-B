#!/usr/bin/env node
// 總收尾覆蓋率補的示範狀態（設計總監 04:20）：截圖與量測。2 倍像素；360×800 無框、1280×800 加 app-shell 外框，深淺色各一。
// 用法：node dev-harness/cp-cov-shots.mjs <輸出資料夾> [base url，預設 http://127.0.0.1:5296] [--only=html:screen,...]
// 每個狀態：console 錯誤、頁面橫向溢出、按鈕／輸入框超出視窗、停用的鈕；同分狀態另量比較表（同 cp-tie-ctx-shots.mjs）。
// 非本機請求一律擋下。
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ARGS = process.argv.slice(2);
const FLAGS = Object.fromEntries(ARGS.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '']; }));
const POS = ARGS.filter((a) => !a.startsWith('--'));
const OUT = resolve(POS[0] || 'cp-cov-shots');
const BASE = POS[1] || 'http://127.0.0.1:5296';
const ONLY = FLAGS.only ? new Set(FLAGS.only.split(',')) : null;

// [harness html, screen, 1280 外框參數（k1112 本來就包 app-shell，不用帶）, 拍照前捲到的選擇器]
const SHOTS = [
  ['cp-step3-real', 'real-tie-three-h2h', '&frame=shell', '.cpm-tie'],
  ['cp-k1112', 'detail-admin-reports-loading', '', '.cpa-panel'],
  ['cp-k1112', 'detail-admin-reports-empty', '', '.cpa-panel'],
  ['cp-k1112', 'detail-admin-reports-error', '', '.cpa-panel'],
  ['cp-step4a', 'score-timeout-over', '&frame=shell', null],
  ['cp-step4-u2', 'u2-timeout-done', '&frame=shell', null],
  ['cp-step4-u2', 'u2-menu-disabled', '&frame=shell', null],
  ['cp-step4-u2', 'u2-pre-disabled', '&frame=shell', null],
  ['cp-step4-u2', 'u2-fullscreen', '&frame=shell', null],
  ['cp-step3-real', 'real-notice-compose', '&frame=shell', '.cpm-ann'],
  ['cp-step3-real', 'real-gate-two', '&frame=shell', null],
];
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

function measureGeneric() {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll('button, a, input, textarea, select')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
    if (r.left < -1 || r.right > vw + 1) out.push(`${el.tagName.toLowerCase()}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12)}」${Math.round(r.left)}～${Math.round(r.right)}／${vw}`);
  }
  const disabled = [...document.querySelectorAll('button:disabled, [aria-disabled="true"]')].map((el) => (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 16));
  const top = document.getElementById('top-bar');
  const tabs = document.getElementById('bottom-tabs');
  const root = document.querySelector('.s4-root');
  const btns = [...document.querySelectorAll('.cps-gate__btns button, .cpm-ann__btns button')].map((el) => {
    const r = el.getBoundingClientRect();
    return { text: (el.textContent || '').trim(), left: Math.round(r.left), width: Math.round(r.width), top: Math.round(r.top) };
  });
  return {
    outOfViewport: out,
    disabled,
    btnRow: btns,
    fullscreenClass: document.documentElement.classList.contains('cp-score-full'),
    topBarDisplay: top ? getComputedStyle(top).display : null,
    bottomTabsDisplay: tabs ? getComputedStyle(tabs).display : null,
    s4RootHeight: root ? Math.round(root.getBoundingClientRect().height) : null,
    viewportHeight: window.innerHeight,
  };
}

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { base: BASE, deviceScaleFactor: 2, shots: [], consoleErrors: [], blocked: [], pageOverflow: [], tie: {}, generic: {} };
for (const [html, name, frameParam, scrollSel] of SHOTS) {
  if (ONLY && !ONLY.has(`${html}:${name}`)) continue;
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
      await page.goto(`${BASE}/dev-harness/${html}.html?screen=${name}&theme=${theme}${size.frame ? frameParam : ''}`);
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
      report.generic[tag] = await page.evaluate(measureGeneric);
      if (name.startsWith('real-tie')) report.tie[tag] = await page.evaluate(measureTie);
      if (scrollSel) {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 12);
        }, scrollSel);
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
for (const p of report.pageOverflow) if (p.px > 0) console.log('overflow', p.tag, p.px);
