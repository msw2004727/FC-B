#!/usr/bin/env node
// 賽事第 4 步 A（資料正確性＋確認框防連點）記分頁截圖：由 cp-step4-u2-shots.mjs 複製改畫面名。
// 對已打包的 u2 harness（vite preview）截 360／390／1280、深淺色，並檢查 console 錯誤、橫向溢出、被動斷行與提示列是否被裁。
// a1-pk-confirm-wait 在畫面就緒當下（< 600ms）先補一張，並記錄「PK 大戰」與「開始 PK」的位置。
// 用法：node dev-harness/cp-step4-a1-shots.mjs <輸出資料夾> [base url，預設 http://localhost:5197]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-step4-a1-shots');
const BASE = process.argv[3] || 'http://localhost:5197';
const ALL = [[360, 640], [390, 780], [1280, 800]];
const THEMES = ['light', 'dark'];
const ANCHORS = {
  'u2-pending': '待送',
  'a1-held': '之後記的 2 筆先存在這支手機',
  'a1-held-sheet': '重新套用',
  'a1-blocked-ht': '先處理沒送出的紀錄，才能開始下半場',
  'a1-resumed': '終場',
  'a1-pk-confirm-wait': '開始 PK 大戰？',
  'a1-pk-confirm-armed': '開始 PK 大戰？',
  'a1-kickoff-confirm': '開始比賽？',
  'a1-takeover-confirm': '接手後，另一支裝置記的動作會送不出去',
  'a1-showcard': '點一下關閉',
  'a1-undo-confirm': '會一併復原第二張黃牌',
  'a1-blocked-ht-before': '前一筆沒送出，請點「未套用的動作」處理',
  'a1-pk-blocked': '先處理沒送出的紀錄，才能開始 PK',
};
const SCREENS = [
  ['u2-pending', ALL, THEMES, true],
  ['a1-held', ALL, THEMES, true],
  ['a1-held-sheet', ALL, THEMES, false],
  ['a1-blocked-ht', ALL, THEMES, true],
  ['a1-resumed', ALL, THEMES, true],
  ['a1-pk-confirm-wait', ALL, THEMES, false],
  ['a1-pk-confirm-armed', ALL, THEMES, false],
  ['a1-kickoff-confirm', ALL, THEMES, false],
  ['a1-takeover-confirm', ALL, THEMES, false],
  ['a1-showcard', ALL, THEMES, false],
  ['a1-undo-confirm', ALL, THEMES, false],
  ['a1-blocked-ht-before', ALL, THEMES, true],
  ['a1-pk-blocked', ALL, THEMES, true],
];
// 第 4 個參數：只拍這些畫面（逗號分隔），例如 a1-pk-blocked,a1-blocked-ht。沒給就全拍。
const ONLY = (process.argv[4] || '').split(',').filter(Boolean);
// 確認框畫面：就緒後約 300ms（面板滑入完、仍在 600ms 內）先拍一張確認鈕停用中的樣子。
const EARLY = new Set(['a1-pk-confirm-wait', 'a1-kickoff-confirm', 'a1-takeover-confirm', 'a1-undo-confirm']);

