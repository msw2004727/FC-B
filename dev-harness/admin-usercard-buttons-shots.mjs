#!/usr/bin/env node
// 用戶卡按鈕截圖（顧問 §3.817；§3.818 起只拍正式元件＝建議版 B）：五顆／四顆／三顆／黑標（有到期）／黑標（無到期）× 390、1280 × 淺深色；
// 解除臨取紅標流程（按前、確認框、成功後）390 淺色。非 localhost 請求一律攔截；
// 記 console 錯誤、橫向溢出、按鈕列行數、臨取狀態列行數與「解除」鈕垂直置中差、賽事個資移除左側間隔。
// 用法：先 node node_modules/vite/bin/vite.js --config dev-harness/vite.harness.config.ts --port <空埠>
//       再 node dev-harness/admin-usercard-buttons-shots.mjs <輸出資料夾> http://localhost:<埠>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const OUT = resolve(process.argv[2] || 'admin-usercard-buttons-shots');
const BASE = process.argv[3] || 'http://localhost:5237';
const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [], states: [] };

async function open(query, w, h, theme, tag) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w > 800 ? 1 : 2, colorScheme: theme });
  await ctx.route('**/*', (r) => {
    const url = r.request().url();
    if (url.startsWith('data:')) return r.continue();
    const host = new URL(url).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return r.continue();
    report.blocked.push(url);
    return r.abort();
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
  await page.goto(`${BASE}/dev-harness/admin-usercard-buttons.html?${query}&theme=${theme}`);
  await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 25000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600); // A 的 pageIn 淡入
  return { ctx, page };
}

async function shoot(page, tag) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
  const state = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.admin-user-card button')];
    const rowTops = new Set([...document.querySelectorAll('.admin-user-actions button')].map((b) => Math.round(b.getBoundingClientRect().top)));
    const lc = document.querySelector('.au-lc-row');
    const clear = document.querySelector('.au-btn-lc-clear');
    const lcText = lc?.querySelector('span');
    const lcRows = lc ? new Set([...lc.children].map((el) => Math.round(el.getBoundingClientRect().top / 6))).size : null;
    const mid = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const centerDiff = clear && lcText ? Math.round(Math.abs(mid(clear) - mid(lcText)) * 10) / 10 : null;
    const clipped = clear && lc ? (() => { const r = clear.getBoundingClientRect(); const p = lc.getBoundingClientRect(); return r.right > p.right + 0.5 || r.top < p.top - 0.5 || r.bottom > p.bottom + 0.5; })() : null;
    const cp = document.querySelector('.au-btn-cp-remove');
    const prev = cp?.previousElementSibling;
    const cpGap = cp && prev ? Math.round(cp.getBoundingClientRect().left - prev.getBoundingClientRect().right) : null;
    return {
      buttons: btns.map((b) => b.textContent), actionRows: rowTops.size, lcText: lc?.textContent ?? (document.querySelector('.admin-user-card')?.textContent?.match(/臨取狀態：[^最]*/)?.[0] ?? null),
      lcRows, centerDiff, clipped, cpGap, toast: (document.querySelector('.ui-toast')?.textContent || '').trim(),
    };
  });
  // 「解除」小鈕：字級、平常（字色對卡片底色）與 hover（字色對按鈕底色）的對比（WCAG 相對亮度）
  if (!tag.includes('flow') && await page.locator('.au-btn-lc-clear').count()) {
    const measure = () => page.evaluate(() => {
      const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
      const btn = document.querySelector('.au-btn-lc-clear');
      const cs = getComputedStyle(btn);
      let bg = rgb(cs.backgroundColor);
      if (bg.length === 4 && bg[3] === 0) bg = rgb(getComputedStyle(document.querySelector('.admin-user-card')).backgroundColor);
      return { fontSize: cs.fontSize, color: cs.color, bg: `rgb(${bg.slice(0, 3).join(',')})`, contrast: ratio(rgb(cs.color), bg) };
    });
    state.clearNormal = await measure();
    await page.locator('.au-btn-lc-clear').hover();
    await page.waitForTimeout(250);
    state.clearHover = await measure();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
  }
  report.states.push({ tag, ...state });
  // 只拍卡片那一塊（頁首到卡片底下一點），比整頁清楚
  const box = await page.evaluate(() => {
    const card = document.querySelector('.admin-user-card')?.getBoundingClientRect();
    return card ? { y: Math.max(0, card.top - 60), h: card.height + 90 } : null;
  });
  const clip = box && !tag.includes('flow') ? { x: 0, y: box.y, width: page.viewportSize().width, height: Math.min(box.h, page.viewportSize().height - box.y) } : undefined;
  await page.screenshot({ path: join(OUT, `${tag}.png`), clip });
  report.shots.push(`${tag}.png`);
}

for (const which of ['five', 'four', 'three', 'black', 'black-none']) {
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    for (const theme of ['light', 'dark']) {
      const tag = `uc-${which}-${w}-${theme}`;
      try {
        const { ctx, page } = await open(`case=${which}`, w, h, theme, tag);
        await shoot(page, tag);
        await ctx.close();
      } catch (err) {
        report.consoleErrors.push(`${tag}: ${err.message.split('\n')[0]}`);
      }
    }
  }
}

// 解除臨取紅標流程（正式版：臨取狀態那一行的「解除」小鈕）
try {
  const { ctx, page } = await open('case=flow', 390, 844, 'light', 'uc-flow');
  await shoot(page, 'uc-flow-1-before');
  await page.getByRole('button', { name: '解除臨取狀態' }).click();
  await page.waitForSelector('[role="alertdialog"]');
  await page.waitForTimeout(400);
  await shoot(page, 'uc-flow-2-confirm');
  await page.locator('[role="alertdialog"] button').last().click();
  await page.waitForSelector('.ui-toast');
  await page.waitForTimeout(500);
  await shoot(page, 'uc-flow-3-after');
  await ctx.close();
} catch (err) {
  report.consoleErrors.push(`flow: ${err.message.split('\n')[0]}`);
}

await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；攔截 ${report.blocked.length}；溢出 ${report.overflows.length}`);
for (const k of ['consoleErrors', 'blocked', 'overflows']) for (const l of report[k]) console.log(k, l);
for (const s of report.states) console.log('state', JSON.stringify(s));
