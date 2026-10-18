import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import { t } from '@/i18n/i18n';
import { Badge, type BadgeTone } from './Badge';
import { prepareUi2Locale, resetUi2Locale } from './ui2-test-utils';

beforeEach(prepareUi2Locale);
afterEach(() => {
  cleanup();
  resetUi2Locale();
});

describe('Badge', () => {
  it('renders text through Text and is not interactive', () => {
    const { container, queryByRole } = render(<Badge label="報名成功" />);
    expect(container.querySelector('.ui-text')?.textContent).toBe('報名成功');
    expect(queryByRole('button')).toBeNull();
    expect(container.firstElementChild?.tagName).toBe('SPAN');
  });

  it.each<BadgeTone>([
    'neutral', 'brand', 'success', 'warning', 'danger', 'info',
  ])('renders tone %s', (tone) => {
    const { container } = render(<Badge tone={tone} label="狀態" />);
    expect(container.firstElementChild?.classList.contains(`ui-badge--${tone}`)).toBe(true);
  });

  it.each(['soft', 'solid', 'outline'] as const)('renders variant %s', (variant) => {
    const { container } = render(<Badge variant={variant} />);
    expect(container.firstElementChild?.classList.contains(`ui-badge--${variant}`)).toBe(true);
  });

  it.each(['sm', 'md', 'lg'] as const)('renders size %s', (size) => {
    const { container } = render(<Badge size={size} />);
    expect(container.firstElementChild?.classList.contains(`ui-badge--${size}`)).toBe(true);
  });

  it('uses translated fallback and exposes disabled state', () => {
    const { container } = render(<Badge label=" " disabled />);
    const badge = container.firstElementChild;
    expect(badge?.textContent).toBe(t('ui.badge.empty'));
    expect(badge?.textContent).toBe('未設定');
    expect(badge?.getAttribute('aria-disabled')).toBe('true');
    expect(badge?.classList.contains('ui-badge--disabled')).toBe(true);
  });

  it('preserves complete text in title', () => {
    const label = '完整而且非常長的多語系狀態標籤';
    const { container } = render(<Badge label={label} />);
    expect(container.firstElementChild?.getAttribute('title')).toBe(label);
  });
});
