/**
 * check-bundle-budget.mjs — 建置後檢查首頁主程式 gzip 是否超過預算。
 *
 * 主要口徑是「入口＋預載合計」。入口單檔退為輔助指標。
 * 站長 11-19 在顧問對話同意（§3.337）。
 *
 * 合計（主要把關）：
 *   各檔分別 zlib.gzipSync(buf, { level: 9 }) 後相加，不是先串接再壓。KB = 1000 bytes（不是 1024）。
 *   含入口 index-*.js，再加上 index.html 裡 rel=modulepreload 且路徑以 .js 結尾的檔。
 *   同一實體檔只算一次（入口若也被 modulepreload，不重複）。不含 CSS、不含 inline script。
 *   預設上限 123,823 bytes（＝賽事建賽修正上線版 7514fde4 實測合計 122,799＋1,024；K2 rebase 後，§3.373 補）。
 *   取代 123,161（首頁批上線版 8be2b2e0 合計 122,137＋1,024，顧問 §3.346）：賽事兩批先上線，基準跟著換。
 *   取代前一版 122,100（基底 18fa8d0 合計 121,043＋1 KB）：首頁「先畫上次內容」批先上線，基準跟著換。
 *   取代原 250KB 觀察用寬鬆上限：合計改為正式門檻，大於上限即失敗，不再只是觀察。
 *   合計是主要把關；之後每批以上一個上線版的合計為基準，增加超過 1 KB 先報 PM。
 *   大於上限才失敗，等於上限通過。
 *   modulepreload 路徑跳出 dist、檔案不存在、讀不到：合計失敗（fail-closed）。
 *
 * 入口單檔（輔助指標）：
 *   只算 dist/index.html 裡 <script type="module" src> 的入口，檔名須為 index-*.js。
 *   不含 modulepreload、不含 CSS、不含 inline script。
 *   gzip 同樣是 zlib.gzipSync level 9 的位元組數。KB = 1000 bytes。
 *   判定用「檔名雜湊正規化後」的 gzip：站長 11-20 於顧問對話親答（§3.362），常設口徑。
 *     入口裡有數百處延後檔檔名（name-<8 碼雜湊>.js），任一延後檔改動都會換雜湊，雜湊幾乎不可壓縮，
 *     實際 gzip 會隨機浮動數十 bytes。正規化只把 dist/assets 裡實際存在、帶雜湊的打包檔名換成固定字串，
 *     其他內容一字不動；實際 gzip 照舊印出對照。
 *   預設上限 60,024 bytes（正規化口徑）：站長 11-20 於顧問對話親選入口 62,000（實際 gzip，§3.373），
 *     照同一把尺換算＝58,902（8be2b2e0 正規化）＋（62,000−60,878（8be2b2e0 實際））；取代 59,124。
 *   前一版 59,124 bytes（正規化口徑）：顧問 §3.365 定（照站長「不放寬」原意換算＝正規化基準 58,902＋原留空間 222），
 *     取代字面沿用的 61,100（61,100 是實際 gzip 口徑的上限，改量正規化後若照字面會寬約 2 KB）。只為 K2 這一批。
 *   前一版上限 61,100 bytes：站長 11-19 於顧問對話親答（§3.347），只為 K2 這一批、一次性。
 *   取代 61,000（首頁批的值）：K2 rebase 後入口實建 61,058；合計仍在 123,161 內。之後每批超過先報 PM，不自行調。
 *   大於上限才失敗，等於上限通過。
 *
 * 兩條都印。任一條超限即失敗，報告指出是哪一條。示警不改判定，只看這兩個上限。
 * 與基準 BASELINE（每次上線後由 PM 更新成上線版實測值）相比，報告印
 *   「與基準相比：入口 ±N B、合計 ±N B」。
 * 入口比基準變小、但合計比基準變大時，另印警告：可能只是把入口的程式搬進預載檔，不算瘦身。
 *
 * fail-closed：找不到 index.html、沒有入口、入口不是剛好一個、HTML 內有任何其他
 *   <script type="module" src>（不認得的入口一律失敗，不靜默忽略）、路徑跳出 dist、檔案不存在：一律失敗。
 *
 * 用法：
 *   node scripts/check-bundle-budget.mjs [dist 目錄] [入口上限] [合計上限]
 *   上限例：60.7KB（入口預設）、122.1KB（合計預設）、1KB。純數字也當 KB。
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const KB = 1000;
// 2026-11-19：60,000 → 60,500（§3.293 補）→ 61,000（首頁「先畫上次內容」批，站長本人同意）。
// → 61,100：站長 11-19 於顧問對話親答（§3.347），只為 K2 這一批、一次性（取代 61,000；K2 rebase 後入口實建 61,058）。
// 入口單檔是輔助指標，超過先報 PM、不自行調。
// → 59,124（正規化口徑）：顧問 §3.365 定，取代 61,100；58,902（8be2b2e0 正規化）＋222（原 61,100−60,878 的空間）。
// → 60,024（正規化口徑）：站長 11-20 親選入口 62,000 實際 gzip（§3.373）照同一把尺換算＝58,902＋（62,000−60,878），取代 59,124。
export const DEFAULT_LIMIT_BYTES = 60_024;
// 站長 11-19 在顧問對話同意（§3.337）。
// 取代原 250KB（250 * KB）觀察用寬鬆上限（§3.337）；再由 122,100（基底 18fa8d0 合計 121,043＋1 KB）
// 改為首頁批上線版 8be2b2e0 實測合計 122,137＋1,024＝123,161，只適用 K2（顧問 §3.346）；
// 再改為賽事建賽修正上線版 7514fde4 實測合計 122,799＋1,024＝123,823（K2 rebase 後，§3.373 補；取代 123,161）。
// 超過即失敗，不再只是觀察。為什麼改：合計才是首頁會下載的 JS 本體，250KB 寬到抓不到變胖。
// 合計是主要把關；之後每批以上一個上線版的合計為基準，增加超過 1 KB 先報 PM。
export const DEFAULT_PRELOAD_SUM_LIMIT_BYTES = 123_823;
// 每次上線後由 PM 更新成上線版實測值。
// 2026-11-20 起入口改記「檔名雜湊正規化後」的 gzip（站長 11-20 於顧問對話親答（§3.362））；
// 之前紀錄的入口數字（例如 8be2b2e0 實際 gzip 60,878）是實際值，不回頭改寫。合計仍是實際 gzip。
// 7514fde4（0.20261121f）實建：入口正規化 59,512（實際 61,523）、合計 122,799；取代 8be2b2e0（58,902／122,137）。
export const BASELINE = { ref: '7514fde4', entryBytes: 59512, sumBytes: 122799 };

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

/** 解析上限。省略時用 fallback（入口預設 60,024）。`60`、`60.024KB`、`1KB` 皆以 1000 bytes = 1KB。 */
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
    reason: '入口檢查未通過，合計未計',
    files: [],
    totalGzip: 0,
    limitBytes,
    measured: false,
    exceeded: false,
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
 * 任一 preload 無法定位或讀取：ok false，totalGzip 只含已讀到的檔，measured false。
 * 成功量完時 measured 為 true，exceeded 表示合計是否超過上限。
 * renderReport 只看這兩個欄位，不比對 reason 文字。
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
      return { ok: false, reason: `modulepreload 路徑不在 dist 內：${href}`, files, totalGzip, limitBytes, measured: false, exceeded: false };
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!existsSync(resolved)) {
      const totalGzip = files.reduce((sum, item) => sum + item.gzipBytes, 0);
      return { ok: false, reason: `找不到 modulepreload 檔：${href}`, files, totalGzip, limitBytes, measured: false, exceeded: false };
    }
    let buf;
    try {
      buf = readFileSync(resolved);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const totalGzip = files.reduce((sum, item) => sum + item.gzipBytes, 0);
      return { ok: false, reason: `讀不到 modulepreload 檔：${href}（${message}）`, files, totalGzip, limitBytes, measured: false, exceeded: false };
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
    reason: over ? `合計超過上限：${totalGzip} > ${limitBytes}` : '通過',
    files,
    totalGzip,
    limitBytes,
    measured: true,
    exceeded: over,
  };
}

