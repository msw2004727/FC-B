#!/usr/bin/env node
/**
 * 捲動鏈守門（T-038）：桌機滾輪、手機觸控、viewport 層級的下拉重整／回彈防護。
 * 直接用 Playwright（chromium），node 執行，不經 test runner；只連本機 dev server（VITE_FIREBASE_EMULATOR=1）。
 *
 * 用法：node scripts/e2e-scroll-guard.mjs [baseUrl]     預設 http://localhost:5181
 * 前置：dev server 已啟動、Firestore／Auth emulator 已用 scripts/seed-emulator.mjs 灌好種子（至少要有活動，/activities 才夠長）。
 *
 * 檢查：
 *   1. html／body／.legacy-ui 的實際計算值：html 的 overscroll-behavior-y 必須是 none（真正擋下拉重整與回彈的是根元素，
 *      body 的值在 Chromium 不會傳給 viewport），.legacy-ui 必須是 auto（否則滾輪被它吃掉）。
 *   2. 桌機 1280×720 與 1366×768：游標停在內容區滾輪 5 格，scrollY 要增加。
 *   3. 手機 390×844：真實觸控滑動（CDP Input.dispatchTouchEvent），scrollY 要增加。
 *   4. viewport 層級防護代理測試：把頁面放進 iframe、捲到底後再滾輪，父頁不得被帶著捲（0＝viewport 沒有往外 chain）。
 * 無法在本機驗證的：LINE 內建瀏覽器、iOS Safari 的實際下拉行為（需實機）。
 */
import { chromium } from '@playwright/test';

const BASE = (process.argv[2] || 'http://localhost:5181').replace(/\/$/, '');
const ROUTE = '/activities';
const failures = [];

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

async function swipeUp(cdp, x, y0, y1, steps = 12) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / steps }],
    });
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const browser = await chromium.launch();
try {
  // 1. 計算值
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.legacy-ui #page-activities', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const v = await page.evaluate(() => {
      const page = document.querySelector('.legacy-ui #page-activities, .legacy-ui .page');
      const ui = page ? page.closest('.legacy-ui') : null;
      return {
        html: getComputedStyle(document.documentElement).overscrollBehaviorY,
        htmlOverflow: getComputedStyle(document.documentElement).overflowY,
        body: getComputedStyle(document.body).overscrollBehaviorY,
        legacyUi: ui ? getComputedStyle(ui).overscrollBehaviorY : null,
      };
    });
    check('html overscroll-behavior-y 是 none（viewport 層級防下拉重整／回彈）', v.html === 'none', `html=${v.html}`);
    check('html 沒有被設成非 visible 的 overflow', v.htmlOverflow === 'visible', `overflow-y=${v.htmlOverflow}`);
    check('body overscroll-behavior-y 仍是 none（維持 M-057／A 的規則）', v.body === 'none', `body=${v.body}`);
    check('頁面的 .legacy-ui 是 auto（不再吃掉滾輪）', v.legacyUi === 'auto', `.legacy-ui=${v.legacyUi}`);
    await context.close();
  }

  // 2. 桌機滾輪
  for (const [w, h] of [[1280, 720], [1366, 768]]) {
    const context = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await context.newPage();
    await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const before = await page.evaluate(() => scrollY);
    await page.mouse.move(w / 2, h / 2);
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => scrollY);
    check(`桌機 ${w}×${h} 滾輪可捲動`, after > before, `scrollY ${before} → ${after}`);
    await context.close();
  }

  // 3. 手機觸控
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const cdp = await context.newCDPSession(page);
    const before = await page.evaluate(() => scrollY);
    await swipeUp(cdp, 195, 640, 240);
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => scrollY);
    check('手機 390×844 觸控可捲動', after > before, `scrollY ${before} → ${after}`);
    await context.close();
  }

  // 4. viewport 層級防護代理：iframe 內捲到底後再滾輪，父頁不得被帶動
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.route(`${BASE}/__scroll-guard-parent.html`, (route) => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><body style="margin:0;height:4000px"><iframe src="${ROUTE}" style="width:1280px;height:420px;border:0;display:block"></iframe></body>`,
    }));
    await page.goto(`${BASE}/__scroll-guard-parent.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    if (!frame) {
      check('iframe 滾動鏈代理測試可執行', false, '找不到子 frame');
    } else {
      await frame.evaluate(() => window.scrollTo({ top: 1e6, behavior: 'instant' }));
      await page.waitForTimeout(1500);
      await page.mouse.move(640, 210);
      for (let i = 0; i < 6; i += 1) {
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(100);
      }
      await page.waitForTimeout(500);
      const outer = await page.evaluate(() => scrollY);
      check('子頁捲到底後繼續滾輪，父頁不被帶動（viewport 沒有往外 chain）', outer === 0, `父頁 scrollY=${outer}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 項失敗`);
  process.exit(1);
}
console.log('\n全部通過');
