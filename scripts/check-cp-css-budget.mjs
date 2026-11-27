/**
 * check-cp-css-budget.mjs — 賽事樣式七支的實際打包大小（賽事新外觀第 0 批卡 0-1）。
 *
 * 口徑：
 *   七支固定是 CP_CSS_FILES；之後新增第八支賽事樣式檔必須加進這個清單。
 *   每支各自當一個入口打包，只算自己的規則：行首的 @import 先拿掉，不展開
 *   （competitions.css 匯入 category-tokens.css、step4b.css 匯入 competitions.css，展開會重複算）。
 *   壓縮用專案安裝的 Vite、與 vite.config.ts 相同的 build.target 與 cssCodeSplit、預設的 CSS 壓縮，
 *   並掛同一個 legacyCssScope（路徑含 /legacy/ 的檔在正式打包會加上 .legacy-ui，這裡保留同樣的路徑層級）。
 *   不寫檔（build.write = false），不連網、不讀 .env、不啟動伺服器；同一份原始檔連跑兩次數字相同。
 *   KB = 1000 bytes；合計的 gzip 是各支 gzip level 9 相加，只當參考、不設門檻。
 *
 * 用法：
 *   node scripts/check-cp-css-budget.mjs [上限] [--rev <commit>] [--dist <目錄>]
 *   上限：純數字是位元組（例 73400），帶 KB 是千位元組（例 73.4KB）；沒給只印數字、不判定。
 *   超過上限結束碼 1；等於上限通過。
 *   --rev：改量某個 commit 的七支（用 git show 讀出，不動工作樹）。
 *   --dist：對帳用的打包目錄（預設 dist）；存在時列出含賽事根節點選擇器的 CSS 檔與大小，只供人看。
 *
 * 上限調整紀錄（package.json 的 check:cp-css）：
 *   2026-11-27 130809 → 131475（＋666，實量）：賽事名單名字斜方身分標籤 .cpn-*（站長選 B 版、顧問 §3.906 選②照實上調、不放共用檔）。
 *     量法：本腳本 --rev origin/main 為 130761、改後工作樹 131475（較 origin/main 實量 ＋714）；只隨名單頁、登錄頁的延後載入塊載入，不進入口。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const KB = 1000;

/** 賽事樣式七支（相對專案根目錄）。 */
export const CP_CSS_FILES = Object.freeze([
  'src/features/tournaments/tournaments.css',
  'src/features/tournaments/list-v2.css',
  'src/features/tournaments/legacy/tournaments-glass.css',
  'src/features/competitions/competitions.css',
  'src/features/competitions/live/live.css',
  'src/features/competitions/step4b/step4b.css',
  'src/features/competitions/live/score-fullscreen.css',
]);

/** 對帳時用來認出賽事樣式的選擇器。 */
export const RECONCILE_MARKERS = Object.freeze(['.cps-root', '.s4-root', '.s4-page', '#page-tournaments']);

/** 與 vite.config.ts 的 build.target 相同（LINE 內建瀏覽器相容目標）。 */
export const BUILD_TARGET = Object.freeze(['es2020', 'chrome87', 'safari14']);

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 拿掉行首的 @import（不展開）。回傳 { css, removed }。 */
export function stripImports(css) {
  const removed = css.match(/^@import[^;]*;/gm) || [];
  return { css: css.replace(/^@import[^;]*;[ \t]*\r?\n?/gm, ''), removed };
}

/** 解析上限。沒給回傳 null（不判定）。純數字＝位元組，帶 KB＝千位元組（1KB＝1000）。 */
export function parseLimit(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const text = String(raw).trim().replace(/,/g, '');
  const m = /^(\d+(?:\.\d+)?)(\s*kb)?$/i.exec(text);
  if (!m) throw new Error(`上限格式不正確：${raw}（例：73400、73.4KB）`);
  const n = Number(m[1]);
  return Math.round(m[2] ? n * KB : n);
}

/** 是否超過上限。等於上限不算超過；數字無效時視為超過（fail-closed）。 */
export function exceedsLimit(total, limit) {
  if (limit == null) return false;
  if (!Number.isFinite(total) || total < 0) return true;
  return total > limit;
}

