import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 純 JS 建置工具，與 vite.config.ts 使用同一個 scope 外掛。
import { legacyCssScope } from '../../../../scripts/legacy-css-scope.mjs';

// 2026-11-13 首頁「液態光澤」（與活動頁同一風格）：jsdom 不套 CSS，這裡以打包後（legacy-css-scope 改寫後）的選擇器靜態守住
// 只套首頁、不自創變數、不用 color-mix／backdrop-filter、隨入口載入（不閃），以及報名狀態小框改掉 color-mix（健檢 B4-10）。

const DIR = 'src/features/home';

interface Flat { selector: string; decls: Record<string, string> }

function scoped(file: string): Flat[] {
  const path = resolve(process.cwd(), DIR, file);
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

describe('home-glass.css：首頁液態光澤', () => {
  const rules = scoped('legacy/home-glass.css');
  const raw = withoutComments(readFileSync(resolve(process.cwd(), DIR, 'legacy/home-glass.css'), 'utf8'));

  it('每條規則都限定在首頁（#page-home 或首頁外層 .home-root）', () => {
    expect(rules.length).toBeGreaterThan(20);
    for (const r of rules) expect(r.selector, r.selector).toMatch(/#page-home|\.legacy-ui\.home-root/);
  });

  it('不自創 CSS 變數、不用 color-mix、不用 backdrop-filter', () => {
    expect(raw).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/m);
    expect(raw).not.toMatch(/color-mix/);
    expect(raw).not.toMatch(/backdrop-filter/);
  });

  it('頁面底層：固定在視窗、不擋點擊，淺深兩組；不用 isolation（找活動對話框在頁內，堆疊層會被頂部列壓住）', () => {
    const light = rules.find((r) => r.selector === '.legacy-ui.home-root::before');
    const dark = rules.find((r) => r.selector === '[data-theme="dark"] .legacy-ui.home-root::before');
    expect(light?.decls.position).toBe('fixed');
    expect(light?.decls['pointer-events']).toBe('none');
    expect(dark?.decls.background).toMatch(/#0b0f16/);
    expect(rules.find((r) => r.selector === '.legacy-ui.home-root > #page-home')?.decls.position).toBe('relative');
    const pageLevel = rules.filter((r) => /home-root/.test(r.selector) || /#page-home$/.test(r.selector));
    expect(pageLevel.length).toBeGreaterThan(0);
    for (const r of pageLevel) {
      expect(r.decls.isolation, r.selector).toBeUndefined();
      expect(r.decls['z-index'], r.selector).toBeUndefined();
    }
  });

  it('下一場活動卡、運動快速入口淺深色都有玻璃底與光影', () => {
    for (const sel of ['.home-next-card', '.home-dashboard-section', '.home-sport-chip']) {
      for (const pre of ['.legacy-ui #page-home ', '[data-theme="dark"] .legacy-ui #page-home ']) {
        const r = rules.find((x) => x.selector === `${pre}${sel}`);
        expect(r?.decls.background, `${pre}${sel}`).toMatch(/linear-gradient\(180deg, rgba\(255,255,255,\.\d+\) 0/);
        expect(r?.decls['box-shadow'], `${pre}${sel}`).toMatch(/inset/);
      }
    }
  });

  it('查看全部：點擊區補到 44px（::after 高 44px、置中）', () => {
    const hit = rules.find((r) => r.selector === '.legacy-ui #page-home .home-next-view-all::after');
    expect(hit?.decls.height).toBe('44px');
    expect(hit?.decls['margin-top']).toBe('-22px');
  });

  it('HomePage 靜態引入（隨入口載入、放在 home.css 之後），不用 import() 延遲載入；外層帶 home-root', () => {
    const src = readFileSync(resolve(process.cwd(), DIR, 'pages/HomePage.tsx'), 'utf8');
    const homeCss = src.indexOf("import '../legacy/home.css';");
    const glass = src.indexOf("import '../legacy/home-glass.css';");
    expect(homeCss).toBeGreaterThan(-1);
    expect(glass).toBeGreaterThan(homeCss);
    expect(src).not.toMatch(/import\(\s*['"][^'"]*home-glass\.css['"]\s*\)/);
    expect(src).toContain('<div class="legacy-ui home-root">');
  });
});

describe('home.css：報名狀態小框不用 color-mix（健檢 B4-10）', () => {
  const rules = scoped('legacy/home.css');
  it('淺色與深色的四種狀態都改 rgba', () => {
    const pills = rules.filter((r) => /\.home-next-status-(confirmed|waitlisted|owner|delegate)$/.test(r.selector));
    expect(pills.length).toBe(8);
    for (const r of pills) {
      for (const [prop, value] of Object.entries(r.decls)) expect(value, `${r.selector} ${prop}`).not.toMatch(/color-mix/);
      expect(r.decls.background, r.selector).toMatch(/^rgba\(/);
    }
  });
});
