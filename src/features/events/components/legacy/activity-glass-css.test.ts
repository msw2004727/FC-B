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

// 2026-11-13 站長回報：正取、不公開印章看不清楚、大小要相同。A 的印章用 multiply 混合，深色卡底上幾乎看不見；
// A 原本不公開 52px、正取／候補 46px。覆寫成同一尺寸、淺色加深、深色改正常混合；位置沿用 A（下一張卡另搬）。
// 不限活動頁：.tl-stamp-* 只在活動卡元件，之後個人頁、俱樂部頁共用該元件時一起套用（PM 11-13）。
describe('timeline-card-extra.css：活動卡印章（正取／候補／不公開）', () => {
  const card = scoped('timeline-card-extra.css');
  const activity = (() => {
    const path = resolve(process.cwd(), 'src/features/events/legacy/activity.css');
    const root = postcss([legacyCssScope()]).process(readFileSync(path, 'utf8'), { from: path }).sync().root;
    const out: Flat[] = [];
    root.walkRules((rule: Rule) => {
      if (rule.parent?.type === 'atrule') return;
      const decls: Record<string, string> = {};
      rule.walkDecls((d) => { decls[d.prop] = d.value; });
      for (const selector of rule.selectors) out.push({ selector, decls, atrule: null, order: 0 });
    });
    return out;
  })();
  const STAMPS = ['.tl-stamp-private', '.tl-stamp-confirmed', '.tl-stamp-waitlisted'];
  const OVERRIDE = (s: string) => `.legacy-ui .tl-event-row > ${s}`;
  const OVERRIDE_DARK = (s: string) => `[data-theme="dark"] .legacy-ui .tl-event-row > ${s}`;
  /** 同一選擇器（不含 @media）依序合併的宣告：A 的基底＋覆寫（覆寫權重較高，後蓋前）。 */
  const merged = (stamp: string, dark = false): Record<string, string> => {
    const base = activity.filter((r) => r.selector === `.legacy-ui ${stamp}`);
    const light = card.filter((r) => r.selector === OVERRIDE(stamp) && r.atrule === null);
    const darkRules = dark ? card.filter((r) => r.selector === OVERRIDE_DARK(stamp) && r.atrule === null) : [];
    return Object.assign({}, ...base.map((r) => r.decls), ...light.map((r) => r.decls), ...darkRules.map((r) => r.decls));
  };

  it('三種印章同一尺寸（照 A 不公開章 52px、框 3px），仍是透明底圓框', () => {
    const sizes = STAMPS.map((s) => {
      const d = merged(s);
      return [d.width, d.height, d['border-width'], d['font-size'], d['letter-spacing'], d['border-radius'], d.transform].join('|');
    });
    expect(new Set(sizes).size).toBe(1);
    const d = merged('.tl-stamp-confirmed');
    expect([d.width, d.height, d['border-width'], d['font-size']]).toEqual(['52px', '52px', '3px', '12px']);
    for (const s of STAMPS) expect(merged(s).background, s).toBeUndefined();
  });

  it('權重高於 A 的印章規則（含 A 寬版的 @media）；不改位置（right／bottom 沿用 A）', () => {
    for (const s of STAMPS) {
      expect(gt(specificity(OVERRIDE(s)), specificity(`.legacy-ui ${s}`))).toBe(true);
      expect(gt(specificity(OVERRIDE_DARK(s)), specificity(OVERRIDE(s)))).toBe(true);
    }
    const touching = card.filter((r) => STAMPS.some((s) => r.selector.includes(s)));
    expect(touching.length).toBeGreaterThan(0);
    expect(touching.some((r) => ['right', 'left', 'top', 'bottom', 'position'].some((p) => p in r.decls) || r.atrule)).toBe(false);
  });

  it('淺色仍用 multiply（墨水感）但不透明度提高；深色改正常混合並換亮色，不再相乘成卡底同色', () => {
    for (const s of STAMPS) {
      const light = merged(s);
      expect(light['mix-blend-mode'], s).toBe('multiply');
      expect(light.color, s).toMatch(/,\.9\)$/);
      expect(light['border-color'], s).toBe(light.color);
      const dark = merged(s, true);
      expect(dark['mix-blend-mode'], s).toBe('normal');
      expect(dark.color, s).not.toBe(light.color);
      expect(dark['border-color'], s).toBe(dark.color);
      // 亮色：RGB 平均 > 150，深色卡底（約 #171c27～#262e40）上看得清楚
      const [r, g, b] = dark.color!.match(/\d+/g)!.slice(0, 3).map(Number);
      expect((r! + g! + b!) / 3, s).toBeGreaterThan(150);
    }
  });

  it('印章在光澤層之上：光澤只畫在卡片自己的背景（卡片沒有 ::before／::after 疊層），印章層級高於性別緞帶', () => {
    expect(card.some((r) => /\.tl-event-row[^ >]*::(before|after)/.test(r.selector))).toBe(false);
    const ribbon = activity.find((r) => r.selector === '.legacy-ui .tl-event-gender-ribbon');
    for (const s of STAMPS) {
      const d = merged(s);
      expect(d.position, s).toBe('absolute');
      expect(Number(d['z-index']), s).toBeGreaterThan(Number(ribbon?.decls['z-index']));
      expect(d['pointer-events'], s).toBe('none');
    }
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
