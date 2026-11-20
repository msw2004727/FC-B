#!/usr/bin/env node
// 第 4 步 A（顧問 11-20 第 2 點）真瀏覽器實測：正式站同款持久化快取＋IndexedDB 日誌，對 Firestore 模擬器（8402、demo-cp-u1）。
// 離線記一球 → 重新整理（仍離線）→ 另一台接手 → 恢復連線，確認原頁面出現被拒（takenOver）、伺服器 0:0、不會默默當成已送出。
// 「離線」用 Playwright 擋掉往 127.0.0.1:8402 的請求（頁面資源仍可從 vite 載入，才能重新整理）。
// 必須在 firebase emulators:exec 底下跑（見 C:/t/fc-cp4/bin 的腳本）：
//   ... emulators:exec ... "node dev-harness/cp-step4-a1-persist.mjs <輸出資料夾>"
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const OUT = resolve(process.argv[2] || 'cp-step4-a1-persist');
const HOST = '127.0.0.1';
const PORT = 8402;
const PROJECT = 'demo-cp-u1';
const DB = '(default)';
const CID = 'comp-u1';
const MT = 'mt-u1';
const UID = 'scorer-u1';
const SID = 'emu-local-sid-0000000001';
const RULES_TARGET = 'emulator/firestore.rules';
const VITE_PORT = 5199;

