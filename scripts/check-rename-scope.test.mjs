// @vitest-environment node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HARD_PROBES,
  INFO_PROBES,
  RENAME_LIMIT,
  evaluateHardProbe,
  includesOwnChunk,
  probeStem,
  renamedAssets,
} from './check-rename-scope.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('check-rename-scope 判定（不建置）', () => {
  it('探針檔都存在（改名或搬家時這裡先紅，不讓 CLI 假綠）', () => {
    for (const probe of [...HARD_PROBES, ...INFO_PROBES]) expect(existsSync(path.join(root, probe)), probe).toBe(true);
    expect(RENAME_LIMIT).toBe(3);
  });

  it('renamedAssets：只看 .js／.css，回傳 B 有 A 沒有的', () => {
    const a = ['index-aaaaaaaa.js', 'TeamsPage-bbbbbbbb.js', 'x-cccccccc.css', 'logo.svg'];
    const b = ['index-AAAAAAAA.js', 'TeamsPage-B-B_BBBB.js', 'x-cccccccc.css', 'logo2.svg', 'TeamsPage-dddddddd.css'];
    expect(renamedAssets(a, b)).toEqual(['TeamsPage-B-B_BBBB.js', 'TeamsPage-dddddddd.css', 'index-AAAAAAAA.js']);
  });

  it('probeStem／includesOwnChunk：雜湊含 - 也認得；前綴相同的別頁不算', () => {
    expect(probeStem('src/features/clubs/pages/TeamsPage.tsx')).toBe('TeamsPage');
    expect(includesOwnChunk(['TeamsPage-B-B_BBBB.js'], 'src/features/clubs/pages/TeamsPage.tsx')).toBe(true);
    expect(includesOwnChunk(['TeamsPageX-BBBBBBBB.js'], 'src/features/clubs/pages/TeamsPage.tsx')).toBe(false);
  });

  it('evaluateHardProbe：≤ 3 且含自己才通過', () => {
    const p = 'src/features/clubs/pages/TeamsPage.tsx';
    expect(evaluateHardProbe(p, ['TeamsPage-BBBBBBBB.js', 'index-AAAAAAAA.js']).ok).toBe(true);
    expect(evaluateHardProbe(p, ['TeamsPage-BBBBBBBB.js', 'a-AAAAAAAA.js', 'b-AAAAAAAA.js', 'c-AAAAAAAA.js']).ok).toBe(false);
    expect(evaluateHardProbe(p, ['index-AAAAAAAA.js']).reason).toMatch(/探針沒生效/);
    expect(evaluateHardProbe(p, []).ok).toBe(false);
  });
});
