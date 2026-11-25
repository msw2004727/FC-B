#!/usr/bin/env node
// 加到主畫面浮球真元件截圖：360／390／1280 × 淺深，加提示泡泡同時出現、緊貼版、教學彈窗（現行／修正提案）。
// 非本機請求一律擋下。每張量：橫向捲動、浮球與泡泡／導覽凸起是否重疊、console 錯誤、教學文字折行。
// 用法：node dev-harness/pwa-fab-shots.mjs <輸出資料夾> <base url>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] || 'pwa-fab-shots');
const BASE = process.argv[3] || 'http://localhost:5393';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

const shots = [];
for (const w of [360, 390, 1280]) for (const theme of ['light', 'dark']) shots.push({ name: `fab-${w}-${theme}`, w, theme, q: '' });
for (const h of ['contact', 'pwa']) for (const w of [360, 390]) for (const theme of ['light', 'dark']) shots.push({ name: `hint-${h}-${w}-${theme}`, w, theme, q: `&hint=${h}` });
shots.push({ name: 'hint-pwa-1280-light', w: 1280, theme: 'light', q: '&hint=pwa' });
for (const theme of ['light', 'dark']) shots.push({ name: `picker-390-${theme}`, w: 390, theme, q: '&modal=picker' });
for (const lang of ['zh-TW', 'en', 'ja', 'ko', 'th', 'vi', 'zh-CN']) {
  shots.push({ name: `picker-${lang}-390`, w: 390, theme: 'light', q: `&modal=picker&lang=${lang}` });
  for (const m of ['ios', 'android']) shots.push({ name: `${m}-${lang}-390`, w: 390, theme: 'light', q: `&modal=${m}&lang=${lang}`, full: true });
}
shots.push({ name: 'ios-zh-TW-360', w: 360, theme: 'light', q: '&modal=ios', full: true });
for (const lang of ['en', 'ja', 'ko', 'th', 'vi', 'zh-CN']) for (const w of [360, 390]) shots.push({ name: `lang-${lang}-${w}`, w, theme: 'light', q: `&lang=${lang}&hint=pwa`, label: true });
for (const lang of ['zh-TW', 'en', 'ja', 'ko', 'th', 'vi', 'zh-CN']) shots.push({ name: `push-hint-${lang}-360`, w: 360, theme: 'light', q: `&lang=${lang}&hint=push`, label: true });
for (const theme of ['light', 'dark']) shots.push({ name: `update-360-${theme}`, w: 360, theme, q: '&update=1' });
shots.push({ name: 'update-hint-360-light', w: 360, theme: 'light', q: '&update=1&hint=pwa' });
shots.push({ name: 'toast-360-light', w: 360, theme: 'light', q: '&toast=' + encodeURIComponent('已加入你的報名清單，記得準時到場') });
for (const w of [390, 1280]) shots.push({ name: `update-${w}-light`, w, theme: 'light', q: '&update=1' });
for (const w of [390, 1280]) shots.push({ name: `reduced-${w}-light`, w, theme: 'light', q: '&hint=pwa', rm: true });
shots.push({ name: 'ads-360-light', w: 360, theme: 'light', q: '&ads=1&hint=contact' });

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], problems: [], consoleErrors: [], blocked: [] };

