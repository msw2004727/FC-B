#!/usr/bin/env node
/**
 * 捲動鏈守門（T-038）：桌機滾輪、手機觸控、viewport 層級的下拉重整／回彈防護、頁面底部多餘空白。
 * 直接用 Playwright（chromium），node 執行，不經 test runner，不進 CI（需要 dev server＋emulator）；只連本機。
 *
 * 手動執行：
 *   1. npm run emulators                                   （Firestore／Auth emulator，127.0.0.1:8080／9099）
 *   2. npm run seed:emulator                               （灌種子；/activities 需要活動）
 *   3. VITE_FIREBASE_EMULATOR=1 VITE_CALLABLE_MODE=mock npx vite --port 5181
 *   4. node scripts/e2e-scroll-guard.mjs [baseUrl]         預設 http://localhost:5181
 *
 * 安全：只接受 loopback 的 http(s) 網址（localhost／127.0.0.1／::1）；且頁面的 console 必須回報
 * 「連線目標 … · emulator」（src/data/firebase.ts 的啟動訊息），否則視為連到正式庫，直接丟錯中止（exit 2），不繼續檢查。
 * 另會對本機 Firestore emulator（127.0.0.1:8080）寫入一個測試用戶（完整個資，才不會跳首次登入彈窗鎖住捲動）。
 *
 * 檢查（任何一項「等不到明確目標頁／資料／捲動範圍」都是失敗，不會退而測別的畫面）：
 *   A. 計算值：html overscroll-behavior-y＝none 且 overflow 為 visible；body＝none；頁面外框（.app-main > .legacy-ui）的 Y＝auto、X＝none（只改 Y）。
 *   B. 桌機 1280×720／1366×768：/activities 與 /profile，游標下是內容（不是固定列）、起點 scrollY＝0、滾輪 5 格後 scrollY 增加。
 *   C. 手機 390×844：/activities 真實觸控滑動（CDP Input.dispatchTouchEvent）後 scrollY 增加。
 *   D. 頁面底部餘量：#app 底到文件底沒有多餘空白；/profile 最後一張卡到文件底的餘量不超過 220px（修前多一個視窗高 ≈ 720px）。
 *   E. viewport 層防護代理（iframe）：子頁捲到底後繼續滾輪，父頁不得被帶動；對照組（暫時把根元素設為 auto）父頁必須被帶動，
 *      恢復 none 後父頁又不動——證明這個測試真的測得到。
 * 不能在本機驗證的：LINE 內建瀏覽器、iOS Safari 的實際下拉重整／橡皮筋（需實機）；CDP 觸控是 Chromium 的輸入模擬。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const RAW_BASE = process.argv[2] || 'http://localhost:5181';
const ACTIVITIES = '/activities';
const PROFILE = '/profile';
// 活動卡片是 div[data-event-id]（role=link），不是 <a>；等到至少一張卡才算資料就緒。
const EVENT_LINK = '#app .legacy-ui [data-event-id]';
const GUARD_UID = 'U0000000000000000000000000000G01';
const EMULATOR_HOST = '127.0.0.1:8080';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const MAX_PROFILE_BOTTOM_GAP = 220;

const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

function parseLoopbackBase(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`網址無法解析：${raw}`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`只接受 loopback 網址（localhost／127.0.0.1／::1），收到：${raw}`);
  }
  return url.origin;
}

/** 寫入測試用戶到本機 Firestore emulator（REST，Bearer owner 只在 emulator 有效）。 */
async function ensureGuardUser() {
  const configPath = fileURLToPath(new URL('../src/data/firebase-config.ts', import.meta.url));
  const projectId = (await readFile(configPath, 'utf8')).match(/projectId\s*:\s*['"]([^'"]+)['"]/)?.[1];
  if (!projectId) throw new Error('找不到 projectId');
  const str = (value) => ({ stringValue: value });
  const res = await fetch(
    `http://${EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/users/${GUARD_UID}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({
        fields: {
          uid: str(GUARD_UID),
          lineUserId: str(GUARD_UID),
          role: str('user'),
          displayName: str('捲動守門測試用戶'),
          gender: str('男'),
          birthday: str('1995-05-05'),
          region: str('台北市'),
          email: str('scroll-guard@example.test'),
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`寫入 emulator 失敗：${res.status}（emulator 沒開？）`);
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

/** 該座標最上層元素是否是 #app 裡 .legacy-ui 的內容，且祖先沒有固定定位（排除頂／底列）。 */
function hitsContent(frameOrPage, x, y) {
  return frameOrPage.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    if (!el) return { ok: false, why: '座標上沒有元素' };
    if (!el.closest('#app .legacy-ui')) return { ok: false, why: `落在 #app .legacy-ui 之外：${el.tagName.toLowerCase()}.${el.className}` };
    for (let n = el; n; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') return { ok: false, why: `落在固定定位元素上：${n.tagName.toLowerCase()}.${n.className}` };
    }
    return { ok: true, why: `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}` };
  }, [x, y]);
}

