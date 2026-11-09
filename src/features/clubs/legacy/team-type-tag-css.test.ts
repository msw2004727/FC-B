import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 站長 11-09 手機回報：深色模式新增俱樂部時點類型標籤沒上底色。jsdom 不套 CSS，這裡靜態守住深色底色只套在未選中的標籤。
function selectorsWithBody(css: string, pattern: RegExp): string[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments))) {
    if (pattern.test(m[2]!)) out.push(...m[1]!.split(',').map(sel => sel.trim()));
  }
  return out;
}

describe('俱樂部類型標籤深色 CSS', () => {
  const css = readFileSync(resolve('src/features/clubs/legacy/team.css'), 'utf8');
  const darkBg = selectorsWithBody(css, /background:\s*rgba\(15,\s*23,\s*42,\s*\.86\)/);

  it('深色底色只套在未選中的建立表單與設定彈窗標籤，不蓋掉選中的漸層', () => {
    expect(darkBg).toContain('[data-theme="dark"] .ct-type-tag-btn:not(.active)');
    expect(darkBg).toContain('[data-theme="dark"] .td-category-tag-btn:not(.active)');
    expect(darkBg).not.toContain('[data-theme="dark"] .ct-type-tag-btn');
    expect(darkBg).not.toContain('[data-theme="dark"] .td-category-tag-btn');
  });
});