for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.w >= 1000 ? 760 : 700 },
    deviceScaleFactor: 2,
    colorScheme: s.theme,
    userAgent: s.w >= 1000 ? DESKTOP : (s.q.includes('android') ? ANDROID : IPHONE),
    hasTouch: s.w < 1000,
    reducedMotion: s.rm ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return route.continue();
    report.blocked.push(`${s.name}: ${u.origin}`);
    return route.abort();
  });
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${s.name}: ${m.text()}`); });
  page.on('pageerror', (e) => report.consoleErrors.push(`${s.name}: ${e.message}`));
  await page.goto(`${BASE}/dev-harness/pwa-fab.html?theme=${s.theme}${s.q}`);
  await page.waitForFunction(() => window.__PF_READY === true, null, { timeout: 20000 });
  await page.waitForTimeout(700);
  const motion = await page.evaluate(() => {
    const f = document.querySelector('.pwa-install-fab'); const c = document.querySelector('.contact-owner-fab');
    const an = (el, pe) => (el ? getComputedStyle(el, pe).animationName : null);
    return { pwaFab: an(f), pwaGlow: an(f, '::before'), pwaRing: an(f, '::after'), pwaSheen: an(f?.querySelector('.fab-gloss'), '::after'), contactGlow: an(c, '::before'), contactSheen: an(c?.querySelector('.fab-gloss'), '::after'), pwaShaking: f?.classList.contains('is-shaking') ?? null };
  });
  // 動畫凍結在好看的一格：光澤掃到中間、光環外擴中、柔光最亮；聯繫站長抖動停在 0 度。
  await page.addStyleTag({ content: `
    .pwa-install-fab { animation: none !important; }
    .pwa-install-fab::before, .contact-owner-fab::before { animation-delay: -1.2s !important; animation-play-state: paused !important; }
    .pwa-install-fab::after, .contact-owner-fab::after { animation-delay: -0.6s !important; animation-play-state: paused !important; }
    .fab-gloss::after { animation-delay: -2.9s !important; animation-play-state: paused !important; }
    .pwa-install-fab.is-shaking, .contact-owner-fab.is-shaking { animation: none !important; }
    .contact-owner-fab-hint, .pwa-install-fab-hint { animation: none !important; }` });
  await page.waitForTimeout(100);
  const m = await page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const over = (a, b) => a && b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
    const fab = r('.pwa-install-fab'); const contact = r('.contact-owner-fab'); const hint = r('.contact-owner-fab-hint'); const upd = r('#sw-reload-deferred-prompt'); const toastEl = r('.ui-toast'); const ads = r('.floating-ads'); const phint = r('.pwa-install-fab-hint');
    const nav = document.querySelector('#bottom-tabs');
    let bump = null;
    if (nav) { const b = nav.getBoundingClientRect(); const cx = (b.left + b.right) / 2; bump = { cx, base: b.top + 4, rx: 64, ry: 65 }; }
    const wraps = [];
    for (const el of document.querySelectorAll('.pwa-guide-text, .pwa-picker-label, .pwa-picker-sub, .pwa-picker-desc, .pwa-guide-header span')) {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      const brs = el.querySelectorAll('br').length;
      const lines = Math.round(el.getBoundingClientRect().height / lh);
      if (lines > brs + 1) wraps.push(el.textContent.trim().slice(0, 30));
    }
    return {
      fab, contact, hint, label: document.querySelector('.pwa-install-fab')?.getAttribute('aria-label'),
      hScroll: document.documentElement.scrollWidth > innerWidth,
      others: { upd: over(fab, upd) || over(contact, upd) || over(phint, upd) || over(hint, upd), toast: over(fab, toastEl) || over(contact, toastEl), ads: over(fab, ads) || over(contact, ads) || over(hint, ads) || over(phint, ads) },
      fabHint: over(fab, hint) || over(contact, r('.pwa-install-fab-hint')) || over(hint, r('.pwa-install-fab-hint')), fabContact: over(fab, contact),
      fabBump: (() => { if (!fab || !bump) return false; const cx0 = fab.x + fab.w / 2, cy0 = fab.y + fab.h / 2, R = fab.w / 2; let minGap = 1e9;
        for (let a = 0; a < 360; a += 2) { const px = cx0 + R * Math.cos(a * Math.PI / 180), py = cy0 + R * Math.sin(a * Math.PI / 180);
          const dx = (px - bump.cx) / bump.rx; if (Math.abs(dx) < 1) { const top = bump.base - bump.ry * Math.sqrt(1 - dx * dx); minGap = Math.min(minGap, top - py); } }
        window.__bumpGap = minGap; return minGap < 0; })(), bumpGap: window.__bumpGap, wraps,
    };
  });
  if (m.hScroll) report.problems.push(`${s.name}: 橫向捲動`);
  if (m.fabHint) report.problems.push(`${s.name}: 浮球與提示泡泡重疊`);
  if (m.fabContact) report.problems.push(`${s.name}: 兩顆浮球重疊`);
  for (const [k, v] of Object.entries(m.others)) if (v) report.problems.push(`${s.name}: 與 ${k} 重疊`);
  if (m.fabBump) report.problems.push(`${s.name}: 浮球壓到導覽凸起`);
  if (m.wraps.length) report.problems.push(`${s.name}: 教學文字折行 ${JSON.stringify(m.wraps)}`);
  report.shots.push({ name: s.name, label: m.label, bumpGap: m.bumpGap, hScroll: m.hScroll, fabTop: m.fab?.y, contactTop: m.contact?.y, motion: s.rm ? motion : undefined });
  if (s.full) {
    await page.addStyleTag({ content: '.pwa-modal-overlay{position:absolute!important;inset:0 auto auto 0!important;width:100%;min-height:100%;height:auto!important;align-items:flex-start!important;padding:16px 0!important}.pwa-guide-panel,.pwa-guide-body{max-height:none!important;overflow:visible!important}' });
    await page.waitForTimeout(150);
    await page.locator('.pwa-guide-panel').screenshot({ path: join(OUT, `${s.name}.png`) });
  } else {
    await page.screenshot({ path: join(OUT, `${s.name}.png`) });
  }
  await ctx.close();
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ shots: report.shots.length, problems: report.problems, consoleErrors: report.consoleErrors.slice(0, 10), blocked: [...new Set(report.blocked)].slice(0, 10) }, null, 2));
