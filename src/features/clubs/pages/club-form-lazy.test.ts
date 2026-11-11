import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 與 entry-graph.test.ts 同一套靜態 import 掃描。不 import 那個測試檔，避免把整組測試再跑一次。

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
  const braces = /^\{([^}]*)\}$/.exec(trimmed);
  if (!braces) return false;
  const names = (braces[1] ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  return names.length > 0 && names.every((n) => /^type\s/.test(n));
}

function staticImportSpecs(source: string): string[] {
  const code = stripComments(source);
  const specs: string[] = [];
  for (const m of code.matchAll(/\bimport\s*(type\b)?([^'"`;]*?)\bfrom\s*(['"])([^'"]+)\3/g)) {
    if (m[1]) continue;
    if (isTypeOnlyClause(m[2] ?? '')) continue;
    specs.push(m[4] ?? '');
  }
  for (const m of code.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) specs.push(m[2] ?? '');
  for (const m of code.matchAll(/\bexport\s*(type\b)?\s*(\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"]+)\3/g)) {
    if (m[1]) continue;
    if (isTypeOnlyClause(m[2] ?? '')) continue;
    specs.push(m[4] ?? '');
  }
  return specs;
}

const SRC = resolve(__dirname, '../../..');

function resolveSpec(from: string, spec: string): string | null {
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

function entryFiles(): Set<string> {
  const parent = join(SRC, 'main.tsx');
  const seen = new Set<string>();
  const queue = [parent];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (source === null) continue;
    for (const spec of staticImportSpecs(source)) {
      const next = resolveSpec(file, spec);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return new Set([...seen].map((file) => file.replace(SRC, 'src').replace(/\\/g, '/')));
}

const FORM_SPECS = /(^|\/)(TeamFormModal|EventFormModal)$/;

describe('俱樂部表單不進頁面靜態圖，也不進入口', () => {
  it('TeamsPage、TeamDetailPage、表單載入器沒有靜態 import 表單元件', () => {
    const files = [
      'features/clubs/pages/TeamsPage.tsx',
      'features/clubs/pages/TeamDetailPage.tsx',
      'features/clubs/components/legacy/team-form-loader.ts',
      'features/home/data/event-form-loader.ts',
    ];
    for (const rel of files) {
      const source = readFileSync(join(SRC, rel), 'utf8');
      const offending = staticImportSpecs(source).filter((spec) => FORM_SPECS.test(spec));
      expect(offending, rel).toEqual([]);
    }
  });

  it('入口靜態圖含俱樂部 manifest 與既有開團載入器，不含俱樂部頁、表單與 teams-repo', () => {
    const visited = entryFiles();
    expect(visited.has('src/main.tsx')).toBe(true);
    expect(visited.has('src/features/clubs/index.ts')).toBe(true);
    expect(visited.has('src/features/home/pages/HomePage.tsx')).toBe(true);
    expect(visited.has('src/features/home/data/event-form-loader.ts')).toBe(true);
    const forbidden = [
      'src/features/clubs/pages/TeamsPage.tsx',
      'src/features/clubs/pages/TeamDetailPage.tsx',
      'src/features/clubs/components/legacy/TeamFormModal.tsx',
      'src/features/clubs/components/legacy/team-form-loader.ts',
      'src/features/clubs/data/teams-repo.ts',
      'src/features/events/components/EventFormModal.tsx',
    ];
    expect(forbidden.filter((file) => visited.has(file))).toEqual([]);
  });
});
