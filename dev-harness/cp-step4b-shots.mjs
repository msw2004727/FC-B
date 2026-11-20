#!/usr/bin/env node
// 賽事第 4 步預覽截圖：對已打包的 harness（vite preview）逐畫面、逐寬度、逐主題截圖（固定視窗高度，不截整頁；
// 內容超過一個視窗時再往下捲、補截後續分段），並檢查 console 錯誤、橫向溢出與介面文字被動斷行。
// 用法：node dev-harness/cp-step4b-shots.mjs <輸出資料夾> [base url，預設 http://localhost:5194]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-step4b-shots');
const BASE = process.argv[3] || 'http://localhost:5194';
const ALL = [[390, 844], [360, 780]];
const THEMES = ['light', 'dark'];
// 每個畫面必須拍到的文字（至少一段截圖的視窗內要看得到）
const ANCHORS = {
  'staff-list-cohost': '李共同',
  'invite-accept': '接受',
  'invite-accept-invalid': '這個邀請已過期',
  'scorer-my-matches': '進入記分',
  'link-rep': '使用次數',
  'link-join': '已有生日資料',
  'link-join-minor': '我已取得監護人同意',
  'link-join-birthday': '不會公開',
  'link-join-full': '名單已滿',
  'link-join-invalid': '這個連結已失效',
  claim: '這是我',
  'claim-age-mismatch': '不能認領',
  'addition-request': '本隊還可增補 2 人',
  'addition-review': '阿海',
  'rules-template': '球隊暫停：每隊每半場 1 次、60 秒',
  'rules-advanced': '暫停時停錶',
  'rules-public': '延長賽：每隊 1 次',
  'checkin-print': '陳大明',
  'audit-log': '改前 1:0',
  'schedule-midnight': '1/10 00:20',
};
const NAMES = Object.keys(ANCHORS);
const SCREENS = NAMES.map((name) => [`b:${name}`, ALL, THEMES, true]);

const SELECTORS = '.cpm-drag__n, .cpm-drag__li > *, .cpl-src button, .cpl-select, .cpl-st, .tc-chip, .tc-tab, .cpl-line, .tc-card-name, .tc-card-dates, button, .ui-badge, .ui-chip, dt, .cp3-name, .cp3-meta, .cp3-strip__txt, .cp3-day, .cp3-m__when, .cp3-m__vs span, .cp3-st__r > *, .cp3-champ span, .cp3-fold span, .cp3-result, .cp3-result--bad, .cp3-judge, .cp3-sec-h, .cp3-ctx, .cp3-score__name, .cp3-modal-p, .ui-input label, .ui-checkbox label, .ui-radio label, h1, h2, h3, .cps-sub, .s4b-k, .s4b-v, .s4b-h, .s4b-label';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], overflows: [], wraps: [] };
const copyMap = new Map();
for (const [full, sizes, themes, scrollMore] of SCREENS) {
  const [, name] = full.split(':');
  for (const [w, h] of sizes) {
    for (const theme of themes) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
      const page = await ctx.newPage();
      const tag = `b-${name}-${w}-${theme}`;
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-step4b.html?screen=${name}&theme=${theme}`);
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
      const clipped = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.cp3-st__r, .cp3-m__vs, .cp3-score, .cp3-m__act, .cps-footer, .cp3-stack-btns, .cp3-strip, .cp3-row, .cps-grid2, .s4b-m__top, .s4b-between, .s4b-staff, .s4b-pair')) {
          if (el.scrollWidth - el.clientWidth > 1) out.push(`${el.className} ${el.scrollWidth}>${el.clientWidth}`);
        }
        return out;
      });
      for (const t of clipped) report.overflows.push(`${tag}: 容器內溢出 ${t}`);
      const cut = await page.evaluate(() => {
        const out = [];
        const vw = document.documentElement.clientWidth;
        for (const el of document.querySelectorAll('button, a, input, select, textarea, .ui-badge, .cp3-crest, .cp3-tn em, .cp3-judge')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (getComputedStyle(el).visibility === 'hidden') continue;
          const label = `${el.tagName.toLowerCase()}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12)}」`;
          if (r.left < -1 || r.right > vw + 1) out.push(`${label} 超出視窗 ${Math.round(r.left)}～${Math.round(r.right)}／${vw}`);
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'visible') continue;
            const q = p.getBoundingClientRect();
            if (ox === 'auto' || ox === 'scroll') break;
            if (r.left < q.left - 1 || r.right > q.right + 1) out.push(`${label} 被 ${p.className || p.tagName} 裁掉 ${Math.round(Math.max(q.left - r.left, r.right - q.right))}px`);
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
