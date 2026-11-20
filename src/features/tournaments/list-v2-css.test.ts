import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

// jsdom 不套 CSS。外部列名稱不截斷、色票子集同值、沒有深色專屬規則，用靜態規則守住（寫法同 tournaments-glass-css.test.ts）。

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

function decls(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--d2-[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1] ?? '', (m[2] ?? '').trim());
  return out;
}

/** 某支檔裡選擇器清單含 `selector` 的那一條規則宣告的 --d2-*（同名只取第一次）。 */
function tokensOf(rel: string, selector: string): Map<string, string> {
  const css = withoutComments(readFileSync(resolve(process.cwd(), rel), 'utf8')).replace(/@import[^;]*;/g, '');
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = (m[1] ?? '').split(',').map((x) => x.trim().replace(/\s+/g, ' '));
    if (sels.includes(selector)) return decls(m[2] ?? '');
  }
  return new Map();
}

describe('list-v2.css：清單頁新外觀（清-3）', () => {
  const REL = 'src/features/tournaments/list-v2.css';
  const rules = flat(REL);
  const raw = withoutComments(readFileSync(resolve(process.cwd(), REL), 'utf8'));

  // 意圖沿用改寫前那一條：外部賽事名稱是外面來的內容，訪客列可以換行、不截斷（先前刻意定的）。
  // 管理者列（cpl-xrow--edit，多一顆編輯鈕）例外：名稱單行省略、↗ 不掉行（顧問 §3.494）。
  it('訪客外部列名稱不在任何省略或不換行規則裡；管理者列名稱單行省略', () => {
    const names = rules.filter((rule) => rule.selector.includes('.cpl-xrow__name') && !rule.selector.includes('cpl-xrow--edit'));
    expect(names.length).toBeGreaterThan(0);
    for (const rule of names) {
      expect(rule.decls['text-overflow'], rule.selector).not.toBe('ellipsis');
      expect(rule.decls['white-space'], rule.selector).not.toBe('nowrap');
    }
    expect(names.some((rule) => rule.decls['overflow-wrap'] === 'break-word')).toBe(true);
    const admin = rules.find((rule) => rule.selector === '#page-tournaments .cpl-xrow--edit .cpl-xrow__name');
    expect(admin?.decls).toMatchObject({ 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' });
    const meta = rules.find((rule) => rule.selector === '#page-tournaments .cpl-xrow--edit .cpl-xrow__meta');
    expect(meta?.decls['flex-wrap']).toBe('nowrap');
  });

  it('色票子集：同名變數與 competitions.css 淺色、深色逐字同值；兩個主題的變數名稱一致', () => {
    const light = tokensOf(REL, '.tournaments-root[data-d2]');
    const dark = tokensOf(REL, '[data-theme="dark"] .tournaments-root[data-d2]');
    const compLight = tokensOf('src/features/competitions/competitions.css', '.tournaments-root[data-d2]');
    const compDark = tokensOf('src/features/competitions/competitions.css', '[data-theme="dark"] .tournaments-root[data-d2]');
    expect(light.size).toBeGreaterThan(10);
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort());
    let shared = 0;
    for (const [name, value] of light) {
      if (!compLight.has(name)) continue;
      shared += 1;
      expect(value, name).toBe(compLight.get(name));
      // competitions.css 深色那條沒寫的變數沿用淺色值
      expect(dark.get(name), `${name}（深色）`).toBe(compDark.get(name) ?? compLight.get(name));
    }
    expect(shared).toBeGreaterThanOrEqual(16);
  });

  it('深色專屬規則只有色票那一條（含確認框那個選擇器）；沒有 !important、color-mix、backdrop-filter、:has(、:is(', () => {
    const darkRules = rules.filter((rule) => rule.selector.startsWith('[data-theme="dark"]'));
    expect(darkRules.map((rule) => rule.selector)).toEqual([
      '[data-theme="dark"] .tournaments-root[data-d2]',
      '[data-theme="dark"].cp-danger-confirm #app-confirm-modal',
    ]);
    expect(raw).not.toContain('!important');
    expect(raw).not.toMatch(/color-mix|backdrop-filter|:has\(|:is\(/);
  });
});
