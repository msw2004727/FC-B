#!/usr/bin/env node
// 賽事第 4 步預覽截圖：對已打包的 harness（vite preview）逐畫面、逐寬度、逐主題截圖（固定視窗高度，不截整頁；
// 內容超過一個視窗時再往下捲、補截後續分段），並檢查 console 錯誤、橫向溢出與介面文字被動斷行。
// 用法：node dev-harness/cp-step4a-shots.mjs <輸出資料夾> [base url，預設 http://localhost:5195]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-step4a-shots');
const BASE = process.argv[3] || 'http://localhost:5195';
const ALL = [[390, 844], [360, 780]];
const THEMES = ['light', 'dark'];
// 每個畫面必須拍到的文字（至少一段截圖的視窗內要看得到）
const ANCHORS = {
  'score-pre': '開賽',
  'score-live': '34:00',
  'score-pick-player': '不指定球員',
  'score-card-yellow': '點一下關閉',
  'score-card-red-auto': '第二張黃牌 → 紅牌',
  'score-halftime': '下半場開始',
  'score-fulltime-undo': '2:41',
  'score-unapplied': '另一支裝置可能也在記這場',
  'score-takeover': '接手記分',
  'score-offline': '重整後會消失',
  'score-paused': '繼續計時',
  'score-amend': '會先復原原紀錄，再記新的',
  'score-cap': '紀錄已達上限，請由主辦在賽後登錄比分',
  'score-undo-half': '第二張黃牌已復原，第一張黃牌仍在',
  'live-detail': '比分已更正',
  'live-match': '比賽紀錄',
  'live-scorers': '劉冠廷',
};
// [畫面, 寬度組, 主題組, 是否可往下補截（面板／亮牌不補）]
const SCREENS = [
  ['score-pre', ALL, THEMES, true],
  ['score-live', ALL, THEMES, true],
  ['score-pick-player', ALL, THEMES, false],
  ['score-card-yellow', ALL, THEMES, false],
  ['score-card-red-auto', ALL, THEMES, false],
  ['score-halftime', ALL, THEMES, true],
  ['score-fulltime-undo', ALL, THEMES, true],
  ['score-unapplied', ALL, THEMES, false],
  ['score-takeover', ALL, THEMES, false],
  ['score-offline', ALL, THEMES, true],
  ['score-paused', ALL, THEMES, true],
  ['score-amend', ALL, THEMES, false],
  ['score-cap', ALL, THEMES, true],
  ['score-undo-half', ALL, THEMES, false],
  ['live-detail', ALL, THEMES, true],
  ['live-match', ALL, THEMES, true],
  ['live-scorers', ALL, THEMES, true],
];

const SELECTORS = '.s4-team, .s4-col__name, .s4-clock, .s4-stage, .s4-hold, .s4-banner, .s4-wake, .s4-ev__main, .s4-ev__tag, .s4-evsum, .s4-flash__no, .s4-flash__name, .s4-flash__kind, .s4-flash__close, .s4-sent__st, .s4-sent__cd, .s4-hint, .s4-note, .s4-log__intent, .s4-log__st, .s4-pl__name, .s4-dlist__when, .s4-vs__score, .cpm-drag__n, .cpm-drag__li > *, .cpl-src button, .cpl-select, .cpl-st, .tc-chip, .tc-tab, .cpl-line, .tc-card-name, .tc-card-dates, button, .ui-badge, .ui-chip, dt, .cp3-name, .cp3-meta, .cp3-strip__txt, .cp3-day, .cp3-m__when, .cp3-m__vs span, .cp3-st__r > *, .cp3-champ span, .cp3-fold span, .cp3-result, .cp3-result--bad, .cp3-judge, .cp3-sec-h, .cp3-ctx, .cp3-score__name, .cp3-modal-p, .ui-input label, .ui-checkbox label, .ui-radio label, h1, h2, h3, .cps-sub, th';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], overflows: [], wraps: [] };
const copyMap = new Map();
for (const [name, sizes, themes, scrollMore] of SCREENS) {
  for (const [w, h] of sizes) {
    for (const theme of themes) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
      const page = await ctx.newPage();
      const tag = `s4-${name}-${w}-${theme}`;
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-step4a.html?screen=${name}&theme=${theme}`);
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
      for (const c of await page.evaluate(() => window.__CPS_COPY)) copyMap.set(c.key, c);
      const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth));
      if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
      // 區塊內部溢出（被 overflow:hidden 吃掉的內容）也要抓
      const clipped = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.cp3-st__r, .cp3-m__vs, .cp3-score, .cp3-m__act, .cps-footer, .cp3-stack-btns, .cp3-strip, .cp3-row, .cps-grid2, .s4-board, .s4-pitch, .s4-ctrl, .s4-pause, .s4-clockrow, .s4-side, .s4-amend-act, .s4-ev, .s4-cardrow, .s4-vs, .s4-dlist__top, .s4-log__act, .s4-kinds, .s4-grid')) {
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
      if (ANCHORS[name] && !anchorSeen) report.consoleErrors.push(`${tag}: 截圖沒拍到「${ANCHORS[name]}」`);
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'copy.json'), JSON.stringify([...copyMap.values()], null, 2), 'utf8');
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；溢出 ${report.overflows.length}；斷行／省略 ${report.wraps.length}`);
for (const k of ['consoleErrors', 'overflows', 'wraps']) for (const l of report[k]) console.log(k, l);
