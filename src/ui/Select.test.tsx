import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { t } from '@/i18n/i18n';
import { Select } from './Select';
import { setupUi3Tests } from './ui3-test-utils';

setupUi3Tests();

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

describe('Select', () => {
  it('renders native options and accessible error/required state', () => {
    render(<Select label="Sport" value="a" options={options} required error="Choose again" />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.labels?.[0]?.htmlFor).toBe(select.id);
    expect(select.options[0]?.label).toBe('Alpha');
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(select.getAttribute('aria-describedby')).toContain(`${select.id}-error`);
    expect(select.closest('.ui-select--native')).not.toBeNull();
    expect(screen.getByText(t('ui.select.required'))).toBeTruthy();
  });

  it('emits native changes and ignores disabled changes', () => {
    const change = vi.fn();
    const { rerender } = render(<Select label="Sport" value="a" options={options} onValueChange={change} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'b' } });
    expect(change).toHaveBeenCalledWith('b');
    expect(select.value).toBe('a');

    change.mockClear();
    rerender(<Select label="Sport" value="a" options={options} onValueChange={change} disabled />);
    fireEvent.change(select, { target: { value: 'b' } });
    expect(select.disabled).toBe(true);
    expect(change).not.toHaveBeenCalled();
  });

  it('retains readonly form value and translates loading', () => {
    const { container, rerender } = render(
      <Select label="Sport" name="sport" value="a" options={options} readOnly />,
    );
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="hidden"]')?.value).toBe('a');
    expect(screen.getByText(t('ui.select.readonly'))).toBeTruthy();

    rerender(<Select label="Sport" value="a" options={options} loading />);
    expect(screen.getByRole('status').textContent).toBe(t('ui.select.loading'));
  });
});
