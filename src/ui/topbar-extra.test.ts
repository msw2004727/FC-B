import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

// T-050：「All」按鈕待機時不得有脈動提示框。
// A 的 layout.css 對 .sport-picker-btn::before 設 animation: sport-picker-attention（頁面打開後閃兩次），
// 但 topbar-extra.css（U-008，44px 點擊範圍）以更高 specificity 把同一個 ::before 改成 top/left 50%，
// 動畫的 transform: scale() 蓋掉 translate(-50%,-50%)，淡框偏到按鈕右下方。
// 這裡以 postcss 解析兩份 CSS，確認待機的 ::before 最後生效的 animation 是 none，且展開（.open）外圈與右下小箭頭沒被動到。
const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
const LAYOUT = read('src/styles/legacy/layout.css');
const EXTRA = read('src/ui/topbar-extra.css');

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

interface Decl {
  selector: string;
  value: string;
}
// 找所有「待機」（不含 .open／:hover／:focus／:active）且作用在運動鈕 ::before 的 animation 宣告
function idleBeforeAnimations(css: string): Decl[] {
  const out: Decl[] = [];
  postcss.parse(css).walkRules((rule) => {
    for (const selector of rule.selectors.map((s) => s.trim())) {
      if (!/(#sport-picker-btn|\.sport-picker-btn)(::before)$/.test(selector.replace(/\s+/g, ' ').split(' ').pop() ?? '')) continue;
      if (/\.open|:hover|:focus|:active/.test(selector)) continue;
      // 排除 @media (prefers-reduced-motion) 內的規則：它只會把動畫關掉，不是待機預設
      if (rule.parent?.type === 'atrule') continue;
      rule.walkDecls(/^animation(-name)?$/, (decl) => {
        out.push({ selector, value: decl.value });
      });
    }
  });
  return out;
}

describe('T-050 「All」按鈕待機不再有脈動提示框', () => {
  it('layout.css 是 A 原檔：待機 ::before 仍宣告 sport-picker-attention（所以要靠 topbar-extra.css 覆寫）', () => {
    const decls = idleBeforeAnimations(LAYOUT);
    expect(decls.length).toBe(1);
    expect(decls[0]!.value).toContain('sport-picker-attention');
  });

  it('topbar-extra.css 對 #sport-picker-btn::before 宣告 animation: none，且 specificity 高於 layout.css 的待機規則', () => {
    const base = idleBeforeAnimations(LAYOUT)[0]!;
    const override = idleBeforeAnimations(EXTRA);
    expect(override.length).toBe(1);
    expect(override[0]!.value).toBe('none');
    // 打包時 legacy 外掛會替 layout.css 選擇器多加一層 .legacy-ui（+1 class），保守把它算進去
    const scopedBase: [number, number, number] = [...specificity(base.selector)] as [number, number, number];
    scopedBase[1] += 1;
    expect(compare(specificity(override[0]!.selector), scopedBase)).toBeGreaterThan(0);
  });

  it('展開（.open）時的外圈與右下角小箭頭規則仍在（互動回饋不變）', () => {
    const rules = new Map<string, Record<string, string>>();
    postcss.parse(LAYOUT).walkRules((rule) => {
      const decls: Record<string, string> = {};
      rule.walkDecls((d) => {
        decls[d.prop] = d.value;
      });
      for (const s of rule.selectors) rules.set(s.trim(), { ...(rules.get(s.trim()) ?? {}), ...decls });
    });
    expect(rules.get('.sport-picker-btn.open::before')?.opacity).toBe('1');
    expect(rules.get('.sport-picker-btn.open::before')?.transform).toBe('scale(1)');
    expect(rules.get('.sport-picker-btn::after')?.['border-right']).toBeTruthy();
    expect(rules.get('.sport-picker-btn.open::after')?.opacity).toBe('.95');
  });

  it('topbar-extra.css 的 44px 點擊範圍規則沒被動到', () => {
    expect(EXTRA).toMatch(/#sport-picker-btn::before,[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
  });
});
