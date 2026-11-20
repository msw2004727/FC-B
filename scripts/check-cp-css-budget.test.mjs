// @vitest-environment node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CP_CSS_FILES, KB, exceedsLimit, measureSources, parseArgs, parseLimit, stripImports } from './check-cp-css-budget.mjs';

const SCRIPT = fileURLToPath(new URL('./check-cp-css-budget.mjs', import.meta.url));
const ROOT = path.dirname(path.dirname(SCRIPT));

describe('check-cp-css-budget：口徑', () => {
  it('七支清單固定（新增第八支賽事樣式檔要加進來）', () => {
    expect(CP_CSS_FILES).toEqual([
      'src/features/tournaments/tournaments.css',
      'src/features/tournaments/list-v2.css',
      'src/features/tournaments/legacy/tournaments-glass.css',
      'src/features/competitions/competitions.css',
      'src/features/competitions/live/live.css',
      'src/features/competitions/step4b/step4b.css',
      'src/features/competitions/live/score-fullscreen.css',
    ]);
  });

  it('KB＝1000 位元組；純數字是位元組、帶 KB 是千位元組；沒給上限不判定', () => {
    expect(KB).toBe(1000);
    expect(parseLimit('73400')).toBe(73400);
    expect(parseLimit('73,400')).toBe(73400);
    expect(parseLimit('73.4KB')).toBe(73400);
    expect(parseLimit('71kb')).toBe(71000);
    expect(parseLimit(undefined)).toBeNull();
    expect(parseLimit('')).toBeNull();
    expect(() => parseLimit('71MB')).toThrow();
    expect(parseArgs(['--rev', 'abc', '73400'])).toEqual({ limit: 73400, rev: 'abc', dist: 'dist' });
  });

  it('等於上限通過、超過才失敗；沒給上限不判定；數字無效視為超過', () => {
    expect(exceedsLimit(73400, 73400)).toBe(false);
    expect(exceedsLimit(73401, 73400)).toBe(true);
    expect(exceedsLimit(999999, null)).toBe(false);
    expect(exceedsLimit(Number.NaN, 73400)).toBe(true);
  });

  it('行首 @import 拿掉、不展開', () => {
    const { css, removed } = stripImports("@import '../competitions.css';\n.a { color: red; }\n");
    expect(removed).toEqual(["@import '../competitions.css';"]);
    expect(css).toBe('.a { color: red; }\n');
  });
});

describe('check-cp-css-budget：打包量測', () => {
  it('@import 不展開；同一份內容連量兩次相同；路徑含 /legacy/ 照正式打包加 .legacy-ui', async () => {
    const big = '.x { color: red; }\n'.repeat(50);
    const body = '.a { color: #ff0000; padding: 0px 0px; }\n';
    const sources = [
      { rel: 'src/a/a.css', css: body },
      { rel: 'src/a/b.css', css: `@import './a.css';\n${body}` },
      { rel: 'src/a/legacy/c.css', css: body },
      { rel: 'src/a/big.css', css: big },
    ];
    const first = await measureSources(sources);
    const second = await measureSources(sources);
    expect(second.map((r) => r.min)).toEqual(first.map((r) => r.min));
    expect(first[1].min).toBe(first[0].min);
    expect(first[1].removedImports).toEqual(["@import './a.css';"]);
    expect(first[0].min).toBeLessThan(Buffer.byteLength(body));
    expect(first[2].min).toBe(first[0].min + '.legacy-ui '.length);
  }, 60_000);

  it('CLI：沒給上限結束碼 0 並註明不判定；上限 1 位元組結束碼 1', () => {
    const plain = spawnSync(process.execPath, [SCRIPT, '--dist', 'no-such-dist'], { cwd: ROOT, encoding: 'utf8' });
    expect(plain.status).toBe(0);
    expect(plain.stdout).toContain('七支合計');
    expect(plain.stdout).toContain('不判定');
    const over = spawnSync(process.execPath, [SCRIPT, '1', '--dist', 'no-such-dist'], { cwd: ROOT, encoding: 'utf8' });
    expect(over.status).toBe(1);
    expect(over.stdout).toContain('超過');
  }, 60_000);
});