const root = (path) => `http://${HOST}:${PORT}/v1/projects/${PROJECT}/databases/${DB}/documents/${path}`;
function enc(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
}
function dec(v) {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, dec(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(dec);
  return v.timestampValue ?? v.doubleValue;
}
async function rest(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer owner', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text() };
}
async function create(col, id, data) {
  const r = await rest('POST', `${root(col)}?documentId=${encodeURIComponent(id)}`, { fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) });
  if (r.status >= 300) throw new Error(`建立 ${col}/${id} 失敗 ${r.status} ${r.text.slice(0, 200)}`);
}
async function patch(path, data) {
  const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${k}`).join('&');
  const r = await rest('PATCH', `${root(path)}?${mask}`, { fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) });
  if (r.status >= 300) throw new Error(`更新 ${path} 失敗 ${r.status} ${r.text.slice(0, 200)}`);
}
async function read(path) {
  const r = await rest('GET', root(path));
  if (r.status === 404) return null;
  const body = JSON.parse(r.text);
  return Object.fromEntries(Object.entries(body.fields ?? {}).map(([k, v]) => [k, dec(v)]));
}
async function list(path) {
  const r = await rest('GET', `${root(path)}?pageSize=300`);
  const body = JSON.parse(r.text);
  return (body.documents ?? []).map((d) => Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, dec(v)])));
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(label, pred, ms = 60000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await pred()) return Date.now() - start;
    await pause(200);
  }
  throw new Error(`逾時：${label}`);
}

const report = { steps: [], ok: false };
const step = (name, data) => { report.steps.push({ t: new Date().toISOString(), name, ...(data ?? {}) }); console.log(`[persist] ${name}`, data ? JSON.stringify(data) : ''); };

await mkdir(OUT, { recursive: true });
const backup = await readFile(RULES_TARGET);
const snapshot = await readFile('emulator/asia-main.rules');
if (createHash('sha256').update(snapshot).digest('hex').slice(0, 16) !== '99a8cafef181e8e0') throw new Error('asia-main.rules 雜湊不符');
let server = null;
let browser = null;
try {
  await writeFile(RULES_TARGET, snapshot);
  await rest('DELETE', `http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT}/databases/${DB}/documents`);
  await create('competitions', CID, { status: 'published', hidden: false, visibility: 'public', hostType: 'personal' });
  await create(`competitions/${CID}/staff`, UID, { roles: ['scorer'], matchIds: [MT], expiresAt: null });
  await create(`competitions/${CID}/matches`, MT, {
    status: 'live', rev: 0, resetRev: 0, lock: { locked: false }, score: { home: 0, away: 0 },
    clockBase: { startedAt: null, pausedSec: 0, running: true, period: 'h1' }, finishedAt: null, divisionId: 'dv1',
    home: { teamId: 'en_h', name: '主隊' }, away: { teamId: 'en_a', name: '客隊' },
  });
  await create(`competitions/${CID}/matches/${MT}/control`, 'scorer', { uid: UID, sid: SID });
  await until('規則生效', async () => (await fetch(root(`competitions/${CID}/matches/${MT}`))).status === 200, 15000);
  step('已播種、規則生效');

  server = await createServer({ configFile: 'dev-harness/vite.harness.config.ts', server: { port: VITE_PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
  await server.listen();
  browser = await chromium.launch({ args: ['--noerrdialogs'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1.5 });
  // 只准本機：vite 與模擬器。其他一律擋（不連正式環境）。
  let firestoreDown = false;
  const blocked = [];
  await ctx.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (!local) { blocked.push(url.host); return route.abort(); }
    if (firestoreDown && url.port === String(PORT)) return route.abort('internetdisconnected');
    return route.continue();
  });
  const consoleErrors = [];
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  const url = `http://127.0.0.1:${VITE_PORT}/dev-harness/cp-step4-a1-persist.html`;
  const rows = () => page.evaluate(() => window.__A1?.rows?.() ?? []);
  const goalRow = async () => (await rows()).find((r) => r.kind === 'goal') ?? null;

  await page.goto(url);
  await page.waitForFunction(() => window.__A1_READY === true || window.__A1_ERROR, null, { timeout: 30000 });
  const err = await page.evaluate(() => window.__A1_ERROR ?? null);
  if (err) throw new Error(`頁面錯誤 ${err}`);
  const goalBtn = page.getByRole('button', { name: '主隊 進球' });
  await goalBtn.waitFor({ timeout: 30000 });
  await until('記分鈕可按', async () => !(await goalBtn.isDisabled()), 30000);
  step('頁面載入完成（線上）');

  firestoreDown = true;
  step('擋掉往模擬器的連線（離線）');
  await goalBtn.click();
  const skip = page.getByRole('button', { name: '不指定球員' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await until('日誌出現進球', async () => (await goalRow()) != null, 20000);
  const waited = await until('寫入進 SDK 佇列（sending）', async () => (await goalRow())?.state === 'sending', 60000);
  step('離線記一球', { row: await goalRow(), waitedMs: waited });
  await page.screenshot({ path: join(OUT, 'p1-offline-pending.png') });

  await page.reload();
  await page.waitForFunction(() => window.__A1_READY === true || window.__A1_ERROR, null, { timeout: 30000 });
  // recover 讀取在離線時要等 SDK 判定連不上（約 10 秒）才回快取；多等一些，確認沒有被誤標 applied。
  await pause(20000);
  const afterReload = await goalRow();
  step('重新整理後（仍離線）', { row: afterReload });
  await page.screenshot({ path: join(OUT, 'p2-reloaded-offline.png') });
  if (afterReload?.state === 'applied') throw new Error('重新整理後被誤標 applied');

  await patch(`competitions/${CID}/matches/${MT}/control/scorer`, { uid: UID, sid: 'other-device-sid-000009' });
  step('另一台接手（control.sid 換掉）');

  firestoreDown = false;
  step('恢復連線');
  const took = await until('原頁面出現被拒或被標已送出', async () => ['rejected', 'applied'].includes((await goalRow())?.state ?? ''), 90000);
  const finalRow = await goalRow();
  step('結果', { row: finalRow, tookMs: took });
  // 被拒後畫面比分要回到伺服器的 0:0（快照回滾）。每 500ms 記一次，最多 10 秒。
  const uiScores = [];
  for (let i = 0; i < 20; i += 1) {
    const shown = await page.evaluate(() => document.querySelector('.s4-score')?.textContent ?? null);
    uiScores.push(shown);
    if (shown === '0:0' && i >= 2) break;
    await pause(500);
  }
  step('被拒後畫面比分（每 500ms）', { uiScores });
  const match = await read(`competitions/${CID}/matches/${MT}`);
  const timeline = await list(`competitions/${CID}/matches/${MT}/timeline`);
  const ui = await page.evaluate(() => ({
    banners: [...document.querySelectorAll('.s4-banner')].map((el) => el.textContent.trim()),
    score: document.querySelector('.s4-score')?.textContent ?? null,
    takeoverEntry: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('其他裝置記分中')),
  }));
  step('伺服器與畫面', { score: match?.score, rev: match?.rev, timeline: timeline.length, ui });
  await page.screenshot({ path: join(OUT, 'p3-rejected.png') });
  const sheetBtn = page.getByRole('button', { name: '未套用的動作' });
  // 被接手時記分區整個停用（含這顆），所以只在可按時打開。
  if (await sheetBtn.isVisible().catch(() => false) && await sheetBtn.isEnabled().catch(() => false)) {
    await sheetBtn.click();
    await pause(600);
    await page.screenshot({ path: join(OUT, 'p4-rejected-sheet.png') });
  }
  // 要的是「出現被拒、不默默當成已送出」。原因多半是 takenOver；恢復連線瞬間讀到的 control 還是舊快取時會重送一次、分類成 rules，一樣是被拒紅列。
  report.ok = finalRow?.state === 'rejected' && uiScores.at(-1) === '0:0'
    && match?.score?.home === 0 && match?.score?.away === 0 && timeline.length === 0;
  report.rejectReason = finalRow?.rejectReason ?? null;
  report.blockedHosts = [...new Set(blocked)];
  report.consoleErrors = consoleErrors;
} catch (e) {
  report.error = e instanceof Error ? e.message : String(e);
  console.error('[persist] 失敗', report.error);
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  await writeFile(RULES_TARGET, backup);
  await pause(1500);
  await writeFile(join(OUT, 'persist-report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`[persist] ok=${report.ok}`);
}
process.exit(report.ok ? 0 : 1);
