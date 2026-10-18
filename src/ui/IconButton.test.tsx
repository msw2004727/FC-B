import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/i18n';
import { IconButton } from './IconButton';
import type { ButtonVariant } from './Button';
import {
  expectBlockedLink,
  expectNativeKeyboard,
  installUiTestLocale,
} from './ui1-test-utils';

installUiTestLocale();

describe('IconButton', () => {
  it('uses the translated label as accessible name and tooltip', () => {
    render(<IconButton name="calendar" label={t('fixture.icon')} />);
    const button = screen.getByRole('button', { name: t('fixture.icon') });
    expect(button.getAttribute('aria-label')).toBe(t('fixture.icon'));
    expect(button.getAttribute('title')).toBe(t('fixture.icon'));
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expectNativeKeyboard(button, ['Enter', ' ']);
  });

  it.each<ButtonVariant>(['primary', 'secondary', 'ghost', 'danger'])(
    'renders variant %s',
    (variant) => {
      render(<IconButton name="calendar" label={t('fixture.icon')} variant={variant} />);
      expect(screen.getByRole('button').classList.contains(`ui-icon-button--${variant}`)).toBe(true);
    },
  );

  it.each(['sm', 'md', 'lg'] as const)('renders size %s', (size) => {
    render(<IconButton name="calendar" label={t('fixture.icon')} size={size} />);
    expect(screen.getByRole('button').classList.contains(`ui-icon-button--${size}`)).toBe(true);
  });

  it('invokes enabled actions and blocks disabled actions', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <IconButton name="calendar" label={t('fixture.icon')} onClick={onClick} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<IconButton name="calendar" label={t('fixture.icon')} onClick={onClick} disabled />);
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('supports disabled anchor semantics', () => {
    const onClick = vi.fn();
    render(
      <IconButton
        name="calendar"
        label={t('fixture.icon')}
        href="/activities"
        disabled
        onClick={onClick}
      />,
    );
    expectBlockedLink(screen.getByRole('link'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
