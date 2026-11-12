/**
 * check-chunk-graph.mjs — 檢查 UPD-2 分塊的不變式（設計稿 upd2-split-design-2026-11-10 §5.1）。
 *
 * 輸入：建置時設 FCB_CHUNK_GRAPH=<路徑> 由 scripts/chunk-groups.ts#chunkGraphPlugin 寫出的 JSON。
 * 斷言（任一不成立就失敗）：
 *   (a) 入口以外的 chunk，imports 都不含入口檔（入口是沒人匯入的葉子；漏抓的共用模組會讓這條變紅）。
 *   (b) app-shared 的 imports／dynamicImports 只能指向「不含 src/ 模組」的 chunk 或它自己
 *       （設計稿只寫 dynamicImports；靜態匯入一併查，app-shared 不得依賴任何會隨 App 程式改名的檔）。
 *   (c) app-shared、vendor-preact 各剛好一個檔；app-dyn 至多一個（可不存在）。入口剛好一個。
 *   (d) 6 個 i18n-<語系> 檔存在；沒有 i18n-zh-TW。
 *   (e) 印出入口仍含的 src 模組清單（只印不擋），供審查比對主程式專用清單。
 *
 * 用法：node scripts/check-chunk-graph.mjs <chunk-graph.json>
 */
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const I18N_LANGS = ['zh-CN', 'en', 'ja', 'vi', 'th', 'ko'];

const baseName = (fileName) => String(fileName).split('/').pop() ?? '';
/**
 * assets/app-shared-AbC12_-x.js → app-shared（去掉 -<8 字元雜湊>.js）。
 * 雜湊是 8 字元（Vite 預設 [hash]），可能含 - 與 _，不能用「最後一個 -」切。
 */
export function chunkStem(fileName) {
  return baseName(fileName).replace(/-[A-Za-z0-9_-]{8}\.js$/, '');
}
const isSrc = (id) => String(id).startsWith('src/');

/** 回傳 { ok, errors: string[], entrySrcModules: string[] }。不丟例外。 */
export function checkChunkGraph(graph) {
  const errors = [];
  const chunks = Array.isArray(graph?.chunks) ? graph.chunks : [];
  if (chunks.length === 0) return { ok: false, errors: ['chunk 圖是空的'], entrySrcModules: [] };

  const entries = chunks.filter((c) => c.isEntry);
  if (entries.length !== 1) {
    errors.push(`入口 chunk 必須剛好一個，目前 ${entries.length} 個：${entries.map((c) => c.fileName).join(', ')}`);
  }
  const entry = entries[0];
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const byStem = (stem) => chunks.filter((c) => chunkStem(c.fileName) === stem);

  // (a)
  if (entry) {
    for (const c of chunks) {
      if (c === entry) continue;
      if ((c.imports ?? []).includes(entry.fileName)) errors.push(`(a) ${c.fileName} 靜態匯入入口 ${entry.fileName}`);
    }
  }

  // (c)
  const shared = byStem('app-shared');
  const vendor = byStem('vendor-preact');
  const dyn = byStem('app-dyn');
  if (shared.length !== 1) errors.push(`(c) app-shared 必須剛好一個，目前 ${shared.length} 個`);
  if (vendor.length !== 1) errors.push(`(c) vendor-preact 必須剛好一個，目前 ${vendor.length} 個`);
  if (dyn.length > 1) errors.push(`(c) app-dyn 至多一個，目前 ${dyn.length} 個`);

  // (b)
  for (const s of shared) {
    for (const target of [...(s.imports ?? []), ...(s.dynamicImports ?? [])]) {
      if (target === s.fileName) continue;
      const t = byFile.get(target);
      if (!t) {
        errors.push(`(b) app-shared 指向不在 chunk 圖裡的檔：${target}`);
        continue;
      }
      const srcMods = (t.moduleIds ?? []).filter(isSrc);
      if (srcMods.length > 0) {
        errors.push(`(b) app-shared 指向含 App 程式的 chunk ${target}（${srcMods.slice(0, 3).join(', ')}${srcMods.length > 3 ? '…' : ''}）`);
      }
    }
  }

  // (d)
  for (const lang of I18N_LANGS) {
    if (byStem(`i18n-${lang}`).length !== 1) errors.push(`(d) i18n-${lang} 必須剛好一個檔，目前 ${byStem(`i18n-${lang}`).length} 個`);
  }
  if (byStem('i18n-zh-TW').length > 0) errors.push('(d) 不得有 i18n-zh-TW（預設語系要留在 i18n 靜態匯入處）');

  // (e)
  const entrySrcModules = entry ? (entry.moduleIds ?? []).filter(isSrc).sort() : [];
  return { ok: errors.length === 0, errors, entrySrcModules };
}

export function renderChunkGraphReport(result) {
  const lines = ['UPD-2 分塊不變式'];
  lines.push(`(e) 入口仍含的 src 模組 ${result.entrySrcModules.length} 個（只印不擋）：`);
  for (const id of result.entrySrcModules) lines.push(`  ${id}`);
  if (result.ok) lines.push('結果：通過');
  else {
    lines.push(`結果：失敗 ${result.errors.length} 項`);
    for (const e of result.errors) lines.push(`  ${e}`);
  }
  return lines.join('\n');
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('用法：node scripts/check-chunk-graph.mjs <chunk-graph.json>');
    process.exitCode = 1;
    return;
  }
  let graph;
  try {
    graph = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`讀不到 chunk 圖：${file}（${err instanceof Error ? err.message : String(err)}）`);
    process.exitCode = 1;
    return;
  }
  const result = checkChunkGraph(graph);
  console.log(renderChunkGraphReport(result));
  process.exitCode = result.ok ? 0 : 1;
}

// 同 check-bundle-budget.mjs：兩邊取 realpath 再比，經由 junction 執行也不會靜默不跑。
function isMainModule() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(path.resolve(argv1)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) main();
