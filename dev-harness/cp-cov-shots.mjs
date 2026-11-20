#!/usr/bin/env node
// 總收尾覆蓋率補的示範狀態（設計總監 04:20）：截圖與量測。2 倍像素；360×800 無框、1280×800 加 app-shell 外框，深淺色各一。
// 用法：node dev-harness/cp-cov-shots.mjs <輸出資料夾> [base url，預設 http://127.0.0.1:5296] [--set=cov|fix] [--only=html:screen,...]
//   --set=fix：設計總監 04:56 那一批（修過的兩個＋長文字類），另量長文字是否被動斷行、省略是否正確（report.text）。
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
const COV = [
  ['cp-step3-real', 'real-tie-three-h2h', '&frame=shell', '.cpm-tie'],
  ['cp-k1112', 'detail-admin-reports-loading', '', '.cpa-panel'],
  ['cp-k1112', 'detail-admin-reports-empty', '', '.cpa-panel'],
  ['cp-k1112', 'detail-admin-reports-error', '', '.cpa-panel'],
  ['cp-step4-u2', 'u2-timeout-done', '&frame=shell', null],
  ['cp-step4-u2', 'u2-menu-disabled', '&frame=shell', null],
  ['cp-step4-u2', 'u2-pre-disabled', '&frame=shell', null],
  ['cp-step4-u2', 'u2-fullscreen', '&frame=shell', null],
  ['cp-step3-real', 'real-notice-compose', '&frame=shell', '.cpm-ann'],
  ['cp-step3-real', 'real-gate-two', '&frame=shell', null],
];
// 設計總監 04:56：修過的（公告刪除確認框、個人主辦有／沒有聯絡）＋長文字類；real-crest-live 是既有狀態（觀眾版進行中的列），一起拍來對照。
const FIX = [
  ['cp-step3-real', 'real-notice-delete', '&frame=shell', null],
  ['cp-step3-real', 'real-contact-personal', '&frame=shell', null],
  ['cp-step3-real', 'real-contact-personal-empty', '&frame=shell', null],
  ['cp-step3-real', 'real-long-overnight', '&frame=shell', '.cp3-ml'],
  ['cp-step3-real', 'real-long-division', '&frame=shell', '.d2-div'],
  ['cp-step3-real', 'real-ended-long-reason', '&frame=shell', '.d2-note'],
  ['cp-step3-real', 'real-notice-long', '&frame=shell', '.cpm-ann'],
  ['cp-step3-real', 'real-crest-live', '&frame=shell', '.cp3-ml'],
];
// 設計總監 05:08：客隊喊暫停（展開、收合），對照主隊 u2-timeout-stop；360 用 360×640（記分頁量測尺寸）。
const AWAY = [
  ['cp-step4-u2', 'u2-timeout-away', '&frame=shell', null],
  ['cp-step4-u2', 'u2-timeout-away-collapsed', '&frame=shell', null],
  ['cp-step4-u2', 'u2-timeout-stop', '&frame=shell', null],
];
// 設計總監 05:38（卡 2-4 面板）：暫停選隊次數用完、客隊選球員、PK 那一腳只有復原；第 5 欄是窄寬（確認框 359 以下內文 13px 用 320 拍）。
// 確認框四個都是既有狀態，只是補拍 320 寬。
const PANELS = [
  ['cp-step4-u2', 'u2-timeout-picks-used', '&frame=shell', null],
  ['cp-step4-u2', 'u2-pick-away', '&frame=shell', null],
  ['cp-step4-u2', 'u2-pk-kick-sheet', '&frame=shell', null],
  ['cp-step4-u2', 'a1-undo-confirm', '&frame=shell', null, 320],
  ['cp-step4-u2', 'a1-kickoff-confirm', '&frame=shell', null, 320],
  ['cp-step4-u2', 'u2-pk-confirm', '&frame=shell', null, 320],
  ['cp-step4-u2', 'a1-takeover-confirm', '&frame=shell', null, 320],
];
const SHOTS = FLAGS.set === 'fix' ? FIX : FLAGS.set === 'away' ? AWAY : FLAGS.set === 'panels' ? PANELS : COV;
// 長文字：介面標籤不該被動斷行；隊名、組別名等單行省略要有省略號；使用者長文（原因、公告）可以換行但不能撐破。
const TEXT_SEL = '.cp3-m__when, .cp3-m__vs span, .cp3-m__top, .cp3-tn em, .cps-h, .d2-div .cps-sub, .cpm-reason, .cpm-ended, .cpm-ann__txt, .cpm-ann__time, .cpm-public, .cp3-day, .cps-top h1';
const SIZES = [{ w: 360, h: FLAGS.set === 'away' ? 640 : 800, frame: false }, { w: 1280, h: 800, frame: true }];
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
  const bar = document.querySelector('.s4-timeout');
  const sideVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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
    sheet: (() => {
      const sh = document.querySelector('.s4-sheet');
      const head = sh?.querySelector('.ui-modal__header');
      return sh ? { cls: sh.className, headerShadow: head ? getComputedStyle(head).boxShadow : null } : null;
    })(),
    picks: [...document.querySelectorAll('.s4-timeout-picks button')].map((el) => ({ text: (el.textContent || '').trim(), disabled: el.disabled })),
    modalButtons: [...document.querySelectorAll('.ui-modal button')].filter((el) => el.getBoundingClientRect().width > 0 && !el.classList.contains('ui-modal__close')).map((el) => (el.textContent || el.getAttribute('aria-label') || '').trim()),
    dialogNotes: [...document.querySelectorAll('.s4-dialog .s4-note')].map((el) => {
      const r = document.createRange(); r.selectNodeContents(el);
      return { text: (el.textContent || '').trim().slice(0, 20), fontSize: getComputedStyle(el).fontSize, lines: new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))).size };
    }),
    awayVarResolved: (() => { const t = document.createElement('div'); t.style.color = 'var(--d2-away)'; document.querySelector('.s4-root')?.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return c; })(),
    timeoutBar: bar ? {
      cls: bar.className,
      side: getComputedStyle(bar).getPropertyValue('--s4-side').trim(),
      borderLeftColor: getComputedStyle(bar).borderLeftColor,
      borderLeftWidth: getComputedStyle(bar).borderLeftWidth,
      boxShadow: getComputedStyle(bar).boxShadow.slice(0, 80),
      homeVar: sideVar('--d2-home'),
      awayVar: sideVar('--d2-away'),
    } : null,
  };
}

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { base: BASE, deviceScaleFactor: 2, shots: [], consoleErrors: [], blocked: [], pageOverflow: [], tie: {}, generic: {}, text: {} };

function measureText(sel) {
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const text = (el.textContent || '').trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    const r = document.createRange();
    r.selectNodeContents(el);
    const lines = new Set([...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0).map((q) => Math.round(q.top))).size;
    const box = el.getBoundingClientRect();
    const parent = el.parentElement?.getBoundingClientRect();
    out.push({
      cls: el.className || el.tagName,
      text: text.slice(0, 24),
      chars: [...text].length,
      lines,
      truncated: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
      textOverflow: cs.textOverflow,
      whiteSpace: cs.whiteSpace,
      clamp: cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp') || null,
      pastParentPx: parent ? Math.max(0, Math.round(box.right - parent.right)) : 0,
    });
  }
  return out;
}
for (const [html, name, frameParam, scrollSel, narrow] of SHOTS) {
  if (ONLY && !ONLY.has(`${html}:${name}`)) continue;
  for (const size of SIZES.map((sz) => (narrow && !sz.frame ? { ...sz, w: narrow } : sz))) {
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
      if (FLAGS.set === 'fix') report.text[tag] = await page.evaluate(measureText, TEXT_SEL);
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
