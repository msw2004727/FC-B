#!/usr/bin/env node
// 記分頁面板與確認框截圖（新外觀第 2 批卡 2-4／2-7）：每個面板狀態 360×640 與 1280×800（加 &frame=shell 外框）、深淺色、2 倍像素；
// 面板裡每一顆「看得到、而且在最上層」的按鈕各截一張，檔名用按鈕實際的字，保證檔名與內容一致。
//
// 用法：node dev-harness/cp-scoreboard-panel-shots.mjs <輸出資料夾> [base url，預設 http://127.0.0.1:5296] [--screens=a,b]
// 輸出：<狀態>-<寬>-<主題>.png、btn-<按鈕字>-<狀態>-<主題>.png、report.json（每顆鈕的字、class、字色、底層長相、高度）。
// 只連 localhost；畫面就緒以示範頁的 window.__CPS_READY 為準。
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.slice(2).split('=');
  return [k, v ?? true];
}));
const pos = args.filter((a) => !a.startsWith('--'));
const OUT = resolve(pos[0] || 'cp-scoreboard-panel-shots');
const BASE = pos[1] || 'http://127.0.0.1:5296';
const ALL = [
  'score-pick-player', 'score-pick-player-long', 'score-amend', 'u2-amend-card', 'u2-pk-goal-locked', 'score-unapplied',
  'a1-held-sheet', 'u2-timeout-sheet', 'a1-kickoff-confirm', 'u2-pk-confirm', 'a1-pk-confirm-wait', 'a1-pk-confirm-armed',
  'a1-takeover-confirm', 'a1-undo-confirm', 'a1-amend-confirm', 'score-takeover', 'u2-menu',
];
const SCREENS = flags.screens ? String(flags.screens).split(',') : ALL;
const pageOf = (s) => (s.startsWith('score-') ? 'cp-step4a.html' : 'cp-step4-u2.html');
const safe = (text) => text.replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 16) || '無字';

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const report = { errors: [], buttons: [] };
for (const screen of SCREENS) {
  for (const [w, h, frame] of [[360, 640, ''], [1280, 800, '&frame=shell']]) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      await ctx.route((u) => !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(new URL(u).hostname), (r) => r.abort());
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`${screen} ${w} ${theme}: ${m.text()}`); });
      await page.goto(`${BASE}/dev-harness/${pageOf(screen)}?screen=${screen}&theme=${theme}${frame}`);
      await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 15000 })
        .catch(() => report.errors.push(`${screen} ${w} ${theme}: 未就緒`));
      await page.evaluate(() => document.fonts.ready);
      // 「剛跳出」要在 0.6 秒內拍；其他等動畫走完、確認鈕可按。
      await page.waitForTimeout(screen === 'a1-pk-confirm-wait' ? 350 : 900);
      await page.screenshot({ path: join(OUT, `${screen}-${w}-${theme}.png`) });
      if (w !== 360) { await ctx.close(); continue; }
      // 只拍面板裡、看得到、而且中心點最上層就是它自己的鈕（被確認框蓋住的底下那張面板的鈕不拍）。
      const targets = await page.evaluate(() => {
        const out = [];
        const nodes = [...document.querySelectorAll('dialog[open] button, .s4-menu button')];
        nodes.forEach((el, index) => {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return;
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!top || !(top === el || el.contains(top))) return;
          const text = (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          if (!text || el.classList.contains('ui-modal__close')) return;
          el.setAttribute('data-shot-index', String(index));
          const cs = getComputedStyle(el);
          const be = getComputedStyle(el, '::before');
          out.push({
            index,
            text,
            cls: el.className,
            color: cs.color,
            bg: be.backgroundImage !== 'none' ? 'glass/gradient' : be.backgroundColor,
            shadow: be.boxShadow.slice(0, 80),
            h: Math.round(r.height),
          });
        });
        return out;
      });
      const used = new Map();
      for (const t of targets) {
        const base = `btn-${safe(t.text)}-${screen}-${theme}`;
        const n = used.get(base) ?? 0;
        used.set(base, n + 1);
        const file = `${base}${n ? `-${n + 1}` : ''}.png`;
        await page.locator(`[data-shot-index="${t.index}"]`).screenshot({ path: join(OUT, file) });
        report.buttons.push({ screen, theme, file, ...t });
      }
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(`狀態 ${SCREENS.length}、按鈕截圖 ${report.buttons.length} 張、主控台錯誤 ${report.errors.length}`);
for (const e of report.errors.slice(0, 5)) console.log(e);
