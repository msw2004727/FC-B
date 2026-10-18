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

  it('retains at most three notifications and discards the oldest', () => {
    render(<ToastHost />);
    act(() => {
      toast.show({ message: 'One', duration: 0 });
      toast.show({ message: 'Two', duration: 0 });
      toast.show({ message: 'Three', duration: 0 });
      toast.show({ message: 'Four', tone: 'error', duration: 0 });
    });
    expect(screen.queryByText('One')).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(getToasts()).toHaveLength(3);
    const button = screen.getAllByRole('button', {
      name: t('ui.toast.close'),
    })[0];
    if (!button) throw new Error('Expected a dismiss button');
    fireEvent.click(button);
    expect(getToasts()).toHaveLength(2);
  });

  it('supports enqueueing before mount and explicit API dismissal', () => {
    const id = toast.show({ message: 'Queued', duration: 0 });
    render(<ToastHost />);
    expect(screen.getByRole('status').textContent).toContain('Queued');
    act(() => toast.dismiss(id));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
