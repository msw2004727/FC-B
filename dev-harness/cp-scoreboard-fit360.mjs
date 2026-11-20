#!/usr/bin/env node
// 記分頁 360×640 量測（新外觀第 2 批卡 2-0；施工-第2批 3.17「驗收用的量法」＋ final-check.md 第 2 節多做的三項）。
// 照設計對話 uiux/fit360.mjs 的量法，但不注入原型樣式與腳本：直接量打包後的示範頁（vite preview）。
//
// 用法：
//   node dev-harness/cp-scoreboard-fit360.mjs <輸出資料夾> [base url，預設 http://127.0.0.1:5296]
//        [--screens=u2-live,score-pk,real:real-forfeit-sheet] [--themes=light,dark] [--size=360x640] [--no-shots]
//   screen 名稱：u2-* / a1-* 走 cp-step4-u2.html（正式頁 ScoringScreen），score-* 走 cp-step4a.html（預覽元件），
//   「real:名稱」走 cp-step3-real.html（只截圖、不是記分頁）。省略 --screens＝全部記分頁狀態。
// 輸出：<輸出資料夾>/fit360-<寬>x<高>.json（每個狀態×主題一筆）與每張截圖 fit-<狀態>-<寬>x<高>-<主題>.png。
// 結束碼：有「違規」（不含已接受的例外）為 1，否則 0。
//
// 量什麼（每個狀態×主題）：
//   - .s4-top / .s4-alerts / .s4-timeout / .s4-feed / .s4-pad / .s4-dock 的上下緣與高
//   - 紀錄區可容列數＝.s4-feed 高 ÷ 列高（有紀錄列用實際列高，沒有用 48）；看得到的列＝整列落在 .s4-feed 與視窗內、中心點點得到
//   - 比分、時鐘（PK 例外）、兩顆進球（PK 是四顆 PK 鈕）、四顆牌、.s4-dock 裡每一顆鈕：整個在視窗內、中心點點得到自己
//   - 頁面不捲動（scrollHeight − innerHeight＝0）、.s4-root 第一層區塊互不重疊也不超出視窗、按鈕互不重疊
// 判準與例外清單在 cp-scoreboard-fit-rules.mjs。
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ACCEPTED_SHORT, PK_SCREENS, ROW_TARGET, rowRule } from './cp-scoreboard-fit-rules.mjs';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.slice(2).split('=');
  return [k, v ?? true];
}));
const pos = args.filter((a) => !a.startsWith('--'));
const OUT = resolve(pos[0] || 'cp-scoreboard-fit360');
const BASE = pos[1] || 'http://127.0.0.1:5296';
const [VW, VH] = String(flags.size || '360x640').split('x').map(Number);
const THEMES = String(flags.themes || 'light,dark').split(',');
const SHOTS = !flags['no-shots'];

/** 全部記分頁狀態（正式頁＋預覽元件）。 */
export const U2_ALL = [
  'u2-pre', 'u2-pre-wake-off', 'u2-live', 'u2-pending', 'u2-pk-confirm', 'u2-pk-live', 'u2-pk-goal-locked',
  'u2-timeout-stop', 'u2-timeout-collapsed', 'u2-crowded', 'u2-reader-tab', 'u2-reader-cap', 'u2-near-cap',
  'u2-no-permission', 'u2-no-permission-host', 'u2-load-failed-network', 'u2-load-failed-error',
  'u2-storage-unavailable', 'u2-long-name', 'u2-long-6', 'u2-long-7', 'u2-long-10', 'u2-long-11', 'u2-long-13', 'u2-long-similar',
  'u2-fulltime-undo', 'u2-fulltime-undo-blocked', 'u2-menu', 'u2-timeout-sheet', 'u2-amend-card',
  'a1-held', 'a1-held-many', 'a1-held-sheet', 'a1-held-offline', 'a1-held-pause-reserved', 'a1-held-timeout', 'a1-held-timeout-collapsed',
  'a1-blocked-ht', 'a1-blocked-ht-before', 'a1-resumed', 'a1-pk-blocked', 'a1-pk-confirm-wait', 'a1-pk-confirm-armed',
  'a1-kickoff-confirm', 'a1-takeover-confirm', 'a1-showcard', 'a1-undo-confirm', 'a1-amend-confirm',
];
export const S4A_ALL = [
  'score-pre', 'score-live', 'score-pick-player', 'score-pick-player-long', 'score-card-yellow', 'score-card-red-auto',
  'score-halftime', 'score-fulltime-undo', 'score-unapplied', 'score-takeover', 'score-offline', 'score-paused',
  'score-amend', 'score-cap', 'score-pause-reserved', 'score-undo-half', 'score-timeout', 'score-timeout-collapsed',
  'score-pk-start', 'score-pk',
];

