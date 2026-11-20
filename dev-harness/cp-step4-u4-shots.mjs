#!/usr/bin/env node
// 賽事第 4 步 U4 觀眾畫面截圖（由 cp-step4-u3-shots.mjs 複製，U3 來自 U2；PM 用）：對已打包的 harness（vite preview）逐畫面、逐寬度、逐主題截圖（固定視窗高度，不截整頁；
// 內容超過一個視窗時再往下捲、補截後續分段），並檢查 console 錯誤、橫向溢出與介面文字被動斷行。
// 用法：node dev-harness/cp-step4-u4-shots.mjs <輸出資料夾> [base url，預設 http://localhost:5199]
// 新外觀第 3 批：補 u4-scorers-cap 與 u4-page-*（正式頁面 LiveMatchPage）；外部請求改成「非 localhost 一律擋」。
// 第 3 批整套（含詳情頁榜單、我的場次）用 cp-p3-public-shots.mjs。
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-step4-u4-shots');
const BASE = process.argv[3] || 'http://localhost:5199';
const ALL = [[360, 640], [1280, 800]];
const THEMES = ['light', 'dark'];
// 每個畫面必須拍到的文字（至少一段截圖的視窗內要看得到）
const ANCHORS = {
  'u4-detail-live': '即時',
  'u4-detail-corrected-pk': '比分已更正',
  'u4-match-live': '比賽紀錄',
  'u4-match-log-open': '第1輪',
  'u4-scorers': '劉冠廷',
  'u4-cards': '黃牌數',
  'u4-scorers-stalled': '射手榜已停止更新',
  'u4-scorers-empty': '還沒有已確認的比賽紀錄',
  'u4-scorers-cap': '只顯示前 50 名',
  'u4-page-live': '比賽紀錄',
  'u4-page-log-open': '劉冠廷',
  'u4-page-pre': '14:30',
  'u4-page-ht': '中場休息',
  'u4-page-pk': '3:2',
  'u4-page-pk-log-open': '第1輪',
  'u4-page-ft-pk-corrected': '比分已更正',
  'u4-page-cancelled': '已取消',
  'u4-page-postponed': '1/16 09:00',
  'u4-page-long-crest': '一二三四五六七八九十示範隊',
  'u4-page-missing': '找不到這場比賽',
};
// [畫面, 寬度組, 主題組, 是否可往下補截]
const SCREENS = [
  ['u4-detail-live', ALL, THEMES, true],
  ['u4-detail-corrected-pk', ALL, THEMES, false],
  ['u4-match-live', ALL, THEMES, false],
  ['u4-match-log-open', ALL, THEMES, true],
  ['u4-scorers', ALL, THEMES, true],
  ['u4-cards', ALL, THEMES, true],
  ['u4-scorers-stalled', ALL, THEMES, true],
  ['u4-scorers-empty', ALL, THEMES, false],
  ['u4-scorers-cap', ALL, THEMES, true],
  ['u4-page-live', ALL, THEMES, false],
  ['u4-page-log-open', ALL, THEMES, true],
  ['u4-page-pre', ALL, THEMES, false],
  ['u4-page-ht', ALL, THEMES, false],
  ['u4-page-pk', ALL, THEMES, false],
  ['u4-page-pk-log-open', ALL, THEMES, true],
  ['u4-page-ft-pk-corrected', ALL, THEMES, false],
  ['u4-page-cancelled', ALL, THEMES, false],
  ['u4-page-postponed', ALL, THEMES, false],
  ['u4-page-long-crest', ALL, THEMES, false],
  ['u4-page-missing', ALL, THEMES, false],
];

