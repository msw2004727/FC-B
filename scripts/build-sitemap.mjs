#!/usr/bin/env node
/**
 * build-sitemap.mjs — 重產 public/sitemap-events.xml（換站計畫書 I-03、D-5）。
 *
 * 由 `npm run bump-version` 在每個上線批次一併呼叫（顧問 §3.129：不用 GitHub Actions 排程，
 * 取代 cutseo-sitemap-v2 的 build-sitemap.yml）；要手動重產就本機跑 `node scripts/build-sitemap.mjs`。
 *
 * 移植自舊站 A `scripts/build-sitemap.js`，篩選條件照 A；差異：
 *   - 只產活動子表、只寫 sitemap-events.xml。俱樂部詳情要登入（S3c 一律 noindex），B 沒有賽事詳情頁，兩個子表都不產。
 *   - 只用公開 Firestore REST 唯讀列出（Rules `events` 為 allow read: if true），不需要任何 secret。
 *   - 讀取失敗、逾時（單頁 15 秒／總計 60 秒）、超過頁數上限或讀到 0 筆時保留原檔並以 exit 0 結束（不擋上線），不像 A 會寫成空表。
 *   - 結束時印一行可貼進上線 evidence：「sitemap：重產 N 筆」或「sitemap：沿用舊檔」。
 * 首頁、著陸頁、Blog 等固定網址在 public/sitemap-static.xml，索引在 public/sitemap.xml（都手動維護，本腳本不碰）。
 */

import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIRESTORE_PROJECT = 'fc-football-6c8dc';
const SITE_ORIGIN = 'https://toosterx.com';
const FIREBASE_CONFIG_URL = new URL('../src/data/firebase-config.ts', import.meta.url);
export const OUTPUT_URL = new URL('../public/sitemap-events.xml', import.meta.url);

const DAY_MS = 24 * 60 * 60 * 1000;
const URLS_PER_FILE_CAP = 5000;
const PAGE_SIZE = 300;
const MAX_PAGES = 30;
const FETCH_TIMEOUT_MS = 15_000;
const TOTAL_TIMEOUT_MS = 60_000;

function readFirebaseApiKey() {
  const match = readFileSync(FIREBASE_CONFIG_URL, 'utf8').match(/apiKey:\s*["']([^"']+)["']/);
  return match ? match[1] : '';
}

function fromFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) {
    const out = {};
    for (const [key, inner] of Object.entries(value.mapValue.fields || {})) out[key] = fromFirestoreValue(inner);
    return out;
  }
  return null;
}

function fromFirestoreDoc(doc) {
  const obj = {};
  for (const [key, value] of Object.entries(doc.fields || {})) obj[key] = fromFirestoreValue(value);
  const docId = (doc.name || '').split('/').pop() || '';
  obj._docId = docId;
  if (!obj.id && docId) obj.id = docId;
  return obj;
}

/**
 * 分頁列出 events。逾時（單頁 15 秒、總計 60 秒）或超過 MAX_PAGES 一律丟錯，
 * 由 regenerateSitemap 走「沿用舊檔」，不寫部分清單（REST list 依文件名排序，截掉的是隨機活動）。
 * fetchImpl／nowFn／apiKey 可注入，單元測試不連網。
 */
