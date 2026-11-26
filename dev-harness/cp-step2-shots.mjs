#!/usr/bin/env node
// 賽事第 2 步預覽截圖：對已打包的 harness（vite preview）逐畫面、逐寬度、逐主題截圖，
// 並檢查 console 錯誤、橫向溢出與介面文字被動斷行。
// 用法：node dev-harness/cp-step2-shots.mjs <輸出資料夾> [base url，預設 http://localhost:5193] [--screens=a,b] [--sizes=360,1280]
// 新外觀第 4 批與第 3 批留下的狀態：每個畫面都要 360 與 1280；原本只有 390／360，補 1280×800。
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ARGS = process.argv.slice(2);
const FLAGS = Object.fromEntries(ARGS.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '']; }));
const POS = ARGS.filter((a) => !a.startsWith('--'));
const OUT = resolve(POS[0] || 'cp-step2-shots');
const BASE = POS[1] || 'http://localhost:5193';
const ONLY = FLAGS.screens ? new Set(FLAGS.screens.split(',')) : null;
const ONLY_W = FLAGS.sizes ? new Set(FLAGS.sizes.split(',').map(Number)) : null;
const ALL = [[390, 844], [360, 800], [1280, 800]];
const ONE = [[390, 844], [1280, 800]];
const NEW = [[360, 800], [1280, 800]];
// 一定要拍到的文字（整頁截圖時要在頁面上；面板只截可視範圍時要在視窗內）
const ANCHORS = {
  'host-approved-personal': '名單', 'host-locked': '解鎖名單', 'host-edit-open': '編輯賽事資訊', 'host-long': '三重示範青年足球俱樂部隊',
  'host-long-pending': '三重示範青年足球俱樂部隊', 'gate-guest': '登入後才能建立賽事', 'gate-member': '建立賽事尚未開放', 'gate-error': '讀取失敗',
  'host-pending-empty': '目前沒有待審的隊伍', 'host-approved-empty': '目前沒有已核准的隊伍', 'host-rejected-empty': '目前沒有已拒絕的隊伍',
  'host-lock-all': '鎖定後各隊不能再改名單', 'roster-confirmed': '確認名單', 'detail-oneday': '比賽期間',
  'edit-started': '首場已開始，時間不能再改', 'edit-locked': '名單已鎖定，組別只能改名稱', 'edit-denied': '這場賽事目前不能編輯',
  'edit-1-personal': '主辦名稱', 'edit-scheduled': '已排賽程，既有場地不能更改', 'edit-3': '儲存變更', 'edit-entry-manage': '編輯賽事', 'edit-entry-detail': '編輯賽事',
  'roster-member': '登錄名單', 'roster-member-legacy': '登錄名單', 'form-self-legacy': '送出', 'roster-remove': '確定要移除',
  'roster-self': '退出名單', 'roster-self-confirm': '確定要退出', 'roster-self-locked': '名單已鎖定', 'roster-self-started': '林示範', 'roster-self-long': '退出名單', 'roster-rep-self': '退出名單', 'form-already': '你已在本賽事其他隊伍名單', 'form-error': '送出', 'form-custom-pos': '自訂', 'form-ineligible': '只有俱樂部成員可以做這個操作',
};
const THEMES_ALL = ['light', 'dark'];
// [畫面, 寬度組, 主題組, 是否整頁（對話框／底部面板只截可視範圍）]
const SCREENS = [
  ['wizard-1', ALL, THEMES_ALL, true],
  ['wizard-1-club', ONE, THEMES_ALL, true],
  ['wizard-1-error', ONE, ['light'], true],
  ['wizard-2', ALL, THEMES_ALL, true],
  ['wizard-3', ALL, THEMES_ALL, true],
  ['wizard-done', ONE, ['light'], true],
  ['detail-rep', ALL, THEMES_ALL, true],
  ['detail-member', ONE, THEMES_ALL, true],
  ['detail-report', ONE, THEMES_ALL, false],
  ['roster', ALL, THEMES_ALL, true],
  ['roster-ready', ALL, THEMES_ALL, true],
  ['roster-locked', ONE, ['light'], true],
  ['form-self-minor', ALL, THEMES_ALL, true],
  ['form-self-adult', ONE, ['light'], true],
  ['form-rep', ALL, THEMES_ALL, true],
  ['form-rep-adult', ONE, ['light'], true],
  ['form-rep-adult-nick', ONE, ['light'], true],
  ['host-pending', ALL, THEMES_ALL, true],
  ['host-reject', ONE, THEMES_ALL, false],
  ['host-approved', ALL, THEMES_ALL, true],
  ['host-lock', ONE, ['light'], false],
  ['host-rejected', ONE, ['light'], true],
  ['host-unlock', ONE, ['light'], false],
  ['position-measure', [[360, 800]], ['light'], true],
  // 新外觀第 4 批第 7 節「要補」
  ['host-approved-personal', NEW, THEMES_ALL, true],
  ['host-locked', NEW, THEMES_ALL, true],
  ['host-edit-open', NEW, THEMES_ALL, true],
  ['host-long', NEW, THEMES_ALL, true],
  ['host-long-pending', NEW, THEMES_ALL, true],
  ['gate-guest', NEW, THEMES_ALL, true],
  ['gate-member', NEW, THEMES_ALL, true],
  ['gate-error', NEW, THEMES_ALL, true],
  // 第 3 批留下的
  ['roster-member', NEW, THEMES_ALL, true],
  // 俱樂部雙鍵（顧問 §3.846）：成員清單只有自訂 id
  ['roster-member-legacy', ONE, THEMES_ALL, true],
  ['form-self-legacy', ONE, THEMES_ALL, true],
  ['roster-remove', NEW, THEMES_ALL, false],
  ['form-error', NEW, THEMES_ALL, true],
  ['form-custom-pos', NEW, THEMES_ALL, true],
  ['form-ineligible', NEW, THEMES_ALL, true],
  // CP-PO-08 球員本人退出名單
  ['roster-self', ALL, THEMES_ALL, true],
  ['roster-self-confirm', ALL, THEMES_ALL, false],
  ['roster-self-locked', ALL, THEMES_ALL, true],
  ['roster-self-started', ALL, THEMES_ALL, true],
  ['roster-self-long', ALL, THEMES_ALL, true],
  ['roster-rep-self', ALL, THEMES_ALL, true],
  ['form-already', ALL, THEMES_ALL, true],
  // 既有小修（顧問 §3.505）
  ['host-pending-empty', NEW, THEMES_ALL, true],
  ['host-approved-empty', NEW, THEMES_ALL, true],
  ['host-rejected-empty', NEW, THEMES_ALL, true],
  ['host-lock-all', NEW, THEMES_ALL, false],
  ['roster-confirmed', ALL, THEMES_ALL, true],
  ['detail-oneday', NEW, THEMES_ALL, true],
  // 編輯賽事（站長 11-21）：1280 包正式內容容器（?frame=1）
  ['edit-1', NEW, THEMES_ALL, true],
  ['edit-1-personal', NEW, THEMES_ALL, true],
  ['edit-2', NEW, THEMES_ALL, true],
  ['edit-3', NEW, THEMES_ALL, true],
  ['edit-started', NEW, THEMES_ALL, true],
  ['edit-locked', NEW, THEMES_ALL, true],
  ['edit-scheduled', NEW, THEMES_ALL, true],
  ['edit-denied', NEW, THEMES_ALL, true],
  ['edit-entry-manage', NEW, THEMES_ALL, true],
  ['edit-entry-detail', NEW, THEMES_ALL, true],
];
const FRAMED_WIDE = (name, w) => name.startsWith('edit-') && w >= 1280;