const SELECTORS = '.s4b-staff__name, .s4b-staff__meta, .s4b-day, .s4b-k, .s4b-err, .s4b-foot, .s4-team, .s4-col__name, .s4-clock, .s4-stage, .s4-hold, .s4-banner, .s4-wake, .s4-ev__main, .s4-ev__tag, .s4-evsum, .s4-flash__no, .s4-flash__name, .s4-flash__kind, .s4-flash__close, .s4-sent__st, .s4-sent__cd, .s4-hint, .s4-note, .s4-log__intent, .s4-log__st, .s4-pl__name, .s4-dlist__when, .s4-vs__score, .cpm-drag__n, .cpm-drag__li > *, .cpl-src button, .cpl-select, .cpl-st, .tc-chip, .tc-tab, .cpl-line, .tc-card-name, .tc-card-dates, button, .ui-badge, .ui-chip, dt, .cp3-name, .cp3-meta, .cp3-strip__txt, .cp3-day, .cp3-m__when, .cp3-m__vs span, .cp3-st__r > *, .cp3-champ span, .cp3-fold span, .cp3-result, .cp3-result--bad, .cp3-judge, .cp3-sec-h, .cp3-ctx, .cp3-score__name, .cp3-modal-p, .ui-input label, .ui-checkbox label, .ui-radio label, h1, h2, h3, .cps-sub, .cps-note, th, .s4-table td, .s4-pk, .cps-top h1';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], overflows: [], wraps: [], firstScreen: [] };
const copyMap = new Map();
for (const [name, sizes, themes, scrollMore] of SCREENS) {
  for (const [w, h] of sizes) {
    for (const theme of themes) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 }); await ctx.route((url) => !/^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/|data:|blob:)/.test(url.href), (r) => { report.consoleErrors.push('BLOCKED ' + r.request().url()); return r.abort(); });
      const page = await ctx.newPage();
      const tag = `s4-${name}-${w}-${theme}`;
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-step4-u4.html?screen=${name}&theme=${theme}`);
      try {
        await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 25000 });
      } catch {
        const st = await page.evaluate(() => ({ err: window.__CPS_ERROR ?? null, txt: document.body.innerText.slice(0, 120) })).catch(() => null);
        report.consoleErrors.push(`${tag}: 未就緒 ${JSON.stringify(st)}`);
        await ctx.close();
        continue;
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      for (const c of ((await page.evaluate(() => window.__CPS_COPY)) || [])) copyMap.set(c.key, c);
      const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth));
      if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
      // 區塊內部溢出（被 overflow:hidden 吃掉的內容）也要抓
      const clipped = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.cp3-st__r, .cp3-m__vs, .cp3-score, .cp3-m__act, .cps-footer, .cp3-stack-btns, .cp3-strip, .cp3-row, .cps-grid2, .s4-board, .s4-top, .s4-goals, .s4-cards, .s4-cardpair, .s4-pkpair, .s4-ctrl, .s4-clockrow, .s4-side, .s4-amend-act, .s4-ev, .s4-vs, .s4-dlist__top, .s4-log__act, .s4-kinds, .s4-grid, .s4-timeout, .s4-timeout__row, .s4-scoreline, .s4-table')) {
          if (el.scrollWidth - el.clientWidth > 1) out.push(`${el.className} ${el.scrollWidth}>${el.clientWidth}`);
        }
        return out;
      });
      for (const t of clipped) report.overflows.push(`${tag}: 容器內溢出 ${t}`);
      // 顧問 §3.294：被 overflow:hidden／clip 祖先裁掉的元素不會讓頁面變寬，要逐元素比對邊界才抓得到
      const cut = await page.evaluate(() => {
        const out = [];
        const vw = document.documentElement.clientWidth;
        for (const el of document.querySelectorAll('button, a, input, select, textarea, .ui-badge, .s4-flash, .s4-hit, .s4-pl, .cp3-crest, .cp3-tn em, .cp3-judge')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (getComputedStyle(el).visibility === 'hidden') continue;
          const name = `${el.tagName.toLowerCase()}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12)}」`;
          if (r.left < -1 || r.right > vw + 1) out.push(`${name} 超出視窗 ${Math.round(r.left)}～${Math.round(r.right)}／${vw}`);
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'visible') continue;
            const q = p.getBoundingClientRect();
            // 橫向捲動區（頁籤列等）本來就可捲，不算裁切
            if (ox === 'auto' || ox === 'scroll') break;
            if (r.left < q.left - 1 || r.right > q.right + 1) out.push(`${name} 被 ${p.className || p.tagName} 裁掉 ${Math.round(Math.max(q.left - r.left, r.right - q.right))}px`);
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
      // 被省略號截掉的文字（預期只有長隊名）
      const ell = await page.evaluate(() => [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis').map((el) => (el.textContent || '').trim().slice(0, 30)));
      for (const t of ell) report.wraps.push(`${tag}: （省略號）${t}`);
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      const parts = scrollMore ? Math.min(4, Math.max(1, Math.ceil((total - 40) / h))) : 1;
      let anchorSeen = false;
      for (let i = 0; i < parts; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), i === parts - 1 && i > 0 ? total : i * (h - 80));
        await page.waitForTimeout(150);
        const file = `${tag}${i ? `-p${i + 1}` : ''}.png`;
        await page.screenshot({ path: join(OUT, file), fullPage: false });
        const anchor = ANCHORS[name];
        if (anchor && await page.evaluate((text) => {
          const vh = window.innerHeight;
          // 找含這段文字的最深元素（子元素都不含），看它有沒有在視窗內
          for (const el of document.querySelectorAll('body *')) {
            if (!(el.textContent || '').includes(text)) continue;
            if ([...el.children].some((c) => (c.textContent || '').includes(text))) continue;
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.bottom > 0 && r.top < vh) return true;
          }
          return false;
        }, anchor)) anchorSeen = true;
        report.shots.push(file);
      }
      if (name === 'score-pick-player-long') {
        const scrollable = await page.evaluate(() => {
          const body = document.querySelector('.s4-sheet .ui-modal__body');
          if (!body) return false;
          return body.scrollHeight > body.clientHeight + 1;
        });
        if (!scrollable) report.overflows.push(`${tag}: 背號面板不能捲動`);
        await page.evaluate(() => {
          const body = document.querySelector('.s4-sheet .ui-modal__body');
          if (body) body.scrollTop = body.scrollHeight;
        });
        await page.waitForTimeout(150);
        const covered = await page.evaluate(() => {
          const body = document.querySelector('.s4-sheet .ui-modal__body');
          const missing = [];
          const vh = window.innerHeight;
          const vw = window.innerWidth;
          function seen(el, label) {
            if (!el || !body) {
              missing.push(label);
              return;
            }
            const r = el.getBoundingClientRect();
            const q = body.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) {
              missing.push(label);
              return;
            }
            if (r.top < q.top - 1 || r.bottom > q.bottom + 1 || r.left < q.left - 1 || r.right > q.right + 1) {
              missing.push(`${label} 被面板裁切`);
            }
            if (r.top < -1 || r.bottom > vh + 1 || r.left < -1 || r.right > vw + 1) missing.push(`${label} 超出視窗`);
          }
          const players = [...document.querySelectorAll('.s4-sheet .s4-pl')];
          const maxTop = players.reduce((n, el) => Math.max(n, el.getBoundingClientRect().top), 0);
          const last = players.filter((el) => Math.abs(el.getBoundingClientRect().top - maxTop) < 8);
          if (last.length < 1) missing.push('最後一排');
          for (const el of last) seen(el, `最後一排「${(el.textContent || '').trim().slice(0, 8)}」`);
          const unspecified = [...document.querySelectorAll('.s4-sheet button')].find((el) => (el.textContent || '').includes('不指定球員'));
          seen(unspecified, '不指定球員');
          return missing;
        });
        for (const item of covered) report.overflows.push(`${tag}: 捲到底後 ${item}`);
        const bottomFile = `${tag}-bottom.png`;
        await page.screenshot({ path: join(OUT, bottomFile), fullPage: false });
        report.shots.push(bottomFile);
        if (await page.evaluate((text) => {
          const vh = window.innerHeight;
          for (const el of document.querySelectorAll('body *')) {
            if (!(el.textContent || '').includes(text)) continue;
            if ([...el.children].some((c) => (c.textContent || '').includes(text))) continue;
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.bottom > 0 && r.top < vh) return true;
          }
          return false;
        }, '不指定球員')) anchorSeen = true;
      }
      if (ANCHORS[name] && !anchorSeen) report.consoleErrors.push(`${tag}: 截圖沒拍到「${ANCHORS[name]}」`);
      await ctx.close();
    }
  }
}
// 第一屏：凍結元件沒有 h1。單場與榜用 .s4-page；詳情改畫正式列表，看 .cp3-ml。U2 的記分控制列不適用於這組畫面。
const FIRST = ['u4-detail-live', 'u4-detail-corrected-pk', 'u4-match-live', 'u4-match-log-open', 'u4-scorers', 'u4-cards', 'u4-scorers-stalled', 'u4-scorers-empty', 'u4-scorers-cap', 'u4-page-live', 'u4-page-pre', 'u4-page-missing'];
for (const name of FIRST) {
  for (const [w, h] of ALL) {
    for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 }); await ctx.route((url) => !/^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/|data:|blob:)/.test(url.href), (r) => { report.consoleErrors.push('BLOCKED ' + r.request().url()); return r.abort(); });
    const page = await ctx.newPage();
    const tag = `s4-${name}-${w}x${h}-${theme}`;
    page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
    page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
    await page.goto(`${BASE}/dev-harness/cp-step4-u4.html?screen=${name}&theme=${theme}`);
    try {
      await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 25000 });
    } catch {
      const st = await page.evaluate(() => ({ err: window.__CPS_ERROR ?? null, txt: document.body.innerText.slice(0, 120) })).catch(() => null);
      report.consoleErrors.push(`${tag}: 未就緒 ${JSON.stringify(st)}`);
      report.firstScreen.push({ tag, missing: ['未就緒'] });
      await ctx.close();
      continue;
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const missing = await page.evaluate(() => {
      const el = document.querySelector('.s4-page, .cp3-ml, .cps-root');
      if (!el) return ['畫面'];
      const top = el.getBoundingClientRect().top;
      if (top > window.innerHeight + 0.5) return [`內容超出第一屏 ${Math.round(top)}>${window.innerHeight}`];
      return [];
    });
    report.firstScreen.push({ tag, missing });
    const file = `${tag}.png`;
    await page.screenshot({ path: join(OUT, file), fullPage: false });
    report.shots.push(file);
    await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'copy.json'), JSON.stringify([...copyMap.values()], null, 2), 'utf8');
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；溢出 ${report.overflows.length}；斷行／省略 ${report.wraps.length}；第一屏 ${report.firstScreen.length}`);
for (const k of ['consoleErrors', 'overflows', 'wraps']) for (const l of report[k]) console.log(k, l);
for (const row of report.firstScreen) if (row.missing.length) console.log('firstScreen', row.tag, row.missing.join('、'));
