import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/preact';
import { h } from 'preact';
import postcss, { type Rule } from 'postcss';
import { afterEach, describe, expect, it } from 'vitest';
import { TopBar } from './TopBar';

// T-050：「All」按鈕待機時不得有脈動提示框。
// A 的 layout.css 對 .sport-picker-btn::before 設 animation: sport-picker-attention（頁面打開後閃兩次），
// 但 topbar-extra.css（U-008，44px 點擊範圍）以更高 specificity 把同一個 ::before 改成 top/left 50%，
// 動畫的 transform: scale() 蓋掉 translate(-50%,-50%)，淡框偏到按鈕右下方；本卡在 topbar-extra.css 覆寫待機動畫。
//
// 本檔只做「靜態檢查」：覆寫規則存在、值為 none、不是 !important、選擇器能匹配 TopBar 實際渲染的運動鈕、
// specificity 高於 layout.css 的同一條規則。它**不**驗證展開回饋、44px 點擊範圍或實際 computed style
// （jsdom 取不到偽元素樣式）；那些只靠離線預覽頁截圖的像素比對（見 docs/specs/lite-convergence/tasks/T-050/REPORT.md）。
const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
const LAYOUT = read('src/styles/legacy/layout.css');
const EXTRA = read('src/ui/topbar-extra.css');

const OVERRIDE_SELECTOR = '.legacy-ui.legacy-chrome #sport-picker-btn::before';
const A_IDLE_SELECTOR = '.sport-picker-btn::before';

// 簡化 specificity：(id, class／attribute／pseudo-class, type／pseudo-element)；本檔選擇器都是單純複合選擇器。
function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const pseudoElements = (selector.match(/::[\w-]+/g) ?? []).length;
  const pseudoClasses = (selector.replace(/::[\w-]+/g, '').match(/:[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length + pseudoClasses;
  return [ids, classes, pseudoElements];
}
function compare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// 只找最上層（不在 @media 內）、選擇器完全相同的規則（可再限定「有宣告某個屬性」，例如 topbar-extra.css 的
// U-008 合併規則與本卡覆寫規則共用同一個選擇器）；找不到或找到多條都讓測試直接失敗。
function ruleBySelector(css: string, selector: string, withProp?: string): Rule {
  const hits: Rule[] = [];
  postcss.parse(css).each((node) => {
    if (node.type !== 'rule' || !node.selectors.some((s) => s.trim() === selector)) return;
    if (withProp && !node.some((child) => child.type === 'decl' && child.prop === withProp)) return;
    hits.push(node);
  });
  expect(hits.length, `找不到或有多條最上層規則：${selector}`).toBe(1);
  return hits[0]!;
}

interface Decl {
  value: string;
  important: boolean;
}
function declOf(rule: Rule, prop: string): Decl | undefined {
  let found = undefined as Decl | undefined;
  rule.walkDecls(prop, (d) => {
    found = { value: d.value, important: d.important === true };
  });
  return found;
}

describe('A 原檔同步檢查：layout.css（本卡沒改它）', () => {
  it('待機的 .sport-picker-btn::before 仍宣告 sport-picker-attention 動畫，且不是 !important（所以 B 才需要覆寫）', () => {
    const animation = declOf(ruleBySelector(LAYOUT, A_IDLE_SELECTOR, 'animation'), 'animation');
    expect(animation?.value).toContain('sport-picker-attention');
    expect(animation?.important).toBe(false);
  });

  it('展開外圈與右下角小箭頭的 A 規則仍在（本卡沒動這幾條）', () => {
    const open = ruleBySelector(LAYOUT, '.sport-picker-btn.open::before');
    expect(declOf(open, 'opacity')?.value).toBe('1');
    expect(declOf(open, 'transform')?.value).toBe('scale(1)');
    expect(declOf(ruleBySelector(LAYOUT, '.sport-picker-btn::after'), 'border-right')?.value).toBeTruthy();
    expect(declOf(ruleBySelector(LAYOUT, '.sport-picker-btn.open::after'), 'opacity')?.value).toBe('.95');
  });
});

describe('B 靜態檢查：topbar-extra.css 覆寫待機動畫', () => {
  afterEach(() => cleanup());

  it('覆寫規則的 animation 為 none，且不是 !important', () => {
    const animation = declOf(ruleBySelector(EXTRA, OVERRIDE_SELECTOR, 'animation'), 'animation');
    expect(animation?.value).toBe('none');
    expect(animation?.important).toBe(false);
  });

  it('覆寫與 A 規則的選擇器（去掉 ::before）都能匹配 TopBar 實際渲染的運動鈕', () => {
    const { container } = render(h(TopBar, { drawerOpen: false, onMenuClick: () => undefined }));
    const btn = container.querySelector('#sport-picker-btn');
    expect(btn).not.toBeNull();
    // 打包時 legacy 外掛會把 layout.css 的選擇器加上 .legacy-ui 範圍
    expect(btn!.matches(OVERRIDE_SELECTOR.replace(/::before$/, ''))).toBe(true);
    expect(btn!.matches(`.legacy-ui ${A_IDLE_SELECTOR.replace(/::before$/, '')}`)).toBe(true);
  });

  it('覆寫的 specificity 高於 layout.css 的同一條規則（含打包時多加的 .legacy-ui 一層）', () => {
    const scopedBase = specificity(A_IDLE_SELECTOR);
    scopedBase[1] += 1;
    expect(compare(specificity(OVERRIDE_SELECTOR), scopedBase)).toBeGreaterThan(0);
  });
});
