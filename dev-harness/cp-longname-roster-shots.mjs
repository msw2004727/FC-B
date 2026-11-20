#!/usr/bin/env node
// 名單頁 20 字暱稱（顧問 §3.471 X-02）：短暱稱／20 字暱稱 × 360 × 深淺色。
// 量 documentElement、球員列、卡片的 scrollWidth／clientWidth，暱稱元素寬度、右緣、是否省略；捲到球員卡後截圖。非 localhost 請求一律攔截。
// 用法：先 node node_modules/vite/bin/vite.js --config dev-harness/vite.harness.config.ts --port <空埠>
//       再 node dev-harness/cp-longname-roster-shots.mjs <輸出資料夾> http://localhost:<埠> <前綴>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'cp-longname-roster');
const BASE = process.argv[3] || 'http://localhost:5294';
const PREFIX = process.argv[4] || 'roster';
const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const rows = [];
const errors = [];
const blocked = [];
for (const nick of ['short', 'long']) {
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
    const tag = `${PREFIX}-roster-nick${nick === 'long' ? '20' : 'short'}-360-${theme}`;
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`${tag}: pageerror ${e.message}`));
    await page.goto(`${BASE}/dev-harness/cp-longname.html?page=roster&nick=${nick}&theme=${theme}`);
    await page.waitForFunction(() => window.__CPS_READY === true || !!window.__CPS_ERROR, null, { timeout: 25000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const li = document.querySelector('li.cps-player');
      const card = li?.closest('.cps-card');
      const name = li?.querySelector('.cps-player__name');
      const pos = li?.querySelector('.cps-player__pos');
      const r = name?.getBoundingClientRect();
      const pr = pos?.getBoundingClientRect();
      return {
        sw: de.scrollWidth, cw: de.clientWidth,
        li: li ? `${li.scrollWidth}/${li.clientWidth}` : null,
        card: card ? `${card.scrollWidth}/${card.clientWidth}` : null,
        name: name ? { text: name.textContent, cls: name.className, w: Math.round(r.width), right: Math.round(r.right), ellipsis: name.scrollWidth > name.clientWidth + 1 } : null,
        posRight: pr ? Math.round(pr.right) : null,
        posText: pos?.textContent ?? null,
      };
    });
    rows.push({ tag, ...m });
    await page.evaluate(() => document.querySelector('li.cps-player')?.closest('.cps-card')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(120);
    await page.screenshot({ path: join(OUT, `${tag}.png`), fullPage: false });
    await ctx.close();
  }
}
await browser.close();
await writeFile(join(OUT, `${PREFIX}-report.json`), JSON.stringify({ rows, errors, blocked }, null, 2), 'utf8');
console.log(`console 錯誤 ${errors.length}；攔截 ${blocked.length}`);
for (const e of errors) console.log('error', e);
for (const r of rows) console.log(`${r.tag}\tdoc ${r.sw}/${r.cw}\tli ${r.li}\tcard ${r.card}\tname ${r.name?.w}w 右緣${r.name?.right}${r.name?.ellipsis ? ' 省略' : ''}\t位置「${r.posText}」右緣${r.posRight}`);
