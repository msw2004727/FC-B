// T-038（2026-10-26）：桌機滾輪失效的回歸防護。
// 根因：A 的 base.css `body { overscroll-behavior:none; overflow-x:hidden }` 被 legacy-css-scope 改寫到 `.legacy-ui`，
// .legacy-ui 成為捲動容器且 overscroll-behavior:none，滾輪被它吃掉、不傳給整頁。
// 修法在 src/styles/legacy-body-state.css：全域 body 仍是 none（防下拉重整／回彈，M-057），.legacy-ui 這層必須是 auto。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

import { legacyCssScope } from './legacy-css-scope.mjs';

// vitest 一律從專案根目錄執行（jsdom 環境下 import.meta.url 不是 file: 網址）。
const root = process.cwd();
const BASE_PATH = resolve(root, 'src/styles/legacy/base.css');
const STATE_PATH = resolve(root, 'src/styles/legacy-body-state.css');

/** 回傳 selector 完整等於 sel 的所有規則裡，overscroll-behavior 的宣告值（依檔案順序）。 */
function overscrollOf(css, from, sel, { scope = false } = {}) {
  const plugins = scope ? [legacyCssScope()] : [];
  const root = postcss(plugins).process(css, { from }).root;
  const values = [];
  root.walkRules((rule) => {
    if (!rule.selectors.map((s) => s.trim()).includes(sel)) return;
    rule.walkDecls('overscroll-behavior', (decl) => values.push(decl.value));
  });
  return values;
}

/** 簡化的特異度（id, class／屬性／偽類, 元素）；只夠比較本測試用到的選擇器。 */
function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const stripped = selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+/g, ' ');
  const elements = (stripped.match(/[a-zA-Z][\w-]*/g) ?? []).length;
  return [ids, classes, elements];
}

function isHigher(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

describe('.legacy-ui 的滾動鏈（桌機滾輪）', () => {
  const baseCss = readFileSync(BASE_PATH, 'utf8');
  const stateCss = readFileSync(STATE_PATH, 'utf8');

  it('已知風險仍在：A 的 base.css 打包後 .legacy-ui 帶 overscroll-behavior:none', () => {
    // 這條是在提醒：若有人重新複製 A 的 base.css，這個副作用仍會被帶進來，必須由 legacy-body-state.css 蓋掉。
    expect(overscrollOf(baseCss, BASE_PATH, '.legacy-ui', { scope: true })).toContain('none');
  });

  it('全域 body 仍是 overscroll-behavior:none（防下拉重整與回彈，M-057）', () => {
    expect(overscrollOf(stateCss, STATE_PATH, 'body')).toEqual(['none']);
  });

  it('.legacy-ui 這層由更高特異度的規則改回 auto，滾輪可傳給整頁', () => {
    const fix = overscrollOf(stateCss, STATE_PATH, 'body .legacy-ui');
    expect(fix).toEqual(['auto']);
    expect(isHigher(specificity('body .legacy-ui'), specificity('.legacy-ui'))).toBe(true);
  });

  it('legacy-body-state.css 不經 legacy-css-scope（路徑不含 /legacy/ 資料夾），body 選擇器維持全域', () => {
    const plugin = legacyCssScope();
    const out = postcss([plugin]).process('body{overscroll-behavior:none}', { from: STATE_PATH }).css;
    expect(out).toBe('body{overscroll-behavior:none}');
  });
});

// 同一條 A body 規則還帶 min-height:100dvh 與 padding-top／bottom；掛在 <body> 底下的 .legacy-ui 外框
// （換頁載入提示 #status-hint 的外框、彈窗外框）若不取消，會多撐一個視窗高的空白（/profile 內容 1094px、頁面 1814px）。
describe('body 底下的 .legacy-ui 外框不得撐高頁面', () => {
  const baseCss = readFileSync(BASE_PATH, 'utf8');
  const stateCss = readFileSync(STATE_PATH, 'utf8');

  function declsOf(css, from, sel, { scope = false } = {}) {
    const plugins = scope ? [legacyCssScope()] : [];
    const parsed = postcss(plugins).process(css, { from }).root;
    const out = {};
    parsed.walkRules((rule) => {
      if (!rule.selectors.map((s) => s.trim()).includes(sel)) return;
      rule.walkDecls((decl) => {
        out[decl.prop] = decl.value;
      });
    });
    return out;
  }

  it('已知風險仍在：A 的 base.css 打包後 .legacy-ui 帶 min-height 與上下 padding', () => {
    const decls = declsOf(baseCss, BASE_PATH, '.legacy-ui', { scope: true });
    expect(decls['min-height']).toBeTruthy();
    expect(decls['padding-bottom']).toBeTruthy();
  });

  it('body > .legacy-ui 取消 min-height 與上下 padding，且特異度高於 .legacy-ui', () => {
    const decls = declsOf(stateCss, STATE_PATH, 'body > .legacy-ui');
    expect(decls['min-height']).toBe('0');
    expect(decls['padding-top']).toBe('0');
    expect(decls['padding-bottom']).toBe('0');
    expect(isHigher(specificity('body > .legacy-ui'), specificity('.legacy-ui'))).toBe(true);
  });
});
