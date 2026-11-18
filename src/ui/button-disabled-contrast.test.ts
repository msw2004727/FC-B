import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

// R-UI-031：jsdom 不套 CSS。停用鈕字色與停用底的對比用 token 實色計算。
// opacity: .6 是整顆按鈕一起淡（字與底同一層），這裡比的是字色對停用底，修的是近黑字疊近黑底。

function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function declsIn(css: string, selector: string): Record<string, string> {
  const root = postcss.parse(css);
  const out: Record<string, string> = {};
  root.walkRules((rule) => {
    if (rule.selector !== selector) return;
    rule.walkDecls((decl) => {
      out[decl.prop] = decl.value.trim();
    });
  });
  return out;
}

function themeMap(css: string, selector: string, base: Record<string, string> = {}): Record<string, string> {
  return { ...base, ...declsIn(css, selector) };
}

function resolveColor(name: string, map: Record<string, string>, seen = new Set<string>()): string {
  const raw = map[name];
  if (!raw) throw new Error(`找不到 ${name}`);
  const ref = raw.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (!ref?.[1]) return raw;
  if (seen.has(name)) throw new Error(`循環 ${name}`);
  seen.add(name);
  return resolveColor(ref[1], map, seen);
}

describe('Button 停用字色對比（R-UI-031）', () => {
  const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
  const buttonCss = readFileSync(resolve(process.cwd(), 'src/ui/button.css'), 'utf8');
  const harnessCss = readFileSync(resolve(process.cwd(), 'src/dev/cp-step2-harness.css'), 'utf8');
  const light = themeMap(tokensCss, ':root');
  const dark = themeMap(tokensCss, ':root[data-theme="dark"]', light);
  const disabled = declsIn(buttonCss, '.ui-button[aria-disabled="true"]');
  const disabledBg = declsIn(buttonCss, '.ui-button[aria-disabled="true"]::before');

  it('停用字用 --color-text-primary，底用 --color-brand-disabled', () => {
    expect(disabled.color).toBe('var(--color-text-primary)');
    expect(disabledBg.background).toBe('var(--color-brand-disabled)');
    expect(Number(disabled.opacity)).toBe(0.6);
  });

  it('淺色與深色的字對停用底都至少 4.5:1', () => {
    for (const [label, map] of [['light', light], ['dark', dark]] as const) {
      const fg = resolveColor('--color-text-primary', map);
      const bg = resolveColor('--color-brand-disabled', map);
      expect(fg.startsWith('#'), label).toBe(true);
      expect(bg.startsWith('#'), label).toBe(true);
      expect(contrast(fg, bg), `${label} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('深色 brand-fg 疊 brand-disabled 達不到 4.5，所以不能沿用品牌前景', () => {
    const fg = resolveColor('--color-brand-fg', dark);
    const bg = resolveColor('--color-brand-disabled', dark);
    expect(contrast(fg, bg)).toBeLessThan(4.5);
  });

  it('停用字色規則寫在 hover 之後，同樣權重時蓋過 hover 的品牌前景', () => {
    const root = postcss.parse(buttonCss);
    let hoverAt = -1;
    let disabledAt = -1;
    let i = 0;
    root.walkRules((rule) => {
      const index = i++;
      if (rule.selector === '.ui-button:hover,\n.ui-button:active' || rule.selectors.includes('.ui-button:hover')) {
        if (rule.nodes.some((node) => node.type === 'decl' && node.prop === 'color')) hoverAt = index;
      }
      if (rule.selector === '.ui-button[aria-disabled="true"]') disabledAt = index;
    });
    expect(hoverAt).toBeGreaterThanOrEqual(0);
    expect(disabledAt).toBeGreaterThan(hoverAt);
  });

  it('預覽 harness 不再覆寫停用鈕字色', () => {
    expect(harnessCss).not.toContain('.cps-actions .ui-button:disabled');
    expect(harnessCss).not.toContain('幾乎看不見');
  });
});
