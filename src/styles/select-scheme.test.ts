import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 站長 11-20：深色模式原生下拉展開看不到字。jsdom 不畫原生清單，這裡守住規則本身並驗計算後的選項底色與字色。
const css = readFileSync(resolve(__dirname, 'legacy-vars.css'), 'utf8');


describe('原生下拉跟著 App 主題', () => {
  it('依 data-theme 宣告 select 的 color-scheme，選項有明確底色與字色', () => {
    expect(css).toContain('[data-theme="dark"] select { color-scheme: dark; }');
    expect(css).toContain('[data-theme="light"] select { color-scheme: light; }');
    expect(css).toContain('select option { background-color: var(--bg-card); color: var(--text-primary); }');
  });

  it('兩個主題都定義了選項用的 --bg-card 與 --text-primary（深淺各自對比分明）', () => {
    const block = (sel: string) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
    const dark = block('[data-theme="dark"] {');
    const light = block('[data-theme="light"] {');
    expect(dark).toMatch(/--bg-card:\s*#181d27/);
    expect(dark).toMatch(/--text-primary:\s*#f5f7fa/);
    expect(light).toMatch(/--bg-card:\s*#ffffff/);
    expect(light).toMatch(/--text-primary:\s*#1a1d24/);
  });
});
