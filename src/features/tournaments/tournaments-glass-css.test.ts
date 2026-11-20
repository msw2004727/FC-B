import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 純 JS 建置工具，與 vite.config.ts 使用同一個 scope 外掛。
import { legacyCssScope } from '../../../scripts/legacy-css-scope.mjs';

// 2026-11-13 賽事卡片清單「液態光澤」與既有跨頁外溢修正：jsdom 不套 CSS，這裡靜態守住。
// 外溢（既有 bug）：俱樂部列表卡也叫 .tc-card，首頁閒置時兩頁樣式都會預先下載；tournaments.css 不限定頁面的
// .tc-card { margin-bottom: 12px } 讓俱樂部卡間距變 19.5px，team.css 的 .tc-card 框線也套到賽事卡外層。

interface Flat { selector: string; decls: Record<string, string> }

function flat(rel: string, scope: boolean): Flat[] {
  const path = resolve(process.cwd(), rel);
  const css = readFileSync(path, 'utf8');
  const root = scope ? postcss([legacyCssScope()]).process(css, { from: path }).sync().root : postcss.parse(css);
  const out: Flat[] = [];
  root.walkRules((rule: Rule) => {
    const decls: Record<string, string> = {};
    rule.walkDecls((d) => { decls[d.prop] = d.value; });
    for (const selector of rule.selectors) out.push({ selector, decls });
  });
  return out;
}
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('tournaments.css：.tc-card 只作用在賽事頁（既有跨頁外溢修正）', () => {
  const rules = flat('src/features/tournaments/tournaments.css', false);

  it('沒有不限定頁面、會碰到俱樂部卡（.tc-card 本身）的規則', () => {
    const bare = rules.filter((r) => /(^|[\s>+~])\.tc-card(?![\w-])/.test(r.selector) && !/#page-tournaments|\.tc-page/.test(r.selector));
    // 允許的只有後代鏈到賽事專屬元素的寫法（例如 .tc-card.ended .tc-card-link，俱樂部卡沒有 .tc-card-link）
    for (const r of bare) expect(r.selector, r.selector).toMatch(/\.tc-card-link|\.tc-card-img|\.tc-card-body/);
    expect(bare.every((r) => !('margin-bottom' in r.decls))).toBe(true);
  });

  // 新外觀清-3 改寫（顧問待點頭，第 5 批第 5 節）：賽事頁不再輸出 tc-card，外溢不可能發生；改守「賽事頁三支樣式與頁面元件不再出現 tc-card」。
  it('賽事頁不再出現 tc-card 這個 class（頁面元件與三支樣式）', () => {
    for (const rel of [
      'src/features/tournaments/pages/TournamentsPage.tsx',
      'src/features/tournaments/tournaments.css',
      'src/features/tournaments/list-v2.css',
      'src/features/tournaments/legacy/tournaments-glass.css',
    ]) {
      const text = withoutComments(readFileSync(resolve(process.cwd(), rel), 'utf8'));
      expect(text, rel).not.toMatch(/\btc-card(?![\w-])/);
    }
  });
});

describe('tournaments-glass.css：賽事頁液態光澤', () => {
  const GLASS = 'src/features/tournaments/legacy/tournaments-glass.css';
  const rules = flat(GLASS, true);
  const raw = withoutComments(readFileSync(resolve(process.cwd(), GLASS), 'utf8'));

  it('每條規則都限定在賽事頁（#page-tournaments 或外層 .tournaments-root）', () => {
    // 清-3 之後只剩頁面底色三條與返回鈕三條。
    expect(rules.length).toBeGreaterThanOrEqual(6);
    for (const r of rules) expect(r.selector, r.selector).toMatch(/#page-tournaments|\.legacy-ui\.tournaments-root/);
  });

  it('不自創 CSS 變數、不用 color-mix、不用 backdrop-filter', () => {
    expect(raw).not.toMatch(/(^|[;{\s])--[\w-]+\s*:/m);
    expect(raw).not.toMatch(/color-mix/);
    expect(raw).not.toMatch(/backdrop-filter/);
  });

  it('返回鈕改 position: relative 時 top／left 歸零；點擊區補到 44px', () => {
    const btn = rules.find((r) => r.selector === '.legacy-ui #page-tournaments .page-header .back-btn');
    expect(btn?.decls).toMatchObject({ position: 'relative', top: '0', left: '0' });
    const hit = rules.find((r) => r.selector === '.legacy-ui #page-tournaments .page-header .back-btn::after');
    expect(hit?.decls).toMatchObject({ top: '-5px', bottom: '-5px' });
  });

  it('TournamentsPage 引入本檔、外層帶 tournaments-root', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/features/tournaments/pages/TournamentsPage.tsx'), 'utf8');
    expect(src).toContain("import '../legacy/tournaments-glass.css';");
    expect(src).toContain('<div class="legacy-ui tournaments-root"');
  });
});
