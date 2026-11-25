#!/usr/bin/env node
// 營運儀表板 W6 推播裝置卡真元件截圖：對 ops-w6 harness 開發伺服器截圖，假資料、不登入、非本機請求一律擋下。
// 截：full × 360／1280 × 淺深（整頁＋卡片前後脈絡），empty × 360 淺。
// 量：7 語系 × 360／1280 × 淺，推播卡文字不得截斷或折行、不得橫向捲動；console 錯誤。
// 用法：node dev-harness/ops-w6-shots.mjs <輸出資料夾> <base url>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] || 'ops-w6-shots');
const BASE = process.argv[3] || 'http://localhost:5393';
const LANGS = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'th', 'vi'];

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], checks: [], problems: [], consoleErrors: [], blocked: [] };

async function open({ scene, width, theme, lang }) {
  const ctx = await browser.newContext({
    viewport: { width, height: width >= 1000 ? 900 : 760 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (['localhost', '127.0.0.1'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    report.blocked.push(u.href);
    return r.abort();
  });
  const page = await ctx.newPage();
  const tag = `${scene}-${theme}-${width}-${lang}`;
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: ${e.message}`));
  await page.goto(`${BASE}/dev-harness/ops-w6.html?scene=${scene}&theme=${theme}&lang=${lang}`);
  await page.waitForFunction(() => window.__OPS_READY === true, null, { timeout: 30000 });
  await page.waitForSelector('.od-a-push', { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  return { ctx, page, tag };
}

async function measure(page, tag) {
  const result = await page.evaluate(() => {
    const out = [];
    const nodes = [...document.querySelectorAll('.od-a-push .od-rank-head, .od-a-push .od-push-daily, .od-a-push .od-cost-label, .od-a-push [data-push]')];
    for (const el of nodes) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
      const truncated = el.scrollWidth > el.clientWidth + 0.5;
      out.push({ text: el.textContent, lines, truncated, w: Math.round(el.getBoundingClientRect().width), sw: el.scrollWidth });
    }
    return { items: out, hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  report.checks.push({ tag, ...result });
  for (const item of result.items) {
    if (item.lines > 1 || item.truncated) report.problems.push(`${tag}: "${item.text}" lines=${item.lines} truncated=${item.truncated} w=${item.w} sw=${item.sw}`);
  }
  if (result.hscroll) report.problems.push(`${tag}: 橫向捲動`);
}

async function contextClip(page) {
  // 推播卡上一張（費用卡）的上一張（熱門主辦）頂端 → 查詢入口底端。
  return page.evaluate(() => {
    const secs = [...document.querySelectorAll('.od-grid > section')];
    const at = secs.findIndex((s) => s.classList.contains('od-a-push'));
    const top = secs[Math.max(0, at - 2)].getBoundingClientRect().top + window.scrollY - 10;
    const bottom = secs[Math.min(secs.length - 1, at + 1)].getBoundingClientRect().bottom + window.scrollY + 10;
    return { x: 0, y: Math.max(0, top), width: document.documentElement.clientWidth, height: bottom - Math.max(0, top) };
  });
}

const SHOTS = [
  ['full', 360, 'light'], ['full', 360, 'dark'], ['full', 1280, 'light'], ['full', 1280, 'dark'], ['empty', 360, 'light'],
];
for (const [scene, width, theme] of SHOTS) {
  const { ctx, page, tag } = await open({ scene, width, theme, lang: 'zh-TW' });
  await measure(page, tag);
  const base = `w6-push-${scene}-${width}-${theme}`;
  const clip = await contextClip(page);
  await page.screenshot({ path: join(OUT, `${base}.png`), clip, fullPage: true });
  await page.screenshot({ path: join(OUT, `${base}-fullpage.png`), fullPage: true });
  report.shots.push(`${base}.png`, `${base}-fullpage.png`);
  await ctx.close();
}

for (const lang of LANGS) {
  for (const width of [360, 1280]) {
    const { ctx, page, tag } = await open({ scene: 'full', width, theme: 'light', lang });
    await measure(page, tag);
    await ctx.close();
  }
}

await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`shots ${report.shots.length}、checks ${report.checks.length}、problems ${report.problems.length}、console errors ${report.consoleErrors.length}、blocked ${report.blocked.length}`);
for (const p of report.problems) console.log(`  PROBLEM ${p}`);
for (const e of report.consoleErrors) console.log(`  CONSOLE ${e}`);
for (const b of [...new Set(report.blocked)]) console.log(`  BLOCKED ${b}`);
