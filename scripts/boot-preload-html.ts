/**
 * 開機預載清單（顧問 §3.255 B′，2026-11-18）：建置時把「活動詳情頁」與「Firestore SDK」實際的 chunk 網址
 * 寫進 index.html 的 `<script type="application/json" id="fcb-boot-preload">`，
 * 由 `src/app/event-detail-preload.ts` 依路徑插 `<link rel="modulepreload">`。
 *
 * 為什麼不用 `import()` 預載：Vite 的 `import()` 包裝在失敗時一定發 `vite:preloadError`，
 * 即使呼叫端 `.catch` 也會先耗掉 chunk-reload 一頁唯一一次的重載機會；`<link>` 失敗只觸發 link 的 error，不發這個事件。
 * 取代：原本 main.tsx 以 `import('./features/events/pages/EventDetailPage')`、`import('firebase/firestore')` 預載。
 *
 * 網址取法：找含目標模組的 chunk，加上它遞迴的靜態 import（扣掉入口已載入的），再加這些 chunk 的 CSS。
 * 與路由 `load` 實際下載的是同一批檔（同一個 chunk 檔名）。找不到目標模組就讓建置失敗，不靜默少預載。
 * dev server 沒有 bundle，不注入（dev 不預載）。
 */
import type { Plugin } from 'vite';

export const BOOT_PRELOAD_SCRIPT_ID = 'fcb-boot-preload';

const DETAIL_MODULE = /[\\/]src[\\/]features[\\/]events[\\/]pages[\\/]EventDetailPage\.tsx$/;
const FIRESTORE_MODULE = /[\\/]node_modules[\\/]firebase[\\/]firestore[\\/]dist[\\/]esm[\\/]index\.esm\.js$/;

export interface BootPreloadGroup {
  js: string[];
  css: string[];
}

export interface BootPreloadMap {
  detail: BootPreloadGroup;
  firestore: BootPreloadGroup;
}

/** bundle 裡需要的最小形狀（Rollup／Rolldown OutputChunk 都有）。 */
export interface BundleChunkLike {
  type: 'chunk';
  fileName: string;
  isEntry: boolean;
  imports: readonly string[];
  moduleIds: readonly string[];
  viteMetadata?: { importedCss: Set<string> };
}

type BundleLike = Record<string, BundleChunkLike | { type: 'asset'; fileName: string }>;

function chunksOf(bundle: BundleLike): BundleChunkLike[] {
  return Object.values(bundle).filter((item): item is BundleChunkLike => item.type === 'chunk');
}

function staticClosure(start: readonly string[], byFile: Map<string, BundleChunkLike>): Set<string> {
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const dep of byFile.get(file)?.imports ?? []) stack.push(dep);
  }
  return seen;
}

function groupFor(
  label: string,
  pattern: RegExp,
  chunks: BundleChunkLike[],
  byFile: Map<string, BundleChunkLike>,
  loaded: Set<string>,
  base: string,
): BootPreloadGroup {
  const targets = chunks.filter((c) => !c.isEntry && c.moduleIds.some((id) => pattern.test(id)));
  if (targets.length === 0) throw new Error(`boot-preload：找不到含 ${label} 的 chunk`);
  const files = [...staticClosure(targets.map((c) => c.fileName), byFile)].filter((f) => !loaded.has(f));
  // 目標 chunk 排前面：網路壅塞時先抓最大的那個。
  const order = (f: string): number => (targets.some((c) => c.fileName === f) ? 0 : 1);
  files.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  return { js: files.map((f) => base + f), css: cssInDependencyOrder(targets, byFile, loaded).map((f) => base + f) };
}

/**
 * CSS 照 Vite `getCssFilesForChunk` 的順序：先走 imports（依賴的 CSS 在前），再放這個 chunk 自己的 importedCss。
 * 後插入的樣式表優先，順序必須跟路由載入時 Vite 插的一樣，否則 cascade 會變（Grok 初審 P2）。
 * 入口已載入的 chunk 不走（它們的 CSS 已在 HTML 裡）。
 * 取代：原本整份 CSS 依檔名字母排序。
 */
function cssInDependencyOrder(
  targets: readonly BundleChunkLike[],
  byFile: Map<string, BundleChunkLike>,
  loaded: Set<string>,
): string[] {
  const seenChunks = new Set<string>();
  const out: string[] = [];
  const seenCss = new Set<string>();
  const visit = (chunk: BundleChunkLike): void => {
    if (seenChunks.has(chunk.fileName) || loaded.has(chunk.fileName)) return;
    seenChunks.add(chunk.fileName);
    for (const dep of chunk.imports) {
      const next = byFile.get(dep);
      if (next) visit(next);
    }
    for (const css of chunk.viteMetadata?.importedCss ?? []) {
      if (seenCss.has(css)) continue;
      seenCss.add(css);
      out.push(css);
    }
  };
  for (const target of targets) visit(target);
  return out;
}

/** 純函式：從 bundle 算出預載清單。 */
export function computeBootPreload(bundle: BundleLike, base = '/'): BootPreloadMap {
  const chunks = chunksOf(bundle);
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const loaded = staticClosure(chunks.filter((c) => c.isEntry).map((c) => c.fileName), byFile);
  return {
    detail: groupFor('EventDetailPage', DETAIL_MODULE, chunks, byFile, loaded, base),
    firestore: groupFor('firebase/firestore', FIRESTORE_MODULE, chunks, byFile, loaded, base),
  };
}

/** 純函式：把清單插到 </head> 前。`<` 轉成 <，內容不可能提早結束 script。 */
export function injectBootPreload(html: string, map: BootPreloadMap): string {
  if (!html.includes('</head>')) throw new Error('boot-preload：index.html 找不到 </head>');
  const json = JSON.stringify(map).replace(/</g, '\\u003c');
  const tag = `<script type="application/json" id="${BOOT_PRELOAD_SCRIPT_ID}">${json}</script>`;
  return html.replace('</head>', () => `  ${tag}\n  </head>`);
}

export function bootPreloadHtml(): Plugin {
  let base = '/';
  return {
    name: 'fcb-boot-preload-html',
    configResolved(config) {
      base = config.base || '/';
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html;
        return injectBootPreload(html, computeBootPreload(ctx.bundle as unknown as BundleLike, base));
      },
    },
  };
}
