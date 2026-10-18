import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { Skeleton } from './Skeleton';
import { prepareUi2Locale, resetUi2Locale } from './ui2-test-utils';

beforeEach(prepareUi2Locale);
afterEach(() => {
  cleanup();
  resetUi2Locale();
});

describe('Skeleton', () => {
  it.each(['text', 'rect', 'circle'] as const)('renders hidden %s shape', (shape) => {
    const { container, queryByRole } = render(<Skeleton shape={shape} />);
    const skeleton = container.firstElementChild;
    expect(skeleton?.classList.contains(`ui-skeleton--${shape}`)).toBe(true);
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton?.textContent).toBe('');
    expect(queryByRole('button')).toBeNull();
  });

  it('renders two reserved text lines', () => {
    const { container } = render(<Skeleton lines={2} />);
    expect(container.querySelectorAll('.ui-skeleton__surface')).toHaveLength(2);
    expect(container.firstElementChild?.classList.contains('ui-skeleton--lines-2')).toBe(true);
  });

  it('reserves specified final dimensions', () => {
    const { container } = render(<Skeleton shape="rect" width={320} height={180} />);
    const skeleton = container.firstElementChild as HTMLElement;
    expect(skeleton.style.width).toBe('320px');
    expect(skeleton.style.height).toBe('180px');
  });

  it('does not add a live region or busy state to a hidden element', () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelector('[aria-live], [aria-busy], [tabindex]')).toBeNull();
  });
});