const SELECTORS = '.s4-team, .s4-col__name, .s4-clock, .s4-stage, .s4-hold, .s4-banner, .s4-wake, .s4-ev__main, .s4-ev__tag, .s4-evsum, .s4-flash__no, .s4-flash__name, .s4-flash__kind, .s4-flash__close, .s4-sent__st, .s4-sent__cd, .s4-hint, .s4-note, .s4-log__intent, .s4-log__st, .s4-pl__name, .s4-dlist__when, .s4-vs__score, .cpm-drag__n, .cpm-drag__li > *, .cpl-src button, .cpl-select, .cpl-st, .tc-chip, .tc-tab, .cpl-line, .tc-card-name, .tc-card-dates, button, .ui-badge, .ui-chip, dt, .cp3-name, .cp3-meta, .cp3-strip__txt, .cp3-day, .cp3-m__when, .cp3-m__vs span, .cp3-st__r > *, .cp3-champ span, .cp3-fold span, .cp3-result, .cp3-result--bad, .cp3-judge, .cp3-sec-h, .cp3-ctx, .cp3-score__name, .cp3-modal-p, .ui-input label, .ui-checkbox label, .ui-radio label, h1, h2, h3, .cps-sub, th';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], overflows: [], wraps: [], firstScreen: [], rects: [] };
const copyMap = new Map();
for (const [name, sizes, themes, scrollMore] of SCREENS.filter(([n]) => ONLY.length === 0 || ONLY.includes(n))) {
  for (const [w, h] of sizes) {
    for (const theme of themes) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 }); await ctx.route(/googleapis\.com|firebaseio\.com|firebaseapp\.com/, (r) => { report.consoleErrors.push('BLOCKED ' + r.request().url()); return r.abort(); });
      const page = await ctx.newPage();
      const tag = `s4-${name}-${w}-${theme}`;
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-step4-u2.html?screen=${name}&theme=${theme}`);
      try {
        await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 25000 });
      } catch {
        const st = await page.evaluate(() => ({ err: window.__CPS_ERROR ?? null, txt: document.body.innerText.slice(0, 120) })).catch(() => null);
        report.consoleErrors.push(`${tag}: 未就緒 ${JSON.stringify(st)}`);
        await ctx.close();
        continue;
      }
      if (EARLY.has(name)) {
        const rects = await page.evaluate(() => window.__A1_RECTS ?? null);
        // 確認鈕＝對話框底部最後一顆（取消在左、確認在右）。
        const goDisabled = () => page.evaluate(() => {
          const btns = [...document.querySelectorAll('.s4-dialog .ui-modal__footer button')];
          return btns.length ? { order: btns.map((b) => (b.textContent || '').trim()), disabled: btns[btns.length - 1].disabled } : null;
        });
        // 等面板滑入動畫走完（仍在 600ms 內），拍停用中的確認鈕；拍之前、之後都確認仍是停用。
        await page.waitForTimeout(300);
        const before = await goDisabled();
        const early = `${tag}-early.png`;
        await page.screenshot({ path: join(OUT, early), fullPage: false });
        report.rects.push({ tag, rects, disabledBeforeShot: before, disabledAfterShot: await goDisabled() });
        report.shots.push(early);
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      const bannerCut = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('.s4-banner')].filter((el) => {
          const r = el.getBoundingClientRect();
          return el.scrollWidth > el.clientWidth + 1 || r.right > vw + 1 || r.left < -1;
        }).map((el) => `${(el.textContent || '').trim().slice(0, 30)} ${el.scrollWidth}>${el.clientWidth}`);
      });
      for (const t of bannerCut) report.overflows.push(`${tag}: 提示列被裁 ${t}`);
      for (const c of ((await page.evaluate(() => window.__CPS_COPY)) || [])) copyMap.set(c.key, c);
      const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth));
      if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
      // 區塊內部溢出（被 overflow:hidden 吃掉的內容）也要抓
      const clipped = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.cp3-st__r, .cp3-m__vs, .cp3-score, .cp3-m__act, .cps-footer, .cp3-stack-btns, .cp3-strip, .cp3-row, .cps-grid2, .s4-board, .s4-top, .s4-goals, .s4-cards, .s4-cardpair, .s4-pkpair, .s4-ctrl, .s4-clockrow, .s4-side, .s4-amend-act, .s4-ev, .s4-vs, .s4-dlist__top, .s4-log__act, .s4-kinds, .s4-grid, .s4-timeout, .s4-timeout__row, .s4-scoreline')) {
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
// 第一屏：控制列或開賽鈕的底邊要在視窗內。u2-crowded 是暫停列加兩條提示，360×640 也要過。
const FIRST = ['a1-held', 'a1-blocked-ht', 'a1-resumed'];
for (const name of FIRST.filter((n) => ONLY.length === 0 || ONLY.includes(n))) {
  for (const [w, h] of [...ALL, [375, 812]]) {
    for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 }); await ctx.route(/googleapis\.com|firebaseio\.com|firebaseapp\.com/, (r) => { report.consoleErrors.push('BLOCKED ' + r.request().url()); return r.abort(); });
    const page = await ctx.newPage();
    const tag = `s4-${name}-${w}x${h}-${theme}`;
    page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
    page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
    await page.goto(`${BASE}/dev-harness/cp-step4-u2.html?screen=${name}&theme=${theme}`);
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
      const el = document.querySelector('.s4-ctrl') || document.querySelector('.s4-kickoff');
      if (!el) return ['底部控制列'];
      const bottom = el.getBoundingClientRect().bottom;
      if (bottom > window.innerHeight + 0.5) return [`底部控制列超出第一屏 ${Math.round(bottom)}>${window.innerHeight}`];
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