export async function fetchAllEvents({
  fetchImpl = fetch,
  nowFn = Date.now,
  apiKey = readFirebaseApiKey(),
  totalTimeoutMs = TOTAL_TIMEOUT_MS,
} = {}) {
  if (!apiKey) throw new Error('找不到 Firebase apiKey');
  const deadline = nowFn() + totalTimeoutMs;
  const all = [];
  let pageToken = '';
  let page = 0;
  do {
    if (page >= MAX_PAGES) throw new Error(`活動超過 ${MAX_PAGES} 頁（${MAX_PAGES * PAGE_SIZE} 筆），不寫部分清單`);
    const remaining = deadline - nowFn();
    if (remaining <= 0) throw new Error(`讀取超過總期限 ${totalTimeoutMs / 1000} 秒`);
    page += 1;
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE), key: apiKey });
    if (pageToken) params.set('pageToken', pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/events?${params}`;
    // 單頁逾時取「15 秒」與「總期限剩餘」較小者，逾時改走「保留舊檔」，不讓上線步驟卡住
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(Math.min(FETCH_TIMEOUT_MS, remaining)) });
    if (res.status !== 200) throw new Error(`Firestore events fetch failed (${res.status})`);
    const body = await res.json();
    all.push(...(body.documents || []).map(fromFirestoreDoc));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return all;
}

export function parseDateMs(dateValue) {
  if (!dateValue) return 0;
  if (typeof dateValue === 'number') return dateValue;
  const raw = String(dateValue).trim();
  const slash = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (slash) {
    return new Date(
      Number(slash[1]),
      Number(slash[2]) - 1,
      Number(slash[3]),
      Number(slash[4] || 0),
      Number(slash[5] || 0),
    ).getTime();
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isSafeRouteSegment(id) {
  return /^[A-Za-z0-9_-]{3,80}$/.test(String(id || '').trim());
}

export function isIndexableEvent(event, nowMs) {
  if (!event) return false;
  const status = String(event.status || '').toLowerCase();
  if (['ended', 'cancelled', 'canceled', 'archived', 'deleted', 'draft'].includes(status)) return false;
  if (event.privateEvent === true) return false;
  if (event.teamOnly === true) return false;
  if (event.isHidden === true || event.hidden === true || event.isDraft === true) return false;
  const startMs = parseDateMs(event.date || event.startAt || event.startTime);
  // 未排程 (0) 也納入；過去 > 30 天的活動排除避免 sitemap 灌過時資料
  if (startMs > 0 && startMs + 30 * DAY_MS < nowMs) return false;
  return true;
}

function pickLastMod(record, nowMs) {
  const candidates = [
    record.updatedAt,
    record.lastModified,
    record.modifiedAt,
    record.createdAt,
    record.eventDate,
    record.date,
    record.startAt,
  ];
  for (const value of candidates) {
    const ms = parseDateMs(value);
    if (ms > 0) return new Date(ms).toISOString().slice(0, 10);
  }
  return new Date(nowMs).toISOString().slice(0, 10);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildEventEntries(events, nowMs) {
  const seen = new Set();
  const out = [];
  for (const ev of events) {
    if (!isIndexableEvent(ev, nowMs)) continue;
    const id = String(ev.id || ev._docId || '').trim();
    if (!isSafeRouteSegment(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      loc: `${SITE_ORIGIN}/events/${encodeURIComponent(id)}`,
      lastmod: pickLastMod(ev, nowMs),
    });
    if (out.length >= URLS_PER_FILE_CAP) break;
  }
  return out;
}

export function buildSitemapXml(entries) {
  const body = entries.map(({ loc, lastmod }) => [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    `    <lastmod>${escapeXml(lastmod)}</lastmod>`,
    '    <changefreq>daily</changefreq>',
    '    <priority>0.7</priority>',
    '  </url>',
  ].join('\n'));
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + (body.length ? `${body.join('\n')}\n` : '')
    + '</urlset>\n';
}

/**
 * 重產活動子表；永不拋錯（上線步驟不因 Firestore／網路／配額問題失敗）。
 * 成功印「sitemap：重產 N 筆」，失敗保留舊檔並印「sitemap：沿用舊檔」。
 * fetchEvents／outputUrl／nowMs 可注入，單元測試用假資料，不連正式資料庫。
 */
export async function regenerateSitemap({
  fetchEvents = fetchAllEvents,
  outputUrl = OUTPUT_URL,
  nowMs = Date.now(),
  logger = console,
} = {}) {
  try {
    const events = await fetchEvents();
    // 正式站不可能 0 筆活動：視為讀取異常，不把子表洗成空表
    if (!Array.isArray(events) || events.length === 0) throw new Error('讀到 0 筆活動');
    const entries = buildEventEntries(events, nowMs);
    const xml = buildSitemapXml(entries);
    const existing = existsSync(outputUrl) ? readFileSync(outputUrl, 'utf8') : '';
    if (existing !== xml) writeFileSync(outputUrl, xml, 'utf8');
    logger.log(`sitemap：重產 ${entries.length} 筆`);
    return { status: 'regenerated', count: entries.length };
  } catch (err) {
    logger.warn(`⚠ sitemap 重產失敗，保留舊檔、不擋上線：${err?.message || err}`);
    logger.log('sitemap：沿用舊檔');
    return { status: 'kept', count: null };
  }
}

// realpath 比對：Windows junction／磁碟代號大小寫不同時也能判斷是直接執行
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  await regenerateSitemap();
}
