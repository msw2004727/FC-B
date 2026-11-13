import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 純 JS 建置工具，與 vite.config.ts 使用同一個 scope 外掛。
import { legacyCssScope } from '../../../../../scripts/legacy-css-scope.mjs';

// 2026-11-13 活動頁頂部精簡 C 方案＋按鈕液態光澤：jsdom 不套 CSS，這裡以打包後（legacy-css-scope 改寫後）的選擇器靜態守住
// 點擊範圍 44px、女生專屬粉色漸層（未選／已選、淺／深）、各狀態覆蓋順序、相容寫法。

const FILE = resolve(process.cwd(), 'src/features/events/components/legacy/activity-head.css');

interface Flat { selector: string; decls: Record<string, string>; atrule: string | null; order: number }

function scoped(): Flat[] {
  const root = postcss([legacyCssScope()]).process(readFileSync(FILE, 'utf8'), { from: FILE }).sync().root;
  const out: Flat[] = [];
  let order = 0;
  root.walkRules((rule: Rule) => {
    const decls: Record<string, string> = {};
    rule.walkDecls((d) => { decls[d.prop] = d.value; });
    const parent = rule.parent?.type === 'atrule' ? `@${(rule.parent as postcss.AtRule).name} ${(rule.parent as postcss.AtRule).params}` : null;
    for (const selector of rule.selectors) out.push({ selector, decls, atrule: parent, order: order++ });
  });
  return out;
}

function find(rules: Flat[], selector: string): Flat {
  const hit = rules.find((r) => r.selector === selector && r.atrule === null);
  if (!hit) throw new Error(`找不到 ${selector}`);
  return hit;
}

/** 簡易權重 [id, class/attr/pseudo-class, element]（本檔選擇器不含 :not 等函式）。 */
function specificity(selector: string): [number, number, number] {
  const s = selector.replace(/::[\w-]+/g, '');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) ?? []).length;
  const elements = (s.replace(/\[[^\]]+\]/g, '').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return [ids, classes, elements];
}
const cmp = (a: [number, number, number], b: [number, number, number]) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

/** 同一元素同時符合 a、b 時，b 是否勝出（權重高，或同權重且在後）。 */
function wins(b: Flat, a: Flat): boolean {
  const c = cmp(specificity(b.selector), specificity(a.selector));
  return c > 0 || (c === 0 && b.order > a.order);
}

const S = '.legacy-ui #page-activities';
const D = '[data-theme="dark"] .legacy-ui #page-activities';
const TAB = '#activity-tabs .tab';

