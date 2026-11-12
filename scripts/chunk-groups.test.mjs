// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RENAME_PROBE_LINE,
  chunkGraphPlugin,
  classifyAppModules,
  createCodeSplitting,
  i18nChunkName,
  normalizeId,
  renameProbePlugin,
} from './chunk-groups.ts';

const temps = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 假模組圖：{ id: [static[], dynamic[]] } */
function graph(def) {
  return (id) => {
    const hit = def[normalizeId(id)];
    return hit ? { importedIds: hit[0], dynamicallyImportedIds: hit[1] ?? [] } : null;
  };
}

const S = '/r/src';
const p = (rel) => `${S}/${rel}`;

describe('classifyAppModules', () => {
  const base = {
    [p('main.tsx')]: [[p('shared.ts'), p('main-only.ts'), p('hook.ts'), '/r/node_modules/preact/dist/preact.mjs'], [p('PageA.tsx'), p('PageB.tsx')]],
    [p('shared.ts')]: [[p('dep.ts'), '/r/node_modules/preact/dist/preact.mjs'], ['/r/node_modules/firebase/app.js']],
    [p('dep.ts')]: [[]],
    [p('main-only.ts')]: [[p('dep.ts')]],
    [p('hook.ts')]: [[p('shared.ts')], [p('lazy-data.ts')]],
    [p('hook-user.ts')]: [[p('hook.ts')]],
    [p('PageA.tsx')]: [[p('shared.ts'), p('hook.ts'), p('lazy-only.ts')]],
    [p('PageB.tsx')]: [[p('shared.ts')]],
    [p('lazy-only.ts')]: [[]],
    [p('lazy-data.ts')]: [[]],
    '/r/node_modules/preact/dist/preact.mjs': [[]],
    '/r/node_modules/firebase/app.js': [[]],
  };

  it('分出 shared／dyn；主程式專用、lazy 專用與 node_modules 不分類', () => {
    const kinds = classifyAppModules(p('main.tsx'), S, graph(base));
    expect(Object.fromEntries(kinds)).toEqual({
      [p('shared.ts')]: 'shared',
      [p('dep.ts')]: 'shared', // 主程式專用模組也用到，但分頁經 shared 用到 → 共用
      [p('hook.ts')]: 'dyn',
    });
  });

  it('動態匯入主程式專用模組的共用模組也算 dyn（否則共用檔會指向入口）', () => {
    const g = {
      ...base,
      [p('shared.ts')]: [[p('dep.ts')], [p('main-only.ts')]],
    };
    const kinds = classifyAppModules(p('main.tsx'), S, graph(g));
    expect(kinds.get(p('shared.ts'))).toBe('dyn');
  });

  it('往上收：靜態匯入 dyn 的共用模組也是 dyn，直到不動點', () => {
    const g = {
      ...base,
      [p('main.tsx')]: [[p('top.ts'), p('main-only.ts')], [p('PageA.tsx'), p('PageB.tsx')]],
      [p('top.ts')]: [[p('mid.ts')]],
      [p('mid.ts')]: [[p('hook.ts')]],
      [p('PageA.tsx')]: [[p('top.ts'), p('shared.ts')]],
    };
    const kinds = classifyAppModules(p('main.tsx'), S, graph(g));
    expect(kinds.get(p('hook.ts'))).toBe('dyn');
    expect(kinds.get(p('mid.ts'))).toBe('dyn');
    expect(kinds.get(p('top.ts'))).toBe('dyn');
    expect(kinds.get(p('shared.ts'))).toBe('shared');
  });

  it('動態匯入另一個共用模組不算 dyn', () => {
    const g = { ...base, [p('shared.ts')]: [[p('dep.ts')], [p('dep.ts')]] };
    expect(classifyAppModules(p('main.tsx'), S, graph(g)).get(p('shared.ts'))).toBe('shared');
  });

  it('JSON 字典與 CSS 一樣照模組圖分類', () => {
    const g = {
      ...base,
      [p('i18n/i18n.ts')]: [[p('i18n/messages/zh-TW.json'), p('ui/Toast.css')]],
      [p('i18n/messages/zh-TW.json')]: [[]],
      [p('ui/Toast.css')]: [[]],
      [p('main.tsx')]: [[...base[p('main.tsx')][0], p('i18n/i18n.ts')], base[p('main.tsx')][1]],
      [p('PageB.tsx')]: [[p('shared.ts'), p('i18n/i18n.ts')]],
    };
    const kinds = classifyAppModules(p('main.tsx'), S, graph(g));
    expect(kinds.get(p('i18n/messages/zh-TW.json'))).toBe('shared');
    expect(kinds.get(p('ui/Toast.css'))).toBe('shared');
  });

  it('Windows 反斜線與大寫磁碟代號的 id 也對得上', () => {
    const W = 'D:\\proj\\src';
    const w = (rel) => `${W}\\${rel.replace(/\//g, '\\')}`;
    const def = {
      [normalizeId(w('main.tsx'))]: [[w('shared.ts')], [w('Page.tsx')]],
      [normalizeId(w('shared.ts'))]: [[]],
      [normalizeId(w('Page.tsx'))]: [[w('shared.ts')]],
    };
    const kinds = classifyAppModules(w('main.tsx'), 'D:/proj/src', graph(def));
    expect(kinds.get('d:/proj/src/shared.ts')).toBe('shared');
    expect(kinds.size).toBe(1);
  });

  it('?query 的 id 去掉 query 後比對', () => {
    expect(normalizeId('C:\\a\\b.css?inline')).toBe('c:/a/b.css');
  });

  it('入口拿不到資訊回空 Map，info 丟例外也不往外丟', () => {
    expect(classifyAppModules(p('main.tsx'), S, () => null).size).toBe(0);
    expect(classifyAppModules(p('main.tsx'), S, () => {
      throw new Error('boom');
    }).size).toBe(0);
  });

  it('中間模組拿不到資訊時當成沒有匯入，不丟例外', () => {
    const g = { ...base };
    delete g[p('shared.ts')];
    const kinds = classifyAppModules(p('main.tsx'), S, graph(g));
    expect(kinds.get(p('shared.ts'))).toBe('shared');
    expect(kinds.has(p('dep.ts'))).toBe(false);
  });
});