const screens = flags.screens ? String(flags.screens).split(',') : [...U2_ALL, ...S4A_ALL];

function pageOf(screen) {
  if (screen.startsWith('real:')) return { html: 'cp-step3-real.html', name: screen.slice(5), board: false };
  if (screen.startsWith('score-')) return { html: 'cp-step4a.html', name: screen, board: true };
  return { html: 'cp-step4-u2.html', name: screen, board: true };
}

/** 在頁面裡量。參數只有 PK 與否；判違規在外面做。 */
function measureInPage(pk) {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const r1 = (n) => Math.round(n * 10) / 10;
  const boxOf = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r1(r.top), bottom: r1(r.bottom), h: r1(r.height) };
  };
  const label = (el) => ((el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 24);
  /** 整個在視窗內、中心點點得到自己（或自己的子元素）。 */
  const reach = (el) => {
    if (!el) return { ok: false, why: '不存在' };
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false, why: '大小為 0' };
    if (r.top < -0.5 || r.left < -0.5 || r.bottom > vh + 0.5 || r.right > vw + 0.5) {
      return { ok: false, why: `超出視窗 ${r1(r.left)},${r1(r.top)}～${r1(r.right)},${r1(r.bottom)}` };
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === el || el.contains(hit))) {
      const who = hit ? `${hit.tagName.toLowerCase()}.${String(hit.className || '').split(' ')[0]}` : '無';
      return { ok: false, why: `中心點被 ${who} 蓋住` };
    }
    return { ok: true };
  };
  const root = document.querySelector('.s4-root');
  const scroll = Math.round(document.documentElement.scrollHeight - vh);
  if (!root) {
    const card = document.querySelector('.cps-root, .cps-frame, main') || document.body;
    return { board: false, vh, vw, scroll, card: boxOf(card) };
  }
  const feed = root.querySelector('.s4-feed');
  const fr = feed ? feed.getBoundingClientRect() : null;
  const evs = [...root.querySelectorAll('.s4-feed .s4-ev')];
  const rowH = evs.length ? r1(evs[0].getBoundingClientRect().height) : 48;
  const visibleRows = evs.filter((e) => {
    const r = e.getBoundingClientRect();
    if (!fr || r.height < 1) return false;
    if (r.top < fr.top - 0.5 || r.bottom > fr.bottom + 0.5 || r.top < -0.5 || r.bottom > vh + 0.5) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === e || e.contains(hit));
  }).length;
  const need = [];
  const push = (kind, el) => {
    const res = reach(el);
    need.push({ kind, label: el ? label(el) : '', ok: res.ok, why: res.why ?? null });
  };
  push('比分', root.querySelector('.s4-top .s4-score'));
  if (!pk) push('時鐘', root.querySelector('.s4-top .s4-clock'));
  const goals = pk
    ? [...root.querySelectorAll('.s4-goals .s4-hit')]
    : [...root.querySelectorAll('.s4-goals .s4-hit--goal')];
  const goalWant = pk ? 4 : 2;
  goals.forEach((el) => push(pk ? 'PK 鈕' : '進球', el));
  const cards = [...root.querySelectorAll('.s4-cards .s4-hit--card')];
  cards.forEach((el) => push('牌', el));
  const dockBtns = [...root.querySelectorAll('.s4-dock button')].filter((el) => el.getBoundingClientRect().width > 0);
  dockBtns.forEach((el) => push('控制列', el));

  // 第一層區塊（.s4-root 的直接子元素，排除 fixed 的面板）
  const blocks = [...root.children].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && getComputedStyle(el).position !== 'fixed';
  }).map((el) => ({ name: String(el.className || el.tagName).split(' ')[0], r: el.getBoundingClientRect() }));
  const blockOverlaps = [];
  const outOfView = [];
  for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i];
    if (a.r.bottom > vh + 0.5) outOfView.push(`${a.name} 下緣 ${r1(a.r.bottom)}>${vh}`);
    for (let j = i + 1; j < blocks.length; j++) {
      const b = blocks[j];
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      if (oy > 0.5 && ox > 0.5) blockOverlaps.push(`${a.name}×${b.name} ${r1(oy)}px`);
    }
  }
  // 按鈕互不重疊（不算祖先／子孫；捲出紀錄區看不到的列不算）
  const btns = [...root.querySelectorAll('button')].filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (el.closest('.s4-feed') && fr && (r.bottom <= fr.top || r.top >= fr.bottom)) return false;
    return true;
  });
  // 紀錄區是捲動容器：裡面的鈕只算露在紀錄區內的那一段（半截列被裁掉的部分不會蓋到下面的鈕）。
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (!fr || !el.closest('.s4-feed')) return r;
    return { left: r.left, right: r.right, top: Math.max(r.top, fr.top), bottom: Math.min(r.bottom, fr.bottom) };
  };
  const btnOverlaps = [];
  for (let i = 0; i < btns.length; i++) {
    for (let j = i + 1; j < btns.length; j++) {
      const a = btns[i];
      const b = btns[j];
      if (a.contains(b) || b.contains(a)) continue;
      const p = shown(a);
      const q = shown(b);
      const oy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
      const ox = Math.min(p.right, q.right) - Math.max(p.left, q.left);
      if (oy > 1 && ox > 1) btnOverlaps.push(`「${label(a)}」×「${label(b)}」${r1(ox)}×${r1(oy)}`);
    }
  }
  const feedBox = boxOf(feed);
  return {
    board: true,
    vh,
    vw,
    scroll,
    top: boxOf(root.querySelector('.s4-top')),
    alerts: boxOf(root.querySelector('.s4-alerts')),
    alertLines: [...root.querySelectorAll('.s4-alerts > *')].map((el) => `${String(el.className).replace(/\s+/g, '.')}｜${label(el)}`),
    timeout: boxOf(root.querySelector('.s4-timeout')),
    feed: feedBox,
    pad: boxOf(root.querySelector('.s4-pad')),
    dock: boxOf(root.querySelector('.s4-dock')),
    rowH,
    rows: feedBox ? Math.round((feedBox.h / rowH) * 100) / 100 : 0,
    events: evs.length,
    visibleRows,
    goals: `${goals.length}/${goalWant}`,
    cards: `${cards.length}/4`,
    dockButtons: dockBtns.map(label),
    need,
    blockOverlaps,
    outOfView,
    btnOverlaps,
  };
}

