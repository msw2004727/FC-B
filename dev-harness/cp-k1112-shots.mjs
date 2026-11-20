#!/usr/bin/env node
// 賽事第 4 步 K11 邀請記分員、K12 管理員下架與檢舉截圖（由 cp-step4-u4-shots.mjs 簡化）。
// 對已打包的 harness（vite preview）逐畫面、390／360 寬、深淺色截圖；非 localhost 請求一律攔截。
// 檢查 console 錯誤、橫向溢出、介面文字被動斷行、接受頁網址不含代碼、DOM 不含檢舉人 uid。
// 用法：node dev-harness/cp-k1112-shots.mjs <輸出資料夾> [base url，預設 http://localhost:5199] [--screens=a,b] [--sizes=360,1280]
// 新外觀第 1b 批第 7 節：清單補上 harness 早就有的 detail-hidden、detail-report-done、detail-report-guest；
// 第 4 批與第 3 批留下的狀態只拍 360 與 1280。
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ARGS = process.argv.slice(2);
const FLAGS = Object.fromEntries(ARGS.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '']; }));
const POS = ARGS.filter((a) => !a.startsWith('--'));
const OUT = resolve(POS[0] || 'cp-k1112-shots');
const BASE = POS[1] || 'http://localhost:5199';
const ONLY = FLAGS.screens ? new Set(FLAGS.screens.split(',')) : null;
const ONLY_W = FLAGS.sizes ? new Set(FLAGS.sizes.split(',').map(Number)) : null;
const SIZES = [[390, 844], [360, 640], [1280, 800]];
const NEW_SIZES = [[360, 640], [1280, 800]];
const THEMES = ['light', 'dark'];
const SCREENS = [
  'staff-list', 'invite-form', 'invite-link', 'accept-guest', 'accept-signed', 'accept-error', 'detail-admin-reports', 'detail-admin-hide', 'detail-host-hidden',
  'detail-hidden', 'detail-report-done', 'detail-report-guest',
];
// 新外觀第 4 批第 7 節、第 3 批留下的（360 與 1280）
const NEW_SCREENS = [
  'staff-list-rep', 'staff-invites-empty', 'staff-invites-error', 'staff-revoke-confirm', 'detail-admin-hidden',
  'accept-bad-link', 'accept-no-ticket', 'accept-net-error', 'accept-sending', 'accept-long-name',
];
// 一定要拍到的文字（至少一段截圖的視窗內）
const ANCHORS = {
  'detail-hidden': '這場賽事目前不公開', 'detail-report-done': '已收到檢舉', 'detail-report-guest': '請先登入再檢舉',
  'staff-list-rep': '尚未使用的邀請', 'staff-invites-empty': '目前沒有尚未使用的邀請', 'staff-invites-error': '重試', 'staff-revoke-confirm': '撤銷邀請？',
  'detail-admin-hidden': '此賽事已被管理員下架', 'accept-bad-link': '邀請連結無效', 'accept-no-ticket': '找不到邀請資料',
  'accept-net-error': '操作失敗，請稍後再試', 'accept-sending': '接受邀請', 'accept-long-name': '新北市三重區',
};
const CODE = 'AbCdEfGhIjKlMnOpQrStUv';
// 介面標籤（不含使用者內容：賽事名、原因、說明可以換行）
const SELECTORS = '.s4b-staff__meta, .s4b-staff__exp, .s4b-staff__exp-inline, .s4b-role-tag, .s4b-k, .s4b-err, .s4b-foot, .s4b-status, .s4b-day, button, .ui-badge, h1, .cpa-h, .cpa-reason, .cpa-meta > span, .cpa-muted, .ui-checkbox label, .ui-radio label, .ui-input label'
  // 新外觀第 1b 批：一句話版面、檢舉未登入那一句（cps-nowrap）、邀請頁提示
  + ', .cps-note, .s4b-alert';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [], wraps: [], leaks: [], roleTags: [] };