/** 讀七支原始內容：沒給 rev 讀工作樹，給了用 git show 讀那個 commit。 */
export function readSources(rev, root = ROOT) {
  return CP_CSS_FILES.map((rel) => {
    const css = rev
      ? execFileSync('git', ['show', `${rev}:${rel}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      : readFileSync(path.join(root, rel), 'utf8');
    return { rel, css };
  });
}

/**
 * 用專案的 Vite 把每支各自打包壓縮，回傳每支的 { rel, raw, min, gzip, removedImports }。
 * sources：[{ rel, css }]；rel 保留原本的目錄層級（/legacy/ 的判斷靠它）。
 */
export async function measureSources(sources) {
  const { build } = await import('vite');
  const { legacyCssScope } = await import('./legacy-css-scope.mjs');
  const work = mkdtempSync(path.join(tmpdir(), 'cp-css-budget-'));
  try {
    const input = {};
    const meta = [];
    sources.forEach(({ rel, css }, i) => {
      const { css: body, removed } = stripImports(css);
      const file = path.join(work, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, body);
      const entry = path.join(work, `entry-${i}.js`);
      writeFileSync(entry, `import ${JSON.stringify('./' + rel.split(path.sep).join('/'))};\n`);
      input[`cp${i}`] = entry;
      meta.push({ rel, raw: Buffer.byteLength(css), removedImports: removed });
    });
    const out = await build({
      configFile: false,
      root: work,
      publicDir: false,
      logLevel: 'silent',
      cacheDir: path.join(work, '.vite'),
      css: { postcss: { plugins: [legacyCssScope()] } },
      build: {
        target: [...BUILD_TARGET],
        cssCodeSplit: true,
        write: false,
        modulePreload: false,
        rollupOptions: { input, output: { assetFileNames: 'assets/[name][extname]', entryFileNames: '[name].js' } },
      },
    });
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output);
    // 內容相同的樣式會被合併成同一個檔，所以從入口 chunk 的 importedCss 找對應的檔，不靠檔名。
    return meta.map((m, i) => {
      const chunk = outputs.find((o) => o.type === 'chunk' && o.name === `cp${i}`);
      const cssName = chunk?.viteMetadata ? [...chunk.viteMetadata.importedCss][0] : undefined;
      const asset = outputs.find((o) => o.type === 'asset' && o.fileName === cssName);
      if (!asset) throw new Error(`打包結果找不到 ${m.rel} 的樣式`);
      const buf = Buffer.from(asset.source);
      return { ...m, min: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length };
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** 對帳：dist 內含賽事根節點選擇器的 CSS 檔與大小（只供人看）。 */
export function reconcileDist(distDir) {
  const assets = path.join(distDir, 'assets');
  if (!existsSync(assets)) return null;
  return readdirSync(assets)
    .filter((f) => f.endsWith('.css'))
    .map((f) => ({ file: f, text: readFileSync(path.join(assets, f), 'utf8') }))
    .filter(({ text }) => RECONCILE_MARKERS.some((m) => text.includes(m)))
    .map(({ file, text }) => ({ file, bytes: Buffer.byteLength(text), markers: RECONCILE_MARKERS.filter((m) => text.includes(m)) }));
}

export function renderReport(rows, limit, reconcile, rev) {
  const total = rows.reduce((s, r) => s + r.min, 0);
  const gz = rows.reduce((s, r) => s + r.gzip, 0);
  const lines = [`賽事樣式七支（${rev ? `commit ${rev}` : '工作樹'}；各支單獨打包、@import 不展開；KB = 1000 bytes）`];
  for (const r of rows) lines.push(`  ${r.rel}  ${r.min} bytes（原始 ${r.raw}，gzip ${r.gzip}）`);
  lines.push(`七支合計 ${total} bytes（${(total / KB).toFixed(2)} KB）；gzip 相加 ${gz} bytes（只當參考）`);
  for (const r of rows) if (r.removedImports.length) lines.push(`  註：${r.rel} 不展開 ${r.removedImports.join(' ')}`);
  if (limit == null) lines.push('沒有給上限：只印數字、不判定。');
  else lines.push(`上限 ${limit} bytes（${(limit / KB).toFixed(2)} KB）：${exceedsLimit(total, limit) ? `超過 ${total - limit} bytes` : `通過，餘 ${limit - total} bytes`}`);
  if (reconcile) {
    lines.push('對帳（dist 內含賽事根節點選擇器的 CSS 檔，會混進同一延遲載入檔的其他樣式，只供人看）：');
    for (const r of reconcile) lines.push(`  ${r.file}  ${r.bytes} bytes  [${r.markers.join(' ')}]`);
  }
  return { text: lines.join('\n'), total };
}

export function parseArgs(argv) {
  const opts = { limit: null, rev: null, dist: 'dist' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rev') opts.rev = argv[++i];
    else if (a === '--dist') opts.dist = argv[++i];
    else opts.limit = parseLimit(a);
  }
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  const rows = await measureSources(readSources(opts.rev));
  const reconcile = opts.rev ? null : reconcileDist(path.resolve(ROOT, opts.dist));
  const { text, total } = renderReport(rows, opts.limit, reconcile, opts.rev);
  console.log(text);
  process.exitCode = exceedsLimit(total, opts.limit) ? 1 : 0;
}

// 兩邊都取 realpath 再比（經由 junction 執行時 argv[1] 不會解析連結）。
function isMainModule() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(path.resolve(argv1)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) await main();
