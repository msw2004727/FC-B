// 改積分後，已登錄場次的 result 點數不重寫；畫面一律以積分榜為準。
// 所以 competitions 的畫面與讀取層不得再寫出 homePoints／awayPoints。
// 這兩個欄位只留在資料層：契約型別 data/types.ts 與文件解析 data/cp-repo.ts（本測試排除）；畫面與其他模組不得引用。
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src/features/competitions');

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

/** 掃 competitions 底下的 ts／tsx。排除測試、testing/、契約型別檔 data/types.ts 與文件解析 data/cp-repo.ts。 */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'testing') continue;
        walk(full);
        continue;
      }
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      if (entry.name.includes('.test.')) continue;
      const rel = toPosix(relative(ROOT, full));
      if (rel === 'data/types.ts' || rel === 'data/cp-repo.ts') continue;
      out.push(full);
    }
  };
  walk(ROOT);
  return out;
}

describe('比賽結果點數不得散落在畫面', () => {
  it('competitions 原始碼沒有 homePoints 或 awayPoints', () => {
    const hits = sources().filter((file) => {
      const text = readFileSync(file, 'utf8');
      return text.includes('homePoints') || text.includes('awayPoints');
    }).map((file) => toPosix(relative(process.cwd(), file)));
    expect(hits).toEqual([]);
  });
});
