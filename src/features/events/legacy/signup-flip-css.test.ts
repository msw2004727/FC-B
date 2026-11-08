import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// 站長 11-08 實測：翻回正面的 0.75 秒回轉看起來像多翻一次。jsdom 不套 CSS，這裡靜態守住「只有翻過去有動畫」。
function ruleBody(css: string, selector: string): string | undefined {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments))) {
    if (m[1]!.split(',').some(sel => sel.trim() === selector)) return m[2];
  }
  return undefined;
}

describe('報名按鈕翻牌 CSS', () => {
  const css = readFileSync(resolve('src/features/events/legacy/activity.css'), 'utf8');

  it('翻過去有 0.75 秒轉場，翻回來直接歸位', () => {
    expect(ruleBody(css, '.signup-flipper')).toMatch(/transition:\s*transform\s+\.75s/);
    expect(ruleBody(css, '.signup-flipper:not(.flipped)')).toMatch(/transition:\s*none/);
  });
});
