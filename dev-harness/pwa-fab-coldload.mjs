#!/usr/bin/env node
// 冷載入時機實測（顧問 §3.752）：模擬聯繫站長提示晚到——安裝球掛載後 5.5 秒才出聯繫站長泡泡、6 秒後才關，
// 量安裝泡泡出現的時間點與兩個泡泡是否同時在畫面上。非本機請求一律擋下。
// 用法：node dev-harness/pwa-fab-coldload.mjs <base url>
import { chromium } from '@playwright/test';

const BASE = process.argv[2] || 'http://localhost:5393';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, userAgent: IPHONE, hasTouch: true });
const page = await ctx.newPage();
await page.route('**/*', (r) => (['localhost', '127.0.0.1'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort()));
await page.goto(`${BASE}/dev-harness/pwa-fab.html?theme=light`);
await page.waitForFunction(() => window.__PF_READY === true, null, { timeout: 20000 });
const log = await page.evaluate(async () => {
  const t0 = performance.now();
  const events = [];
  let both = false;
  const obs = new MutationObserver(() => {
    const c = Boolean(document.querySelector('.contact-owner-fab-hint'));
    const p = Boolean(document.querySelector('.pwa-install-fab-hint'));
    if (c && p) both = true;
    events.push({ t: Math.round(performance.now() - t0), contact: c, pwa: p });
  });
  obs.observe(document.body, { childList: true });
  await new Promise((r) => setTimeout(r, 5500));
  const fake = document.createElement('div');
  fake.className = 'contact-owner-fab-hint';
  fake.textContent = '有問題？點這裡聯繫站長';
  document.body.appendChild(fake);
  await new Promise((r) => setTimeout(r, 6000));
  fake.remove();
  await new Promise((r) => setTimeout(r, 8000));
  obs.disconnect();
  return { events, both };
});
console.log(JSON.stringify(log, null, 2));
await browser.close();
