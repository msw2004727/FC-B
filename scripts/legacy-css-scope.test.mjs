import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

import { legacyCssScope, scopeSelector } from './legacy-css-scope.mjs';

describe('scopeSelector（舊版 CSS 限定在 .legacy-ui）', () => {
  it.each([
    [':root', '.legacy-ui'],
    ['html', '.legacy-ui'],
    ['body', '.legacy-ui'],
    ['body.modal-open', '.legacy-ui.modal-open'],
    ['body > .app', '.legacy-ui > .app'],
    ['[data-theme="dark"]', '[data-theme="dark"] .legacy-ui'],
    ['[data-theme="light"]', '[data-theme="light"] .legacy-ui'],
    ['[data-theme="dark"] .ce-team-chip', '[data-theme="dark"] .legacy-ui .ce-team-chip'],
    ['html[data-theme="dark"] .x', '[data-theme="dark"] .legacy-ui .x'],
    ['[data-theme="dark"] body', '[data-theme="dark"] .legacy-ui'],
    ['*', '.legacy-ui *'],
    ['*::before', '.legacy-ui *::before'],
    ['.tab-bar', '.legacy-ui .tab-bar'],
    ['#page-activities .tl-event', '.legacy-ui #page-activities .tl-event'],
    ['.legacy-ui .x', '.legacy-ui .x'],
    ['bodyish', '.legacy-ui bodyish'],
  ])('%s → %s', (input, expected) => {
    expect(scopeSelector(input)).toBe(expected);
  });
});

describe('legacyCssScope 外掛', () => {
  const run = (css, from) => postcss([legacyCssScope()]).process(css, { from }).css;

  it('只處理 /legacy/ 底下的檔案', () => {
    expect(run('.a{color:red}', '/x/src/styles/base.css')).toBe('.a{color:red}');
    expect(run('.a{color:red}', '/x/src/styles/legacy/base.css')).toBe('.legacy-ui .a{color:red}');
  });

  it('逗號選擇器逐一改寫、@media 內也改寫、@keyframes 不動', () => {
    const out = run(
      '.a, .b{x:1}@media (max-width:400px){.c{x:2}}@keyframes spin{from{x:0}to{x:1}}',
      'C:\\x\\src\\styles\\legacy\\base.css',
    );
    expect(out).toContain('.legacy-ui .a, .legacy-ui .b{x:1}');
    expect(out).toContain('@media (max-width:400px){.legacy-ui .c{x:2}}');
    expect(out).toContain('@keyframes spin{from{x:0}to{x:1}}');
  });
});
