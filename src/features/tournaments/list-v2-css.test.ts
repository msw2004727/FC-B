import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

// jsdom 不套 CSS。單行省略與 color-mix 退路用靜態規則守住，寫法同 tournaments-glass-css.test.ts。

interface Flat { selector: string; decls: Record<string, string> }

function flat(rel: string): Flat[] {
  const path = resolve(process.cwd(), rel);
  const root = postcss.parse(readFileSync(path, 'utf8'));
  const out: Flat[] = [];
  root.walkRules((rule: Rule) => {
    const decls: Record<string, string> = {};
    rule.walkDecls((d) => { decls[d.prop] = d.value; });
    for (const selector of rule.selectors) out.push({ selector, decls });
  });
  return out;
}

const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('list-v2.css：站內卡省略與分類外框退路', () => {
  const REL = 'src/features/tournaments/list-v2.css';
  const rules = flat(REL);
  const raw = withoutComments(readFileSync(resolve(process.cwd(), REL), 'utf8'));

  it('單行省略只套站內卡容器，外部卡名稱不在省略規則裡', () => {
    const names = rules.filter((rule) => rule.selector.includes('.tc-card-name') || rule.selector.includes('.tc-card-dates'));
    const ellipsis = names.filter((rule) => rule.decls['text-overflow'] === 'ellipsis' || rule.decls['white-space'] === 'nowrap');
    expect(ellipsis.length).toBeGreaterThan(0);
    for (const rule of ellipsis) {
      expect(rule.selector).toContain('[data-inapp="competitions"]');
    }
    expect(ellipsis.every((rule) => rule.selector.includes('[data-inapp="competitions"]'))).toBe(true);
  });

  it('分類小標外框先寫固定 rgba，再寫 color-mix', () => {
    const blocks = raw.split('}').filter((block) => block.includes('cpl-chip--') && block.includes('color-mix'));
    expect(blocks.length).toBe(6);
    for (const block of blocks) {
      const rgbaAt = block.search(/box-shadow:[^;]*rgba\(/);
      const mixAt = block.search(/box-shadow:[^;]*color-mix\(/);
      expect(rgbaAt).toBeGreaterThanOrEqual(0);
      expect(mixAt).toBeGreaterThan(rgbaAt);
    }
  });
});
