import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

// 完善個人資料彈窗的橘色提示框（.fl-alert）字色對比 ≥ 4.5:1（2026-11-19 後續卡 3）。
// jsdom 不套 CSS：底色用 390px 實拍取樣（彈窗玻璃底＋橘色 12% 疊色後的像素），字色讀 layout.css。
// 淺色取樣 #fcf2e0、深色取樣 #4c4742（C:/t/tmp/FCB/mc-shots 實測）。底色若改，這裡要重量。
const SAMPLED_BG = { light: '#fcf2e0', dark: '#4c4742' } as const;

function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function alertColors(): { light: string; dark: string } {
  const css = readFileSync(resolve(__dirname, '../../../../styles/legacy/layout.css'), 'utf8');
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    const sel = rule.selector.trim();
    if (sel !== '.fl-alert' && sel !== '[data-theme="dark"] .fl-alert') return;
    rule.walkDecls('color', (decl) => {
      out[sel === '.fl-alert' ? 'light' : 'dark'] = decl.value.trim();
    });
  });
  return { light: out.light ?? '', dark: out.dark ?? '' };
}

describe('完善資料彈窗橘色提示框對比', () => {
  it('淺色與深色字色對取樣底色都 ≥ 4.5:1', () => {
    const colors = alertColors();
    expect(colors.light).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colors.dark).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(colors.light, SAMPLED_BG.light)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.dark, SAMPLED_BG.dark)).toBeGreaterThanOrEqual(4.5);
  });
});
