#!/usr/bin/env node
// 賽事第 3 步預覽截圖：對已打包的 harness（vite preview）逐畫面、逐寬度、逐主題截圖（固定視窗高度，不截整頁；
// 內容超過一個視窗時再往下捲、補截後續分段），並檢查 console 錯誤、橫向溢出與介面文字被動斷行。
// 用法：node dev-harness/cp-step3-real-shots.mjs <輸出資料夾> [base url，預設 http://localhost:5194] [--screens=a,b] [--sizes=360,1280]
//   --screens 只拍這幾個畫面（名稱不含「real:」）；--sizes 只拍這幾種寬度。非本機請求一律擋下並記在 report.blocked。
// 新外觀第 1b／4 批（施工-第1b批、第4批第 7 節）：每個畫面都要 360 與 1280；原本只有 390／360，補 1280×800。
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ARGS = process.argv.slice(2);
const FLAGS = Object.fromEntries(ARGS.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '']; }));
const POS = ARGS.filter((a) => !a.startsWith('--'));
const OUT = resolve(POS[0] || 'cp-step3-shots');
const BASE = POS[1] || 'http://localhost:5194';
const ONLY = FLAGS.screens ? new Set(FLAGS.screens.split(',')) : null;
const ONLY_W = FLAGS.sizes ? new Set(FLAGS.sizes.split(',').map(Number)) : null;
const ALL = [[390, 844], [360, 780], [1280, 800]];
const ONE = [[390, 844], [1280, 800]];
// 新外觀第 1b／4 批補的狀態：規格只要 360 與 1280。
const NEW = [[360, 780], [1280, 800]];
const THEMES = ['light', 'dark'];
// [畫面, 寬度組, 主題組, 是否可往下補截（面板／對話框不補）]
// 每個畫面必須拍到的文字（至少一段截圖的視窗內要看得到），避免分段圖拍到別處（顧問 §3.294 P2-2）
const ANCHORS = {
  'list-in': '建立賽事', 'real-warm': '距開賽', 'real-live': '下一場', 'real-live-stand': '雷霆隊',
  'real-host-matches': '登錄比分', 'real-score-sheet': '登錄並確認', 'real-reschedule-clash': '仍要改期',
  'real-tie-panel': '名次排列', 'real-end-dialog': '還有同分尚未裁定', 'real-cancel-sheet': '取消原因會公開',
  'real-recruit': '報名期間', 'real-done': '18:00', 'real-ended-host': '剩餘場次不再進行', 'real-postponed': '場地整修',
  'real-cancelled-comp': '報名隊伍不足', 'real-notices': '領隊會議', 'real-contact-club': '聯絡主辦',
  'real-contact-personal': '賽前到集合點找王示範', 'real-contact-personal-empty': '個人主辦（未留聯絡）',
  'real-long-overnight': '隔日 01:30', 'real-long-division': '五、六年級生限定', 'real-ended-long-reason': '敬請見諒', 'real-notice-long': '各隊領隊請注意', 'real-host-schedule': '每場分鐘數', 'real-shift-day': '順延', 'real-wizard-personal': '賽事名稱',
  // 卡 2-0（施工-第2批 3.25、3.27）
  'real-forfeit-sheet': '確認棄權', 'real-reset-dialog': '重置後比分歸零', 'real-clear-schedule': '確定要清除',
  'real-tie-exists': '已有裁定，請先撤銷原本的裁定', 'real-tie-decision': '撤銷裁定',
  // 新外觀第 1b 批第 7 節
  'real-live-twin-next': '綠洲隊', 'real-live-no-today': '晨光隊', 'real-warm-no-schedule': '距開賽',
  'real-recruit-nodiv': '報名期間', 'real-done-five': '第一級別組', 'real-done-nochamp': '已結束',
  'real-done-pending': '冠軍待主辦裁定', 'real-long': '三重示範青年足球俱樂部隊', 'real-long-recruit': '三重區示範運動公園第一足球場',
  'real-draft-host': '發布', 'real-scorer': '我的場次', 'real-admin-menu': '下架', 'real-club-entry-one': '送出報名',
  'real-club-entry-two': '送出報名', 'real-club-entry-error': '還有必填項目沒填', 'real-notice-delete': '確定要刪除這則公告？',
  'real-notice-delete-sys': '這是系統公告，確定要刪除？', 'real-load-failed': '讀取失敗', 'real-crest-live': '雷霆隊', 'real-crest-colors': '隊徽底色', 'real-reschedule-tbd': '確認改期', 'real-tie-overlimit': '裁定原因', 'real-cancel-overlimit': '取消原因會公開', 'real-done-scorers': '射手榜', 'real-notices-more': '更多', 'real-tie-skip': '銀河隊', 'real-wizard-two-venues': '新增場地', 'real-corrected-pk': '藍鯨隊',
  // 新外觀第 4 批第 7 節
  'real-swap-open': '確認對調', 'real-shift-clash': '仍要順延', 'real-shift-clash-settled': '仍要順延', 'real-pending-fresh': '登錄比分', 'real-host-matches-empty': '請先排賽程',
  'real-schedule-preview': '共 12 場、需 2 天、每隊 3 場', 'real-schedule-unplaced': '還有 4 場排不下', 'real-schedule-too-many': '場次太多，請調整賽制',
  'real-schedule-replace': '清除賽程',
  // 卡 2-5 補、頁首賽事名小字（設計總監 03:38／03:52）
  'real-tie-ranked': '對戰積分', 'real-tie-four': '赤焰隊', 'real-tie-three': '公平競賽', 'real-tie-three-h2h': '青鳥隊', 'real-notice-compose': '取消', 'real-gate-two': '登入後才能記分', 'real-ctx-short': '三重春季盃', 'real-ctx-long': '賽程管理',
};
const SCREENS = [
  ['real:list-in', ALL, THEMES, true],
  ['real:real-warm', ALL, THEMES, true],
  ['real:real-live', ALL, THEMES, true],
  ['real:real-live-stand', ALL, THEMES, true],
  ['real:real-host-matches', ALL, THEMES, true],
  ['real:real-score-sheet', ALL, THEMES, false],
  ['real:real-reschedule-clash', ALL, THEMES, false],
  ['real:real-tie-panel', ALL, THEMES, true],
  ['real:real-end-dialog', ALL, THEMES, false],
  ['real:real-cancel-sheet', ALL, THEMES, false],
  ['real:real-recruit', ONE, THEMES, true],
  ['real:real-done', ONE, THEMES, true],
  ['real:real-ended-host', ONE, THEMES, true],
  ['real:real-postponed', ONE, THEMES, true],
  ['real:real-cancelled-comp', ONE, THEMES, true],
  ['real:real-notices', ONE, THEMES, true],
  ['real:real-contact-club', ONE, THEMES, true],
  ['real:real-contact-personal', ONE, THEMES, true],
  ['real:real-contact-personal-empty', NEW, THEMES, true],
  ['real:real-long-overnight', NEW, THEMES, true],
  ['real:real-long-division', NEW, THEMES, true],
  ['real:real-ended-long-reason', NEW, THEMES, true],
  ['real:real-notice-long', NEW, THEMES, true],
  ['real:real-host-schedule', ONE, THEMES, true],
  ['real:real-shift-day', ONE, THEMES, true],
  ['real:real-wizard-personal', ONE, THEMES, true],
  ['real:real-forfeit-sheet', ALL, THEMES, false],
  ['real:real-reset-dialog', ALL, THEMES, false],
  ['real:real-clear-schedule', ALL, THEMES, false],
  ['real:real-tie-exists', ALL, THEMES, true],
  ['real:real-tie-decision', ALL, THEMES, true],
  // 新外觀第 1b 批第 7 節「要補示範狀態」
  ['real:real-live-twin-next', NEW, THEMES, true],
  ['real:real-live-no-today', NEW, THEMES, true],
  ['real:real-warm-no-schedule', NEW, THEMES, true],
  ['real:real-recruit-nodiv', NEW, THEMES, true],
  ['real:real-done-five', NEW, THEMES, true],
  ['real:real-done-nochamp', NEW, THEMES, true],
  ['real:real-done-pending', NEW, THEMES, true],
  ['real:real-long', NEW, THEMES, true],
  ['real:real-long-recruit', NEW, THEMES, true],
  ['real:real-draft-host', NEW, THEMES, true],
  ['real:real-scorer', NEW, THEMES, true],
  ['real:real-admin-menu', NEW, THEMES, false],
  ['real:real-club-entry-one', NEW, THEMES, false],
  ['real:real-club-entry-two', NEW, THEMES, false],
  ['real:real-club-entry-error', NEW, THEMES, false],
  ['real:real-notice-delete', NEW, THEMES, false],
  ['real:real-notice-delete-sys', NEW, THEMES, false],
  ['real:real-load-failed', NEW, THEMES, false],
  ['real:real-crest-live', NEW, THEMES, true],
  ['real:real-crest-colors', NEW, THEMES, true],
  // 總收尾示範缺口
  ['real:real-reschedule-tbd', NEW, THEMES, false],
  ['real:real-tie-overlimit', NEW, THEMES, true],
  ['real:real-cancel-overlimit', NEW, THEMES, false],
  ['real:real-done-scorers', NEW, THEMES, true],
  ['real:real-notices-more', NEW, THEMES, true],
  ['real:real-tie-skip', NEW, THEMES, true],
  ['real:real-wizard-two-venues', NEW, THEMES, true],
  ['real:real-corrected-pk', NEW, THEMES, true],
  // 新外觀第 4 批第 7 節「要補」
  ['real:real-swap-open', NEW, THEMES, true],
  ['real:real-shift-clash', NEW, THEMES, true],
  ['real:real-shift-clash-settled', NEW, THEMES, true],
  ['real:real-pending-fresh', NEW, THEMES, true],
  ['real:real-host-matches-empty', NEW, THEMES, false],
  ['real:real-host-matches-denied', NEW, THEMES, false],
  ['real:real-schedule-preview', NEW, THEMES, true],
  ['real:real-schedule-unplaced', NEW, THEMES, true],
  ['real:real-schedule-too-many', NEW, THEMES, true],
  ['real:real-schedule-replace', NEW, THEMES, true],
  // 卡 2-5 補、頁首賽事名小字（設計總監 03:38／03:52）；1280 加外框另見 cp-tie-ctx-shots.mjs
  ['real:real-tie-ranked', NEW, THEMES, true],
  ['real:real-tie-four', NEW, THEMES, true],
  ['real:real-tie-three', NEW, THEMES, true],
  ['real:real-tie-three-h2h', NEW, THEMES, true],
  ['real:real-notice-compose', NEW, THEMES, true],
  ['real:real-gate-two', NEW, THEMES, false],
  ['real:real-ctx-short', NEW, THEMES, false],
  ['real:real-ctx-long', NEW, THEMES, false],
];

