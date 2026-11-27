#!/usr/bin/env node
// 運動喜好正式元件截圖：360／1280 × 淺深，外加 390 七語。非本機請求一律擋下；量橫向捲動、文字截斷、console 錯誤。
// 用法：node dev-harness/sport-fav-shots.mjs <輸出資料夾> <base url> [只拍名稱含此字串]
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] || 'sport-fav-shots');
const BASE = process.argv[3] || 'http://localhost:5472';
const ONLY = process.argv[4] || '';
// 九宮格格子索引（第一批，排行 RANK）：足球 4、羽球 1、籃球 2、排球 8
const SEL3 = [4, 1, 2];
const S = [];
const add = (name, q, act, opt = {}) => { for (const w of [360, 1280]) for (const t of ['light', 'dark']) S.push({ name: `${name}-${w}-${t}`, w, t, q, act, ...opt }); };
add('grid1', 'scene=grid');
add('grid1-sel3', 'scene=grid', [...SEL3.map((i) => ['tile', i])]);
add('grid2', 'scene=grid', [...SEL3.map((i) => ['tile', i]), ['more']]);
add('grid3', 'scene=grid', [...SEL3.map((i) => ['tile', i]), ['more'], ['more']]);
add('grid-back1', 'scene=grid', [...SEL3.map((i) => ['tile', i]), ['more'], ['more'], ['more']]);
add('grid-locked', 'scene=grid-locked', [['tile', 8]]);
add('saved-off', 'scene=grid', [...SEL3.map((i) => ['tile', i]), ['ok']]);
add('saved-on', 'scene=grid&push=on', [...SEL3.map((i) => ['tile', i]), ['ok']], { grant: true });
add('profile', 'scene=profile');
add('profile-empty', 'scene=profile-empty');
add('profile-flag-off', 'scene=profile&flag=0');
add('profile-edit', 'scene=profile', [['edit']]);
add('profile-del', 'scene=profile', [['edit'], ['del']]);
add('push-on', 'scene=push&push=on', [], { grant: true });
add('push-off', 'scene=push');
for (const lang of ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'th', 'vi']) {
  S.push({ name: `lang-${lang}-grid-390`, w: 390, t: 'light', q: `scene=grid-locked&lang=${lang}`, act: [['tile', 8]] });
  S.push({ name: `lang-${lang}-grid2-360`, w: 360, t: 'light', q: `scene=grid&lang=${lang}`, act: [['more']] });
  S.push({ name: `lang-${lang}-grid3-360`, w: 360, t: 'light', q: `scene=grid&lang=${lang}`, act: [['more'], ['more']] });
  S.push({ name: `lang-${lang}-grid1-360`, w: 360, t: 'light', q: `scene=grid-locked&lang=${lang}`, act: [] });
  S.push({ name: `lang-${lang}-saved-390`, w: 390, t: 'light', q: `scene=grid&lang=${lang}`, act: [['tile', 4], ['ok']] });
  S.push({ name: `lang-${lang}-edit-390`, w: 390, t: 'light', q: `scene=profile&lang=${lang}`, act: [['edit'], ['del']] });
  S.push({ name: `lang-${lang}-push-390`, w: 390, t: 'light', q: `scene=push&push=on&lang=${lang}`, act: [], grant: true });
}

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], problems: [], consoleErrors: [], blocked: [] };
for (const s of S) {
  if (ONLY && !s.name.includes(ONLY)) continue;
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.w >= 1000 ? 800 : 740 }, deviceScaleFactor: 2, colorScheme: s.t, hasTouch: s.w < 1000 });
  if (s.grant) await ctx.grantPermissions(['notifications'], { origin: BASE });
  const page = await ctx.newPage();
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return route.continue();
    report.blocked.push(`${s.name}: ${u.origin}`); return route.abort();
  });
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${s.name}: ${m.text()}`); });
  page.on('pageerror', (e) => report.consoleErrors.push(`${s.name}: ${e.message}`));
  await page.goto(`${BASE}/dev-harness/sport-fav.html?theme=${s.t}&${s.q}`);
  await page.waitForFunction(() => window.__SF_READY === true, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  for (const [a, i] of s.act || []) {
    if (a === 'tile') await page.locator('#sport-prefs-modal .spf-tile').nth(i).click();
    if (a === 'more') await page.click('.spf-more');
    if (a === 'ok') await page.click('.spf-ok');
    if (a === 'edit') await page.click('#profile-edit-btn');
    if (a === 'del') await page.locator('#profile-info-edit .fav-tag-x').first().click();
    await page.waitForTimeout(350);
  }
  await page.mouse.move(0, 0);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
  await page.waitForTimeout(150);
  const m = await page.evaluate(() => {
    const out = { hScroll: document.documentElement.scrollWidth > window.innerWidth + 1, clipped: [], wrapped: [] };
    for (const el of document.querySelectorAll('.spf-name,.spf-tag,.fav-tag,.fav-add,.ne-title,.ne-sub,.spf-saved-hint,#spf-title,.spf-more,.spf-ok,.spf-push-btn')) {
      // 省略號截斷時 scrollWidth 可能只差 1px：改量文字實際寬度與元素內容寬度（審查指出原寫法漏抓）。
      const range = document.createRange(); range.selectNodeContents(el);
      const textW = range.getBoundingClientRect().width;
      const cs = getComputedStyle(el);
      const boxW = el.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
      const ellipsisBox = cs.overflow === 'hidden' && cs.whiteSpace === 'nowrap';
      const clampBox = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
      if (el.scrollWidth > el.clientWidth + 1 || (ellipsisBox && textW > boxW + 0.5) || (clampBox && el.scrollHeight > el.clientHeight + 1)) out.clipped.push(`${el.className || el.id}: ${el.textContent.trim()}`);
    }
    out.names = [...document.querySelectorAll('.spf-tile')].map((t) => t.textContent.trim() || '·');
    return out;
  });
  if (m.hScroll) report.problems.push(`${s.name}: 橫向捲動`);
  for (const c of m.clipped) report.problems.push(`${s.name}: 截斷 ${c}`);
  const file = join(OUT, `${s.name}.png`);
  await page.screenshot({ path: file });
  report.shots.push({ name: s.name, file, tiles: m.names });
  await ctx.close();
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`shots=${report.shots.length} problems=${report.problems.length} consoleErrors=${report.consoleErrors.length} blocked=${report.blocked.length}`);
for (const p of report.problems) console.log('P', p);
for (const p of report.consoleErrors.slice(0, 10)) console.log('E', p);
