import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// T-041 A2：首頁（HomePage）隨入口同步載入，所以入口的「靜態 import 圖」不得含 Firestore SDK 的值 import，
// 否則 SDK（約 160 KB gz）會進入口的靜態相依，第一次 render 得等它下載完。
// 資料模組要在查詢當下才用 loadFirestoreSdk() 動態取得 SDK（見 src/data/firestore-sdk.ts）。
// 本測試沿著 main.tsx 的靜態 import（排除 import type 與動態 import()）走訪原始碼，找出違規的檔案與路徑。

const SRC = resolve(__dirname, '..');
const ENTRY = join(SRC, 'main.tsx');

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const candidate = base + ext;
    if (/\.(tsx?)$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

function staticImportSpecs(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specs: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) {
    if (m[1]) continue; // import type / export type
    const clause = (m[2] ?? '').trim();
    if (/^\{[^}]*\}$/.test(clause)) {
      const names = clause.replace(/[{}]/g, '').split(',').map((n) => n.trim()).filter(Boolean);
      if (names.length > 0 && names.every((n) => n.startsWith('type '))) continue;
    }
    specs.push(m[3] ?? m[4] ?? '');
  }
  return specs;
}

function findFirestoreImporters(entry: string): Array<{ file: string; chain: string[] }> {
  const parent = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [entry];
  const hits: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of staticImportSpecs(file)) {
      if (spec === 'firebase/firestore') {
        hits.push(file);
        continue;
      }
      const next = resolveImport(file, spec);
      if (next && !seen.has(next)) {
        if (!parent.has(next)) parent.set(next, file);
        queue.push(next);
      }
    }
  }
  const rel = (p: string): string => p.replace(SRC, 'src').replace(/\\/g, '/');
  return [...new Set(hits)].map((file) => {
    const chain = [file];
    let cur = file;
    while (parent.has(cur)) {
      cur = parent.get(cur) as string;
      chain.push(cur);
    }
    return { file: rel(file), chain: chain.reverse().map(rel) };
  });
}

describe('入口的靜態 import 圖', () => {
  it('不含 firebase/firestore 的值 import（SDK 要在查詢當下動態載入）', () => {
    const offenders = findFirestoreImporters(ENTRY);
    expect(offenders.map((o) => `${o.file}\n  ← ${o.chain.join(' → ')}`)).toEqual([]);
  });

  it('首頁路由同步載入：features/home/index.ts 靜態引入 HomePage（不再是入口執行完才發現的 lazy chunk）', () => {
    const specs = staticImportSpecs(join(SRC, 'features/home/index.ts'));
    expect(specs).toContain('./pages/HomePage');
  });

  it('走訪器本身有效：對一個確實靜態 import firestore 的檔案能抓到', () => {
    const hits = findFirestoreImporters(join(SRC, 'features/events/data/events-repo.ts'));
    expect(hits.map((h) => h.file)).toContain('src/features/events/data/events-repo.ts');
  });
});
