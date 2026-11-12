/**
 * check-bundle-budget.mjs — 建置後檢查首頁主程式 gzip 是否超過預算。
 *
 * 口徑（不要改成加總）：
 *   只算 dist/index.html 裡 <script type="module" src> 的入口，檔名須為 index-*.js。
 *   不含 modulepreload、不含 CSS、不含 inline script。
 *   gzip = zlib.gzipSync(buf, { level: 9 }) 的位元組數；KB = 1000 bytes（不是 1024）。
 *   預設上限 60KB = 60000 bytes。大於上限才失敗，等於上限通過。
 *
 * 理由：交接文件記載的「首頁主程式約 54.88KB、上限 60KB」只對得上入口檔這個口徑
 *   （2026-11-10、基底 ee2581c 實測：入口約 54.5KB；加上全部 modulepreload 約 111.7KB，
 *   再加 CSS 約 158KB，後兩者都不可能是低於 60KB 的那個數字）。
 *   已知限制：入口縮小、內容搬進 modulepreload 的 chunk 時第一條不會變紅。
 *   第二條補這件事：入口＋modulepreload 的 JS gzip 相加（見下方）。第一條口徑不要改成加總。
 *
 * 第二條（入口＋modulepreload 合計）：
 *   各檔分別 zlib.gzipSync level 9 後相加，不是先串接再壓。KB = 1000 bytes。
 *   含入口 index-*.js，再加上 index.html 裡 rel=modulepreload 且路徑以 .js 結尾的檔。
 *   同一實體檔只算一次（入口若也被 modulepreload，不重複）。不含 CSS、不含 inline。
 *   預設寬鬆上限 250KB。大於上限才失敗，等於上限通過。
 *   這是觀察用天花板，不是正式門檻：2026-11-10、基底 ee2581c 實測合計約 111.7KB，
 *   250KB 留餘裕給後續批次（含 UPD-1b 入口約 +700B）。正式數字等建置日誌再由 PM 收緊。
 *   modulepreload 路徑跳出 dist、檔案不存在、讀不到：第二條失敗（fail-closed）。
 *
 * fail-closed：找不到 index.html、沒有入口、入口不是剛好一個、HTML 內有任何其他
 *   <script type="module" src>（不認得的入口一律失敗，不靜默忽略）、路徑跳出 dist、檔案不存在：一律失敗。
 *
 * 用法：
 *   node scripts/check-bundle-budget.mjs [dist 目錄] [入口上限] [第二條上限]
 *   上限例：60KB（入口預設）、250KB（第二條預設）、1KB。純數字也當 KB。
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const KB = 1000;
export const DEFAULT_LIMIT_BYTES = 60 * KB;
/** 第二條寬鬆上限。正式門檻見檔頭，不要把第一條的 60KB 拿來套這條。 */
export const DEFAULT_PRELOAD_SUM_LIMIT_BYTES = 250 * KB;

