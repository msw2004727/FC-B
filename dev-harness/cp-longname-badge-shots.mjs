#!/usr/bin/env node
// 詳情頁隊伍清單「已核准」標籤（顧問 §3.463）：短隊名／13 字隊名 × 360 × 深淺色。
// 量每個標籤的行數與高度、documentElement scrollWidth／clientWidth；捲到隊伍清單後截圖。非 localhost 請求一律攔截。
// 用法：先 node node_modules/vite/bin/vite.js --config dev-harness/vite.harness.config.ts --port <空埠>
//       再 node dev-harness/cp-longname-badge-shots.mjs <輸出資料夾> http://localhost:<埠> <前綴>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-longname-badge');
const BASE = process.argv[3] || 'http://localhost:5294';
const PREFIX = process.argv[4] || 'badge';
const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const rows = [];
const errors = [];
const blocked = [];
for (const team of ['short', 'long']) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1.5, colorScheme: theme });
    await ctx.route('**/*', (r) => {
      const url = r.request().url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return r.continue();
      const host = new URL(url).hostname;
      if (host === 'localhost' || host === '127.0.0.1') return r.continue();
      blocked.push(url);
      return r.abort();
    });
    const page = await ctx.newPage();
    const tag = `${PREFIX}-detail-team${team === 'long' ? '13' : 'short'}-360-${theme}`;
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`${tag}: pageerror ${e.message}`));
    await page.goto(`${BASE}/dev-harness/cp-longname.html?page=detail&name=short&team=${team}&theme=${theme}`);
    await page.waitForFunction(() => window.__CPS_READY === true || !!window.__CPS_ERROR, null, { timeout: 25000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const badges = [...document.querySelectorAll('.cps-list .cps-li > .ui-badge')].map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const tops = new Set([...range.getClientRects()].filter((q) => q.width > 0 && q.height > 0).map((q) => Math.round(q.top / 4)));
        const r = el.getBoundingClientRect();
        return { text: (el.textContent || '').trim(), lines: tops.size, h: Math.round(r.height), w: Math.round(r.width), cls: el.className };
      });
      const names = [...document.querySelectorAll('.cps-list .cps-li .cp3-tn em')].map((el) => ({
        text: (el.textContent || '').trim(), clipped: el.scrollWidth > el.clientWidth + 1, w: Math.round(el.getBoundingClientRect().width),
      }));
      return { sw: de.scrollWidth, cw: de.clientWidth, badges, names };
    });
    rows.push({ tag, ...m });
    await page.evaluate(() => document.querySelector('.cps-list')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(120);
    await page.screenshot({ path: join(OUT, `${tag}.png`), fullPage: false });
    await ctx.close();
  }
}
await browser.close();
await writeFile(join(OUT, `${PREFIX}-report.json`), JSON.stringify({ rows, errors, blocked }, null, 2), 'utf8');
console.log(`console 錯誤 ${errors.length}；攔截 ${blocked.length}`);
for (const e of errors) console.log('error', e);
for (const r of rows) {
  const b = r.badges.map((x) => `${x.text}:${x.lines}行/${x.h}px/${x.w}w`).join(' ');
  const n = r.names.map((x) => `${x.text.slice(0, 6)}${x.clipped ? '…' : ''}(${x.w})`).join(' ');
  console.log(`${r.tag}\t${r.sw}/${r.cw}\t${b}\t${n}`);
}
