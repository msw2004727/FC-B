import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// T-041 A2：首頁（HomePage）隨入口同步載入，所以入口的「靜態 import 圖」不得含任何 Firebase SDK（firebase/*）的值 import，
// 否則 SDK（firestore 約 160 KB gz、auth 約 36 KB gz）會進入口的靜態相依，第一次 render 得等它們下載完。
// 資料模組要在查詢當下才動態取得 SDK（firestore 用 loadFirestoreSdk()，見 src/data/firestore-sdk.ts；
// app／auth／functions 在 data/firebase.ts 動態 import）。
// 本測試沿著 main.tsx 的靜態 import（排除 import type 與動態 import()）走訪原始碼，找出違規的檔案與路徑。
//
// 已知限制：只看語法，不理解字串／樣板字串裡長得像 import 的文字（會誤報，不會漏報）；
// 動態 import() 一律視為沒問題（那正是我們要的做法）。

const SRC = resolve(__dirname, '..');
const ENTRY = join(SRC, 'main.tsx');

/** 是不是 Firebase SDK 的模組名稱：firebase、firebase/app…，以及 @firebase/*。 */
export function isFirebaseSdkSpecifier(spec: string): boolean {
  return /^@?firebase(\/|$)/.test(spec);
}

/** 拿掉 // 與 /* *\/ 註解（保留字串內容，字串裡的 // 不算註解）。 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    const next = source[i + 1];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      out += ' ';
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

function isTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim();
  // import { type A, type B } from …：全是 type 就不會留在輸出
  const braces = /^\{([^}]*)\}$/.exec(trimmed);
  if (!braces) return false;
  const names = (braces[1] ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  return names.length > 0 && names.every((n) => /^type\s/.test(n));
}

/** 一段原始碼的靜態 import／re-export 模組名稱（不含 import type、全 type 的具名 import、動態 import()）。 */
export function staticImportSpecs(source: string): string[] {
  const code = stripComments(source);
  const specs: string[] = [];

  // import X from 'm'／import { a } from 'm'／import * as ns from 'm'／import type …（不含引號與分號的子句，避免跨敘述誤配）
  for (const m of code.matchAll(/\bimport\s*(type\b)?([^'"`;]*?)\bfrom\s*(['"])([^'"]+)\3/g)) {
    if (m[1]) continue; // import type …
    if (isTypeOnlyClause(m[2] ?? '')) continue;
    specs.push(m[4] ?? '');
  }
  // import 'm'（只有副作用）
  for (const m of code.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) specs.push(m[2] ?? '');
  // export * from 'm'／export { a } from 'm'（export type … 不算）
  for (const m of code.matchAll(/\bexport\s*(type\b)?\s*(\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"]+)\3/g)) {
    if (m[1]) continue;
    if (isTypeOnlyClause(m[2] ?? '')) continue;
    specs.push(m[4] ?? '');
  }
  return specs;
}

interface GraphIo {
  read(file: string): string | null;
  /** 把 import 的模組名稱解成檔案；不是專案內的檔案回 null。 */
  resolve(from: string, spec: string): string | null;
}

export interface SdkImporter {
  file: string;
  chain: string[];
}

export function findFirebaseSdkImporters(entry: string, io: GraphIo): SdkImporter[] {
  const parent = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [entry];
  const hits: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = io.read(file);
    if (source === null) continue;
    for (const spec of staticImportSpecs(source)) {
      if (isFirebaseSdkSpecifier(spec)) {
        hits.push(file);
        continue;
      }
      const next = io.resolve(file, spec);
      if (next && !seen.has(next)) {
        if (!parent.has(next)) parent.set(next, file);
        queue.push(next);
      }
    }
  }
  return [...new Set(hits)].map((file) => {
    const chain = [file];
    let cur = file;
    while (parent.has(cur)) {
      cur = parent.get(cur) as string;
      chain.push(cur);
    }
    return { file, chain: chain.reverse() };
  });
}

const realIo: GraphIo = {
  read: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null),
  resolve: (from, spec) => {
    let base: string;
    if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
    else return null;
    for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const candidate = base + ext;
      if (/\.(tsx?)$/.test(candidate) && existsSync(candidate)) return candidate;
    }
    return null;
  },
};

