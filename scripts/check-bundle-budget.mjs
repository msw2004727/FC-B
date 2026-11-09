/**
 * check-bundle-budget.mjs — 建置後檢查首頁主程式 gzip 是否超過預算。
 *
 * 口徑（ee2581c 建置到 C:/t/bb-dist 實測後選定，不要改成加總）：
 *   只算 dist/index.html 裡 <script type="module" src> 的入口，檔名須為 index-*.js。
 *   不含 modulepreload、不含 CSS、不含 inline script。
 *   gzip = zlib.gzipSync(buf, { level: 9 }) 的位元組數；KB = 1000 bytes（不是 1024）。
 *   預設上限 60KB = 60000 bytes。大於上限才失敗，等於上限通過。
 *
 * 理由：同一產物、level 9——
 *   (a) 只算入口 index-KpBypRYB.js：54489 bytes = 54.49 KB（/1000）＝ 53.21 KiB（/1024）
 *   (b) 入口 + 全部 19 個 modulepreload：111737 bytes = 111.74 KB
 *   (c) (b) 再加 2 個 stylesheet：158306 bytes = 158.31 KB
 *   vite reporter 對同一入口印 gzip 54.97 kB（同樣以 1000 為單位）。
 *   背景的「約 54.88KB」只落在 (a) 且用 1000；(b)(c) 都超過 100KB，不是這個預算。
 *   54.49 與 54.88 差 0.39KB，是壓縮實作與這次建置的差距，不是另一種檔案集合。
 *
 * 找不到 index.html、沒有入口、入口不是剛好一個、路徑跳出 dist、檔案不存在：一律失敗（fail-closed）。
 *
 * 用法：
 *   node scripts/check-bundle-budget.mjs [dist 目錄] [上限]
 *   上限例：60KB（預設）、1KB。純數字也當 KB。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

export const KB = 1000;
export const DEFAULT_LIMIT_BYTES = 60 * KB;

function attr(tagAttrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(tagAttrs);
  return m ? (m[1] ?? m[2] ?? '') : '';
}

/** 從首頁 HTML 取出入口 JS 的路徑（不含 query）。只含 index-*.js 的 module script。 */
export function listHomeEntryJs(html) {
  /** @type {string[]} */
  const found = [];
  for (const m of String(html).matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = m[1] ?? '';
    if (attr(attrs, 'type').toLowerCase() !== 'module') continue;
    const src = attr(attrs, 'src').trim();
    if (!src) continue;
    const clean = src.split(/[?#]/)[0];
    const base = clean.split('/').pop() ?? '';
    if (!/^index-[^/]+\.js$/.test(base)) continue;
    found.push(clean);
  }
  return found;
}

/** zlib.gzipSync(buf, { level: 9 }) 的位元組數。 */
export function gzipByteLength(buf) {
  return zlib.gzipSync(buf, { level: 9 }).length;
}

/**
 * 是否超標。等於上限不算超標。
 * 大小或上限不是有限非負數時視為超標（fail-closed，不可靜默通過）。
 */
export function exceedsBudget(gzipBytes, limitBytes) {
  if (!Number.isFinite(gzipBytes) || gzipBytes < 0) return true;
  if (!Number.isFinite(limitBytes) || limitBytes < 0) return true;
  return gzipBytes > limitBytes;
}

/** 解析上限。省略為 60KB。`60`、`60KB`、`1KB` 皆以 1000 bytes = 1KB。 */
export function parseLimit(raw) {
  if (raw == null || String(raw).trim() === '') return DEFAULT_LIMIT_BYTES;
  const m = /^(\d+(?:\.\d+)?)(?:\s*kb)?$/i.exec(String(raw).trim());
  if (!m) throw new Error(`上限格式不正確：${raw}（例：60KB、1KB）`);
  const kb = Number(m[1]);
  if (!Number.isFinite(kb) || kb < 0) throw new Error(`上限無效：${raw}`);
  return Math.round(kb * KB);
}

/** 把 HTML 裡的路徑解到 dist 目錄內。跳出 dist、絕對網址、磁碟機路徑回傳 null。 */
export function resolveDistHref(distDir, href) {
  const clean = String(href).split(/[?#]/)[0].trim();
  if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean) || /^[a-zA-Z]:/.test(clean) || clean.startsWith('\\\\')) {
    return null;
  }
  const rel = clean.replace(/^\/+/, '').replace(/\\/g, '/');
  if (!rel || rel.split('/').some((part) => part === '' || part === '.' || part === '..')) return null;
  const root = path.resolve(distDir);
  const file = path.resolve(root, rel);
  const relToRoot = path.relative(root, file);
  if (!relToRoot || relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) return null;
  return file;
}

function failed(reason, limitBytes) {
  return { ok: false, reason, entries: [], totalGzip: 0, limitBytes };
}

/**
 * 讀 dist、量入口 gzip、判斷是否超標。
 * 不丟例外：任何讀不到入口的情況都是 ok: false。
 */
export function inspectHomeBundle(distDir, limitBytes) {
  const indexPath = path.join(distDir, 'index.html');
  if (!existsSync(indexPath)) return failed(`找不到 dist/index.html：${indexPath}`, limitBytes);
  let html;
  try {
    html = readFileSync(indexPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failed(`讀不到 dist/index.html：${message}`, limitBytes);
  }

  const hrefs = listHomeEntryJs(html);
  if (hrefs.length === 0) {
    return failed('找不到入口 JS（index.html 沒有 script type=module 且檔名為 index-*.js）', limitBytes);
  }
  if (hrefs.length !== 1) {
    return failed(`入口 JS 必須剛好一個，目前 ${hrefs.length} 個：${hrefs.join(', ')}`, limitBytes);
  }

  const href = hrefs[0];
  const file = resolveDistHref(distDir, href);
  if (!file) return failed(`入口路徑不在 dist 內：${href}`, limitBytes);
  if (!existsSync(file)) return failed(`找不到入口檔：${href}`, limitBytes);

  let buf;
  try {
    buf = readFileSync(file);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failed(`讀不到入口檔：${href}（${message}）`, limitBytes);
  }

  const gzipBytes = gzipByteLength(buf);
  const over = exceedsBudget(gzipBytes, limitBytes);
  return {
    ok: !over,
    reason: over ? `超過上限：${gzipBytes} > ${limitBytes}` : '通過',
    entries: [{ href, file, rawBytes: buf.length, gzipBytes }],
    totalGzip: gzipBytes,
    limitBytes,
  };
}

export function formatKb(bytes) {
  return (bytes / KB).toFixed(2);
}

/** 明細與總計。失敗時仍印已量到的數字。 */
export function renderReport(result) {
  const lines = [
    '首頁入口 JS gzip（只算 index-*.js；不含 modulepreload 與 CSS；KB = 1000 bytes；gzip level 9）',
  ];
  if (result.entries.length === 0) {
    lines.push(`結果：${result.reason}`);
    return lines.join('\n');
  }
  for (const entry of result.entries) {
    lines.push(`  ${entry.href}  gzip ${entry.gzipBytes} bytes（${formatKb(entry.gzipBytes)} KB）  raw ${entry.rawBytes} bytes`);
  }
  lines.push(`總計 ${result.totalGzip} bytes（${formatKb(result.totalGzip)} KB）／上限 ${result.limitBytes} bytes（${formatKb(result.limitBytes)} KB）`);
  lines.push(`結果：${result.ok ? '通過' : result.reason}`);
  return lines.join('\n');
}

function main() {
  const distDir = process.argv[2] || 'dist';
  let limitBytes;
  try {
    limitBytes = parseLimit(process.argv[3]);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const result = inspectHomeBundle(distDir, limitBytes);
  console.log(renderReport(result));
  process.exit(result.ok ? 0 : 1);
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) main();
