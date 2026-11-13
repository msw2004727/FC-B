import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 純 JS 建置工具，與 vite.config.ts 使用同一個 scope 外掛。
import { legacyCssScope } from '../../../../../scripts/legacy-css-scope.mjs';

// 2026-11-13 活動頁頂部精簡 C 方案＋「整片液態玻璃、分隔線區分按鈕」（站長看 g2 預覽定案）：jsdom 不套 CSS，
// 這裡以打包後（legacy-css-scope 改寫後）的選擇器靜態守住玻璃片、分隔線、選中狀態、女生專屬、點擊範圍 44px 與相容寫法。

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

/** 同一選擇器可能出現在多條規則：取最後一條有宣告該屬性的值（後者覆蓋前者）。 */
function last(rules: Flat[], selector: string, prop: string): string | undefined {
  return rules.filter((r) => r.selector === selector && r.atrule === null && prop in r.decls).at(-1)?.decls[prop];
}

/** 簡易權重 [id, class/attr/pseudo-class, element]；:not(...) 以括號內權重計。 */
function specificity(selector: string): [number, number, number] {
  const s = selector.replace(/::[\w-]+/g, '').replace(/:not\(([^)]*)\)/g, ' $1');
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
const TAB = '#activity-tabs > .tab';
const GLOSS = /^linear-gradient\(180deg, rgba\(255,255,255,\.\d+\) 0%, rgba\(255,255,255,\.\d+\) 46%, rgba\(255,255,255,0\) 54%\)/;

