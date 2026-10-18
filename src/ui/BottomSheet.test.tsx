import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { BottomSheet } from '@/ui/BottomSheet';
import { t } from '@/i18n/i18n';
import { installUi4TestLocale } from './ui4-test-helpers';

installUi4TestLocale();

describe('BottomSheet', () => {
  it('renders an accessible sheet with translated dismissal and loading labels', () => {
    const close = vi.fn();
    render(
      <BottomSheet open title="Filters" loading size="sm" onClose={close} />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog.classList.contains('ui-bottom-sheet')).toBe(true);
    expect(dialog.classList.contains('ui-modal--sm')).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe(t('ui.bottomSheet.loading'));

    fireEvent.click(screen.getByRole('button', {
      name: t('ui.bottomSheet.close'),
    }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('traps focus when only the close button is available and handles Escape', () => {
    const close = vi.fn();
    render(<BottomSheet open title="Filters" onClose={close} />);
    const button = screen.getByRole('button', { name: t('ui.bottomSheet.close') });
    fireEvent.keyDown(button, { key: 'Tab' });
    expect(document.activeElement).toBe(button);
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('supports disabling overlay dismissal', () => {
    const close = vi.fn();
    render(
      <BottomSheet
        open
        title="Filters"
        closeOnOverlay={false}
        onClose={close}
      />,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(close).not.toHaveBeenCalled();
  });
});
