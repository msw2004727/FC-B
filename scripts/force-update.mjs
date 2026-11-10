#!/usr/bin/env node
/**
 * force-update.mjs — 把 public/runtime-config.json 的 minBuild 寫成現在的台北時間 YYYYMMDDHHmm。
 *
 * 只改這一個欄位，保留其他欄位與縮排。
 * 寫入前先讀線上 https://toosterx.com/version.json；要寫的新值不大於線上建置編號就失敗
 * （避免同一分鐘打包的舊版被強制）。離線或讀不到線上檔時明確失敗，不寫檔。
 *
 * 強制更新須顧問三行裁定（R-UPD-022）。
 *
 * 用法：node scripts/force-update.mjs [--online-url <url>]
 * --online-url 預設 https://toosterx.com/version.json。
 * 只接受 https 的 toosterx.com 與 next.toosterx.com 的 /version.json。
 * 其他值（http、其他網域、帳密、子網域、連接埠）失敗且不寫檔。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { taipeiBuildId } from './build-meta.mjs';

export const ONLINE_VERSION_URL = 'https://toosterx.com/version.json';

const ALLOWED_ONLINE_HOSTS = new Set(['toosterx.com', 'next.toosterx.com']);

/**
 * 只接受兩個正式主機的 https /version.json。
 * 回傳標準網址。不合法就丟錯（呼叫端不得寫檔）。
 */
export function assertAllowedOnlineUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('--online-url 不是可用的網址，未寫入');
  }
  const text = raw.trim();
  if (text.includes('@') || text.includes('\\')) {
    throw new Error('--online-url 不可帶帳密或其他主機，未寫入');
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`--online-url 不是可用的網址（${text}），未寫入`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`--online-url 只接受 https（${text}），未寫入`);
  }
  if (url.username || url.password) {
    throw new Error('--online-url 不可帶帳密，未寫入');
  }
  if (url.port !== '') {
    throw new Error('--online-url 不可指定連接埠，未寫入');
  }
  if (!ALLOWED_ONLINE_HOSTS.has(url.hostname)) {
    throw new Error(`--online-url 只接受 toosterx.com 與 next.toosterx.com（${url.hostname}），未寫入`);
  }
  if (url.pathname !== '/version.json' || url.search !== '' || url.hash !== '') {
    throw new Error('--online-url 只接受該主機的 /version.json，未寫入');
  }
  return `https://${url.hostname}/version.json`;
}

/** 沒有 --online-url 時用預設。有旗標但沒值、或網址不在允許名單，丟錯。 */
export function onlineUrlFromArgv(argv) {
  const idx = argv.indexOf('--online-url');
  if (idx < 0) return ONLINE_VERSION_URL;
  const value = argv[idx + 1];
  if (value == null || value.startsWith('--')) {
    throw new Error('--online-url 需要網址，未寫入');
  }
  return assertAllowedOnlineUrl(value);
}

/** 目前檔案實際有的欄位。更新開關只有前兩個；地圖鍵是活動地圖在用的，不能當成未知欄位刪掉。 */
export const RUNTIME_CONFIG_KEYS = [
  'swEnabled',
  'minBuild',
  'googleMapsBrowserApiKey',
  'googleMapsVersion',
];

const CONFIG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'runtime-config.json');
const MIN_BUILD_RE = /("minBuild"\s*:\s*)(0|\d{12})(?=\s*[,}\n])/;

export function assertRuntimeConfigShape(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('runtime-config.json 必須是物件');
  }
  const unknown = Object.keys(data).filter((key) => !RUNTIME_CONFIG_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`runtime-config.json 出現不允許的欄位：${unknown.join(', ')}`);
  }
  if (!('swEnabled' in data) || !('minBuild' in data)) {
    throw new Error('runtime-config.json 必須有 swEnabled 與 minBuild');
  }
  if (typeof data.swEnabled !== 'boolean') {
    throw new Error(`runtime-config.json 的 swEnabled 必須是布林（實際 ${typeof data.swEnabled}）`);
  }
  const min = data.minBuild;
  const twelve = typeof min === 'number' && Number.isInteger(min) && /^\d{12}$/.test(String(min));
  if (min !== 0 && !twelve) {
    throw new Error(`runtime-config.json 的 minBuild 必須是 0 或 12 位整數（實際 ${String(min)}）`);
  }
}

