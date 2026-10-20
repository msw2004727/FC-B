import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { ToastHost } from '@/ui/ToastHost';
import { getToasts, toast } from '@/ui/Toast';
import { t } from '@/i18n/i18n';
import { installUi4TestLocale } from './ui4-test-helpers';

installUi4TestLocale();
beforeEach(() => toast.clear());
afterEach(() => toast.clear());

describe('ToastHost', () => {
  it('portals a translated notification region', () => {
    render(<ToastHost />);
    const region = screen.getByRole('region', { name: t('ui.toast.region') });
    expect(region.parentElement).toBe(document.body);
    expect(region.classList.contains('ui-toast-host')).toBe(true);
  });

  // 測試同步更新：照 A（M-041）一次只顯示一顆提示，新的取代舊的，沒有關閉鈕。
  it('shows only the newest notification like A', () => {
    render(<ToastHost />);
    act(() => {
      toast.show({ message: 'One', duration: 0 });
      toast.show({ message: 'Two', duration: 0 });
      toast.show({ message: 'Four', tone: 'error', duration: 0 });
    });
    expect(screen.queryByText('One')).toBeNull();
    expect(screen.queryByText('Two')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Four');
    expect(screen.queryByRole('button', { name: t('ui.toast.close') })).toBeNull();
  });

  it('supports enqueueing before mount and explicit API dismissal', () => {
    const id = toast.show({ message: 'Queued', duration: 0 });
    render(<ToastHost />);
    expect(screen.getByRole('status').textContent).toContain('Queued');
    act(() => toast.dismiss(id));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