describe('createCodeSplitting', () => {
  it('分組與優先序：i18n > vendor-preact > app-shared > app-dyn', () => {
    const cs = createCodeSplitting('/r');
    const names = cs.groups.map((g) => (typeof g.name === 'string' ? g.name : g.debugName));
    expect(names).toEqual(['i18n', 'vendor-preact', 'app-shared', 'app-dyn']);
    const prio = cs.groups.map((g) => g.priority);
    expect([...prio].sort((a, b) => b - a)).toEqual(prio);
    expect(cs.groups[1].tags).toEqual(['$initial']);
  });

  it('name 依分類回 app-shared／app-dyn，其餘 null；模組圖只算一次', () => {
    const root = path.resolve('/r');
    const src = (rel) => path.resolve(root, 'src', rel);
    const def = {
      [normalizeId(src('main.tsx'))]: [[src('shared.ts'), src('hook.ts')], [src('Page.tsx')]],
      [normalizeId(src('shared.ts'))]: [[]],
      [normalizeId(src('hook.ts'))]: [[src('shared.ts')], [src('lazy.ts')]],
      [normalizeId(src('Page.tsx'))]: [[src('shared.ts'), src('hook.ts')]],
      [normalizeId(src('lazy.ts'))]: [[]],
    };
    const getModuleInfo = vi.fn(graph(def));
    const ctx = { getModuleInfo };
    const cs = createCodeSplitting(root);
    const shared = cs.groups[2].name;
    const dyn = cs.groups[3].name;
    expect(shared(src('shared.ts'), ctx)).toBe('app-shared');
    const callsAfterFirst = getModuleInfo.mock.calls.length;
    expect(shared(src('hook.ts'), ctx)).toBeNull();
    expect(dyn(src('hook.ts'), ctx)).toBe('app-dyn');
    expect(dyn(src('shared.ts'), ctx)).toBeNull();
    expect(shared(src('Page.tsx'), ctx)).toBeNull();
    expect(shared(src('main.tsx'), ctx)).toBeNull();
    expect(getModuleInfo.mock.calls.length).toBe(callsAfterFirst);
  });

  it('getModuleInfo 一律回 null：全部回 null（退回自動切法）並警告一次', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cs = createCodeSplitting('/r');
    const ctx = { getModuleInfo: () => null };
    expect(cs.groups[2].name('/r/src/a.ts', ctx)).toBeNull();
    expect(cs.groups[3].name('/r/src/a.ts', ctx)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('vendor-preact 只抓 preact／preact-iso', () => {
    const t = createCodeSplitting('/r').groups[1].test;
    expect(t.test('C:\\r\\node_modules\\preact\\hooks\\dist\\hooks.mjs')).toBe(true);
    expect(t.test('/r/node_modules/preact-iso/src/router.js')).toBe(true);
    expect(t.test('/r/node_modules/preact-render-to-string/x.js')).toBe(false);
    expect(t.test('/r/node_modules/firebase/app.js')).toBe(false);
  });
});

describe('i18nChunkName（原 manualChunks 規則）', () => {
  it('六個非預設語系各一個 chunk，zh-TW 不拆', () => {
    for (const lang of ['zh-CN', 'en', 'ja', 'vi', 'th', 'ko']) {
      expect(i18nChunkName(`/r/src/i18n/messages/${lang}.json`)).toBe(`i18n-${lang}`);
      expect(i18nChunkName(`C:\\r\\src\\features\\events\\locales\\${lang}.json`)).toBe(`i18n-${lang}`);
      expect(i18nChunkName(`/r/src/i18n/legacy/${lang}.json`)).toBe(`i18n-${lang}`);
    }
    expect(i18nChunkName('/r/src/i18n/messages/zh-TW.json')).toBeNull();
    expect(i18nChunkName('/r/src/data/en.json')).toBeNull();
  });
});

describe('chunkGraphPlugin', () => {
  const bundle = {
    'assets/index-a.js': {
      type: 'chunk', fileName: 'assets/index-a.js', name: 'index', isEntry: true, isDynamicEntry: false,
      moduleIds: ['C:\\r\\src\\main.tsx', '\0vite/preload-helper.js'], imports: ['assets/app-shared-b.js'], dynamicImports: ['assets/Page-c.js'],
    },
    'assets/x.css': { type: 'asset', fileName: 'assets/x.css' },
  };

  it('沒有設定路徑時不做事', () => {
    const plugin = chunkGraphPlugin('C:\\r', '');
    expect(() => plugin.generateBundle.call({}, {}, bundle)).not.toThrow();
  });

  it('寫出相對路徑的 chunk 圖（只含 chunk）', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'fcb-graph-'));
    temps.push(dir);
    const out = path.join(dir, 'sub', 'graph.json');
    chunkGraphPlugin('C:\\r', out).generateBundle.call({}, {}, bundle);
    const json = JSON.parse(await readFile(out, 'utf8'));
    expect(json.chunks).toEqual([{
      fileName: 'assets/index-a.js', name: 'index', isEntry: true, isDynamicEntry: false,
      moduleIds: ['src/main.tsx', '\0vite/preload-helper.js'], imports: ['assets/app-shared-b.js'], dynamicImports: ['assets/Page-c.js'],
    }]);
  });
});

describe('renameProbePlugin', () => {
  it('沒有探針時不改任何檔', () => {
    const plugin = renameProbePlugin('/r', '');
    expect(plugin.transform('x', '/r/src/a.tsx')).toBeNull();
    expect(() => plugin.buildEnd()).not.toThrow();
  });

  it('只在探針檔尾端加一行；沒對到就讓建置失敗', () => {
    const root = path.resolve('/r');
    const plugin = renameProbePlugin(root, 'src/features/clubs/pages/TeamsPage.tsx');
    expect(plugin.transform('a', path.resolve(root, 'src/other.tsx'))).toBeNull();
    expect(() => plugin.buildEnd()).toThrow(/沒有對到/);
    const out = plugin.transform('a', `${path.resolve(root, 'src/features/clubs/pages/TeamsPage.tsx')}?v=1`);
    expect(out.code).toBe(`a\n${RENAME_PROBE_LINE}\n`);
    expect(() => plugin.buildEnd()).not.toThrow();
  });
});
