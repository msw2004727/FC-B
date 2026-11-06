import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 2026-11-06 iPhone Safari 頂部列整條點不動：A 的 body 規則 overflow-x:hidden 限定到 .legacy-ui 後，
// 包住頂部列／底部導覽等 fixed 元素的 .legacy-ui.legacy-chrome 外框變成捲動容器（A 沒有這層）。
// jsdom 不套 CSS，這裡靜態守住：外框必須 overflow: visible，且權重高於 .legacy-ui 的 body 規則。

function rulesFor(css: string, selector: string): string[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments))) {
    if (m[1]!.split(',').some((s) => s.trim() === selector)) out.push(m[2]!);
  }
  return out;
}

describe('app-shell.css：外框不是捲動容器', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/ui/app-shell.css'), 'utf8');

  it('.legacy-ui.legacy-chrome 宣告 overflow: visible', () => {
    const bodies = rulesFor(css, '.legacy-ui.legacy-chrome');
    expect(bodies.some((b) => /(^|[;\s])overflow\s*:\s*visible\s*(;|$)/.test(b))).toBe(true);
  });

  it('A 的 body 規則（打包後是 .legacy-ui）確實帶 overflow-x: hidden，外框需要上面那條覆蓋', () => {
    const legacyBase = readFileSync(resolve(process.cwd(), 'src/styles/legacy/base.css'), 'utf8');
    const bodyRules = rulesFor(legacyBase, 'body');
    expect(bodyRules.some((b) => /overflow-x\s*:\s*hidden/.test(b))).toBe(true);
  });

  it('body .legacy-ui 把 -webkit-overflow-scrolling 設回 auto（iOS 不再自成堆疊層）', () => {
    const state = readFileSync(resolve(process.cwd(), 'src/styles/legacy-body-state.css'), 'utf8');
    const bodies = rulesFor(state, 'body .legacy-ui');
    expect(bodies.some((b) => /-webkit-overflow-scrolling\s*:\s*auto/.test(b))).toBe(true);
  });
});