/** 線上 build 必須是 0 或 12 位整數。回傳數字。 */
export function parseOnlineBuild(onlineBuild) {
  const text = typeof onlineBuild === 'number' ? String(onlineBuild) : String(onlineBuild ?? '').trim();
  if (text !== '0' && !/^\d{12}$/.test(text)) {
    throw new Error(`線上 version.json 的 build 不是 0 或 12 位建置編號（${text}），未寫入`);
  }
  return Number(text);
}

export function assertNewerThanOnline(nextId, onlineBuild) {
  if (!/^\d{12}$/.test(nextId)) throw new Error(`要寫的 minBuild 不是 12 位數字（${nextId}），未寫入`);
  const online = parseOnlineBuild(onlineBuild);
  const next = Number(nextId);
  if (!(next > online)) {
    throw new Error(
      `要寫的 minBuild ${nextId} 不大於線上建置編號 ${online}，未寫入（同一分鐘打包的舊版不能被強制）`,
    );
  }
}

/** 只換 minBuild 的數字。格式不合或會動到其他欄位就丟錯，不回傳新字串。 */
export function replaceMinBuild(source, nextId) {
  if (!/^\d{12}$/.test(nextId)) throw new Error(`minBuild 必須是 12 位數字（${nextId}），未寫入`);
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('runtime-config.json 不是合法 JSON，未寫入');
  }
  assertRuntimeConfigShape(parsed);
  const hits = String(source).match(new RegExp(MIN_BUILD_RE.source, 'g'));
  if (!hits || hits.length !== 1) {
    throw new Error('runtime-config.json 的 minBuild 必須恰好出現一次，未寫入');
  }
  const next = String(source).replace(MIN_BUILD_RE, `$1${nextId}`);
  let after;
  try {
    after = JSON.parse(next);
  } catch {
    throw new Error('寫入後的 runtime-config.json 不是合法 JSON，未寫入');
  }
  if (after.minBuild !== Number(nextId)) throw new Error('寫入後 minBuild 與預期不符，未寫入');
  const rest = (obj) => {
    const copy = { ...obj };
    delete copy.minBuild;
    return copy;
  };
  if (JSON.stringify(rest(parsed)) !== JSON.stringify(rest(after))) {
    throw new Error('除 minBuild 外還有欄位被改到，未寫入');
  }
  return next;
}

async function defaultFetchOnline(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data || typeof data !== 'object' || !('build' in data)) {
    throw new Error('沒有 build 欄位');
  }
  return data.build;
}

/**
 * @param {{
 *   filePath?: string,
 *   now?: Date,
 *   onlineUrl?: string,
 *   fetchOnline?: () => Promise<unknown>,
 *   readFile?: (filePath: string) => string,
 *   writeFile?: (filePath: string, text: string) => void,
 * }} [options]
 */
export async function runForceUpdate(options = {}) {
  const onlineUrl = assertAllowedOnlineUrl(options.onlineUrl ?? ONLINE_VERSION_URL);
  const filePath = options.filePath ?? CONFIG_FILE;
  const now = options.now ?? new Date();
  const fetchOnline = options.fetchOnline ?? (() => defaultFetchOnline(onlineUrl));
  const readFile = options.readFile ?? ((file) => fs.readFileSync(file, 'utf8'));
  const writeFile = options.writeFile ?? ((file, text) => fs.writeFileSync(file, text));

  let source;
  try {
    source = readFile(filePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`讀不到 runtime-config.json（${message}），未寫入`);
  }

  let online;
  try {
    online = await fetchOnline();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`讀不到線上 version.json（${message}），未寫入 minBuild`);
  }

  const nextId = taipeiBuildId(now);
  assertNewerThanOnline(nextId, online);
  const text = replaceMinBuild(source, nextId);
  writeFile(filePath, text);
  return { previous: JSON.parse(source).minBuild, next: Number(nextId), text };
}

function main() {
  let onlineUrl;
  try {
    onlineUrl = onlineUrlFromArgv(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  runForceUpdate({ onlineUrl })
    .then(({ previous, next }) => {
      console.log(`minBuild：${previous} → ${next}`);
      console.log('提醒：強制更新須顧問三行裁定（R-UPD-022）。確認裁定後才提交 public/runtime-config.json。');
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
