// T-038（2026-10-26）：個人頁卡標題「?」的說明彈窗樣式。
// 原本 edu-info-btn.css 只抽了 A css/education.css 第 5～12 行（按鈕），漏掉第 14～31 行的彈窗樣式，
// 點「?」後 .edu-info-overlay／.edu-info-dialog 沒有樣式，說明文字攤在頁面最下方而不是置中彈窗。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

const CSS_PATH = resolve(process.cwd(), 'src/styles/legacy/edu-info-btn.css');

function rule(sel) {
  const root = postcss.parse(readFileSync(CSS_PATH, 'utf8'));
  const decls = {};
  root.walkRules((r) => {
    if (r.selectors.map((s) => s.trim()).includes(sel)) {
      r.walkDecls((d) => {
        decls[d.prop] = d.value;
      });
    }
  });
  return decls;
}

describe('edu-info-btn.css 的說明彈窗樣式（照 A education.css）', () => {
  it('.edu-info-overlay 是全螢幕固定遮罩，符合 R-UI-010 的遮罩值', () => {
    const d = rule('.edu-info-overlay');
    expect(d['position']).toBe('fixed');
    expect(d['inset']).toBe('0');
    expect(d['background']).toBe('rgba(0,0,0,.35)');
    expect(d['backdrop-filter']).toBe('blur(10px)');
    expect(d['-webkit-backdrop-filter']).toBe('blur(10px)');
  });

  it('.edu-info-dialog 是 16px 圓角、可捲動內容的置中卡片', () => {
    const d = rule('.edu-info-dialog');
    expect(d['border-radius']).toBe('16px');
    expect(d['box-shadow']).toBe('0 8px 32px rgba(0,0,0,.15)');
    expect(d['display']).toBe('flex');
    expect(rule('.edu-info-dialog-body')['overflow-y']).toBe('auto');
  });

  it('說明按鈕樣式仍在', () => {
    expect(rule('.edu-info-btn')['width']).toBe('22px');
  });
});
