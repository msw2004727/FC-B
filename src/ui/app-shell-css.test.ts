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

  it('A 的 .page 進場動畫是 fill both，body .legacy-ui .page 改 backwards（播完不留 transform，頁內彈窗相對視窗固定）', () => {
    const legacyBase = readFileSync(resolve(process.cwd(), 'src/styles/legacy/base.css'), 'utf8');
    expect(rulesFor(legacyBase, '.page').some((b) => /animation\s*:\s*pageIn\b[^;]*\bboth\b/.test(b))).toBe(true);
    const state = readFileSync(resolve(process.cwd(), 'src/styles/legacy-body-state.css'), 'utf8');
    const bodies = rulesFor(state, 'body .legacy-ui .page');
    expect(bodies.some((b) => /animation-fill-mode\s*:\s*backwards/.test(b))).toBe(true);
  });
});

// UPD-3P 方案乙：更新提示框顯示時 body 加 fcb-update-open（reload-safety.ts），主內容底部空白與吐司一起上推 68px。
describe('app-shell.css／toast-host.css：更新提示框出現時內容上推', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/ui/app-shell.css'), 'utf8');

  it('body.fcb-update-open 定義 --update-prompt-space: 68px（提示框高 60＋與導覽列間距 8）', () => {
    const bodies = rulesFor(css, 'body.fcb-update-open');
    expect(bodies.some((b) => /--update-prompt-space\s*:\s*68px/.test(b))).toBe(true);
  });

  it('.app-main 的底部空白加上 --update-prompt-space（預設 0，沒提示框時不變）', () => {
    const bodies = rulesFor(css, '.ui-app-shell .app-main');
    expect(bodies.some((b) => /padding-bottom\s*:[^;]*var\(--update-prompt-space,\s*0px\)/.test(b))).toBe(true);
  });

  it('吐司的底部位置也加上 --update-prompt-space', () => {
    const host = readFileSync(resolve(process.cwd(), 'src/ui/toast-host.css'), 'utf8');
    const bodies = rulesFor(host, '.ui-toast-host');
    expect(bodies.some((b) => /inset\s*:[^;]*var\(--update-prompt-space,\s*0px\)/.test(b))).toBe(true);
  });
});
