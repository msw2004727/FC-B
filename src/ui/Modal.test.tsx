import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Modal } from '@/ui/Modal';
import { Text } from '@/ui/Text';
import { t } from '@/i18n/i18n';
import { installUi4TestLocale } from './ui4-test-helpers';

installUi4TestLocale();

describe('Modal', () => {
  it('portals, labels the dialog, traps Tab, restores focus and body overflow', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    const original = document.body.style.overflow;
    document.body.style.overflow = 'scroll';

    try {
      const view = render(
        <Modal open title="Dialog" onClose={vi.fn()}>
          <button type="button" disabled><Text>Disabled</Text></button>
          <button type="button"><Text>Last</Text></button>
        </Modal>,
      );

      const dialog = screen.getByRole('dialog', { name: 'Dialog' });
      const close = screen.getByRole('button', { name: t('ui.modal.close') });
      const last = screen.getByRole('button', { name: 'Last' });

      expect(dialog.parentElement).toBe(document.body);
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.classList.contains('ui-modal--md')).toBe(true);
      expect(document.activeElement).toBe(close);
      expect(document.body.style.overflow).toBe('hidden');

      fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(last);
      fireEvent.keyDown(last, { key: 'Tab' });
      expect(document.activeElement).toBe(close);

      view.unmount();
      expect(document.activeElement).toBe(trigger);
      expect(document.body.style.overflow).toBe('scroll');
    } finally {
      trigger.remove();
      document.body.style.overflow = original;
    }
  });

  it('handles Escape and overlay, with independent dismissal switches', () => {
    const close = vi.fn();
    const view = render(
      <Modal open title="Dialog" onClose={close}>
        <Text>Content</Text>
      </Modal>,
    );

    let dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(close).toHaveBeenCalledTimes(2);

    view.rerender(
      <Modal
        open
        title="Dialog"
        closeOnEsc={false}
        closeOnOverlay={false}
        onClose={close}
      />,
    );
    dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('does not close for a gesture beginning inside the panel', () => {
    const close = vi.fn();
    render(
      <Modal open title="Dialog" onClose={close}>
        <Text>Content</Text>
      </Modal>,
    );
    fireEvent.pointerDown(screen.getByText('Content'));
    fireEvent.click(screen.getByRole('dialog'));
    expect(close).not.toHaveBeenCalled();
  });

  it('renders loading and error states using translated text', () => {
    render(
      <Modal
        open
        title="Dialog"
        size="lg"
        loading
        error="Failure"
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.classList.contains('ui-modal--lg')).toBe(true);
    expect(screen.getByRole('status').textContent).toBe(t('ui.modal.loading'));
    expect(screen.getByRole('alert').textContent).toBe('Failure');
    expect(dialog.getAttribute('aria-describedby')).toBe(
      screen.getByRole('alert').id,
    );
  });

  it('blocks background touchmove but allows content touchmove', () => {
    render(
      <Modal open title="Dialog" onClose={vi.fn()}>
        <Text>Content</Text>
      </Modal>,
    );
    const background = new Event('touchmove', { bubbles: true, cancelable: true });
    screen.getByRole('dialog').dispatchEvent(background);
    expect(background.defaultPrevented).toBe(true);

    const content = new Event('touchmove', { bubbles: true, cancelable: true });
    screen.getByText('Content').dispatchEvent(content);
    expect(content.defaultPrevented).toBe(false);
  });

  it('keeps the body locked until all dialogs close', () => {
    const original = document.body.style.overflow;
    const first = render(<Modal open title="One" onClose={vi.fn()} />);
    const second = render(<Modal open title="Two" onClose={vi.fn()} />);
    first.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    second.unmount();
    expect(document.body.style.overflow).toBe(original);
  });

  it('renders nothing when closed', () => {
    render(<Modal open={false} title="Dialog" onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
