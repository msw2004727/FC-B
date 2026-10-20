import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t, useT, setLocale } from '@/i18n/i18n';
import { Icon } from '@/ui/Icon';
import { Button, useButtonLoading, type ButtonSize, type ButtonVariant } from './Button';
import {
  expectBlockedLink,
  expectNativeKeyboard,
  installUiTestLocale,
} from './ui1-test-utils';

installUiTestLocale();

afterEach(() => {
  cleanup();
});

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

  it('replaces text with loadingText and applies 0.6 opacity like A _withButtonLoading (M-053, U-014)', async () => {
    let resolveTask!: () => void;
    const asyncSpy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTask = resolve;
        }),
    );

    function Demo() {
      const { buttonProps, run } = useButtonLoading('建立中...');
      return (
        <Button {...buttonProps} onClick={() => { void run(asyncSpy); }}>
          建立活動
        </Button>
      );
    }

    render(<Demo />);
    const btn = screen.getByRole('button', { name: '建立活動' });
    fireEvent.click(btn);
    // 防連點：第二次點擊不應觸發 asyncSpy
    fireEvent.click(btn);
    expect(asyncSpy).toHaveBeenCalledTimes(1);
    expect(btn.textContent).toBe('建立中...');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('data-btn-loading')).toBe('1');
    expect(btn.style.opacity).toBe('0.6');

    await act(async () => {
      resolveTask();
    });
    expect(btn.textContent).toBe('建立活動');
    expect(btn.getAttribute('aria-busy')).toBeNull();
    expect(btn.hasAttribute('disabled')).toBe(false);
  });

  it('restores button state even when async action rejects (U-014, L-30)', async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce('ok');

    function Demo() {
      const { buttonProps, run } = useButtonLoading('儲存中...');
      return (
        <Button
          {...buttonProps}
          onClick={() => {
            run(failing).catch(() => undefined);
          }}
        >
          儲存
        </Button>
      );
    }

    render(<Demo />);
    const btn = screen.getByRole('button', { name: '儲存' });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.textContent).toBe('儲存');
    expect(btn.hasAttribute('disabled')).toBe(false);

    // 失敗後可再次點擊重試
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(failing).toHaveBeenCalledTimes(2);
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