/** 虛擬檔案系統：key 是 '/a.ts' 這樣的路徑，模組名稱用 './a' 或 '/a'。 */
function virtualIo(files: Record<string, string>): GraphIo {
  return {
    read: (file) => files[file] ?? null,
    resolve: (_from, spec) => {
      const name = spec.replace(/^\.\//, '/');
      for (const ext of ['', '.ts', '.tsx']) {
        if (files[name + ext] !== undefined) return name + ext;
      }
      return null;
    },
  };
}

const rel = (p: string): string => p.replace(SRC, 'src').replace(/\\/g, '/');

describe('入口的靜態 import 圖', () => {
  it('不含任何 firebase/* SDK 的值 import（firestore、auth、functions、app 都要動態載入）', () => {
    const offenders = findFirebaseSdkImporters(ENTRY, realIo);
    expect(offenders.map((o) => `${rel(o.file)}\n  ← ${o.chain.map(rel).join(' → ')}`)).toEqual([]);
  });

  it('首頁路由同步載入：features/home/index.ts 靜態引入 HomePage（不再是入口執行完才發現的 lazy chunk）', () => {
    const source = readFileSync(join(SRC, 'features/home/index.ts'), 'utf8');
    expect(staticImportSpecs(source)).toContain('./pages/HomePage');
  });

  it('走訪器對真實檔案有效：對一個確實靜態 import firestore 的檔案能抓到', () => {
    const hits = findFirebaseSdkImporters(join(SRC, 'features/events/data/events-repo.ts'), realIo);
    expect(hits.map((h) => rel(h.file))).toContain('src/features/events/data/events-repo.ts');
  });
});

describe('staticImportSpecs（突變案例：寫法再怪也要抓到）', () => {
  it.each([
    ['一般寫法', `import { getDocs } from 'firebase/firestore';`, ['firebase/firestore']],
    ['無空格', `import{getDocs}from'firebase/firestore';`, ['firebase/firestore']],
    ['雙引號、預設匯入', `import app from "firebase/app";`, ['firebase/app']],
    ['namespace 匯入', `import * as fs from 'firebase/firestore'`, ['firebase/firestore']],
    ['前面有區塊註解', `/* 註解 */ import { x } from 'firebase/auth';`, ['firebase/auth']],
    ['前面有多行區塊註解', `/*\n * 說明\n */\nimport { x } from 'firebase/functions';`, ['firebase/functions']],
    ['同一行多個敘述', `import a from './a';import b from 'firebase/auth';`, ['./a', 'firebase/auth']],
    ['多行具名匯入', `import {\n  collection,\n  getDocs,\n} from 'firebase/firestore';`, ['firebase/firestore']],
    ['混合：預設值 ＋ type 具名', `import X, { type A } from 'firebase/app';`, ['firebase/app']],
    ['具名匯入混 type 與值', `import { type A, getDocs } from 'firebase/firestore';`, ['firebase/firestore']],
    ['只有副作用', `import 'firebase/app';`, ['firebase/app']],
    ['只有副作用（無空格）', `import'firebase/app';`, ['firebase/app']],
    ['re-export *', `export * from 'firebase/functions';`, ['firebase/functions']],
    ['re-export 具名（無空格）', `export{getDocs}from'firebase/firestore';`, ['firebase/firestore']],
    ['@firebase 範圍套件', `import { x } from '@firebase/app';`, ['@firebase/app']],
    ['字串裡的 // 不是註解', `const u = 'http://x'; import a from 'firebase/app';`, ['firebase/app']],
  ])('抓到：%s', (_name, source, expected) => {
    expect(staticImportSpecs(source)).toEqual(expected);
  });

  it.each([
    ['import type', `import type { A } from 'firebase/firestore';`],
    ['全是 type 的具名匯入', `import { type A, type B } from 'firebase/firestore';`],
    ['export type', `export type { A } from 'firebase/firestore';`],
    ['動態 import', `const m = await import('firebase/auth');`],
    ['動態 import（then）', `import('firebase/functions').then((m) => m);`],
    ['行註解', `// import { x } from 'firebase/app';`],
    ['區塊註解', `/* import { x } from 'firebase/app'; */`],
    ['行尾註解', `const a = 1; // import { x } from 'firebase/app'`],
  ])('不算靜態 import：%s', (_name, source) => {
    expect(staticImportSpecs(source).filter(isFirebaseSdkSpecifier)).toEqual([]);
  });

  it('isFirebaseSdkSpecifier：firebase、firebase/*、@firebase/* 才算，firebase-tools 之類不算', () => {
    for (const ok of ['firebase', 'firebase/app', 'firebase/firestore', '@firebase/app']) {
      expect(isFirebaseSdkSpecifier(ok), ok).toBe(true);
    }
    for (const no of ['firebase-tools', './firebase', '@/data/firebase', 'my-firebase/x']) {
      expect(isFirebaseSdkSpecifier(no), no).toBe(false);
    }
  });
});

describe('findFirebaseSdkImporters（虛擬專案，突變案例）', () => {
  it('入口經過兩層才靜態 import firestore（寫法很怪）→ 抓得到，且路徑正確', () => {
    const io = virtualIo({
      '/main.tsx': `import { App } from './app';`,
      '/app.ts': `export * from './data';`,
      '/data.ts': `/* 資料層 */ import{getDocs}from"firebase/firestore";`,
    });
    const hits = findFirebaseSdkImporters('/main.tsx', io);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.chain).toEqual(['/main.tsx', '/app.ts', '/data.ts']);
  });

  it('同樣的路徑改成動態 import()、import type → 抓不到（正確做法）', () => {
    const io = virtualIo({
      '/main.tsx': `import { App } from './app';`,
      '/app.ts': `import type { Firestore } from 'firebase/firestore';\nexport const load = () => import('firebase/firestore');`,
    });
    expect(findFirebaseSdkImporters('/main.tsx', io)).toEqual([]);
  });

  it('auth、functions、app 也一樣會被抓到', () => {
    for (const sdk of ['firebase/auth', 'firebase/functions', 'firebase/app']) {
      const io = virtualIo({
        '/main.tsx': `import './a';`,
        '/a.ts': `import x from '${sdk}';`,
      });
      expect(findFirebaseSdkImporters('/main.tsx', io).map((h) => h.file), sdk).toEqual(['/a.ts']);
    }
  });
});