function attr(tagAttrs, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
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

/** HTML 內所有「有 src 的 module script」，且檔名不是 index-*.js 者（不認得的入口，視為失敗）。 */
export function listOtherModuleScripts(html) {
  /** @type {string[]} */
  const others = [];
  for (const m of String(html).matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = m[1] ?? '';
    if (attr(attrs, 'type').toLowerCase() !== 'module') continue;
    const src = attr(attrs, 'src').trim();
    if (!src) continue;
    const clean = src.split(/[?#]/)[0];
    const base = clean.split('/').pop() ?? '';
    if (!/^index-[^/]+\.js$/.test(base)) others.push(clean);
  }
  return others;
}

/** index.html 裡 rel=modulepreload、且路徑（去掉 query）以 .js 結尾的 href。不含 CSS。 */
export function listModulePreloadJs(html) {
  /** @type {string[]} */
  const found = [];
  for (const m of String(html).matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = m[1] ?? '';
    const rel = attr(attrs, 'rel').toLowerCase().split(/\s+/).filter(Boolean);
    if (!rel.includes('modulepreload')) continue;
    const href = attr(attrs, 'href').trim();
    if (!href) continue;
    const clean = href.split(/[?#]/)[0];
    if (!/\.js$/i.test(clean)) continue;
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

/** 解析上限。省略時用 fallback（入口預設 60KB）。`60`、`60KB`、`1KB` 皆以 1000 bytes = 1KB。 */
export function parseLimit(raw, fallback = DEFAULT_LIMIT_BYTES) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const m = /^(\d+(?:\.\d+)?)(?:\s*kb)?$/i.exec(String(raw).trim());
  if (!m) throw new Error(`上限格式不正確：${raw}（例：60KB、1KB）`);
  const kb = Number(m[1]);
  if (!Number.isFinite(kb) || kb < 0) throw new Error(`上限無效：${raw}`);
  return Math.round(kb * KB);
}

/** 把 HTML 裡的路徑解到 dist 目錄內。跳出 dist、絕對網址、磁碟機路徑回傳 null。 */
export function resolveDistHref(distDir, href) {
  const clean = String(href).split(/[?#]/)[0].trim();
  if (!clean || clean.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(clean) || /^[a-zA-Z]:/.test(clean) || clean.startsWith('\\\\')) {
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

function preloadNotMeasured(limitBytes) {
  return {
    ok: false,
    reason: '入口檢查未通過，第二條未計',
    files: [],
    totalGzip: 0,
    limitBytes,
  };
}

function failed(reason, limitBytes, preloadLimitBytes = DEFAULT_PRELOAD_SUM_LIMIT_BYTES) {
  return {
    ok: false,
    reason,
    entries: [],
    totalGzip: 0,
    limitBytes,
    preload: preloadNotMeasured(preloadLimitBytes),
  };
}

/**
 * 入口檔＋ modulepreload JS 的 gzip 相加。
 * entryFile／entryBuf 是已讀到的入口。同一路徑只算一次。
 * 任一 preload 無法定位或讀取：ok false，totalGzip 只含已讀到的檔。
 */
export function measurePreloadSum(distDir, html, entryHref, entryFile, entryBuf, limitBytes) {
  const files = [{
    href: entryHref,
    file: entryFile,
    rawBytes: entryBuf.length,
    gzipBytes: gzipByteLength(entryBuf),
    kind: 'entry',
  }];
  const seen = new Set([entryFile]);
  for (const href of listModulePreloadJs(html)) {
    const resolved = resolveDistHref(distDir, href);
    if (!resolved) {
      const totalGzip = files.reduce((sum, item) => sum + item.gzipBytes, 0);
      return { ok: false, reason: `modulepreload 路徑不在 dist 內：${href}`, files, totalGzip, limitBytes };
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!existsSync(resolved)) {
      const totalGzip = files.reduce((sum, item) => sum + item.gzipBytes, 0);
      return { ok: false, reason: `找不到 modulepreload 檔：${href}`, files, totalGzip, limitBytes };
    }
    let buf;
    try {
      buf = readFileSync(resolved);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const totalGzip = files.reduce((sum, item) => sum + item.gzipBytes, 0);
      return { ok: false, reason: `讀不到 modulepreload 檔：${href}（${message}）`, files, totalGzip, limitBytes };
    }
    files.push({
      href,
      file: resolved,
      rawBytes: buf.length,
      gzipBytes: gzipByteLength(buf),
      kind: 'preload',
    });
  }
  const totalGzip = files.reduce((sum, item) => sum + item.gzipBytes, 0);
  const over = exceedsBudget(totalGzip, limitBytes);
  return {
    ok: !over,
    reason: over ? `第二條超過寬鬆上限：${totalGzip} > ${limitBytes}` : '通過',
    files,
    totalGzip,
    limitBytes,
  };
}

/**
 * 讀 dist、量入口 gzip、判斷是否超標。
 * ok 只表示第一條（入口）通過；第二條在 result.preload。
 * 不丟例外：任何讀不到入口的情況都是 ok: false。
 * preloadLimitBytes 省略時用 250KB 寬鬆上限。
 */
export function inspectHomeBundle(distDir, limitBytes, preloadLimitBytes = DEFAULT_PRELOAD_SUM_LIMIT_BYTES) {
  const indexPath = path.join(distDir, 'index.html');
  if (!existsSync(indexPath)) return failed(`找不到 dist/index.html：${indexPath}`, limitBytes, preloadLimitBytes);
  let html;
  try {
    html = readFileSync(indexPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failed(`讀不到 dist/index.html：${message}`, limitBytes, preloadLimitBytes);
  }

  const others = listOtherModuleScripts(html);
  if (others.length > 0) {
    return failed(`index.html 有不認得的 module script，無法確定入口：${others.join(', ')}`, limitBytes, preloadLimitBytes);
  }
  const hrefs = listHomeEntryJs(html);
  if (hrefs.length === 0) {
    return failed('找不到入口 JS（index.html 沒有 script type=module 且檔名為 index-*.js）', limitBytes, preloadLimitBytes);
  }
  if (hrefs.length !== 1) {
    return failed(`入口 JS 必須剛好一個，目前 ${hrefs.length} 個：${hrefs.join(', ')}`, limitBytes, preloadLimitBytes);
  }

  const href = hrefs[0];
  const file = resolveDistHref(distDir, href);
  if (!file) return failed(`入口路徑不在 dist 內：${href}`, limitBytes, preloadLimitBytes);
  if (!existsSync(file)) return failed(`找不到入口檔：${href}`, limitBytes, preloadLimitBytes);

  let buf;
  try {
    buf = readFileSync(file);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failed(`讀不到入口檔：${href}（${message}）`, limitBytes, preloadLimitBytes);
  }

  const gzipBytes = gzipByteLength(buf);
  const over = exceedsBudget(gzipBytes, limitBytes);
  const preload = measurePreloadSum(distDir, html, href, file, buf, preloadLimitBytes);
  return {
    ok: !over,
    reason: over ? `超過上限：${gzipBytes} > ${limitBytes}` : '通過',
    entries: [{ href, file, rawBytes: buf.length, gzipBytes }],
    totalGzip: gzipBytes,
    limitBytes,
    preload,
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
  if (result.preload) {
    lines.push('');
    lines.push('第二條：入口＋modulepreload JS gzip 合計（各檔 gzip level 9 相加，同一檔只算一次；不含 CSS；KB = 1000 bytes）');
    for (const item of result.preload.files) {
      const label = item.kind === 'entry' ? '入口' : 'modulepreload';
      lines.push(`  [${label}] ${item.href}  gzip ${item.gzipBytes} bytes（${formatKb(item.gzipBytes)} KB）  raw ${item.rawBytes} bytes`);
    }
    lines.push(`總計 ${result.preload.totalGzip} bytes（${formatKb(result.preload.totalGzip)} KB）／寬鬆上限 ${result.preload.limitBytes} bytes（${formatKb(result.preload.limitBytes)} KB）`);
    lines.push(`結果：${result.preload.ok ? '通過' : result.preload.reason}`);
    lines.push('第二條是觀察用寬鬆上限。未超過不代表已達正式門檻，正式數字由 PM 看這段日誌再定。');
  }
  return lines.join('\n');
}

function main() {
  const distDir = process.argv[2] || 'dist';
  let limitBytes;
  let preloadLimitBytes;
  try {
    limitBytes = parseLimit(process.argv[3]);
    preloadLimitBytes = parseLimit(process.argv[4], DEFAULT_PRELOAD_SUM_LIMIT_BYTES);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  const result = inspectHomeBundle(distDir, limitBytes, preloadLimitBytes);
  console.log(renderReport(result));
  const preloadOk = result.preload ? result.preload.ok : false;
  process.exitCode = result.ok && preloadOk ? 0 : 1;
}

// 兩邊都取 realpath 再比：ESM 的 import.meta.url 已解析符號連結／junction，argv[1] 不會，
// 只做 path.resolve 會讓經由連結執行時 main 靜默不跑而假綠。CLI 行為另有子行程測試。
function isMainModule() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(path.resolve(argv1)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
const isMain = isMainModule();

if (isMain) main();
