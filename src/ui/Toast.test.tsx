import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { Toast, computeToastDuration, getToasts, toast } from '@/ui/Toast';
import { ToastHost } from '@/ui/ToastHost';
import { installUi4TestLocale } from './ui4-test-helpers';

installUi4TestLocale();

afterEach(() => {
  toast.clear();
  cleanup();
  vi.useRealTimers();
});

describe('Toast', () => {
  // 測試同步更新：照 A（M-041）單顆膠囊無狀態標題與無關閉鈕，保留 aria-live 與 tone class
  it.each(['success', 'info', 'warning', 'error'] as const)(
    'renders %s with semantic status and A capsule markup without close button',
    (tone) => {
      render(<Toast message="Message" tone={tone} duration={0} onClose={vi.fn()} />);
      const element = screen.getByRole(tone === 'error' ? 'alert' : 'status');
      expect(element.classList.contains(`ui-toast--${tone}`)).toBe(true);
      expect(element.classList.contains('toast')).toBe(true);
      expect(element.classList.contains('show')).toBe(true);
      expect(element.getAttribute('aria-live')).toBe(
        tone === 'error' ? 'assertive' : 'polite',
      );
      expect(element.textContent).toBe('Message');
      expect(screen.queryByRole('button')).toBeNull();
    },
  );

  // 測試同步更新：照 A（M-041）預設時長依字數／換行決定（短字 2500ms、>24 字 3500ms、含換行 4000ms）
  it('computes A durations (2500ms short, 3500ms >24 chars, 4000ms multiline)', () => {
    expect(computeToastDuration('短訊息')).toBe(2500);
    expect(computeToastDuration('這是一段超過二十四個非空白字元的超長提示訊息測試內容喔')).toBe(3500);
    expect(computeToastDuration('第一行\n第二行')).toBe(4000);
    expect(computeToastDuration('自訂', 1800)).toBe(1800);
  });

  it('automatically closes after default 2.5 seconds for short text', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    render(<Toast message="Message" onClose={close} />);
    act(() => { vi.advanceTimersByTime(2499); });
    expect(close).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(close).toHaveBeenCalledOnce();
  });

  it('automatically closes after 4 seconds when message contains newline', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    render(<Toast message={'Line 1\nLine 2'} onClose={close} />);
    act(() => { vi.advanceTimersByTime(3999); });
    expect(close).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(close).toHaveBeenCalledOnce();
  });

  it('pauses on hover and continues using the remaining time', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    render(<Toast message="Message" duration={4000} onClose={close} />);
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.pointerEnter(screen.getByRole('status'));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(close).not.toHaveBeenCalled();
    fireEvent.pointerLeave(screen.getByRole('status'));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(close).toHaveBeenCalledOnce();
  });

  it('replaces previous toast with the new one (M-041) and deduplicates within 2s (U-012)', () => {
    vi.useFakeTimers();
    const id1 = toast.show({ message: '第一則' });
    const idDup = toast.show({ message: '第一則' });
    expect(idDup).toBe(id1);
    expect(getToasts()).toHaveLength(1);

    toast.show({ message: '第二則' });
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]?.message).toBe('第二則');

    act(() => { vi.advanceTimersByTime(2100); });
    const idAfterWindow = toast.show({ message: '第二則' });
    expect(idAfterWindow).not.toBe(id1);
  });

  it('mounts inside open <dialog> so toast is visible above showModal() (M-040)', () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);
    try {
      render(<ToastHost />);
      act(() => {
        toast.show({ message: '資料儲存中，請稍候' });
      });
      expect(dialog.querySelector('.ui-toast-host')).not.toBeNull();
      expect(dialog.textContent).toContain('資料儲存中，請稍候');
    } finally {
      dialog.remove();
    }
  });
});
