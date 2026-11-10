import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';

import { PopularityStars } from './PopularityStars';

describe('PopularityStars', () => {
  beforeEach(async () => {
    _setDictLoaderForTest(null);
    await setLocale('zh-TW');
  });

  afterEach(() => {
    cleanup();
  });

  it.each([
    [0, 0, 0, 5],
    [0.5, 0, 1, 4],
    [1.5, 1, 1, 3],
    [5, 5, 0, 0],
  ] as const)('score %s：滿星 %s、半星 %s、空星 %s', (score, full, half, empty) => {
    const { container } = render(<PopularityStars score={score} />);
    expect(container.querySelectorAll('.popularity-stars svg')).toHaveLength(5);
    expect(container.querySelectorAll('.is-full')).toHaveLength(full);
    expect(container.querySelectorAll('linearGradient')).toHaveLength(half);
    expect(container.querySelectorAll('.is-empty')).toHaveLength(empty);
    const grad = container.querySelector('linearGradient');
    if (half === 1) {
      expect(grad?.getAttribute('x1')).toBe('0');
      expect(grad?.getAttribute('x2')).toBe('1');
    }
  });

  it('兩個元件的 gradient id 都唯一', () => {
    const { container } = render(
      <div>
        <PopularityStars score={0.5} />
        <PopularityStars score={1.5} />
      </div>,
    );
    const ids = [...container.querySelectorAll('linearGradient')].map((el) => el.getAttribute('id'));
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('aria-label 走 i18n，整數不帶小數', async () => {
    const half = render(<PopularityStars score={3.5} />);
    const row = half.container.querySelector('.popularity-stars');
    expect(row?.getAttribute('role')).toBe('img');
    expect(row?.getAttribute('aria-label')).toBe('人氣指數 3.5 顆星');
    half.unmount();

    const whole = render(<PopularityStars score={3} />);
    expect(whole.container.querySelector('.popularity-stars')?.getAttribute('aria-label')).toBe('人氣指數 3 顆星');
    whole.unmount();

    await setLocale('en');
    const en = render(<PopularityStars score={3.5} />);
    expect(en.container.querySelector('.popularity-stars')?.getAttribute('aria-label')).toBe('Popularity 3.5 stars');
  });

  it('元件不判斷主題，空星色在 CSS', () => {
    const tsx = readFileSync(resolve(process.cwd(), 'src/features/profile/components/PopularityStars.tsx'), 'utf8');
    expect(tsx).not.toContain('data-theme');
    expect(tsx).not.toContain('#4a5266');
    expect(tsx).not.toContain('#d9dde5');
    const css = readFileSync(resolve(process.cwd(), 'src/features/profile/components/popularity-stars.css'), 'utf8');
    expect(css).toContain('#d9dde5');
    expect(css).toContain('#4a5266');
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('calc(17 * var(--pcu))');
    expect(css).toContain('var(--pop-star-size, calc(17 * var(--pcu)))');
    expect(css).toContain('calc(1 * var(--pcu))');
    expect(css).toContain('drop-shadow(0 1px 1.5px rgba(0,0,0,.4))');
  });
});