/** 打包檔名：<名稱>-<8 碼雜湊>.<副檔名>。 */
const HASHED_ASSET = /^(.+)-([A-Za-z0-9_-]{8})\.([A-Za-z0-9]+)$/;

/**
 * dist/assets（含子資料夾）裡實際存在、帶雜湊的打包「檔案」名 → 正規化後的名稱（雜湊換成 XXXXXXXX）。
 * 只認實際產出的檔案，資料夾不算，不用萬用規則（§3.362 條件 3）。
 * 讀不到（不存在、不是資料夾、沒有權限）回 null，由呼叫端標示「讀不到 dist/assets」。
 */
export function listHashedAssetNames(distDir) {
  const map = new Map();
  let entries = [];
  try {
    entries = readdirSync(path.join(distDir, 'assets'), { withFileTypes: true, recursive: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const m = HASHED_ASSET.exec(entry.name);
    if (m) map.set(entry.name, `${m[1]}-XXXXXXXX.${m[3]}`);
  }
  return map;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 只換「路徑引用」形式的打包檔名：前面必須是 /，後面是引號、反引號、? 或 #（Flash 交叉審 P1）。
 * 實測入口 274 處打包檔名全部是 "assets/…"、import(`./…`)、from"./…" 形式（前一字元都是 /），
 * 所以一般字串常數、註解或更長字串裡剛好同名的文字都不會被換。長名先換。
 */
export function normalizeBuildHashes(text, hashedNames) {
  let out = String(text);
  const names = [...hashedNames.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const re = new RegExp(`/${escapeRegExp(name)}(?=["'\`?#])`, 'g');
    out = out.replace(re, () => `/${hashedNames.get(name)}`);
  }
  return out;
}

/**
 * 讀 dist、量入口 gzip 與合計、判斷是否超標。
 * ok 只表示輔助指標（入口單檔）通過；合計在 result.preload。
 * 兩者都要看：任一條超限，CLI 結束碼即失敗。缺檔不改寫 ok（入口該過就過）。
 * 不丟例外：任何讀不到入口的情況都是 ok: false。
 * preloadLimitBytes 省略時用合計上限 123,823。
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
  // 入口判定用檔名雜湊正規化後的 gzip（站長 11-20 於顧問對話親答（§3.362））；實際 gzip 照舊記錄對照。
  // latin1 逐位元組來回，檔名是 ASCII，換名稱不會改到其他位元組。
  const listed = listHashedAssetNames(distDir);
  const assetsReadable = listed !== null;
  const hashedNames = listed ?? new Map();
  const normalizedGzipBytes = gzipByteLength(Buffer.from(normalizeBuildHashes(buf.toString('latin1'), hashedNames), 'latin1'));
  const over = exceedsBudget(normalizedGzipBytes, limitBytes);
  const preload = measurePreloadSum(distDir, html, href, file, buf, preloadLimitBytes);
  return {
    ok: !over,
    reason: over ? `入口超過上限（雜湊正規化後）：${normalizedGzipBytes} > ${limitBytes}` : '通過',
    entries: [{ href, file, rawBytes: buf.length, gzipBytes, normalizedGzipBytes, hashedNameCount: hashedNames.size, assetsReadable }],
    totalGzip: normalizedGzipBytes,
    actualGzip: gzipBytes,
    limitBytes,
    preload,
  };
}

export function formatKb(bytes) {
  return (bytes / KB).toFixed(2);
}

/** 與基準的差值。0 印成 ±0，正數帶 +，負數帶 -。 */
function formatDeltaBytes(delta) {
  if (!Number.isFinite(delta) || delta === 0) return '±0';
  return delta > 0 ? `+${delta}` : String(delta);
}

/**
 * 有量到入口與合計時，印與 BASELINE 的差。
 * 入口變小且合計變大只示警，不改 ok。
 */
function appendBaselineComparison(lines, entryBytes, sumBytes) {
  const entryDelta = entryBytes - BASELINE.entryBytes;
  const sumDelta = sumBytes - BASELINE.sumBytes;
  lines.push(`與基準相比：入口 ${formatDeltaBytes(entryDelta)} B、合計 ${formatDeltaBytes(sumDelta)} B`);
  if (entryDelta < 0 && sumDelta > 0) {
    lines.push('⚠ 入口變小但合計變大：可能只是把入口的程式搬進預載檔，不算瘦身');
  }
}

/** 明細與總計。兩條都印。失敗時仍印已量到的數字，並指出是哪一條超限。 */
export function renderReport(result) {
  const lines = [
    '首頁 gzip 預算（主要：入口＋預載合計；輔助：入口單檔；各檔分別 gzip level 9 後相加；KB = 1000 bytes）',
  ];
  if (result.entries.length === 0) {
    lines.push(`輔助（入口）結果：${result.reason}`);
  } else {
    lines.push('輔助：入口單檔（只算 index-*.js；不含 modulepreload 與 CSS；KB = 1000 bytes；gzip level 9）');
    for (const entry of result.entries) {
      lines.push(`  ${entry.href}  實際 gzip ${entry.gzipBytes} bytes（${formatKb(entry.gzipBytes)} KB）  raw ${entry.rawBytes} bytes`);
      if (entry.normalizedGzipBytes !== undefined) {
        const note = entry.assetsReadable === false
          ? '讀不到 dist/assets，未正規化，等同實際值'
          : entry.hashedNameCount === 0
            ? 'dist/assets 沒有帶雜湊的打包檔名，等同實際值'
            : `正規化 ${entry.hashedNameCount} 個打包檔名`;
        lines.push(`  雜湊正規化後 gzip ${entry.normalizedGzipBytes} bytes（判定用，§3.362；${note}）`);
      }
    }
    lines.push(`總計（判定用）${result.totalGzip} bytes（${formatKb(result.totalGzip)} KB）／上限 ${result.limitBytes} bytes（${formatKb(result.limitBytes)} KB）`);
    lines.push(`結果：${result.ok ? '通過' : result.reason}`);
  }
  if (result.preload) {
    lines.push('');
    lines.push('主要：入口＋modulepreload JS gzip 合計（各檔分別 gzip level 9 後相加，同一檔只算一次；不含 CSS；KB = 1000 bytes）');
    for (const item of result.preload.files) {
      const label = item.kind === 'entry' ? '入口' : 'modulepreload';
      lines.push(`  [${label}] ${item.href}  gzip ${item.gzipBytes} bytes（${formatKb(item.gzipBytes)} KB）  raw ${item.rawBytes} bytes`);
    }
    lines.push(`總計 ${result.preload.totalGzip} bytes（${formatKb(result.preload.totalGzip)} KB）／上限 ${result.preload.limitBytes} bytes（${formatKb(result.preload.limitBytes)} KB）`);
    lines.push(`結果：${result.preload.ok ? '通過' : result.preload.reason}`);
    const measured = result.preload.measured === true;
    const exceeded = result.preload.exceeded === true;
    if (measured && result.entries.length > 0) {
      appendBaselineComparison(lines, result.totalGzip, result.preload.totalGzip);
    }
    const entryOver = result.entries.length > 0 && !result.ok;
    const sumOver = measured && exceeded;
    if (entryOver || sumOver) {
      const which = [];
      if (entryOver) which.push('入口');
      if (sumOver) which.push('合計');
      lines.push(`超限：${which.join('、')}`);
    }
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
