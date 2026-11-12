/**
 * chunk-groups.ts — 打包分塊規則（UPD-2，設計稿 upd2-split-design-2026-11-10 §3）。
 *
 * 目的：讓主程式（入口 index-*.js）變成「沒有任何 chunk 匯入的葉子」。
 * 入口開頭的載入表列著所有分頁檔名，分頁一改名入口必改名；以前約 44 個分頁直接匯入入口裡的共用綁定，
 * 所以入口改名會連帶它們全部改名。改成：
 *   - i18n-<語系>：非預設語系字典，一語系一個（原 manualChunks 搬過來；zh-TW 不拆，留在 i18n 靜態匯入處）。
 *   - vendor-preact：首屏的 preact／preact-iso（版本不變就永遠同名）。
 *   - app-shared：主程式靜態閉包中、也被任一動態載入目標（分頁、lazy 元件、lazy 資料模組）用到的 src 模組。
 *     另含主程式靜態閉包裡的全部 .css：首屏 CSS 只有這一個檔，規則先後＝匯入先後（入口不含 CSS）。
 *   - app-dyn：上一類裡「會動態匯入其他 App 模組」的少數模組（及靜態匯入它們的模組，往上收到不動點）。
 *     動態匯入的 i18n-<語系> 字典不算（不含 App 程式，算進來會把 i18n.ts 及其所有匯入者拉進來）。
 *     若留在 app-shared，app-shared 的內容會含那些 lazy 檔名，任一 lazy 檔改名就讓所有分頁連鎖改名。
 *   - 其餘主程式專用模組留在入口（Rolldown 預設）。
 * 優先序一定要 app-shared 高於 app-dyn：includeDependenciesRecursively 預設 true，app-dyn 先抓會把共用模組全拉進去。
 *
 * 失敗保底：拿不到模組資訊時分類為空、全部回 null，交還 Rolldown 自動切法（最壞退回現狀，不會壞）；
 * scripts/check-chunk-graph.mjs 的不變式會把「退回現狀」抓成紅燈。
 * 名稱固定，不得把版號、日期、建置編號放進名稱或內容（R-UPD-033）。
 *
 * 另含兩個只在環境變數存在時才動作的建置外掛（正式建置不設變數，外掛不做事）：
 *   - FCB_CHUNK_GRAPH=<路徑>：把 chunk 圖寫成 JSON（給 check-chunk-graph.mjs）。
 *   - FCB_RENAME_PROBE=<src 相對路徑>：在該檔尾端加一行有副作用的程式（給 check-rename-scope.mjs 模擬「改一行」）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export type ModInfo = {
  readonly importedIds: readonly string[];
  readonly dynamicallyImportedIds: readonly string[];
};
export type Kind = 'shared' | 'dyn';
type InfoFn = (id: string) => ModInfo | null;

/** 比對用：反斜線轉斜線、去掉 ?query、磁碟代號小寫。不拿來回傳給 Rolldown。 */
export function normalizeId(id: string): string {
  let s = String(id).replace(/\\/g, '/');
  const q = s.indexOf('?');
  if (q >= 0) s = s.slice(0, q);
  return s.replace(/^([A-Za-z]):\//, (_m, d: string) => `${d.toLowerCase()}:/`);
}

/** 一般 CSS 匯入（不帶 ?query）。 */
function isPlainCss(id: string): boolean {
  return /\.css$/i.test(String(id));
}

function srcPrefix(srcDir: string): string {
  const s = normalizeId(srcDir);
  return s.endsWith('/') ? s : `${s}/`;
}

/**
 * 依模組圖分類（設計稿 §3.2）。info 回 null 的模組視為沒有匯入；entry 拿不到資訊回空 Map。
 * 回傳的 key 是 normalizeId 後的 id。
 */
export function classifyAppModules(entryId: string, srcDir: string, info: InfoFn): Map<string, Kind> {
  const result = new Map<string, Kind>();
  const prefix = srcPrefix(srcDir);
  const inSrc = (id: string) => normalizeId(id).startsWith(prefix);
  const cache = new Map<string, ModInfo | null>();
  const get = (id: string): ModInfo | null => {
    const key = normalizeId(id);
    if (!cache.has(key)) {
      let found: ModInfo | null = null;
      try {
        found = info(id);
      } catch {
        found = null;
      }
      cache.set(key, found);
    }
    return cache.get(key) ?? null;
  };
  if (!get(entryId)) return result;

  /** 經 importedIds 的閉包（含起點）。key 為正規化 id，值為原始 id（往下查 info 用）。 */
  const staticClosure = (roots: Iterable<string>, into: Map<string, string>) => {
    const stack = [...roots];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      const key = normalizeId(id);
      if (into.has(key)) continue;
      into.set(key, id);
      for (const next of get(id)?.importedIds ?? []) stack.push(next);
    }
  };

  // 1. initial：入口的靜態閉包
  const initial = new Map<string, string>();
  staticClosure([entryId], initial);

  // 2. lazyRoots：從入口經靜態＋動態匯入走遍全部，收集「不在 initial」的動態匯入目標
  const lazyRoots: string[] = [];
  const seen = new Set<string>();
  const walk = [entryId];
  while (walk.length > 0) {
    const id = walk.pop() as string;
    const key = normalizeId(id);
    if (seen.has(key)) continue;
    seen.add(key);
    const mi = get(id);
    if (!mi) continue;
    for (const next of mi.importedIds) walk.push(next);
    for (const next of mi.dynamicallyImportedIds) {
      if (!initial.has(normalizeId(next))) lazyRoots.push(next);
      walk.push(next);
    }
  }

  // 3. lazyReach：各 lazyRoot 的靜態閉包聯集
  const lazyReach = new Map<string, string>();
  staticClosure(lazyRoots, lazyReach);

  // 4. shared 候選：initial ∩ lazyReach ∩ src（不含入口本身）
  //    另外 initial 裡的每個 .css 一律是 shared（不論分頁有沒有用到）：首屏 CSS 全部集中在 app-shared 一個檔，
  //    規則先後與原匯入順序（基底 5dd7c54 單一入口 CSS）相同。只收一部分會讓那幾支排到入口 CSS 之前、
  //    同權重規則勝負翻轉（UPD-2 Opus 終審 P1：.page-header h2 的 flex、建立活動彈窗 ≤480px 的 position）。
  //    帶 ?inline／?url 的 id 不以 .css 結尾，是 JS 字串模組，照一般規則分類。
  const entryKey = normalizeId(entryId);
  const candidates = new Map<string, string>();
  for (const [key, raw] of initial) {
    if (key === entryKey) continue;
    if ((lazyReach.has(key) && inSrc(raw)) || isPlainCss(raw)) candidates.set(key, raw);
  }

  // 5. dynSeed：候選中動態匯入了「src 下、不屬於候選、也不是 i18n-<語系> 字典」的模組。
  //    語系字典由 i18n 分組各自成檔，不含 App 程式、不隨分頁改名；算進來會把 i18n.ts 及所有靜態匯入它的
  //    共用模組（Text、Toast、AppConfirm…）全拉進 app-dyn，讓匯入 app-dyn 的檔從個位數變幾十個（終審 P2）。
  const dyn = new Set<string>();
  for (const [key, raw] of candidates) {
    const targets = get(raw)?.dynamicallyImportedIds ?? [];
    if (targets.some((t) => inSrc(t) && !candidates.has(normalizeId(t)) && i18nChunkName(t) == null)) dyn.add(key);
  }
  // 6. 往上收：候選中經靜態匯入可走到 dyn 的模組也是 dyn（反覆到不動點）
  let changed = dyn.size > 0;
  while (changed) {
    changed = false;
    for (const [key, raw] of candidates) {
      if (dyn.has(key)) continue;
      const imports = get(raw)?.importedIds ?? [];
      if (imports.some((t) => dyn.has(normalizeId(t)))) {
        dyn.add(key);
        changed = true;
      }
    }
  }

  // 7. 回傳
  for (const key of candidates.keys()) result.set(key, dyn.has(key) ? 'dyn' : 'shared');
  return result;
}

