// T-038（2026-10-26）：桌機滾輪失效的回歸防護。
// 根因：A 的 base.css `body { overscroll-behavior:none; overflow-x:hidden }` 被 legacy-css-scope 改寫到 `.legacy-ui`，
// .legacy-ui 成為捲動容器且 overscroll-behavior:none，滾輪被它吃掉、不傳給整頁。
// 修法在 src/styles/legacy-body-state.css：.legacy-ui 這層的 Y 軸必須是 auto；防下拉重整／回彈由根元素 html 的 overscroll-behavior-y:none 負責（body 的 none 維持不變）。
// 這裡是靜態（從實際 CSS 解析）的檢查；瀏覽器端的實際檢查（計算值、滾輪、觸控、iframe 滾動鏈、底部餘量）見 scripts/e2e-scroll-guard.mjs。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

import { legacyCssScope } from './legacy-css-scope.mjs';

// vitest 一律從專案根目錄執行（jsdom 環境下 import.meta.url 不是 file: 網址）。
const root = process.cwd();
const BASE_PATH = resolve(root, 'src/styles/legacy/base.css');
const STATE_PATH = resolve(root, 'src/styles/legacy-body-state.css');
const MAIN_PATH = resolve(root, 'src/main.tsx');

/** 解析成 [{ selector, decls }]（逗號選擇器拆開、依檔案順序）；scope＝true 時先過 legacy-css-scope（打包時的實際改寫）。 */
function parseRules(css, from, { scope = false } = {}) {
  const parsed = postcss(scope ? [legacyCssScope()] : []).process(css, { from }).root;
  const rules = [];
  parsed.walkRules((rule) => {
    const decls = {};
    rule.walkDecls((decl) => {
      decls[decl.prop] = decl.value;
    });
    for (const selector of rule.selectors) rules.push({ selector: selector.trim(), decls });
  });
  return rules;
}

/** 選擇器特異度 [id, class／屬性／偽類, 元素／偽元素]。 */
function specificity(selector) {
  let rest = selector;
  const take = (re) => {
    const found = rest.match(re) ?? [];
    rest = rest.replace(re, ' ');
    return found.length;
  };
  const attrs = take(/\[[^\]]*\]/g);
  const ids = take(/#[\w-]+/g);
  const classes = take(/\.[\w-]+/g);
  const pseudoElements = take(/::[\w-]+/g);
  const pseudoClasses = take(/:[\w-]+/g);
  const elements = take(/(?<![\w-])[a-zA-Z][\w-]*/g);
  return [ids, classes + attrs + pseudoClasses, elements + pseudoElements];
}

