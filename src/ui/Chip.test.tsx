import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { t } from '@/i18n/i18n';
import { Chip } from './Chip';
import { prepareUi2Locale, resetUi2Locale } from './ui2-test-utils';

beforeEach(prepareUi2Locale);
afterEach(() => {
  cleanup();
  resetUi2Locale();
});

describe('Chip', () => {
  it('renders noninteractive content as spans', () => {
    const { container, queryByRole } = render(<Chip label="足球" description="19 活動" />);
    expect(queryByRole('button')).toBeNull();
    expect(container.querySelector('.ui-chip__label')?.textContent).toBe('足球');
    expect(container.querySelector('.ui-chip__description')?.textContent).toBe('19 活動');
  });

  it.each(['outline', 'soft', 'solid'] as const)('renders %s variant', (variant) => {
    const { container } = render(<Chip variant={variant} />);
    expect(container.firstElementChild?.classList.contains(`ui-chip--${variant}`)).toBe(true);
  });

  it('is controlled and exposes selected state', () => {
    const onSelect = vi.fn();
    const { getByRole, rerender } = render(
      <Chip label="足球" selected={false} onSelect={onSelect} />,
    );
    fireEvent.click(getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith(true);
    expect(getByRole('button').getAttribute('aria-pressed')).toBe('false');

    rerender(<Chip label="足球" selected onSelect={onSelect} />);
    expect(getByRole('button').getAttribute('aria-pressed')).toBe('true');
    expect(getByRole('button').closest('.ui-chip')?.classList.contains('ui-chip--selected')).toBe(true);
  });

  it('keeps removal separate from selection', () => {
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    const { getByRole, container } = render(
      <Chip label="足球" onSelect={onSelect} onRemove={onRemove} />,
    );
    const remove = getByRole('button', { name: t('ui.chip.remove', { label: '足球' }) });
    expect(remove.getAttribute('title')).toBe('移除「足球」');
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.querySelector('button button')).toBeNull();
  });

  it.each([{ disabled: true }, { loading: true }])('blocks both actions: %o', (state) => {
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    const { getAllByRole, container } = render(
      <Chip label="足球" {...state} onSelect={onSelect} onRemove={onRemove} />,
    );

    for (const element of getAllByRole('button')) {
      expect((element as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(element);
    }
    expect(onSelect).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    if ('loading' in state) {
      expect(container.firstElementChild?.getAttribute('aria-busy')).toBe('true');
    }
  });

  it('provides native keyboard button semantics without duplicate handlers', () => {
    const onSelect = vi.fn();
    const { getByRole } = render(<Chip label="足球" onSelect={onSelect} />);
    const button = getByRole('button') as HTMLButtonElement;
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.type).toBe('button');

    // jsdom 不模擬 Enter / Space 的瀏覽器預設 click；明確送出鍵盤 click。
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.click(button, { detail: 0 });
    fireEvent.keyUp(button, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('uses translated missing-label text', () => {
    const { container } = render(<Chip label="" />);
    expect(container.textContent).toBe(t('ui.chip.empty'));
    expect(container.textContent).toBe('未分類');
  });
});
