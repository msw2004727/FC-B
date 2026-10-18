import { act, fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { t, useT, setLocale } from '@/i18n/i18n';
import { Icon } from '@/ui/Icon';
import { Button, type ButtonSize, type ButtonVariant } from './Button';
import {
  expectBlockedLink,
  expectNativeKeyboard,
  installUiTestLocale,
} from './ui1-test-utils';

installUiTestLocale();

describe('Button', () => {
  it('renders translated text through Text and preserves native button semantics', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>{t('fixture.action')}</Button>);
    const button = screen.getByRole('button', { name: t('fixture.action') });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.querySelector('.ui-text')?.textContent).toBe(t('fixture.action'));
    expectNativeKeyboard(button, ['Enter', ' ']);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each<ButtonVariant>(['primary', 'secondary', 'ghost', 'danger'])(
    'renders variant %s',
    (variant) => {
      render(<Button variant={variant}>{t('fixture.action')}</Button>);
      expect(screen.getByRole('button').classList.contains(`ui-button--${variant}`)).toBe(true);
    },
  );

  it.each<ButtonSize>(['sm', 'md', 'lg'])('renders size %s', (size) => {
    render(<Button size={size}>{t('fixture.action')}</Button>);
    expect(screen.getByRole('button').classList.contains(`ui-button--${size}`)).toBe(true);
  });

  it('blocks disabled button activation', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>{t('fixture.action')}</Button>);
    const button = screen.getByRole('button');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps the label, exposes busy state, and restores activation after loading', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button loading onClick={onClick}>{t('fixture.action')}</Button>,
    );
    const button = screen.getByRole('button', { name: t('fixture.action') });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.querySelector('svg')?.getAttribute('focusable')).toBe('false');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();

    rerender(<Button onClick={onClick}>{t('fixture.action')}</Button>);
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders an anchor with native Enter handling and safe blank-target rel', () => {
    render(
      <Button href="/activities" target="_blank" rel="nofollow">
        {t('fixture.action')}
      </Button>,
    );
    const link = screen.getByRole('link', { name: t('fixture.action') });
    expect(link.getAttribute('href')).toBe('/activities');
    expect(link.getAttribute('rel')).toBe('nofollow noopener noreferrer');
    expectNativeKeyboard(link, ['Enter']);
  });

  it.each(['disabled', 'loading'] as const)('blocks an anchor while %s', (state) => {
    const onClick = vi.fn();
    render(
      <Button
        href="/activities"
        disabled={state === 'disabled'}
        loading={state === 'loading'}
        onClick={onClick}
      >
        {t('fixture.action')}
      </Button>,
    );
    expectBlockedLink(screen.getByRole('link'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps decorative icons outside Text', () => {
    render(
      <Button leading={<Icon name="calendar" />}>
        {t('fixture.action')}
      </Button>,
    );
    expect(screen.getByRole('button').querySelector('.ui-button__icon svg')).not.toBeNull();
  });

  it('updates caller-owned translations when locale changes', async () => {
    function Example() {
      const translate = useT();
      return <Button>{translate('fixture.action')}</Button>;
    }
    render(<Example />);
    await act(async () => setLocale('en'));
    expect(screen.getByRole('button', { name: 'Find activities' })).not.toBeNull();
  });
});
