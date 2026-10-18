import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { t } from '@/i18n/i18n';
import { Text } from '@/ui/Text';
import { Icon } from '@/ui/Icon';
import { EmptyState } from './EmptyState';
import { prepareUi2Locale, resetUi2Locale } from './ui2-test-utils';

beforeEach(prepareUi2Locale);
afterEach(() => {
  cleanup();
  resetUi2Locale();
});

describe('EmptyState', () => {
  it('uses translated default title and description', () => {
    const { getByRole, container } = render(<EmptyState />);
    const region = getByRole('region', { name: t('ui.emptyState.title') });
    expect(region.textContent).toContain('你目前還沒有報名活動');
    expect(container.querySelector('.ui-empty-state__body')?.textContent)
      .toBe(t('ui.emptyState.body'));
    expect(region.getAttribute('aria-describedby')).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('replaces empty values with text', () => {
    const { container } = render(<EmptyState title="" body=" " />);
    expect(container.querySelector('.ui-empty-state__title')?.textContent)
      .toBe(t('ui.emptyState.title'));
    expect(container.querySelector('.ui-empty-state__body')?.textContent)
      .toBe(t('ui.emptyState.body'));
  });

  it('renders icon and action slots without converting VNodes to strings', () => {
    const onClick = vi.fn();
    const { getByRole, container } = render(
      <EmptyState
        title="未分組"
        body="選擇一個分組"
        icon={<Icon name="users" size={48} />}
        action={<button type="button" onClick={onClick}><Text>選擇分組</Text></button>}
      />,
    );
    expect(container.querySelector('.ui-empty-state__icon svg')).not.toBeNull();
    fireEvent.click(getByRole('button', { name: '選擇分組' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('can hide its decorative icon', () => {
    const { container } = render(<EmptyState icon={null} />);
    expect(container.querySelector('.ui-empty-state__icon')).toBeNull();
  });

  it('assigns distinct accessible IDs to multiple instances', () => {
    const { getAllByRole } = render(<><EmptyState /><EmptyState /></>);
    const ids = getAllByRole('region').map((element) => element.getAttribute('aria-labelledby'));
    expect(new Set(ids).size).toBe(2);
  });
});
