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

describe('app-shell.css：登入失敗提示高於各頁頁面底層（2026-11-13 Opus 交叉審 P2）', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/ui/app-shell.css'), 'utf8');

  it('.app-login-alert 是定位元素且 z-index 1（各頁 position: fixed 的 ::before 底層畫在 0／auto）', () => {
    const bodies = rulesFor(css, '.ui-app-shell .app-main > .app-login-alert');
    expect(bodies.some((b) => /position\s*:\s*relative/.test(b) && /z-index\s*:\s*1\s*(;|$)/.test(b))).toBe(true);
  });

  it('App.tsx 的登入失敗提示帶 app-login-alert，且直接放在 main.app-main 底下', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/app/App.tsx'), 'utf8');
    expect(app).toMatch(/<main class="app-main">\s*\{loginError[^\n]*\n\s*<div class="app-login-alert" role="alert">/);
  });

  it('四頁底層都是 fixed 的 ::before，且不高於 z-index 0（提示的 1 蓋得過）', () => {
    const layers: [string, RegExp][] = [
      ['src/features/events/components/legacy/activity-list-extra.css', /\.legacy-ui\.activities-root::before\s*\{([^}]*)\}/],
      ['src/features/home/legacy/home-glass.css', /\.legacy-ui\.home-root::before\s*\{([^}]*)\}/],
      ['src/features/clubs/legacy/teams-glass.css', /\.legacy-ui\.teams-root::before\s*\{([^}]*)\}/],
      ['src/features/tournaments/legacy/tournaments-glass.css', /\.legacy-ui\.tournaments-root::before\s*\{([^}]*)\}/],
    ];
    for (const [file, re] of layers) {
      const body = readFileSync(resolve(process.cwd(), file), 'utf8').match(re)?.[1] ?? '';
      expect(body, file).toMatch(/position\s*:\s*fixed/);
      const z = body.match(/z-index\s*:\s*(-?\d+)/)?.[1];
      expect(z === undefined || Number(z) <= 0, file).toBe(true);
    }
  });
});

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

// UPD-3P 方案乙：更新提示框顯示時 body 加 fcb-update-open（reload-safety.ts），主內容底部空白與吐司一起上推 68px
// （提示框高 60＋與導覽列間距 8）。直接寫 body class 規則、不自創 CSS 變數（測試同步更新）。
describe('app-shell.css／toast-host.css：更新提示框出現時內容上推', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/ui/app-shell.css'), 'utf8');
  const host = readFileSync(resolve(process.cwd(), 'src/ui/toast-host.css'), 'utf8');

  it('不自創 --update-prompt-space 變數', () => {
    expect(css).not.toContain('--update-prompt-space');
    expect(host).not.toContain('--update-prompt-space');
  });

  it('沒提示框時 .app-main 底部空白維持原算式', () => {
    const bodies = rulesFor(css, '.ui-app-shell .app-main');
    expect(bodies).toContainEqual(expect.stringMatching(
      /padding-bottom:\s*calc\(var\(--bottombar-h, 64px\) \+ 55px \+ env\(safe-area-inset-bottom, 0px\)\);/,
    ));
  });

  it('body.fcb-update-open 時 .app-main 底部空白為原算式 + 68px', () => {
    const bodies = rulesFor(css, 'body.fcb-update-open .ui-app-shell .app-main');
    expect(bodies).toContainEqual(expect.stringMatching(
      /padding-bottom:\s*calc\(var\(--bottombar-h, 64px\) \+ 55px \+ 68px \+ env\(safe-area-inset-bottom, 0px\)\);/,
    ));
  });

  it('body.fcb-update-open 時吐司底部位置 + 68px＋安全區（與提示框同一參考，iPhone 主畫面不被蓋）', () => {
    expect(rulesFor(host, '.ui-toast-host')).toContainEqual(expect.stringMatching(
      /inset:\s*auto auto calc\(var\(--bottombar-h, var\(--bottomnav-h, 64px\)\) \+ 16px\) 50%;/,
    ));
    expect(rulesFor(host, 'body.fcb-update-open .ui-toast-host')).toContainEqual(expect.stringMatching(
      /bottom:\s*calc\(var\(--bottombar-h, var\(--bottomnav-h, 64px\)\) \+ 16px \+ 68px \+ env\(safe-area-inset-bottom, 0px\)\);/,
    ));
  });
});
