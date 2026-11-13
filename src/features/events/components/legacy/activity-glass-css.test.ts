import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 純 JS 建置工具，與 vite.config.ts 使用同一個 scope 外掛。
import { legacyCssScope } from '../../../../../scripts/legacy-css-scope.mjs';

// 2026-11-13 站長選定活動卡「液態光澤」：jsdom 不套 CSS，這裡以打包後（legacy-css-scope 改寫後）的選擇器靜態守住
// 只套活動頁、各類型淺／深色都有、權重高於 A 的 hover 與類型底色、底層與黏頂列的退路與相容寫法。

const DIR = 'src/features/events/components/legacy';

interface Flat { selector: string; decls: Record<string, string>; atrule: string | null; order: number }

function scoped(file: string): Flat[] {
  const path = resolve(process.cwd(), DIR, file);
  const root = postcss([legacyCssScope()]).process(readFileSync(path, 'utf8'), { from: path }).sync().root;
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

function find(rules: Flat[], selector: string, atrule: string | null = null): Flat {
  const hit = rules.find((r) => r.selector === selector && r.atrule === atrule);
  if (!hit) throw new Error(`找不到 ${selector}${atrule ? `（${atrule}）` : ''}`);
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
const gt = (a: [number, number, number], b: [number, number, number]) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

const TYPES = ['', '.tl-type-camp', '.tl-type-play', '.tl-type-watch', '.tl-type-course', '.tl-type-external', '.tl-type-teamonly', '.tl-type-female-only'];
const LIGHT = (t: string) => `.legacy-ui #page-activities .tl-event-row${t}`;
const DARK = (t: string) => `[data-theme="dark"] .legacy-ui #page-activities .tl-event-row${t}`;

describe('timeline-card-extra.css：液態光澤卡片', () => {
  const card = scoped('timeline-card-extra.css');
  const raw = readFileSync(resolve(process.cwd(), DIR, 'timeline-card-extra.css'), 'utf8');

  it('影響卡片外觀的規則都限定在活動頁（個人頁相關活動、俱樂部活動列表不受影響）', () => {
    const touching = card.filter((r) => /\.tl-event-row(?![\w-])(?:\.[\w-]+)*$/.test(r.selector)
      && ['background', 'box-shadow', 'border-radius', 'border-top-color'].some((p) => p in r.decls));
    expect(touching.length).toBe(TYPES.length * 2);
    expect(touching.every((r) => r.selector.includes('#page-activities'))).toBe(true);
  });

  it('八種類型淺色、深色都有底色與光影；圓角用 A 既有的 --radius', () => {
    for (const t of TYPES) {
      for (const sel of [LIGHT(t), DARK(t)]) {
        const r = find(card, sel);
        expect(r.decls.background, sel).toMatch(/linear-gradient\(180deg, rgba\(255,255,255,\.\d+\) 0%/);
        expect(r.decls['box-shadow'], sel).toMatch(/^inset 0 1px 0 /);
      }
    }
    expect(find(card, LIGHT('')).decls['border-radius']).toBe('var(--radius)');
  });

  it('權重：高於 A 的 hover 與類型底色；女生專屬在各組最後；深色整組在淺色之後', () => {
    const hover = '.legacy-ui .tl-event-row:hover';
    const femaleHover = '.legacy-ui .tl-event-row.tl-type-female-only:hover';
    const darkType = '[data-theme="dark"] .legacy-ui .tl-type-friendly';
    expect(gt(specificity(LIGHT('')), specificity(hover))).toBe(true);
    expect(gt(specificity(LIGHT('')), specificity(femaleHover))).toBe(true);
    expect(gt(specificity(DARK('')), specificity(darkType))).toBe(true);
    for (const t of TYPES.slice(1)) expect(gt(specificity(DARK(t)), specificity(LIGHT(t)))).toBe(true);
    const female = TYPES.length - 1;
    const lightOrder = TYPES.map((t) => find(card, LIGHT(t)).order);
    const darkOrder = TYPES.map((t) => find(card, DARK(t)).order);
    expect(Math.max(...lightOrder.slice(0, female))).toBeLessThan(lightOrder[female]!);
    expect(Math.max(...darkOrder.slice(0, female))).toBeLessThan(darkOrder[female]!);
    expect(Math.max(...lightOrder)).toBeLessThan(Math.min(...darkOrder));
  });

  it('不用 backdrop-filter、沒有動畫、不自創 CSS 變數', () => {
    const glass = card.filter((r) => r.selector.includes('#page-activities'));
    expect(glass.some((r) => Object.keys(r.decls).some((p) => /backdrop-filter|animation|transition/.test(p)))).toBe(false);
    expect(/(^|[;{\s])--[\w-]+\s*:/.test(raw.replace(/\/\*[\s\S]*?\*\//g, ''))).toBe(false);
  });
});

describe('activity-list-extra.css：底層與黏頂列', () => {
  const list = scoped('activity-list-extra.css');
  const raw = readFileSync(resolve(process.cwd(), DIR, 'activity-list-extra.css'), 'utf8');
  const SUPPORTS = '@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))';

  it('底層：固定在視窗、z-index -1、不攔點擊，畫在 .activities-root 自己的堆疊層（只靠 isolation，不改定位與層級）', () => {
    const isolation = list.filter((r) => r.selector === '.legacy-ui.activities-root' && r.decls.isolation);
    expect(isolation.map((r) => r.decls.isolation)).toEqual(['isolate']);
    expect(list.filter((r) => r.selector === '.legacy-ui.activities-root').some((r) => 'z-index' in r.decls || 'position' in r.decls)).toBe(false);
    const layer = find(list, '.legacy-ui.activities-root::before');
    expect(layer.decls).toMatchObject({ position: 'fixed', 'z-index': '-1', 'pointer-events': 'none', top: '0', right: '0', bottom: '0', left: '0' });
    expect(layer.decls.background).toBe('linear-gradient(180deg, #eef1f6 0%, #e5eaf2 100%)');
    // 原始碼寫成同一元素形式，打包後必須是「深色主題下的 .activities-root」
    expect(find(list, '[data-theme="dark"] .legacy-ui.activities-root::before').decls.background)
      .toBe('linear-gradient(180deg, #0b0f16 0%, #10151f 100%)');
  });

  // 測試同步更新（2026-11-13 看圖審查 P2）：半透明＋模糊會透出捲到後面的卡片字，改成實色底、不再用 backdrop-filter。
  it('篩選列與月份標題：實色底（淺 #eef1f6、深 #0b0f16），不透出背後卡片', () => {
    const sticky = '.legacy-ui #page-activities.page > .activity-sticky-filters';
    const month = '.legacy-ui #page-activities .tl-month-header';
    expect(find(list, sticky).decls.background).toBe('var(--bg-root)');
    for (const sel of [sticky, month]) {
      const all = list.filter((r) => r.selector === sel && r.decls.background);
      expect(all.at(-1)?.decls.background).toBe('#eef1f6');
      expect(find(list, `[data-theme="dark"] ${sel}`).decls.background).toBe('#0b0f16');
    }
    expect(list.some((r) => Object.keys(r.decls).some((p) => /backdrop-filter/.test(p)))).toBe(false);
    expect(list.some((r) => r.atrule === SUPPORTS)).toBe(false);
    // 月份標題的實色退路在 A 的 activity.css
    const activity = readFileSync(resolve(process.cwd(), 'src/features/events/legacy/activity.css'), 'utf8');
    expect(activity).toMatch(/\.tl-month-header \{[^}]*background: var\(--bg-root\);/);
  });

  it('不自創 CSS 變數', () => {
    expect(/(^|[;{\s])--[\w-]+\s*:/.test(raw.replace(/\/\*[\s\S]*?\*\//g, ''))).toBe(false);
  });

  it('已結束收合鈕的玻璃底色只套活動頁（Grok 初審 P3）', () => {
    expect(find(list, '.legacy-ui .tl-ended-fold-btn').decls.background).toBe('transparent');
    expect(find(list, '.legacy-ui #page-activities .tl-ended-fold-btn').decls.background).toBe('rgba(255,255,255,.45)');
    expect(find(list, '[data-theme="dark"] .legacy-ui #page-activities .tl-ended-fold-btn').decls.background).toBe('rgba(255,255,255,.04)');
  });
});