const I18N_RE = /[\\/](?:messages|locales|legacy)[\\/](zh-CN|en|ja|vi|th|ko)\.json$/;
const PREACT_RE = /[\\/]node_modules[\\/](?:preact|preact-iso)[\\/]/;

/** i18n 分組名稱（原 manualChunks 規則原樣搬來）。zh-TW 不拆。 */
export function i18nChunkName(id: string): string | null {
  const m = I18N_RE.exec(id);
  return m ? `i18n-${m[1]}` : null;
}

type ChunkCtx = { getModuleInfo(id: string): ModInfo | null };

/**
 * 給 build.rolldownOptions.output.codeSplitting 用。root 是專案根目錄（vite.config.ts 所在）。
 * 分類在第一次呼叫 name 時用 ctx.getModuleInfo 算一次，之後只查 Map（不靠「上一次 test 的模組」這類共享變數）。
 */
export function createCodeSplitting(root: string) {
  const entryId = path.resolve(root, 'src/main.tsx');
  const srcDir = path.resolve(root, 'src');
  let kinds: Map<string, Kind> | null = null;
  const kindOf = (id: string, ctx: ChunkCtx): Kind | undefined => {
    if (!kinds) {
      // 入口 id 在 Windows 可能是反斜線或斜線寫法，兩種都試。
      const candidates = [entryId, entryId.replace(/\\/g, '/')];
      const usable = candidates.find((c) => {
        try {
          return ctx.getModuleInfo(c) != null;
        } catch {
          return false;
        }
      });
      kinds = usable ? classifyAppModules(usable, srcDir, (m) => ctx.getModuleInfo(m)) : new Map();
      if (kinds.size === 0) {
        console.warn('[chunk-groups] 取不到模組圖，app-shared／app-dyn 分組未生效（退回 Rolldown 自動切法）');
      }
    }
    return kinds.get(normalizeId(id));
  };
  return {
    groups: [
      { debugName: 'i18n', name: (id: string) => i18nChunkName(id), test: I18N_RE, priority: 40 },
      { name: 'vendor-preact', test: PREACT_RE, tags: ['$initial' as const], priority: 30 },
      {
        debugName: 'app-shared',
        name: (id: string, ctx: ChunkCtx) => (kindOf(id, ctx) === 'shared' ? 'app-shared' : null),
        priority: 20,
      },
      {
        debugName: 'app-dyn',
        name: (id: string, ctx: ChunkCtx) => (kindOf(id, ctx) === 'dyn' ? 'app-dyn' : null),
        priority: 10,
      },
    ],
  };
}