function compareSpecificity(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

describe('specificity() 本身（避免比較函式寫死成必然成立）', () => {
  it.each([
    ['.a', [0, 1, 0]],
    ['body', [0, 0, 1]],
    ['body .a', [0, 1, 1]],
    ['body > .a', [0, 1, 1]],
    ['#x.y', [1, 1, 0]],
    ['html.achievements-closed .legacy-ui #uc-stat-badges', [1, 2, 1]],
    ['.a:hover', [0, 2, 0]],
    ['.a::before', [0, 1, 1]],
    ['a[href^="/events/"]', [0, 1, 1]],
  ])('%s → %j', (selector, expected) => {
    expect(specificity(selector)).toEqual(expected);
  });

  it('比較結果隨輸入改變（不是恆真）', () => {
    expect(compareSpecificity(specificity('body .legacy-ui'), specificity('.legacy-ui'))).toBe(1);
    expect(compareSpecificity(specificity('.legacy-ui'), specificity('body .legacy-ui'))).toBe(-1);
    expect(compareSpecificity(specificity('.legacy-ui'), specificity('.legacy-ui'))).toBe(0);
  });
});

describe('.legacy-ui 的滾動鏈（桌機滾輪）', () => {
  const baseRules = parseRules(readFileSync(BASE_PATH, 'utf8'), BASE_PATH, { scope: true });
  const stateRules = parseRules(readFileSync(STATE_PATH, 'utf8'), STATE_PATH);

  // 從實際 CSS 找出「帶 overscroll-behavior:none 的 .legacy-ui 規則」與「把 Y 軸改回 auto 的覆蓋規則」，再比特異度。
  const baseRule = baseRules.find((r) => r.selector === '.legacy-ui' && r.decls['overscroll-behavior']);
  const fixRule = stateRules.find((r) => r.decls['overscroll-behavior-y'] === 'auto');

  it('已知風險仍在：A 的 base.css 打包後 .legacy-ui 帶 overscroll-behavior:none', () => {
    // 這條是在提醒：若有人重新複製 A 的 base.css，這個副作用仍會被帶進來，必須由 legacy-body-state.css 蓋掉。
    expect(baseRule?.decls['overscroll-behavior']).toBe('none');
  });

  it('全域 body 仍是 overscroll-behavior:none（維持 M-057／A 的規則，與修前一致）', () => {
    const bodyRules = stateRules.filter((r) => r.selector === 'body' && r.decls['overscroll-behavior']);
    expect(bodyRules.map((r) => r.decls['overscroll-behavior'])).toEqual(['none']);
  });

  it('根元素 html 設 overscroll-behavior-y:none：真正擋下拉重整與回彈的是它（body 的值在 Chromium 不傳給 viewport）', () => {
    // 實測：只設 body → 子頁捲到底後父頁被帶著捲；只設 html → 擋住；A 正式站也只設了 body。
    // 只設垂直軸：M-057 的目的是下拉重整與回彈，水平的邊緣滑動返回維持 A 實際行為。
    const htmlDecls = stateRules
      .filter((r) => r.selector === 'html')
      .flatMap((r) => Object.entries(r.decls))
      .filter(([prop]) => prop.startsWith('overscroll-behavior'));
    expect(htmlDecls).toEqual([['overscroll-behavior-y', 'none']]);
  });

  it('覆蓋規則只動 Y 軸（長手寫法，不含簡寫與 X 軸），且從實際 CSS 解析出的特異度高於 A 原檔那條', () => {
    expect(fixRule).toBeTruthy();
    expect(baseRule).toBeTruthy();
    const overscrollProps = Object.keys(fixRule.decls).filter((prop) => prop.startsWith('overscroll-behavior'));
    expect(overscrollProps).toEqual(['overscroll-behavior-y']);
    expect(compareSpecificity(specificity(fixRule.selector), specificity(baseRule.selector))).toBe(1);

    // 兩條規則疊起來後 .legacy-ui 的有效值：X 取 A 原檔簡寫的 none，Y 取覆蓋規則的 auto。
    const effective = {
      x: baseRule.decls['overscroll-behavior'],
      y: fixRule.decls['overscroll-behavior-y'],
    };
    expect(effective).toEqual({ x: 'none', y: 'auto' });
  });

  it('legacy-body-state.css 不經 legacy-css-scope（路徑不含 /legacy/ 資料夾），body 選擇器維持全域', () => {
    const out = postcss([legacyCssScope()]).process('body{overscroll-behavior:none}', { from: STATE_PATH }).css;
    expect(out).toBe('body{overscroll-behavior:none}');
  });

  it('實際載入點 src/main.tsx 有 import legacy-body-state.css，且在 A 的 base／layout 之後、不是放進 legacy 資料夾', () => {
    const main = readFileSync(MAIN_PATH, 'utf8');
    const imports = [...main.matchAll(/^import '([^']+\.css)';/gm)].map((m) => m[1]);
    const stateIndex = imports.indexOf('./styles/legacy-body-state.css');
    expect(stateIndex).toBeGreaterThanOrEqual(0);
    expect(stateIndex).toBeGreaterThan(imports.indexOf('./styles/legacy/base.css'));
    expect(stateIndex).toBeGreaterThan(imports.indexOf('./styles/legacy/layout.css'));
    // 會被 legacy-css-scope 改寫的路徑樣式：/legacy/ 資料夾底下的 css
    expect(/\/legacy\/[^/]+\.css$/.test(imports[stateIndex])).toBe(false);
  });
});

// 同一條 A body 規則還帶 min-height:100dvh 與 padding-top／bottom；掛在 <body> 底下的 .legacy-ui 外框
// （換頁載入提示 #status-hint 的外框、彈窗外框）若不取消，會多撐一個視窗高的空白（/profile 內容 1094px、頁面 1814px）。
describe('body 底下的 .legacy-ui 外框不得撐高頁面', () => {
  const baseRules = parseRules(readFileSync(BASE_PATH, 'utf8'), BASE_PATH, { scope: true });
  const stateRules = parseRules(readFileSync(STATE_PATH, 'utf8'), STATE_PATH);

  const baseRule = baseRules.find((r) => r.selector === '.legacy-ui' && r.decls['min-height']);
  const wrapperRule = stateRules.find((r) => r.selector === 'body > .legacy-ui');

  it('已知風險仍在：A 的 base.css 打包後 .legacy-ui 帶 min-height 與上下 padding', () => {
    expect(baseRule?.decls['min-height']).toBeTruthy();
    expect(baseRule?.decls['padding-bottom']).toBeTruthy();
  });

  it('body > .legacy-ui 取消 min-height、上下 padding 與背景，且特異度高於 A 原檔那條', () => {
    expect(wrapperRule).toBeTruthy();
    expect(wrapperRule.decls['min-height']).toBe('0');
    expect(wrapperRule.decls['padding-top']).toBe('0');
    expect(wrapperRule.decls['padding-bottom']).toBe('0');
    expect(wrapperRule.decls['background']).toBe('transparent');
    expect(compareSpecificity(specificity(wrapperRule.selector), specificity(baseRule.selector))).toBe(1);
  });
});
