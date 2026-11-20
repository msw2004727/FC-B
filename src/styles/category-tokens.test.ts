import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { COMPETITIONS_ENABLED } from '@/feature-overrides';

const ROOT = process.cwd();

function css(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

function varsOf(rel: string, selector: string): Record<string, string> {
  const root = postcss.parse(css(rel));
  const found: Record<string, string> = {};
  root.walkRules((rule) => {
    if (rule.selector !== selector) return;
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) found[decl.prop] = decl.value;
    });
  });
  return found;
}

function expandHex(hex: string): string {
  const raw = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return raw;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const full = expandHex(hex).slice(1);
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const left = luminance(a);
  const right = luminance(b);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const LIGHT_CARDS = ['#ffffff', '#edf1f6'];
const DARK_CARDS = ['#262e40', '#171c27'];

describe('category-tokens 照預覽逐值抄', () => {
  const tokens = varsOf('src/styles/category-tokens.css', ':root');
  const dark = varsOf('src/styles/category-tokens.css', '[data-theme="dark"]');
  const listRoot = varsOf('src/dev/cp-step3-list-harness.css', ':root');
  const listDark = varsOf('src/dev/cp-step3-list-harness.css', '[data-theme="dark"]');
  // 隊徽色票原本照 src/dev/cp-step3-harness.css（第 3 步手寫預覽）逐值抄；總收尾刪掉那支舊示範頁，數值原樣搬到這裡。
  const crestRoot: Record<string, string> = { '--crest-0': '#0f766e', '--crest-1': '#0e7490', '--crest-2': '#c2410c', '--crest-3': '#be123c', '--crest-4': '#475569', '--crest-5': '#4d7c0f', '--crest-6': '#57534e', '--crest-7': '#047857', '--crest-fg': '#fff' };
  const crestDark: Record<string, string> = { '--crest-0': '#2dd4bf', '--crest-1': '#22d3ee', '--crest-2': '#fb923c', '--crest-3': '#fb7185', '--crest-4': '#94a3b8', '--crest-5': '#a3e635', '--crest-6': '#a8a29e', '--crest-7': '#34d399', '--crest-fg': '#0b0f16' };

  it('預覽與 tokens 都真的讀到變數（避免空物件讓比對恆真，Flash 初審 P2）', () => {
    for (const [name, vars, min] of [['tokens', tokens, 20], ['dark', dark, 15], ['listRoot', listRoot, 12], ['listDark', listDark, 6], ['crestRoot', crestRoot, 9], ['crestDark', crestDark, 9]] as const) {
      expect(Object.keys(vars).length, name).toBeGreaterThanOrEqual(min);
    }
  });

  it('淺色分類色、封面漸層、隊徽與預覽相同', () => {
    for (const [key, value] of Object.entries(listRoot)) {
      expect(tokens[key], key).toBe(value);
    }
    for (const [key, value] of Object.entries(crestRoot)) {
      expect(tokens[key], key).toBe(value);
    }
  });

  it('深色分類色與隊徽與預覽相同，封面漸層沿用淺色', () => {
    for (const [key, value] of Object.entries(listDark)) {
      expect(dark[key], key).toBe(value);
    }
    for (const [key, value] of Object.entries(crestDark)) {
      expect(dark[key], key).toBe(value);
    }
    for (const key of ['--cat-league-from', '--cat-league-to', '--cat-cup-from', '--cat-cup-to', '--cat-friendly-from', '--cat-friendly-to']) {
      expect(dark[key], key).toBe(tokens[key]);
    }
  });
});

describe('隊徽對比（顧問 §3.264⑤）', () => {
  const tokens = varsOf('src/styles/category-tokens.css', ':root');
  const dark = varsOf('src/styles/category-tokens.css', '[data-theme="dark"]');

  it('淺色：底色對卡片 ≥ 3:1，字色對底色 ≥ 4.5:1', () => {
    for (let i = 0; i < 8; i += 1) {
      const bg = tokens[`--crest-${i}`] ?? '';
      for (const card of LIGHT_CARDS) {
        expect(contrast(bg, card), `--crest-${i} vs ${card}`).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(tokens['--crest-fg'] ?? '', bg), `fg vs --crest-${i}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('深色：底色對卡片 ≥ 3:1，字色對底色 ≥ 4.5:1', () => {
    for (let i = 0; i < 8; i += 1) {
      const bg = dark[`--crest-${i}`] ?? '';
      for (const card of DARK_CARDS) {
        expect(contrast(bg, card), `--crest-${i} vs ${card}`).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(dark['--crest-fg'] ?? '', bg), `fg vs --crest-${i}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('分類色不進首頁入口', () => {
  const entryFiles = [
    resolve(ROOT, 'src/main.tsx'),
    resolve(ROOT, 'src/styles/tokens.css'),
    ...['src/styles/legacy-vars.css', 'src/styles/base.css', 'src/styles/legacy/base.css', 'src/styles/legacy/layout.css', 'src/styles/legacy-body-state.css', 'src/styles/legacy-input-zoom.css', 'src/styles/legacy-line-height.css'].map((rel) => resolve(ROOT, rel)),
    ...walk(resolve(ROOT, 'src/app')),
    ...walk(resolve(ROOT, 'src/core')),
    ...walk(resolve(ROOT, 'src/ui')),
  ];

  it('入口會靜態匯入的檔案沒有 category-tokens', () => {
    for (const file of entryFiles) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain('category-tokens');
      expect(text, file).not.toContain('--cat-league');
      expect(text, file).not.toContain('--crest-0');
    }
  });

  // 清-3（第 5 批終審第 3 點）：清單頁已經沒有規則用分類色，拿掉賽事頁的匯入；站內賽事樣式那一邊照舊。
  it('賽事頁不再匯入、站內賽事樣式有匯入，開關字面與建置期常數一致', () => {
    const page = css('src/features/tournaments/pages/TournamentsPage.tsx');
    const sheet = css('src/features/competitions/competitions.css');
    expect(page).not.toContain("import '@/styles/category-tokens.css';");
    expect(sheet.startsWith("@import '../../styles/category-tokens.css';")).toBe(true);
    const flag = css('src/feature-overrides.ts');
    if (COMPETITIONS_ENABLED) {
      expect(flag).toContain('export const COMPETITIONS_ENABLED = true;');
    } else {
      expect(flag).toContain('export const COMPETITIONS_ENABLED = false;');
    }
  });
});