function relToRoot(root: string, id: string): string {
  const n = normalizeId(id);
  const r = normalizeId(root).replace(/\/$/, '');
  return n.startsWith(`${r}/`) ? n.slice(r.length + 1) : n;
}

type GraphChunk = {
  fileName: string;
  name: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  moduleIds: string[];
  imports: string[];
  dynamicImports: string[];
};

/** FCB_CHUNK_GRAPH 有值時，在 generateBundle 把 chunk 圖寫到該路徑（不進 dist、不進離線快取）。 */
export function chunkGraphPlugin(root: string, outFile = process.env.FCB_CHUNK_GRAPH): Plugin {
  return {
    name: 'fcb-chunk-graph',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (!outFile) return;
      const chunks: GraphChunk[] = [];
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        chunks.push({
          fileName: item.fileName,
          name: item.name,
          isEntry: item.isEntry,
          isDynamicEntry: item.isDynamicEntry,
          moduleIds: item.moduleIds.map((id) => relToRoot(root, id)),
          imports: [...item.imports],
          dynamicImports: [...item.dynamicImports],
        });
      }
      chunks.sort((a, b) => a.fileName.localeCompare(b.fileName));
      const target = path.resolve(outFile);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify({ chunks }, null, 2)}\n`, 'utf8');
    },
  };
}

export const RENAME_PROBE_LINE = ';globalThis.__fcbRenameProbe=(globalThis.__fcbRenameProbe||0)+1;';
/** CSS 探針：加一條不會被壓縮掉的規則（註解會被壓縮刪掉，等於沒改）。 */
export const RENAME_PROBE_CSS_LINE = '.fcb-rename-probe{--fcb-rename-probe:1}';

/**
 * FCB_RENAME_PROBE=<src 相對路徑，例 src/features/clubs/pages/TeamsPage.tsx> 有值時，在該檔尾端加一行有副作用的程式
 * （.css 檔改加一條規則）。
 * 沒對到任何模組就讓建置失敗（防探針沒生效的假綠）。正式建置沒有該變數，外掛不做事。
 */
export function renameProbePlugin(root: string, probe = process.env.FCB_RENAME_PROBE): Plugin {
  const target = probe ? normalizeId(path.resolve(root, probe)) : '';
  let hit = false;
  return {
    name: 'fcb-rename-probe',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!target || normalizeId(id) !== target) return null;
      hit = true;
      return { code: `${code}\n${isPlainCss(id) ? RENAME_PROBE_CSS_LINE : RENAME_PROBE_LINE}\n`, map: null };
    },
    buildEnd() {
      if (target && !hit) throw new Error(`FCB_RENAME_PROBE 沒有對到任何模組：${probe}`);
    },
  };
}
