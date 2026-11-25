#!/usr/bin/env node
// 營運儀表板 W6 推播裝置卡真元件截圖：對 ops-w6 harness 開發伺服器截圖，假資料、不登入、非本機請求一律擋下。
// 方案 A／B（?variant=）各截：full × 360／1280 × 淺深、extreme（1 台 iPhone）× 360 淺、empty × 360 淺（卡片前後脈絡＋整頁）。
// 量：兩方案 × 7 語系 × 360／1280 × full／extreme／zero，推播卡文字不得截斷或折行、條內數字不得超出色段、條外數字不得超出條框、不得橫向捲動；console 錯誤。
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

async function open({ variant, scene, width, theme, lang }) {
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
  const tag = `${variant}-${scene}-${theme}-${width}-${lang}`;
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
  page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: ${e.message}`));
  await page.goto(`${BASE}/dev-harness/ops-w6.html?variant=${variant}&scene=${scene}&theme=${theme}&lang=${lang}`);
  await page.waitForFunction(() => window.__OPS_READY === true, null, { timeout: 30000 });
  await page.waitForSelector('.od-a-push', { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  return { ctx, page, tag };
}

async function measure(page, tag) {
  const result = await page.evaluate(() => {
    const out = [];
    const sel = '.od-a-push .od-rank-head, .od-a-push .od-push-total, .od-a-push .od-push-daily, .od-a-push .od-push-name, .od-a-push [data-push]';
    for (const el of document.querySelectorAll(sel)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
      const r = el.getBoundingClientRect();
      let truncated = el.scrollWidth > el.clientWidth + 0.5;
      // 條內數字：不得超出所在色段；條外數字（方案 B）：不得超出條框。
      const box = el.closest('.od-push-seg, .od-pushb-fill') || (el.classList.contains('od-pushb-out') ? el.closest('.od-pushb-track') : null);
      let overflow = false;
      if (box) {
        const b = box.getBoundingClientRect();
        overflow = r.left < b.left - 0.5 || r.right > b.right + 0.5;
      }
      out.push({ text: el.textContent, lines, truncated, overflow, w: Math.round(r.width) });
    }
    return { items: out, hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  report.checks.push({ tag, ...result });
  for (const item of result.items) {
    if (item.lines > 1 || item.truncated || item.overflow) report.problems.push(`${tag}: "${item.text}" lines=${item.lines} truncated=${item.truncated} overflow=${item.overflow} w=${item.w}`);
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
  ['full', 360, 'light'], ['full', 360, 'dark'], ['full', 1280, 'light'], ['full', 1280, 'dark'],
  ['extreme', 360, 'light'], ['empty', 360, 'light'],
];
for (const variant of ['A', 'B']) {
  for (const [scene, width, theme] of SHOTS) {
    const { ctx, page, tag } = await open({ variant, scene, width, theme, lang: 'zh-TW' });
    await measure(page, tag);
    const base = `w6-push-${variant}-${scene}-${width}-${theme}`;
    const clip = await contextClip(page);
    await page.screenshot({ path: join(OUT, `${base}.png`), clip, fullPage: true });
    await page.screenshot({ path: join(OUT, `${base}-fullpage.png`), fullPage: true });
    report.shots.push(`${base}.png`, `${base}-fullpage.png`);
    await ctx.close();
  }
  for (const lang of LANGS) {
    for (const width of [360, 1280]) {
      for (const scene of ['full', 'extreme', 'zero']) {
        const { ctx, page, tag } = await open({ variant, scene, width, theme: 'light', lang });
        await measure(page, tag);
        await ctx.close();
      }
    }
  }
}

await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`shots ${report.shots.length}、checks ${report.checks.length}、problems ${report.problems.length}、console errors ${report.consoleErrors.length}、blocked ${report.blocked.length}`);
for (const p of report.problems) console.log(`  PROBLEM ${p}`);
for (const e of report.consoleErrors) console.log(`  CONSOLE ${e}`);
for (const b of [...new Set(report.blocked)]) console.log(`  BLOCKED ${b}`);
