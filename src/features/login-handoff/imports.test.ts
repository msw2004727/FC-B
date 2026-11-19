import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = resolve(__dirname);

function importSpecs(source: string): { spec: string; dynamic: boolean }[] {
  const found: { spec: string; dynamic: boolean }[] = [];
  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    found.push({ spec: match[1] ?? '', dynamic: false });
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    found.push({ spec: match[1] ?? '', dynamic: true });
  }
  return found;
}

function allowed(spec: string, dynamic: boolean): boolean {
  if (spec.startsWith('./')) return true;
  if (spec === '@/data/callables') return true;
  return dynamic && spec === '@/data/auth';
}

describe('login-handoff 匯入界線', () => {
  it('非測試檔只從同資料夾、callables，或動態 auth 匯入', () => {
    const files = readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.includes('.test.'));
    expect(files.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const name of files) {
      const source = readFileSync(resolve(dir, name), 'utf8');
      for (const { spec, dynamic } of importSpecs(source)) {
        if (!allowed(spec, dynamic)) bad.push(`${name} ${dynamic ? 'import()' : 'from'} ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('auth.ts 不含 flag 與 pwa-install', () => {
    const auth = readFileSync(resolve(dir, '../../data/auth.ts'), 'utf8');
    expect(auth).not.toContain('@/features/login-handoff/flag');
    expect(auth).not.toContain('@/features/pwa/pwa-install');
  });
});
