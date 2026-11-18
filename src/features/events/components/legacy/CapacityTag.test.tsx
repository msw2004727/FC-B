import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/preact';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 純 JS 建置工具，與 vite.config.ts 使用同一個 scope 外掛。
import { legacyCssScope } from '../../../../../scripts/legacy-css-scope.mjs';
import { CapacityTag } from './CapacityTag';

describe('CapacityTag', () => {
  it('顯示「已報/上限」；沒給讀屏文字時整個 aria-hidden（活動頁計量條已有讀屏人數）', () => {
    const { container } = render(<CapacityTag model={{ confirmed: 23, max: 27, state: 'wait', long: false }} />);
    const tag = container.querySelector('.tl-cap-tag')!;
    expect(tag.className).toBe('tl-cap-tag is-wait');
    expect(tag.textContent).toBe('23/27');
    expect(tag.getAttribute('aria-hidden')).toBe('true');
    expect(tag.querySelector('.tl-cap-ico')).toBeTruthy();
    expect(tag.querySelector('.tl-cap-pay')).toBeNull();
  });

  it('不限人數只顯示已報數；長數字帶 is-long', () => {
    const { container } = render(<CapacityTag model={{ confirmed: 6, max: 0, state: 'nomax', long: false }} />);
    expect(container.querySelector('.tl-cap-tag')?.textContent).toBe('6');
    expect(container.querySelector('.tl-cap-max')).toBeNull();
    const long = render(<CapacityTag model={{ confirmed: 128, max: 200, state: 'open', long: true }} />);
    expect(long.container.querySelector('.tl-cap-tag')?.className).toBe('tl-cap-tag is-open is-long');
  });

  it('給讀屏文字時：數字給眼睛、讀屏只唸完整句子', () => {
    const { container } = render(
      <CapacityTag model={{ confirmed: 8, max: 16, state: 'open', long: false }} srText="已報 8／16 人" />,
    );
    const tag = container.querySelector('.tl-cap-tag')!;
    expect(tag.hasAttribute('aria-hidden')).toBe(false);
    expect(tag.querySelector('.tl-cap-n')?.getAttribute('aria-hidden')).toBe('true');
    expect(tag.querySelector('.tl-cap-max')?.getAttribute('aria-hidden')).toBe('true');
    expect(tag.querySelector('.fcb-sr-only')?.textContent).toBe('已報 8／16 人');
  });

  it('付款狀態預留接點：傳入才出現右上角圓點（目前沒有呼叫端傳入）', () => {
    const pending = render(<CapacityTag model={{ confirmed: 3, max: 10, state: 'open', long: false }} payment="pending" />);
    expect(pending.container.querySelector('.tl-cap-tag')?.className).toBe('tl-cap-tag is-open has-pay is-pay-pending');
    expect(pending.container.querySelector('.tl-cap-pay')).toBeTruthy();
    const paid = render(<CapacityTag model={{ confirmed: 3, max: 10, state: 'open', long: false }} payment="paid" />);
    expect(paid.container.querySelector('.tl-cap-tag')?.classList.contains('is-pay-paid')).toBe(true);
  });
});

describe('capacity-tag.css（風格三：狀態變色玻璃膠囊）', () => {
  const path = resolve(process.cwd(), 'src/features/events/components/legacy/capacity-tag.css');
  const raw = readFileSync(path, 'utf8');
  const rules = new Map<string, Record<string, string>>();
  postcss([legacyCssScope()]).process(raw, { from: path }).sync().root.walkRules((rule: Rule) => {
    const decls: Record<string, string> = {};
    rule.walkDecls((d) => { decls[d.prop] = d.value; });
    for (const s of rule.selectors) rules.set(s, { ...(rules.get(s) ?? {}), ...decls });
  });
  const get = (s: string) => {
    const d = rules.get(s);
    if (!d) throw new Error(`找不到 ${s}`);
    return d;
  };
  const activity = readFileSync(resolve(process.cwd(), 'src/features/events/legacy/activity.css'), 'utf8');

  it('與狀態標籤同高（20px），不新增 CSS 變數、不用 backdrop-filter', () => {
    expect(get('.legacy-ui .tl-cap-tag').height).toBe('20px');
    expect(activity).toMatch(/\.tl-event-status \{[^}]*min-height: 20px/);
    expect(raw).not.toMatch(/^\s*--[\w-]+\s*:/m);
    expect(raw).not.toMatch(/backdrop-filter\s*:/);
  });

  it('五種狀態淺、深色都有顏色；候補用專案候補紫並帶柔光', () => {
    for (const st of ['is-full', 'is-wait', 'is-upcoming']) {
      expect(get(`.legacy-ui .tl-cap-tag.${st}`).color, st).toBeTruthy();
      expect(get(`[data-theme="dark"] .legacy-ui .tl-cap-tag.${st}`)['border-color'], st).toBeTruthy();
    }
    // 不限人數沿用報名中的綠（看圖審查 P2：灰色會被誤認成未開放），不得另有灰色規則。
    expect(() => get('.legacy-ui .tl-cap-tag.is-nomax')).toThrow();
    expect(get('.legacy-ui .tl-cap-tag').color).toBe('var(--accent)');
    expect(get('.legacy-ui .tl-cap-tag.is-wait').color).toBe('var(--color-waitlist)');
    expect(get('.legacy-ui .tl-cap-tag.is-wait')['box-shadow']).toMatch(/0 0 8px/);
    expect(get('.legacy-ui .tl-cap-tag.is-long .tl-cap-ico').display).toBe('none');
  });

  it('付款圓點絕對定位，不改標籤寬度', () => {
    expect(get('.legacy-ui .tl-cap-tag.has-pay').position).toBe('relative');
    expect(get('.legacy-ui .tl-cap-pay').position).toBe('absolute');
  });
});
