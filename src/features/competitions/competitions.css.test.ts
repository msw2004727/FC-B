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

describe('公告輸入區底列與我的場次對戰列不擠壓（11-20 外框驗收 P2-1、P2-2）', () => {
  it('取消鈕不吃最小寬、已發 n 則可縮並省略', () => {
    const css = readFileSync(resolve(__dirname, 'competitions.css'), 'utf8');
    expect(css).toContain('.cpm-ann__btns .ui-button--ghost { min-inline-size: 0;');
    expect(css).toMatch(/\.cpm-ann__foot \.cpm-meta \{[^}]*min-width: 0;[^}]*text-overflow: ellipsis;/);
  });

  it('我的場次對戰文字可縮並省略', () => {
    const css = readFileSync(resolve(__dirname, 'step4b/step4b.css'), 'utf8');
    expect(css).toMatch(/\.s4b-between > \.s4b-k \{[^}]*flex: 1 1 auto;[^}]*min-width: 0;[^}]*text-overflow: ellipsis;/);
  });
});

describe('使用者取的賽事名稱標題（顧問 §3.460）', () => {
  it('名稱標題最多兩行、超過才省略；共用 .cps-title 與頂列 h1 仍不換行', () => {
    const css = readFileSync(resolve(__dirname, 'competitions.css'), 'utf8');
    expect(css).toMatch(/\.cps-title \{[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.cps-title\.cps-title--user \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*-webkit-line-clamp: 2;[^}]*overflow: hidden;/);
    expect(css).toMatch(/\.cps-top h1 \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
    expect(css).toMatch(/\.cps-top h1\.cps-top__user \{[^}]*white-space: normal;[^}]*-webkit-line-clamp: 2;/);
  });
});
