#!/usr/bin/env node
/**
 * build-sitemap.mjs — 每日重建 public/sitemap-events.xml（換站計畫書 I-03、D-5）。
 *
 * 移植自舊站 A `scripts/build-sitemap.js`，篩選條件照 A；差異：
 *   - 只產活動子表。俱樂部詳情要登入（S3c 一律 noindex），B 沒有賽事詳情頁，兩個子表都不產。
 *   - 只用公開 Firestore REST（訪客讀得到的才進 sitemap），不需要任何 secret。
 *   - 讀取失敗時保留原檔，不像 A 會寫成空表。
 * 首頁、著陸頁、Blog 等固定網址在 public/sitemap-static.xml（手動維護）。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIRESTORE_PROJECT = 'fc-football-6c8dc';
const SITE_ORIGIN = 'https://toosterx.com';
const FIREBASE_CONFIG_URL = new URL('../src/data/firebase-config.ts', import.meta.url);
const OUTPUT_URL = new URL('../public/sitemap-events.xml', import.meta.url);

const DAY_MS = 24 * 60 * 60 * 1000;
const URLS_PER_FILE_CAP = 5000;
const PAGE_SIZE = 300;
const MAX_PAGES = 30;

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

async function fetchAllEvents(apiKey) {
  const all = [];
  let pageToken = '';
  let page = 0;
  do {
    page += 1;
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE), key: apiKey });
    if (pageToken) params.set('pageToken', pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/events?${params}`;
    const res = await fetch(url);
    if (res.status !== 200) throw new Error(`Firestore events fetch failed (${res.status})`);
    const body = await res.json();
    all.push(...(body.documents || []).map(fromFirestoreDoc));
    pageToken = body.nextPageToken || '';
  } while (pageToken && page < MAX_PAGES);
  if (pageToken) console.warn(`[build-sitemap] events exceeded ${MAX_PAGES} pages; truncated`);
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

function pickLastMod(record) {
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
  return new Date().toISOString().slice(0, 10);
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
      lastmod: pickLastMod(ev),
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

async function main() {
  const apiKey = readFirebaseApiKey();
  if (!apiKey) throw new Error('找不到 Firebase apiKey');
  const events = await fetchAllEvents(apiKey);
  const entries = buildEventEntries(events, Date.now());
  console.log(`[build-sitemap] fetched events=${events.length}, indexable=${entries.length}`);
  const xml = buildSitemapXml(entries);
  const existing = existsSync(OUTPUT_URL) ? readFileSync(OUTPUT_URL, 'utf8') : '';
  if (existing === xml) {
    console.log('[build-sitemap] sitemap-events.xml unchanged');
    return;
  }
  writeFileSync(OUTPUT_URL, xml, 'utf8');
  console.log('[build-sitemap] sitemap-events.xml updated');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    // 讀取失敗保留原檔，workflow 不因 Firestore／配額問題失敗
    console.error(`[build-sitemap] failed, keep existing file: ${err.message}`);
  });
}