/** 依判準整理違規與已接受的例外。 */
function judge(screen, m) {
  const violations = [];
  const accepted = [];
  const notes = [];
  if (m.scroll > 0) violations.push(`頁面會捲動 ${m.scroll}px`);
  if (!m.board) return { violations, accepted, notes: ['沒有記分板'] };
  const rule = rowRule(screen);
  if (!rule.check) {
    notes.push(rule.reason);
    return { violations, accepted, notes };
  }
  const pk = PK_SCREENS.has(screen);
  const [gotGoals, wantGoals] = m.goals.split('/').map(Number);
  if (gotGoals !== wantGoals) violations.push(`${pk ? 'PK 鈕' : '進球'}應有 ${wantGoals} 顆，實際 ${gotGoals}`);
  if (m.cards !== '4/4') violations.push(`牌應有 4 顆，實際 ${m.cards.split('/')[0]}`);
  if (m.dockButtons.length < 1) violations.push('控制列沒有按鈕');
  for (const n of m.need) if (!n.ok) violations.push(`${n.kind}「${n.label}」${n.why}`);
  for (const t of m.blockOverlaps) violations.push(`區塊重疊 ${t}`);
  for (const t of m.outOfView) violations.push(`區塊超出視窗 ${t}`);
  for (const t of m.btnOverlaps) violations.push(`按鈕重疊 ${t}`);
  if (m.rows < ROW_TARGET) {
    const text = `紀錄區 ${m.feed?.h ?? 0}px＝${m.rows} 列（< ${ROW_TARGET}）`;
    if (ACCEPTED_SHORT[screen]) accepted.push(`${text}；${ACCEPTED_SHORT[screen]}`);
    else violations.push(text);
  }
  if (pk) notes.push('PK：不量時鐘，量四顆 PK 鈕');
  return { violations, accepted, notes };
}