for (const [name, sizes] of [...SCREENS.map((s) => [s, SIZES]), ...NEW_SCREENS.map((s) => [s, NEW_SIZES])]) {
  if (ONLY && !ONLY.has(name)) continue;
  for (const [w, h] of sizes) {
    if (ONLY_W && !ONLY_W.has(w)) continue;
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
      await ctx.route('**/*', (r) => {
        const host = new URL(r.request().url()).hostname;
        if (host === 'localhost' || host === '127.0.0.1') return r.continue();
        if (r.request().url().startsWith('data:')) return r.continue();
        report.blocked.push(r.request().url());
        return r.abort();
      });
      const page = await ctx.newPage();
      const tag = `k1112-${name}-${w}-${theme}`;
      page.on('console', (m) => {
        const text = m.text();
        if (text.includes(CODE)) report.leaks.push(`${tag}: console 含代碼`);
        if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${text}`);
      });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/cp-k1112.html?screen=${name}&theme=${theme}`);
      try {
        await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 25000 });
      } catch {
        const st = await page.evaluate(() => ({ err: window.__CPS_ERROR ?? null, txt: document.body.innerText.slice(0, 120) })).catch(() => null);
        report.consoleErrors.push(`${tag}: 未就緒 ${JSON.stringify(st)}`);
        await ctx.close();
        continue;
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      if (name.startsWith('accept-')) {
        const href = page.url();
        if (href.includes(CODE) || href.includes('#')) report.leaks.push(`${tag}: 網址仍含代碼或 # ${href}`);
        if ((await page.content()).includes(CODE)) report.leaks.push(`${tag}: DOM 含代碼`);
      }
      if ((await page.content()).includes('uid_never_rendered')) report.leaks.push(`${tag}: DOM 含檢舉人 uid`);
      const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth));
      if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
      const cut = await page.evaluate(() => {
        const out = [];
        const vw = document.documentElement.clientWidth;
        for (const el of document.querySelectorAll('button, a, input, select, textarea, .ui-badge, .s4b-inv__url')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.left < -1 || r.right > vw + 1) out.push(`${el.tagName.toLowerCase()}「${(el.textContent || '').trim().slice(0, 12)}」超出視窗 ${Math.round(r.left)}～${Math.round(r.right)}／${vw}`);
        }
        return out;
      });
      for (const t of cut) report.overflows.push(`${tag}: ${t}`);
      const wraps = await page.evaluate((sel) => {
        const out = [];
        for (const el of document.querySelectorAll(sel)) {
          const r = document.createRange();
          r.selectNodeContents(el);
          const tops = new Set([...r.getClientRects()].filter((q) => q.width > 0 && q.height > 0 && q.height < 40).map((q) => Math.round(q.top / 4)));
          if (tops.size > 1) out.push((el.textContent || '').trim().slice(0, 40));
        }
        return out;
      }, SELECTORS);
      for (const t of wraps) report.wraps.push(`${tag}: ${t}`);
      // 顧問 11-20：主辦兼記分的角色標籤實量（寬、高、字寬、是否一行、有無 <wbr>）
      const tags = await page.evaluate(() => [...document.querySelectorAll('.s4b-role-tag')].map((el) => {
        const r = el.getBoundingClientRect();
        const label = el.querySelector('.ui-badge__label');
        const lr = label ? label.getBoundingClientRect() : r;
        const row = el.closest('.s4b-staff');
        const rr = row ? row.getBoundingClientRect() : r;
        return { text: (el.textContent || '').trim(), w: Math.round(r.width), h: Math.round(r.height), labelW: Math.round(lr.width), wbr: el.querySelectorAll('wbr').length, rowW: Math.round(rr.width), rowH: Math.round(rr.height) };
      }));
      for (const t of tags) report.roleTags.push({ tag, ...t });
      const ell = await page.evaluate(() => [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis').map((el) => (el.textContent || '').trim().slice(0, 30)));
      for (const t of ell) report.wraps.push(`${tag}: （省略號）${t}`);
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      const parts = Math.min(3, Math.max(1, Math.ceil((total - 40) / h)));
      let anchorSeen = false;
      for (let i = 0; i < parts; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), i === parts - 1 && i > 0 ? total : i * (h - 80));
        await page.waitForTimeout(150);
        const file = `${tag}${i ? `-p${i + 1}` : ''}.png`;
        await page.screenshot({ path: join(OUT, file), fullPage: false });
        if (ANCHORS[name] && await page.evaluate((text) => {
          const vh = window.innerHeight;
          for (const el of document.querySelectorAll('body *')) {
            if (!(el.textContent || '').includes(text)) continue;
            if ([...el.children].some((c) => (c.textContent || '').includes(text))) continue;
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.bottom > 0 && r.top < vh) return true;
          }
          return false;
        }, ANCHORS[name])) anchorSeen = true;
        report.shots.push(file);
      }
      if (ANCHORS[name] && !anchorSeen) report.consoleErrors.push(`${tag}: 截圖沒拍到「${ANCHORS[name]}」`);
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；攔截 ${report.blocked.length}；溢出 ${report.overflows.length}；斷行／省略 ${report.wraps.length}；外洩 ${report.leaks.length}`);
for (const k of ['consoleErrors', 'blocked', 'overflows', 'wraps', 'leaks']) for (const l of report[k]) console.log(k, l);
