import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { Toast } from '@/ui/Toast';
import { t } from '@/i18n/i18n';
import { installUi4TestLocale } from './ui4-test-helpers';

installUi4TestLocale();

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it.each(['success', 'info', 'warning', 'error'] as const)(
    'renders %s with semantic status and translated controls',
    (tone) => {
      render(<Toast message="Message" tone={tone} duration={0} onClose={vi.fn()} />);
      const element = screen.getByRole(tone === 'error' ? 'alert' : 'status');
      expect(element.classList.contains(`ui-toast--${tone}`)).toBe(true);
      expect(element.getAttribute('aria-live')).toBe(
        tone === 'error' ? 'assertive' : 'polite',
      );
      expect(screen.getByRole('button', {
        name: t('ui.toast.close'),
      }).getAttribute('title')).toBe(t('ui.toast.close'));
      expect(element.textContent).toContain(t(`ui.toast.${tone}`));
    },
  );

  it('automatically closes after four seconds', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    render(<Toast message="Message" onClose={close} />);
    act(() => { vi.advanceTimersByTime(3999); });
    expect(close).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(close).toHaveBeenCalledOnce();
  });

  it('pauses on hover and continues using the remaining time', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    render(<Toast message="Message" onClose={close} />);
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.pointerEnter(screen.getByRole('status'));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(close).not.toHaveBeenCalled();
    fireEvent.pointerLeave(screen.getByRole('status'));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(close).toHaveBeenCalledOnce();
  });

  it('allows a persistent toast to be dismissed with its native button', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    render(<Toast message="Message" duration={0} onClose={close} />);
    act(() => { vi.advanceTimersByTime(60000); });
    expect(close).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: t('ui.toast.close') });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(close).toHaveBeenCalledOnce();
  });
});
