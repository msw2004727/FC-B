// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { I18N_LANGS, checkChunkGraph, chunkStem, renderChunkGraphReport } from './check-chunk-graph.mjs';

const H = 'Ab-12_xY'; // 8 字元雜湊，含 - 與 _
const f = (stem) => `assets/${stem}-${H}.js`;
const chunk = (stem, extra = {}) => ({
  fileName: f(stem), name: stem, isEntry: false, isDynamicEntry: false, moduleIds: [], imports: [], dynamicImports: [], ...extra,
});

function goodGraph() {
  return {
    chunks: [
      chunk('index', { isEntry: true, moduleIds: ['src/main.tsx', 'src/app/App.tsx'], imports: [f('app-shared'), f('vendor-preact'), f('app-dyn')], dynamicImports: [f('TeamsPage')] }),
      chunk('app-shared', { moduleIds: ['src/data/firebase.ts', '\0vite/preload-helper.js'], imports: [f('vendor-preact')], dynamicImports: [f('firebase-app')] }),
      chunk('app-dyn', { moduleIds: ['src/features/events/data/use-events.ts'], imports: [f('app-shared')], dynamicImports: [f('events-repo')] }),
      chunk('vendor-preact', { moduleIds: ['node_modules/preact/dist/preact.mjs'] }),
      chunk('firebase-app', { moduleIds: ['node_modules/firebase/app/dist/index.esm.js'] }),
      chunk('events-repo', { isDynamicEntry: true, moduleIds: ['src/features/events/data/events-repo.ts'], imports: [f('app-shared')] }),
      chunk('TeamsPage', { isDynamicEntry: true, moduleIds: ['src/features/clubs/pages/TeamsPage.tsx'], imports: [f('app-shared'), f('vendor-preact')] }),
      ...I18N_LANGS.map((lang) => chunk(`i18n-${lang}`, { moduleIds: [`src/i18n/messages/${lang}.json`] })),
    ],
  };
}

describe('chunkStem', () => {
  it('雜湊含 - 也切得對', () => {
    expect(chunkStem(`assets/app-shared-${H}.js`)).toBe('app-shared');
    expect(chunkStem('assets/i18n-zh-CN-DM9-cYni.js')).toBe('i18n-zh-CN');
  });
});

describe('checkChunkGraph', () => {
  it('合格的圖通過，並列出入口的 src 模組', () => {
    const r = checkChunkGraph(goodGraph());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.entrySrcModules).toEqual(['src/app/App.tsx', 'src/main.tsx']);
    expect(renderChunkGraphReport(r)).toContain('結果：通過');
  });

  it('(a) 分頁直接匯入入口 → 失敗（漏抓共用模組）', () => {
    const g = goodGraph();
    g.chunks.find((c) => c.name === 'TeamsPage').imports.push(f('index'));
    const r = checkChunkGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/\(a\).*TeamsPage/);
  });

  it('(b) app-shared 動態匯入含 App 程式的 chunk → 失敗', () => {
    const g = goodGraph();
    g.chunks.find((c) => c.name === 'app-shared').dynamicImports.push(f('events-repo'));
    expect(checkChunkGraph(g).errors.join('\n')).toMatch(/\(b\).*events-repo/);
  });

  it('(b) app-shared 靜態匯入 app-dyn → 失敗；指向不存在的檔也失敗', () => {
    const g = goodGraph();
    g.chunks.find((c) => c.name === 'app-shared').imports.push(f('app-dyn'), 'assets/missing-12345678.js');
    const msg = checkChunkGraph(g).errors.join('\n');
    expect(msg).toMatch(/\(b\).*app-dyn/);
    expect(msg).toMatch(/\(b\).*missing/);
  });

  it('(c) 沒有 app-shared（分組沒生效、退回自動切法）→ 失敗', () => {
    const g = goodGraph();
    g.chunks = g.chunks.filter((c) => c.name !== 'app-shared');
    expect(checkChunkGraph(g).errors.join('\n')).toMatch(/\(c\) app-shared/);
  });

  it('(c) app-dyn 可以不存在，但不能有兩個', () => {
    const g = goodGraph();
    g.chunks = g.chunks.filter((c) => c.name !== 'app-dyn');
    expect(checkChunkGraph(g).ok).toBe(true);
    const g2 = goodGraph();
    g2.chunks.push({ ...chunk('app-dyn'), fileName: 'assets/app-dyn-zzzzzzzz.js' });
    expect(checkChunkGraph(g2).errors.join('\n')).toMatch(/\(c\) app-dyn/);
  });

  it('(d) 缺語系檔或多了 zh-TW → 失敗', () => {
    const g = goodGraph();
    g.chunks = g.chunks.filter((c) => c.name !== 'i18n-ja');
    g.chunks.push(chunk('i18n-zh-TW'));
    const msg = checkChunkGraph(g).errors.join('\n');
    expect(msg).toMatch(/i18n-ja/);
    expect(msg).toMatch(/zh-TW/);
  });

  it('入口不是剛好一個、或圖是空的 → 失敗，不丟例外', () => {
    const g = goodGraph();
    g.chunks.find((c) => c.name === 'TeamsPage').isEntry = true;
    expect(checkChunkGraph(g).errors.join('\n')).toMatch(/入口 chunk 必須剛好一個/);
    expect(checkChunkGraph({}).ok).toBe(false);
    expect(checkChunkGraph(null).ok).toBe(false);
  });
});
