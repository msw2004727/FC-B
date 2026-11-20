import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('公告文字換行', () => {
  it('公告內文可換行，長網址不撐出窄畫面', () => {
    const css = readFileSync(resolve(__dirname, 'competitions.css'), 'utf8');
    const start = css.indexOf('.cpm-ann__txt {');
    const end = css.indexOf('.cpm-ann__time {');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const block = css.slice(start, end);
    expect(block).toContain('white-space: pre-wrap;');
    expect(block).toContain('overflow-wrap: anywhere;');
  });
});
