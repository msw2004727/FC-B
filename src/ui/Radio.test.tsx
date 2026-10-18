import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { t } from '@/i18n/i18n';
import { Radio } from './Radio';
import { setupUi3Tests } from './ui3-test-utils';

setupUi3Tests();

describe('Radio', () => {
  it('renders a labelled native radio with required and error metadata', () => {
    render(<Radio name="sport" value="a" label="Alpha" checked required error="Invalid" />);
    const input = screen.getByRole('radio') as HTMLInputElement;
    expect(input.type).toBe('radio');
    expect(input.labels?.[0]?.htmlFor).toBe(input.id);
    expect(input.checked).toBe(true);
    expect(input.closest('.ui-radio--checked')).not.toBeNull();
    expect(input.getAttribute('aria-describedby')).toContain(`${input.id}-error`);
    expect(screen.getByText(t('ui.radio.required'))).toBeTruthy();
  });

  it('uses native activation and guards disabled state', () => {
    const change = vi.fn();
    const { rerender } = render(
      <Radio name="sport" value="a" label="Alpha" checked={false} onCheckedChange={change} />,
    );
    const input = screen.getByRole('radio') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);
    fireEvent.click(input);
    expect(change).toHaveBeenCalledWith(true);

    change.mockClear();
    rerender(<Radio name="sport" value="a" label="Alpha" checked={false} disabled onCheckedChange={change} />);
    fireEvent.click(input);
    expect(change).not.toHaveBeenCalled();
    expect(input.disabled).toBe(true);
  });

  it('uses translated loading text', () => {
    render(<Radio name="sport" value="a" label="Alpha" checked={false} loading />);
    expect(screen.getByRole('status').textContent).toBe(t('ui.radio.loading'));
  });
});
