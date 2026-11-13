import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 純 JS 建置工具，與 vite.config.ts 使用同一個 scope 外掛。
import { legacyCssScope } from '../../../../scripts/legacy-css-scope.mjs';

// 2026-11-13 俱樂部列表「液態光澤」（與活動頁同一風格，站長選 B 案：主題色內光）：jsdom 不套 CSS，這裡以打包後
// （legacy-css-scope 改寫後）的選擇器靜態守住只套列表頁、卡片間距同活動卡、主題色與退路、不自創變數、不用 color-mix，
// 以及同檔的健檢 B4-10 修正（搜尋鈕 hover 不用 color-mix、浮動鈕補 -webkit-backdrop-filter）。

interface Flat { selector: string; decls: Record<string, string> }

function scoped(rel: string): Flat[] {
  const path = resolve(process.cwd(), rel);
  const root = postcss([legacyCssScope()]).process(readFileSync(path, 'utf8'), { from: path }).sync().root;
  const out: Flat[] = [];
  root.walkRules((rule: Rule) => {
    const decls: Record<string, string> = {};
    rule.walkDecls((d) => { decls[d.prop] = d.value; });
    for (const selector of rule.selectors) out.push({ selector, decls });
  });
  return out;
}
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** 同一選擇器可能分在幾條規則（共用宣告＋各自宣告），依檔案順序合併成最後生效的宣告。 */
const get = (rules: Flat[], selector: string): Flat => {
  const hits = rules.filter((r) => r.selector === selector);
  if (!hits.length) throw new Error(`找不到 ${selector}`);
  return { selector, decls: Object.assign({}, ...hits.map((h) => h.decls)) };
};

const GLASS = 'src/features/clubs/legacy/teams-glass.css';
const THEMED = '.tc-card.tc-row.tc-themed:not(.tc-attention-effect):not(.tc-pinned)';

describe('teams-glass.css：俱樂部列表液態光澤', () => {
  const rules = scoped(GLASS);
  const raw = withoutComments(readFileSync(resolve(process.cwd(), GLASS), 'utf8'));

  it('每條規則都限定在俱樂部列表（#page-teams 或外層 .teams-root），詳情與管理頁不受影響', () => {
    expect(rules.length).toBeGreaterThan(20);
    for (const r of rules) expect(r.selector, r.selector).toMatch(/#page-teams|\.legacy-ui\.teams-root/);
  });

  it('不自創 CSS 變數、不用 color-mix、不用 backdrop-filter（主題色只讀 LegacyTeamCard 既有的 --team-theme-color）', () => {
    expect(raw).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/m);
    expect(raw).not.toMatch(/color-mix/);
    expect(raw).not.toMatch(/backdrop-filter/);
    const vars = new Set(raw.match(/var\(--[\w-]+/g) ?? []);
    expect([...vars].sort()).toEqual(['var(--accent', 'var(--team-theme-color'].sort());
  });

  it('卡片間距與活動卡同一天的間距相同（activity.css .tl-events-col gap）', () => {
    const activity = postcss.parse(readFileSync(resolve(process.cwd(), 'src/features/events/legacy/activity.css'), 'utf8'));
    let activityGap = '';
    activity.walkRules('.tl-events-col', (rule) => { rule.walkDecls('gap', (d) => { activityGap = d.value; }); });
    expect(activityGap).toBe('.4rem');
    expect(get(rules, '.legacy-ui #page-teams .team-grid').decls.gap).toBe(activityGap);
  });

  it('預設卡（也是沒設主題色時的退路）淺深色都是主色綠內光；置頂卡是琥珀', () => {
    for (const sel of ['.legacy-ui #page-teams .tc-card.tc-row', '[data-theme="dark"] .legacy-ui #page-teams .tc-card.tc-row']) {
      const r = get(rules, sel);
      expect(r.decls.background, sel).toMatch(/rgba\(13,148,136,/);
      expect(r.decls['box-shadow'], sel).toMatch(/inset 0 -6px 12px -6px rgba\(13,148,136,/);
    }
    expect(get(rules, '.legacy-ui #page-teams .tc-card.tc-row.tc-pinned').decls['box-shadow']).toMatch(/rgba\(217,119,6,/);
    expect(get(rules, '[data-theme="dark"] .legacy-ui #page-teams .tc-card.tc-row.tc-pinned').decls['box-shadow']).toMatch(/rgba\(251,191,36,/);
  });

  it('有主題色的卡（B 案）：左側淡色與底部內光用 --team-theme-color，排除置頂與光跡卡；底色不再帶主色綠', () => {
    const base = get(rules, `.legacy-ui #page-teams ${THEMED}`);
    expect(base.decls.isolation).toBe('isolate');
    expect(base.decls.background).not.toMatch(/13,148,136/);
    expect(base.decls['box-shadow']).not.toMatch(/13,148,136/);
    const before = get(rules, `.legacy-ui #page-teams ${THEMED}::before`);
    const after = get(rules, `.legacy-ui #page-teams ${THEMED}::after`);
    expect(before.decls.background).toContain('var(--team-theme-color)');
    expect(after.decls['box-shadow']).toContain('var(--team-theme-color)');
    // 兩層都畫在卡片底色之上、內容之下，且不擋點擊
    for (const r of rules.filter((x) => x.selector.endsWith(`${THEMED}::before`) || x.selector.endsWith(`${THEMED}::after`))) {
      if ('z-index' in r.decls) expect(r.decls['z-index']).toBe('-1');
      if ('content' in r.decls) expect(r.decls['pointer-events']).toBe('none');
    }
    expect(Number(get(rules, `[data-theme="dark"] .legacy-ui #page-teams ${THEMED}::after`).decls.opacity)).toBeGreaterThan(0);
  });

  it('返回／搜尋鈕改 position: relative 時把 A .back-btn 的 top／left 歸零（預覽時曾因此位移）', () => {
    for (const r of rules.filter((x) => x.decls.position === 'relative' && /back-btn/.test(x.selector))) {
      expect(r.decls.top, r.selector).toBe('0');
      expect(r.decls.left, r.selector).toBe('0');
    }
    expect(rules.some((x) => /back-btn$/.test(x.selector) && x.decls.position === 'relative')).toBe(true);
  });

  it('TeamsPage 引入本檔、外層帶 teams-root', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/features/clubs/pages/TeamsPage.tsx'), 'utf8');
    expect(src).toContain("import '../legacy/teams-glass.css';");
    expect(src).toContain('<div class="legacy-ui teams-root">');
  });
});

describe('team.css：健檢 B4-10 同檔修正', () => {
  const rules = scoped('src/features/clubs/legacy/team.css');

  it('搜尋鈕 hover／選中不用 color-mix，淺深色各一組 rgba', () => {
    const toggles = rules.filter((r) => /\.team-filter-toggle-btn(:hover|\.active)$/.test(r.selector));
    expect(toggles.length).toBe(4);
    for (const r of toggles) {
      for (const [prop, value] of Object.entries(r.decls)) expect(value, `${r.selector} ${prop}`).not.toMatch(/color-mix/);
    }
    expect(toggles.some((r) => r.selector.startsWith('[data-theme="dark"]') && /52, 211, 153/.test(r.decls.background ?? ''))).toBe(true);
  });

  it('.td-floating-top-btn 的 backdrop-filter 有 -webkit- 前綴', () => {
    const r = get(rules, '.legacy-ui .td-floating-top-btn');
    expect(r.decls['backdrop-filter']).toBe('blur(12px)');
    expect(r.decls['-webkit-backdrop-filter']).toBe('blur(12px)');
  });
});