const SELECTORS = 'button, .ui-badge, .ui-chip, dt, .cps-line, .cps-li__name, .cps-cap, .cps-kv span, .cps-label, .ui-input label, .ui-checkbox label, .ui-switch label, h1, h2, h3, .cps-stepname span, .cps-stepname b, .ui-stepper label'
  // 新外觀第 4 批：頁首賽事名小字、名單列名字與位置、一句話版面
  + ', .cps-sub, .cps-player__name, .cps-player__pos, .cps-note';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [], wraps: [] };
const copyMap = new Map();
for (const [name, sizes, themes, full] of SCREENS) {
  if (ONLY && !ONLY.has(name)) continue;
  for (const [w, h] of sizes) {
    if (ONLY_W && !ONLY_W.has(w)) continue;
    for (const theme of themes) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      // 只允許本機：任何對外連線（Firestore、Functions、地圖、字型 CDN）一律擋下並記錄，確保預覽不碰正式環境
      await ctx.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
        report.blocked.push(`${name}: ${u.hostname}${u.pathname}`);
        return route.abort();
      });
      const page = await ctx.newPage();
      const tag = `${name}-${w}-${theme}`;
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-step2.html?screen=${name}&theme=${theme}${FRAMED_WIDE(name, w) ? '&frame=1' : ''}`);
      try {
        await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 25000 });
      } catch {
        const st = await page.evaluate(() => ({ err: window.__CPS_ERROR ?? null, txt: document.body.innerText.slice(0, 120) })).catch(() => null);
        report.consoleErrors.push(`${tag}: 未就緒 ${JSON.stringify(st)}`);
        await ctx.close();
        continue;
      }
      await page.evaluate(() => document.fonts.ready);
      if (name === 'host-lock' || name === 'host-lock-all') await page.waitForSelector('.app-confirm, [class*="app-confirm"]');
      await page.waitForTimeout(400);
      for (const c of await page.evaluate(() => window.__CPS_COPY)) copyMap.set(c.key, c);
      const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth));
      if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
      const wraps = await page.evaluate((sel) => {
        const out = [];
        for (const el of document.querySelectorAll(sel)) {
          if (el.closest('.cps-sheet-body p, .cps-privacy, .ui-input small')) continue;
          const r = document.createRange();
          r.selectNodeContents(el);
          const tops = new Set([...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0 && q.height < 40).map((q) => Math.round(q.top / 4)));
          if (tops.size > 1) out.push((el.textContent || '').trim().slice(0, 40));
        }
        return out;
      }, SELECTORS);
      for (const t of wraps) report.wraps.push(`${tag}: ${t}`);
      const anchor = ANCHORS[name];
      if (anchor && !(await page.evaluate(([text, whole]) => {
        const vh = window.innerHeight;
        for (const el of document.querySelectorAll('body *')) {
          if (!(el.textContent || '').includes(text)) continue;
          if ([...el.children].some((c) => (c.textContent || '').includes(text))) continue;
          const r = el.getBoundingClientRect();
          if (r.height > 0 && (whole || (r.bottom > 0 && r.top < vh))) return true;
        }
        return false;
      }, [anchor, full]))) report.consoleErrors.push(`${tag}: 截圖沒拍到「${anchor}」`);
      const ell = await page.evaluate(() => [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis').map((el) => (el.textContent || '').trim().slice(0, 30)));
      for (const t of ell) report.wraps.push(`${tag}: （省略號）${t}`);
      const file = `${tag}.png`;
      await page.screenshot({ path: join(OUT, file), fullPage: full });
      report.shots.push(file);
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'copy.json'), JSON.stringify([...copyMap.values()], null, 2), 'utf8');
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；外部請求 ${report.blocked.length}；溢出 ${report.overflows.length}；斷行／省略 ${report.wraps.length}`);
for (const k of ['consoleErrors', 'blocked', 'overflows', 'wraps']) for (const l of report[k]) console.log(k, l);
