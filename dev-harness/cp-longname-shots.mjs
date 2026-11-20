#!/usr/bin/env node
// 長賽事名稱／長隊名掃描（顧問 §3.460）：每頁 × 名稱（短、22 字、24 字、長隊名）× 360／1280 × 深淺色。
// 量 documentElement scrollWidth／clientWidth、最寬元素、名稱是否被切、幾行；非 localhost 請求一律攔截。
// 用法：先 node node_modules/vite/bin/vite.js --config dev-harness/vite.harness.config.ts --port <空埠>
//       再 node dev-harness/cp-longname-shots.mjs <輸出資料夾> http://localhost:<埠> [頁面,逗號分隔] [前綴]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-longname-shots');
const BASE = process.argv[3] || 'http://localhost:5294';
const ONLY = process.argv[4] && process.argv[4] !== 'all' ? process.argv[4].split(',') : null;
const PREFIX = process.argv[5] || 'ln';
const SIZES = [[360, 640], [1280, 800]];
const THEMES = ['light', 'dark'];
const PAGES = ['list', 'detail', 'detail-live', 'manage', 'matches', 'schedule', 'staff', 'roster', 'scoring', 'live', 'wizard-3', 'wizard-done', 'accept'];
const VARIANTS = [
  { id: 'short', q: 'name=short&team=short' },
  { id: 'name22', q: 'name=22&team=short', text: '新北市三重區二〇二七年春季社區五人制足球聯賽' },
  { id: 'name24', q: 'name=24&team=short', text: '新北市三重區二〇二七年春季社區五人制足球邀請聯賽' },
  { id: 'team13', q: 'name=short&team=long', text: '新北市三重區社區足球俱樂部|桃園市中壢區青年足球俱樂部|高雄市前鎮區海風足球俱樂部|台北市信義區青年足球聯隊|高雄市前鎮區海風足球隊' },
];

function urlOf(page, variant, theme) {
  if (page === 'scoring') {
    // 記分頁不顯示賽事名稱；長隊名用既有 u2-long-name（12／11 字）。
    const screen = variant.id === 'team13' ? 'u2-long-name' : 'u2-live';
    return `${BASE}/dev-harness/cp-step4-u2.html?screen=${screen}&theme=${theme}`;
  }
  return `${BASE}/dev-harness/cp-longname.html?page=${page}&${variant.q}&theme=${theme}`;
}

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { rows: [], consoleErrors: [], blocked: [] };
for (const page of ONLY ?? PAGES) {
  for (const variant of VARIANTS) {
    for (const [w, h] of SIZES) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: theme });
        await ctx.route('**/*', (r) => {
          const url = r.request().url();
          if (url.startsWith('data:') || url.startsWith('blob:')) return r.continue();
          const host = new URL(url).hostname;
          if (host === 'localhost' || host === '127.0.0.1') return r.continue();
          report.blocked.push(url);
          return r.abort();
        });
        const tab = await ctx.newPage();
        const tag = `${PREFIX}-${page}-${variant.id}-${w}-${theme}`;
        tab.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
        tab.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
        await tab.goto(urlOf(page, variant, theme));
        try {
          await tab.waitForFunction(() => window.__CPS_READY === true || !!window.__CPS_ERROR, null, { timeout: 25000 });
          if (await tab.evaluate(() => !window.__CPS_READY)) throw new Error('err');
        } catch {
          const st = await tab.evaluate(() => ({ err: window.__CPS_ERROR ?? null, txt: document.body.innerText.slice(0, 120) })).catch(() => null);
          report.consoleErrors.push(`${tag}: 未就緒 ${JSON.stringify(st)}`);
          await ctx.close();
          continue;
        }
        await tab.evaluate(() => document.fonts.ready);
        await tab.waitForTimeout(350);
        const m = await tab.evaluate((pattern) => {
          const de = document.documentElement;
          const cw = de.clientWidth;
          const desc = (el) => {
            const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
            return `${el.tagName.toLowerCase()}${cls}「${(el.textContent || '').trim().slice(0, 16)}」`;
          };
          // 最寬元素：右緣最遠者；同右緣取最深（最內層）那個。
          let widest = null; let widestRight = 0; let widestDepth = -1;
          for (const el of document.body.querySelectorAll('*')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const right = Math.round(r.right + window.scrollX);
            let depth = 0; for (let p = el; p; p = p.parentElement) depth += 1;
            if (right > widestRight || (right === widestRight && depth > widestDepth)) { widest = el; widestRight = right; widestDepth = depth; }
          }
          const names = [];
          if (pattern) {
            const re = new RegExp(pattern);
            const hits = [...document.body.querySelectorAll('*')].filter((el) => re.test(el.textContent || '')
              && ![...el.children].some((c) => re.test(c.textContent || '')));
            for (const el of hits) {
              let clipped = false;
              for (let p = el, i = 0; p && i < 4; p = p.parentElement, i += 1) {
                const cs = getComputedStyle(p);
                const hidden = cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.textOverflow === 'ellipsis';
                if (hidden && (p.scrollWidth > p.clientWidth + 1 || p.scrollHeight > p.clientHeight + 1)) clipped = true;
              }
              const r = el.getBoundingClientRect();
              const offscreen = r.right > cw + 1 || r.left < -1;
              const range = document.createRange(); range.selectNodeContents(el);
              const tops = new Set([...range.getClientRects()].filter((q) => q.width > 0 && q.height > 0).map((q) => Math.round(q.top / 6)));
              names.push({ el: desc(el), lines: tops.size, clipped, offscreen, w: Math.round(r.width) });
            }
          }
          return { sw: de.scrollWidth, cw, widest: widest ? desc(widest) : null, widestRight, names };
        }, variant.text ? variant.text : null);
        report.rows.push({ tag, page, variant: variant.id, w, theme, ...m });
        await tab.evaluate((pattern) => {
          if (!pattern) return;
          const re = new RegExp(pattern);
          const el = [...document.body.querySelectorAll('*')].find((e) => re.test(e.textContent || '') && ![...e.children].some((c) => re.test(c.textContent || '')));
          el?.scrollIntoView({ block: 'center' });
        }, variant.text ? variant.text : null);
        await tab.waitForTimeout(120);
        await tab.screenshot({ path: join(OUT, `${tag}.png`), fullPage: false });
        await ctx.close();
      }
    }
  }
}
await browser.close();
await writeFile(join(OUT, `${PREFIX}-report.json`), JSON.stringify(report, null, 2), 'utf8');
console.log(`列 ${report.rows.length}；console 錯誤 ${report.consoleErrors.length}；攔截 ${report.blocked.length}`);
for (const k of ['consoleErrors', 'blocked']) for (const l of report[k]) console.log(k, l);
for (const r of report.rows) {
  if (r.theme !== 'light') continue;
  const n = r.names.map((x) => `${x.el} ${x.lines}行${x.clipped ? ' 切' : ''}${x.offscreen ? ' 出界' : ''}`).join('；');
  console.log(`${r.page}\t${r.variant}\t${r.w}\t${r.sw}/${r.cw}\t${r.sw > r.cw ? '溢出 ' + r.widest : ''}\t${n}`);
}
