import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { t } from '@/i18n/i18n';
import { Input } from './Input';
import { setupUi3Tests } from './ui3-test-utils';

setupUi3Tests();

describe('Input', () => {
  it('associates label, hint and error with the native input', () => {
    render(<Input label="Email" value="" type="email" hint="Help" error="Invalid" required />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.labels?.[0]?.htmlFor).toBe(input.id);
    expect(input.required).toBe(true);
    expect(input.type).toBe('email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(`${input.id}-hint`);
    expect(input.getAttribute('aria-describedby')).toContain(`${input.id}-error`);
    expect(input.closest('.ui-input--email')).not.toBeNull();
    expect(screen.getByText(t('ui.input.required'))).toBeTruthy();
  });

  it('emits input and blocks disabled, readonly and loading changes', () => {
    const change = vi.fn();
    const { rerender } = render(<Input label="Name" value="" onValueChange={change} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'A' } });
    expect(change).toHaveBeenCalledWith('A');

    for (const state of [{ disabled: true }, { readOnly: true }, { loading: true }]) {
      change.mockClear();
      rerender(<Input label="Name" value="" onValueChange={change} {...state} />);
      fireEvent.input(input, { target: { value: 'B' } });
      expect(change).not.toHaveBeenCalled();
    }
    expect(input.readOnly).toBe(true);
    expect(screen.getByRole('status').textContent).toBe(t('ui.input.loading'));
  });

  it.each(['text', 'email', 'tel', 'number', 'search'] as const)('supports %s', (type) => {
    const { container } = render(<Input label="Field" value="" type={type} success />);
    expect(container.querySelector('input')?.type).toBe(type);
    expect(container.querySelector(`.ui-input--${type}`)).not.toBeNull();
    expect(screen.getByText(t('ui.input.success'))).toBeTruthy();
  });
});