describe('activity-head.css：頂部精簡＋液態光澤', () => {
  const rules = scoped();
  const raw = readFileSync(FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('點擊範圍：膠囊、圓鈕 34px 以透明 ::after 補到 44px；頁籤列上下留 5px 不裁掉延伸區；開團鈕以透明上下框撐到 44px', () => {
    for (const sel of [`${S} ${TAB}::after`, `${S} .activity-region-btn::after`]) {
      expect(find(rules, sel).decls).toMatchObject({ position: 'absolute', top: '-6px', bottom: '-6px' });
    }
    expect(find(rules, `${S} ${TAB}`).decls.height).toBe('34px');
    expect(find(rules, `${S} #activity-tabs`).decls.padding).toBe('5px 24px 5px 2px');
    expect(find(rules, `${S} .activity-region-pick`).decls.padding).toBe('5px 0');
    for (const btn of ['.back-btn', '.page-search-toggle-btn']) {
      expect(find(rules, `${S} .activity-page-header ${btn}::after`).decls)
        .toMatchObject({ top: '-6px', right: '-6px', bottom: '-6px', left: '-6px' });
    }
    expect(find(rules, `${S} .activity-region-item`).decls['min-height']).toBe('44px');
    const create = find(rules, `${S} #activity-create-btn`).decls;
    expect(create).toMatchObject({
      height: '44px',
      margin: '-5px 0',
      'border-top': '5px solid transparent',
      'border-bottom': '5px solid transparent',
      'box-sizing': 'border-box',
    });
  });

  it('長語系：標題列可換行，標題區不縮，「我要開團」放不下時整顆換到第二行（不重疊）', () => {
    expect(find(rules, `${S} .activity-page-header`).decls['flex-wrap']).toBe('wrap');
    expect(find(rules, `${S} .activity-page-heading`).decls.flex).toBe('1 0 auto');
    expect(find(rules, `${S} .activity-region-btn`).decls['white-space']).toBe('nowrap');
    expect(find(rules, `${S} .activity-region-item`).decls['white-space']).toBe('nowrap');
  });

  it('女生專屬：未選、已選都是粉色漸層並帶光澤（淺、深色），已選白字；覆蓋一般膠囊與已選樣式', () => {
    const female = `${TAB}.activity-tab-female`;
    const lightOff = find(rules, `${S} ${female}`);
    const lightOn = find(rules, `${S} ${female}.active`);
    const darkOff = find(rules, `${D} ${female}`);
    const darkOn = find(rules, `${D} ${female}.active`);
    for (const r of [lightOff, lightOn, darkOff, darkOn]) {
      expect(r.decls.background, r.selector).toMatch(/^linear-gradient\(180deg, rgba\(255,255,255,\.\d+\) 0%[\s\S]*linear-gradient\(135deg, #/);
      expect(r.decls['box-shadow'], r.selector).toMatch(/^inset 0 1px 0 /);
    }
    expect(lightOn.decls.background).toContain('#f472b6, #ec4899');
    expect(darkOn.decls.background).toContain('#be185d, #ec4899');
    expect(lightOn.decls.color).toBe('#fff');
    expect(darkOn.decls.color).toBe('#fff');
    // 一般膠囊、已選、深色同名規則都被女生專屬蓋過
    const generic = [`${S} ${TAB}`, `${D} ${TAB}`, `${S} ${TAB}.active`, `${D} ${TAB}.active`].map((s) => find(rules, s));
    for (const g of generic) {
      expect(wins(lightOff, g) || wins(darkOff, g), g.selector).toBe(true);
      expect(wins(darkOn, g), g.selector).toBe(true);
    }
    expect(wins(lightOn, find(rules, `${S} ${TAB}.active`))).toBe(true);
    expect(wins(darkOn, darkOff)).toBe(true); // 深色已選蓋過深色未選
    expect(wins(darkOn, lightOn)).toBe(true);
  });

  it('狀態覆蓋：深色預設蓋過淺色預設；已選蓋過預設；未開放（灰）在淺、深色都蓋過一般膠囊', () => {
    const lightBase = find(rules, `${S} ${TAB}`);
    const darkBase = find(rules, `${D} ${TAB}`);
    const lightOn = find(rules, `${S} ${TAB}.active`);
    const darkOn = find(rules, `${D} ${TAB}.active`);
    expect(wins(darkBase, lightBase)).toBe(true);
    expect(wins(lightOn, darkBase)).toBe(true);
    expect(wins(darkOn, lightOn)).toBe(true);
    const unavailable = find(rules, `${S} ${TAB}.activity-tab-unavailable`);
    const darkUnavailable = find(rules, `${D} ${TAB}.activity-tab-unavailable`);
    expect(wins(unavailable, lightBase)).toBe(true);
    expect(wins(darkUnavailable, darkBase)).toBe(true);
    expect(unavailable.decls['box-shadow']).toBe('none');
    // 地區鈕同一套
    expect(wins(find(rules, `${D} .activity-region-btn.active`), find(rules, `${S} .activity-region-btn.active`))).toBe(true);
    expect(wins(find(rules, `${S} .activity-region-btn.active`), find(rules, `${D} .activity-region-btn`))).toBe(true);
  });

  it('光澤：膠囊、圓鈕、開團鈕都有上半光澤與頂緣亮線；鎖定的開團鈕不呼吸', () => {
    for (const sel of [`${S} ${TAB}`, `${D} ${TAB}`, `${S} .activity-region-btn`, `${S} .activity-page-header .back-btn`, `${D} .activity-page-header .page-search-toggle-btn`]) {
      const r = find(rules, sel);
      expect(r.decls.background, sel).toMatch(/^linear-gradient\(180deg, rgba\(255,255,255,\.\d+\) 0%/);
      expect(r.decls['box-shadow'], sel).toMatch(/^inset 0 1px 0 /);
    }
    expect(find(rules, `${S} #activity-create-btn .activity-create-gloss`).decls).toMatchObject({ 'pointer-events': 'none', 'z-index': '3' });
    const locked = find(rules, `${S} #activity-create-btn.activity-create-profile-locked`);
    expect(locked.decls.animation).toBe('none');
    expect(wins(locked, find(rules, `${D} #activity-create-btn`))).toBe(true);
    expect(wins(find(rules, `${D} #activity-create-btn.activity-create-profile-locked`), find(rules, `${D} #activity-create-btn`))).toBe(true);
  });

  it('搜尋面板輸入框 16px（iPhone 不自動放大）', () => {
    expect(find(rules, `${S} .activity-filter-panel input`).decls['font-size']).toBe('16px');
    expect(find(rules, `${S} .activity-filter-panel select`).decls['font-size']).toBe('16px');
  });

  it('不用 backdrop-filter、不用 color-mix、不自創 CSS 變數', () => {
    expect(/backdrop-filter|color-mix\(/.test(raw)).toBe(false);
    expect(/(^|[;{\s])--[\w-]+\s*:/.test(raw)).toBe(false);
  });
});