const browser = await chromium.launch({ args: ['--noerrdialogs'] });
await mkdir(OUT, { recursive: true });
const results = [];
for (const screen of screens) {
  const { html, name, board } = pageOf(screen);
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2 });
    // 只放行本機；其他一律擋掉並記下來。
    const blocked = [];
    await ctx.route((u) => !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname), (r) => {
      blocked.push(r.request().url());
      return r.abort();
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
    await page.goto(`${BASE}/dev-harness/${html}?screen=${name}&theme=${theme}`);
    const row = { screen, theme, size: `${VW}x${VH}` };
    try {
      await page.waitForFunction(() => window.__CPS_READY === true, null, { timeout: 25000 });
    } catch {
      row.error = await page.evaluate(() => window.__CPS_ERROR ?? '未就緒').catch(() => '未就緒');
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    if (!row.error && board) {
      row.m = await page.evaluate(measureInPage, PK_SCREENS.has(screen));
      Object.assign(row, judge(screen, row.m));
    } else if (!row.error) {
      row.m = { board: false, scroll: await page.evaluate(() => Math.round(document.documentElement.scrollHeight - window.innerHeight)) };
      row.violations = [];
      row.accepted = [];
      row.notes = ['非記分頁，只截圖'];
    } else {
      row.violations = [`未就緒：${row.error}`];
      row.accepted = [];
      row.notes = [];
    }
    if (errors.length) row.consoleErrors = errors;
    if (blocked.length) row.blocked = blocked;
    if (SHOTS) {
      const file = `fit-${screen.replace(':', '-')}-${VW}x${VH}-${theme}.png`;
      await page.screenshot({ path: join(OUT, file), fullPage: false });
      row.shot = file;
    }
    results.push(row);
    await ctx.close();
  }
}
await browser.close();
const report = {
  tool: 'dev-harness/cp-scoreboard-fit360.mjs',
  base: BASE,
  size: `${VW}x${VH}`,
  rowTarget: ROW_TARGET,
  at: new Date().toISOString(),
  results,
};
const file = join(OUT, `fit360-${VW}x${VH}.json`);
await writeFile(file, JSON.stringify(report, null, 2), 'utf8');

let bad = 0;
for (const r of results) {
  const m = r.m || {};
  const head = m.board
    ? `feed ${m.feed?.top}～${m.feed?.bottom} h${m.feed?.h} 列${m.rows} 看得到${m.visibleRows}/${m.events} 捲${m.scroll}`
    : `無記分板 捲${m.scroll ?? '?'}`;
  const tail = [
    r.violations.length ? `違規 ${r.violations.join('；')}` : '',
    r.accepted.length ? `已接受 ${r.accepted.length}` : '',
    r.consoleErrors ? `console ${r.consoleErrors.length}` : '',
    r.blocked ? `擋外部 ${r.blocked.length}` : '',
  ].filter(Boolean).join(' ｜ ');
  if (r.violations.length) bad += 1;
  console.log(`${r.screen.padEnd(28)} ${r.theme.padEnd(5)} ${head}${tail ? ` ｜ ${tail}` : ''}`);
}
console.log(`共 ${results.length} 筆；有違規 ${bad} 筆；報告 ${file}`);
process.exitCode = bad > 0 ? 1 : 0;
