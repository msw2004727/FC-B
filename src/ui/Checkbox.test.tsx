import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { t } from '@/i18n/i18n';
import { Checkbox } from './Checkbox';
import { setupUi3Tests } from './ui3-test-utils';

setupUi3Tests();

describe('Checkbox', () => {
  it('uses a labelled native checkbox and mixed state', () => {
    render(<Checkbox label="Accept" checked={false} indeterminate required error="Required" />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.type).toBe('checkbox');
    expect(input.labels?.[0]?.htmlFor).toBe(input.id);
    expect(input.indeterminate).toBe(true);
    expect(input.getAttribute('aria-checked')).toBe('mixed');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.closest('.ui-checkbox--mixed')).not.toBeNull();
    expect(screen.getByText(t('ui.checkbox.required'))).toBeTruthy();
  });

  it('handles native activation and blocks disabled activation', () => {
    const change = vi.fn();
    const { rerender } = render(<Checkbox label="Accept" checked={false} onCheckedChange={change} />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);
    // jsdom 不合成 Space 的瀏覽器預設 click；原生 activation 以 click 驗證。
    fireEvent.click(input);
    expect(change).toHaveBeenCalledWith(true);

    change.mockClear();
    rerender(<Checkbox label="Accept" checked={false} onCheckedChange={change} disabled />);
    fireEvent.click(input);
    expect(input.disabled).toBe(true);
    expect(change).not.toHaveBeenCalled();
  });

  it('uses translated loading text', () => {
    render(<Checkbox label="Accept" checked loading />);
    expect(screen.getByRole('status').textContent).toBe(t('ui.checkbox.loading'));
    expect(screen.getByRole('checkbox').closest('.ui-checkbox--checked')).not.toBeNull();
  });
});