describe('activity-head.css：整片液態玻璃＋分隔線', () => {
  const rules = scoped();
  const raw = readFileSync(FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('兩片玻璃（返回／搜尋／分享、頁籤＋地區）：四角 12px，上半光澤、inset 外框與頂緣亮線、底部內光、投影；淺深色都有', () => {
    for (const slab of ['.activity-head-tools', '.activity-filter-slab']) {
      for (const sel of [`${S} ${slab}`, `${D} ${slab}`]) {
        const r = find(rules, sel);
        expect(r.decls.background, sel).toMatch(GLOSS);
        expect(r.decls['box-shadow'], sel).toMatch(/^inset 0 0 0 1px rgba\([^)]*\), inset 0 2px 0 -1px (?:#[0-9a-f]+|rgba\([^)]*\)), inset 0 -6px 12px -6px rgba\([^)]*\), 0 6px 14px -10px /);
      }
      expect(find(rules, `${S} ${slab}`).decls['border-radius']).toBe('12px');
    }
    expect(last(rules, `${S} .activity-head-tools`, 'height')).toBe('36px');
    expect(last(rules, `${S} .activity-filter-slab`, 'height')).toBe('40px');
  });

  it('片內按鈕不各自畫框與陰影、四角不圓；高 44px（比玻璃片高，點擊範圍 ≥44px）', () => {
    for (const sel of [`${S} .activity-head-tools > button`, `${S} ${TAB}`, `${S} .activity-region-btn`]) {
      expect(find(rules, sel).decls, sel).toMatchObject({
        height: '44px', border: '0', 'border-radius': '0', background: 'none', 'box-shadow': 'none', 'white-space': 'nowrap',
      });
    }
    // 標題列片 36px：按鈕 44×44，上下各超出 4px（標題列上下留白 4.8px，不被黏頂列蓋住）
    const tool = `${S} .activity-head-tools > button`;
    expect([last(rules, tool, 'width'), last(rules, tool, 'margin')]).toEqual(['44px', '-4px 0']);
    // 篩選列片 40px：頁籤捲動區與地區鈕各 44px、上下各超出 2px（黏頂列上下留 2px）
    expect(find(rules, `${S} #activity-tabs`).decls).toMatchObject({ height: '44px', margin: '-2px 0', 'overflow-x': 'auto' });
    expect(find(rules, `${S} .activity-region-pick`).decls).toMatchObject({ height: '44px', margin: '-2px 0' });
    expect(last(rules, `${S}.page > .activity-sticky-filters`, 'padding')).toBe('2px .2rem');
    // A 的 .back-btn 帶 absolute 與 top／left .8rem，必須歸零
    expect([last(rules, tool, 'position'), last(rules, tool, 'top'), last(rules, tool, 'left')]).toEqual(['relative', '0', '0']);
  });

  it('分隔線：第一顆以外的按鈕左側 1px 細線（頁籤可捲時跟著捲）；地區鈕以分隔線與頁籤隔開；A 的「|」不顯示', () => {
    for (const sel of [
      `${S} .activity-head-tools > button + button::before`,
      `${S} ${TAB}:not(:first-child)::before`,
      `${S} .activity-region-pick::before`,
    ]) {
      expect(find(rules, sel).decls, sel).toMatchObject({ content: "''", position: 'absolute', left: '0', width: '1px', 'pointer-events': 'none' });
      expect(find(rules, `[data-theme="dark"] ${sel}`).decls.background).toBe('rgba(255,255,255,.14)');
    }
    expect(find(rules, `${S} #activity-tabs > .activity-tab-separator`).decls.display).toBe('none');
  });

  it('選中：片內淡色圓角填底（::after 在文字下）＋主色字；深色另一組', () => {
    const fill = find(rules, `${S} .activity-head-tools > button::after`);
    expect(fill.decls).toMatchObject({ position: 'absolute', 'z-index': '-1', 'border-radius': '8px', 'pointer-events': 'none' });
    for (const btn of [TAB, '.activity-region-btn']) {
      expect(find(rules, `${S} ${btn}.active`).decls.color).toBe('var(--accent)');
      expect(find(rules, `${S} ${btn}.active::after`).decls.background).toContain('rgba(13,148,136,.14)');
      expect(find(rules, `${D} ${btn}.active::after`).decls.background).toContain('rgba(52,211,153,.16)');
    }
    expect(find(rules, `${S} .activity-head-tools > .page-search-toggle-btn.active::after`).decls.background).toBe('rgba(13,148,136,.13)');
    // 按鈕本身 z-index 0 形成堆疊，填底的 -1 才會在文字下、玻璃片上
    expect(find(rules, `${S} ${TAB}`).decls['z-index']).toBe('0');
  });

  it('女生專屬：未選粉色字；選中片內粉紅漸層＋光澤、白字；淺深色都有，且蓋過一般選中樣式', () => {
    const female = `${TAB}.activity-tab-female`;
    expect(find(rules, `${S} ${female}`).decls.color).toBe('#db2777');
    expect(find(rules, `${D} ${female}`).decls.color).toBe('#f9a8d4');
    expect(find(rules, `${S} ${female}.active`).decls.color).toBe('#fff');
    const onLight = find(rules, `${S} ${female}.active::after`);
    const onDark = find(rules, `${D} ${female}.active::after`);
    expect(onLight.decls.background).toMatch(GLOSS);
    expect(onLight.decls.background).toContain('linear-gradient(135deg, #f472b6, #ec4899)');
    expect(onDark.decls.background).toMatch(GLOSS);
    expect(onDark.decls.background).toContain('linear-gradient(135deg, #be185d, #ec4899)');
    expect(wins(onLight, find(rules, `${S} ${TAB}.active::after`))).toBe(true);
    expect(wins(onDark, find(rules, `${D} ${TAB}.active::after`))).toBe(true);
    expect(wins(onDark, onLight)).toBe(true);
    expect(wins(find(rules, `${S} ${female}.active`), find(rules, `${S} ${TAB}.active`))).toBe(true);
    expect(wins(find(rules, `${S} ${female}.active`), find(rules, `${D} ${female}`))).toBe(true);
  });

  it('未開放（新手友善、高強度）灰字、不填底，淺深色都蓋過一般與女生樣式', () => {
    const off = find(rules, `${S} ${TAB}.activity-tab-unavailable`);
    expect(off.decls).toMatchObject({ color: 'var(--text-muted)', cursor: 'not-allowed' });
    expect(wins(off, find(rules, `${S} ${TAB}`))).toBe(true);
    expect(wins(find(rules, `${D} ${TAB}.activity-tab-unavailable`), find(rules, `${D} ${TAB}.activity-tab-female`))).toBe(true);
  });

  it('地區鈕最寬 7.5rem，長地區名以省略號收尾、圖示不縮；選單每列 44px、不折行', () => {
    expect(last(rules, `${S} .activity-region-btn`, 'max-width')).toBe('7.5rem');
    expect(find(rules, `${S} .activity-region-label`).decls).toMatchObject({ overflow: 'hidden', 'text-overflow': 'ellipsis', 'min-width': '0' });
    expect(find(rules, `${S} .activity-region-btn svg`).decls.flex).toBe('0 0 auto');
    expect(find(rules, `${S} .activity-region-item`).decls).toMatchObject({ 'min-height': '44px', 'white-space': 'nowrap' });
    // 短視窗：選單停在底部導覽上方、選單內捲動（Grok 初審 P2）；dvh 前有 vh 退路（postcss 讀到的是後寫的 dvh）
    const menu = find(rules, `${S} .activity-region-menu`);
    expect(menu.decls['max-height']).toBe('min(332px, calc(100dvh - var(--topbar-h) - var(--bottombar-h) - 110px))');
    expect(menu.decls).toMatchObject({ 'overflow-y': 'auto', 'overscroll-behavior': 'contain', 'z-index': '2' });
    expect(readFileSync(FILE, 'utf8')).toContain('max-height: min(332px, calc(100vh - var(--topbar-h) - var(--bottombar-h) - 110px));');
  });

  it('標題列可換行：「我要開團」放不下時整顆換到第二行靠右；開團鈕四角 10px、高 36px，後面墊 44px 的 label 補點擊範圍', () => {
    expect(find(rules, `${S} .activity-page-header`).decls).toMatchObject({ 'flex-wrap': 'wrap', gap: '10px .35rem' });
    expect(find(rules, `${S} .activity-page-heading`).decls.flex).toBe('1 0 auto');
    expect(find(rules, `${S} .activity-page-actions`).decls['min-height']).toBe('36px');
    expect(find(rules, `${S} .activity-create-hit`).decls).toMatchObject({ position: 'absolute', height: '44px', 'margin-top': '-22px', 'z-index': '0' });
    expect(find(rules, `${S} #activity-create-btn`).decls).toMatchObject({ 'z-index': '1', height: '36px', 'border-radius': '10px' });
    expect(find(rules, `${S} #activity-create-btn .activity-create-gloss`).decls).toMatchObject({ 'pointer-events': 'none', 'z-index': '3' });
    // 開團鈕外框與呼吸光暈照 A，本檔不覆寫
    const createRules = rules.filter((r) => /#activity-create-btn$/.test(r.selector));
    expect(createRules.some((r) => ['animation', 'animation-name', 'border', 'filter', 'box-shadow'].some((p) => p in r.decls))).toBe(false);
  });

  it('搜尋面板輸入框 16px（iPhone 不自動放大）', () => {
    expect(find(rules, `${S} .activity-filter-panel input`).decls['font-size']).toBe('16px');
    expect(find(rules, `${S} .activity-filter-panel select`).decls['font-size']).toBe('16px');
  });

  it('相容與規範：不用 backdrop-filter（只把 A 返回鈕的模糊關掉）、不用 color-mix、不自創 CSS 變數、沒有膠囊與正圓', () => {
    const blur = rules.flatMap((r) => Object.entries(r.decls).filter(([p]) => /backdrop-filter/.test(p)).map(([, v]) => v));
    expect(blur.every((v) => v === 'none')).toBe(true);
    expect(/color-mix\(/.test(raw)).toBe(false);
    expect(/(^|[;{\s])--[\w-]+\s*:/.test(raw)).toBe(false);
    expect(rules.some((r) => /999px|50%/.test(r.decls['border-radius'] ?? ''))).toBe(false);
    expect(rules.some((r) => 'border-top-color' in r.decls)).toBe(false);
  });
});
