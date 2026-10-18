import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/i18n';
import { Card } from './Card';
import {
  expectBlockedLink,
  expectNativeKeyboard,
  installUiTestLocale,
} from './ui1-test-utils';

installUiTestLocale();

describe('Card', () => {
  it('renders a static container and wraps literal content in Text', () => {
    const { container } = render(<Card>{t('fixture.heading')}</Card>);
    const card = container.querySelector('.ui-card');
    expect(card?.tagName).toBe('DIV');
    expect(card?.querySelector('.ui-text')?.textContent).toBe(t('fixture.heading'));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each(['default', 'outlined', 'elevated', 'interactive'] as const)(
    'renders variant %s',
    (variant) => {
      const { container } = render(<Card variant={variant}>{t('fixture.heading')}</Card>);
      expect(container.querySelector(`.ui-card--${variant}`)).not.toBeNull();
    },
  );

  it.each(['none', 'sm', 'md', 'lg'] as const)('renders padding %s', (padding) => {
    const { container } = render(<Card padding={padding}>{t('fixture.heading')}</Card>);
    expect(container.querySelector(`.ui-card--padding-${padding}`)).not.toBeNull();
  });

  it('uses a native button for an action', () => {
    const onClick = vi.fn();
    render(<Card onClick={onClick}>{t('fixture.heading')}</Card>);
    const button = screen.getByRole('button', { name: t('fixture.heading') });
    expect(button.getAttribute('type')).toBe('button');
    expectNativeKeyboard(button, ['Enter', ' ']);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('blocks disabled button actions', () => {
    const onClick = vi.fn();
    render(<Card onClick={onClick} disabled>{t('fixture.heading')}</Card>);
    const button = screen.getByRole('button');
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('uses a native anchor for navigation', () => {
    render(<Card href="/activities">{t('fixture.heading')}</Card>);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/activities');
    expectNativeKeyboard(link, ['Enter']);
  });

  it('blocks disabled navigation', () => {
    const onClick = vi.fn();
    render(<Card href="/activities" disabled onClick={onClick}>{t('fixture.heading')}</Card>);
    expectBlockedLink(screen.getByRole('link'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