async function signIn(page, base) {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async (uid) => {
    const mod = await import('/src/data/auth.ts');
    await mod.devSignIn(uid);
  }, GUARD_UID);
  await page.waitForTimeout(500);
}

/** 打開目標頁並等到明確的資料就緒；等不到就丟錯（不退而測別的畫面）。 */
async function openReady(page, base, route, readySelector) {
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(readySelector, { state: 'visible', timeout: 30000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(300);
}

async function scrollRange(page) {
  return page.evaluate(() => ({
    y: window.scrollY,
    range: document.documentElement.scrollHeight - window.innerHeight,
  }));
}

async function main() {
  const base = parseLoopbackBase(RAW_BASE);
  await ensureGuardUser();
  const browser = await chromium.launch();
  try {
    // ── A. 計算值（同時確認連的是 emulator） ──────────────────────────
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      const infoLogs = [];
      page.on('console', (msg) => infoLogs.push(msg.text()));
      await signIn(page, base);
      await openReady(page, base, ACTIVITIES, EVENT_LINK);
      // 不是 emulator 就直接中止（throw → 外層 exit 2），不繼續對這個網址做任何檢查。
      const target = infoLogs.find((line) => /\[firebase\].*連線目標/.test(line));
      if (!target || !/·\s*emulator/.test(target)) {
        throw new Error(`頁面沒有回報 emulator 連線目標，中止（收到：${target ?? '沒有連線目標訊息'}）`);
      }
      console.log(`PASS  連線目標是 emulator  ${target}`);
      const v = await page.evaluate(() => {
        // 頁面本體的外框：.app-main > .legacy-ui（#app 底下第一個 .legacy-ui 是頂部列的 .legacy-chrome，不是頁面）
        const ui = document.querySelector('.app-main > .legacy-ui');
        const css = (el, prop) => getComputedStyle(el)[prop];
        return {
          htmlY: css(document.documentElement, 'overscrollBehaviorY'),
          htmlOverflowY: css(document.documentElement, 'overflowY'),
          bodyY: css(document.body, 'overscrollBehaviorY'),
          uiY: ui ? css(ui, 'overscrollBehaviorY') : null,
          uiX: ui ? css(ui, 'overscrollBehaviorX') : null,
        };
      });
      check('html overscroll-behavior-y＝none（viewport 層級防下拉重整／回彈）', v.htmlY === 'none', `html=${v.htmlY}`);
      check('html overflow 維持 visible（否則 body 的值不傳給 viewport、也會改變捲動來源）', v.htmlOverflowY === 'visible', `overflow-y=${v.htmlOverflowY}`);
      check('body overscroll-behavior-y 仍是 none（與修前一致）', v.bodyY === 'none', `body=${v.bodyY}`);
      check('頁面外框（.app-main > .legacy-ui）的 Y 軸是 auto（滾輪不被吃掉）', v.uiY === 'auto', `y=${v.uiY}`);
      check('頁面外框的 X 軸維持修前的 none（只改了 Y）', v.uiX === 'none', `x=${v.uiX}`);

      // ── D. 頁面底部餘量（無多餘空白） ──────────────────────────────
      const gap = await page.evaluate(() => {
        const app = document.querySelector('#app');
        const appBottom = app.getBoundingClientRect().bottom + window.scrollY;
        return Math.round(document.documentElement.scrollHeight - appBottom);
      });
      check('#app 底到文件底沒有多餘空白（body 層外框不撐高頁面）', gap <= 2, `餘量 ${gap}px`);
      await context.close();
    }

    // ── B. 桌機滾輪 ─────────────────────────────────────────────────
    for (const [w, h] of [[1280, 720], [1366, 768]]) {
      for (const [route, ready] of [[ACTIVITIES, EVENT_LINK], [PROFILE, '#profile-activity-records']]) {
        const context = await browser.newContext({ viewport: { width: w, height: h } });
        const page = await context.newPage();
        const label = `桌機 ${w}×${h} ${route}`;
        try {
          await signIn(page, base);
          await openReady(page, base, route, ready);
          const start = await scrollRange(page);
          check(`${label} 起點 scrollY＝0 且有足夠捲動範圍（≥150px）`, start.y === 0 && start.range >= 150, `scrollY=${start.y} 範圍=${start.range}`);
          const hit = await hitsContent(page, w / 2, h / 2);
          check(`${label} 游標落在頁面內容上`, hit.ok, hit.why);
          await page.mouse.move(w / 2, h / 2);
          for (let i = 0; i < 5; i += 1) {
            await page.mouse.wheel(0, 100);
            await page.waitForTimeout(100);
          }
          await page.waitForTimeout(400);
          const after = await scrollRange(page);
          check(`${label} 滾輪可捲動`, after.y > start.y, `scrollY ${start.y} → ${after.y}`);

          if (route === PROFILE) {
            const gapProfile = await page.evaluate(() => {
              const content = document.querySelector('#profile-content');
              const last = content?.lastElementChild;
              if (!last) return null;
              const lastBottom = last.getBoundingClientRect().bottom + window.scrollY;
              return Math.round(document.documentElement.scrollHeight - lastBottom);
            });
            check(
              `${label} 最後一張卡到文件底的餘量 ≤ ${MAX_PROFILE_BOTTOM_GAP}px（修前約多一個視窗高）`,
              gapProfile !== null && gapProfile <= MAX_PROFILE_BOTTOM_GAP,
              `餘量 ${gapProfile}px`,
            );
          }
        } catch (err) {
          check(`${label} 頁面就緒`, false, String(err.message).split('\n')[0]);
        }
        await context.close();
      }
    }

    // ── C. 手機觸控 ─────────────────────────────────────────────────
    {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      try {
        await signIn(page, base);
        await openReady(page, base, ACTIVITIES, EVENT_LINK);
        const start = await scrollRange(page);
        check('手機 390×844 /activities 起點 scrollY＝0 且有足夠捲動範圍', start.y === 0 && start.range >= 150, `scrollY=${start.y} 範圍=${start.range}`);
        const hitStart = await hitsContent(page, 195, 640);
        const hitEnd = await hitsContent(page, 195, 240);
        check('手機觸控起點與終點都落在頁面內容上', hitStart.ok && hitEnd.ok, `${hitStart.why}／${hitEnd.why}`);
        const cdp = await context.newCDPSession(page);
        await swipeUp(cdp, 195, 640, 240);
        await page.waitForTimeout(600);
        const after = await scrollRange(page);
        check('手機 390×844 觸控可捲動', after.y > start.y, `scrollY ${start.y} → ${after.y}`);
      } catch (err) {
        check('手機 /activities 頁面就緒', false, String(err.message).split('\n')[0]);
      }
      await context.close();
    }

    // ── E. viewport 層防護代理（iframe）＋對照組 ──────────────────────
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      try {
        await signIn(page, base);
        await page.route(`${base}/__scroll-guard-parent.html`, (route) => route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><body style="margin:0;height:4000px"><iframe id="f" src="${ACTIVITIES}" style="position:absolute;top:0;left:0;width:1280px;height:420px;border:0"></iframe></body>`,
        }));
        await page.goto(`${base}/__scroll-guard-parent.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#f', { timeout: 10000 });
        // 鎖定正確的子 frame（網址是 /activities），等它的活動資料就緒
        const frame = await (async () => {
          const deadline = Date.now() + 15000;
          while (Date.now() < deadline) {
            const found = page.frames().find((f) => f !== page.mainFrame() && new URL(f.url()).pathname === ACTIVITIES);
            if (found) return found;
            await page.waitForTimeout(200);
          }
          return null;
        })();
        if (!frame) throw new Error('找不到 /activities 子 frame');
        await frame.waitForSelector(EVENT_LINK, { state: 'visible', timeout: 30000 });
        await frame.waitForTimeout(800);

        const dims = await frame.evaluate(() => ({
          range: document.documentElement.scrollHeight - window.innerHeight,
          htmlY: getComputedStyle(document.documentElement).overscrollBehaviorY,
        }));
        check('iframe 子頁有足夠捲動範圍（≥150px）', dims.range >= 150, `範圍=${dims.range}`);
        const hit = await hitsContent(frame, 640, 210);
        check('iframe 內游標落在頁面內容上', hit.ok, hit.why);
        const outerHit = await page.evaluate(() => document.elementFromPoint(640, 210)?.id);
        check('父頁在該座標命中的是 iframe 本身', outerHit === 'f', `命中 id=${outerHit}`);

        /** 父頁歸零 → 子頁捲到底（驗證真的到底）→ 繼續滾輪 → 回報父頁 scrollY。 */
        const overscrollWheel = async () => {
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
          await frame.evaluate(() => window.scrollTo({ top: 1e6, behavior: 'instant' }));
          await page.waitForTimeout(1200);
          const atBottom = await frame.evaluate(
            () => Math.abs(window.scrollY - (document.documentElement.scrollHeight - window.innerHeight)) <= 2,
          );
          if (!atBottom) throw new Error('子頁沒有捲到底，無法測邊界行為');
          await page.mouse.move(640, 210);
          for (let i = 0; i < 6; i += 1) {
            await page.mouse.wheel(0, 120);
            await page.waitForTimeout(100);
          }
          await page.waitForTimeout(500);
          return page.evaluate(() => window.scrollY);
        };

        const normal = await overscrollWheel();
        check('子頁捲到底後繼續滾輪，父頁不被帶動（viewport 沒有往外 chain）', normal === 0, `父頁 scrollY=${normal}`);

        await frame.evaluate(() => document.documentElement.style.setProperty('overscroll-behavior-y', 'auto', 'important'));
        const control = await overscrollWheel();
        check('對照組：暫時把根元素設為 auto，父頁必須被帶動（證明測試測得到）', control > 0, `父頁 scrollY=${control}`);

        await frame.evaluate(() => document.documentElement.style.removeProperty('overscroll-behavior-y'));
        const restored = await overscrollWheel();
        check('恢復根元素的 none 後，父頁又不被帶動', restored === 0, `父頁 scrollY=${restored}`);
      } catch (err) {
        check('iframe 滾動鏈代理測試可執行', false, String(err.message).split('\n')[0]);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (err) {
  console.error(`中止：${err.message}`);
  process.exit(2);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 項失敗`);
  process.exit(1);
}
console.log('\n全部通過');