const SELECTORS = '.cpm-drag__n, .cpm-drag__li > *, .cpl-src button, .cpl-select, .cpl-st, .tc-chip, .tc-tab, .cpl-line, .tc-card-name, .tc-card-dates, button, .ui-badge, .ui-chip, dt, .cp3-name, .cp3-meta, .cp3-strip__txt, .cp3-day, .cp3-m__when, .cp3-m__vs span, .cp3-st__r > *, .cp3-champ span, .cp3-fold span, .cp3-result, .cp3-result--bad, .cp3-judge, .cp3-sec-h, .cp3-ctx, .cp3-score__name, .cp3-modal-p, .ui-input label, .ui-checkbox label, .ui-radio label, h1, h2, h3, .cps-sub'
  // 新外觀第 1b／4 批：對調兩句結果（不折行）、冠軍每一行、右上選單、公告時間、名單隊名、組別卡說明
  + ', .cpm-swap, .cp3-champ__k, .cp3-champ__v, .cps-menu [role="menuitem"], .cpm-ann__time, .cps-li__name, .cps-cap, .cpm-preview';

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const report = { shots: [], consoleErrors: [], blocked: [], overflows: [], wraps: [] };
const copyMap = new Map();
for (const [full, sizes, themes, scrollMore] of SCREENS) {
  const [kind, name] = full.split(':');
  if (ONLY && !ONLY.has(name)) continue;
  for (const [w, h] of sizes) {
    if (ONLY_W && !ONLY_W.has(w)) continue;
    for (const theme of themes) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
      const tag = `${kind}-${name}-${w}-${theme}`;
      // 只放行本機：Firestore、Functions、地圖、字型 CDN 一律擋下並記錄
      await ctx.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
        report.blocked.push(`${tag}: ${u.hostname}${u.pathname}`);
        return route.abort();
      });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${tag}: ${m.text()}`); });
      page.on('pageerror', (e) => report.consoleErrors.push(`${tag}: pageerror ${e.message}`));
      await page.goto(`${BASE}/dev-harness/${kind === 'list' ? 'cp-step3-list' : 'cp-step3-real'}.html?screen=${name}&theme=${theme}`);
      try {
        await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 25000 });
      } catch {
        const st = await page.evaluate(() => ({ err: window.__CPS_ERROR ?? null, txt: document.body.innerText.slice(0, 120) })).catch(() => null);
        report.consoleErrors.push(`${tag}: 未就緒 ${JSON.stringify(st)}`);
        await ctx.close();
        continue;
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      for (const c of await page.evaluate(() => window.__CPS_COPY)) copyMap.set(c.key, c);
      const wide = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth));
      if (wide > 0) report.overflows.push(`${tag}: 橫向溢出 ${wide}px`);
      // 區塊內部溢出（被 overflow:hidden 吃掉的內容）也要抓
      const clipped = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.cp3-st__r, .cp3-m__vs, .cp3-score, .cp3-m__act, .cps-footer, .cp3-stack-btns, .cp3-strip, .cp3-row, .cps-grid2')) {
          if (el.scrollWidth - el.clientWidth > 1) out.push(`${el.className} ${el.scrollWidth}>${el.clientWidth}`);
        }
        return out;
      });
      for (const t of clipped) report.overflows.push(`${tag}: 容器內溢出 ${t}`);
      // 顧問 §3.294：被 overflow:hidden／clip 祖先裁掉的元素不會讓頁面變寬，要逐元素比對邊界才抓得到
      const cut = await page.evaluate(() => {
        const out = [];
        const vw = document.documentElement.clientWidth;
        for (const el of document.querySelectorAll('button, a, input, select, textarea, .ui-badge, .cp3-crest, .cp3-tn em, .cp3-judge')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (getComputedStyle(el).visibility === 'hidden') continue;
          const name = `${el.tagName.toLowerCase()}「${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12)}」`;
          if (r.left < -1 || r.right > vw + 1) out.push(`${name} 超出視窗 ${Math.round(r.left)}～${Math.round(r.right)}／${vw}`);
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'visible') continue;
            const q = p.getBoundingClientRect();
            // 橫向捲動區（頁籤列等）本來就可捲，不算裁切
            if (ox === 'auto' || ox === 'scroll') break;
            if (r.left < q.left - 1 || r.right > q.right + 1) out.push(`${name} 被 ${p.className || p.tagName} 裁掉 ${Math.round(Math.max(q.left - r.left, r.right - q.right))}px`);
            break;
          }
        }
        return out;
      });
      for (const t of cut) report.overflows.push(`${tag}: 元素被裁 ${t}`);
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
      // 被省略號截掉的文字（預期只有長隊名）
      const ell = await page.evaluate(() => [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis').map((el) => (el.textContent || '').trim().slice(0, 30)));
      for (const t of ell) report.wraps.push(`${tag}: （省略號）${t}`);
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      const parts = scrollMore ? Math.min(4, Math.max(1, Math.ceil((total - 40) / h))) : 1;
      let anchorSeen = false;
      for (let i = 0; i < parts; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), i === parts - 1 && i > 0 ? total : i * (h - 80));
        await page.waitForTimeout(150);
        const file = `${tag}${i ? `-p${i + 1}` : ''}.png`;
        await page.screenshot({ path: join(OUT, file), fullPage: false });
        const anchor = ANCHORS[name];
        if (anchor && await page.evaluate((text) => {
          const vh = window.innerHeight;
          // 找含這段文字的最深元素（子元素都不含），看它有沒有在視窗內
          for (const el of document.querySelectorAll('body *')) {
            if (!(el.textContent || '').includes(text)) continue;
            if ([...el.children].some((c) => (c.textContent || '').includes(text))) continue;
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.bottom > 0 && r.top < vh) return true;
          }
          return false;
        }, anchor)) anchorSeen = true;
        report.shots.push(file);
      }
      if (ANCHORS[name] && !anchorSeen) report.consoleErrors.push(`${tag}: 截圖沒拍到「${ANCHORS[name]}」`);
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(join(OUT, 'copy.json'), JSON.stringify([...copyMap.values()], null, 2), 'utf8');
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`截圖 ${report.shots.length} 張；console 錯誤 ${report.consoleErrors.length}；外部請求 ${report.blocked.length}；溢出 ${report.overflows.length}；斷行／省略 ${report.wraps.length}`);
for (const k of ['consoleErrors', 'blocked', 'overflows', 'wraps']) for (const l of report[k]) console.log(k, l);
