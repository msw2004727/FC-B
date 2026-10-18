import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { t } from '@/i18n/i18n';
import { RadioGroup } from './RadioGroup';
import { setupUi3Tests } from './ui3-test-utils';

setupUi3Tests();

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta', disabled: true },
  { value: 'c', label: 'Gamma' },
];

describe('RadioGroup', () => {
  it('supports arrows, wrapping, Home/End and skips disabled items', () => {
    function Example() {
      const [value, setValue] = useState('a');
      return <RadioGroup label="Sport" value={value} options={options} onValueChange={setValue} orientation="horizontal" />;
    }
    render(<Example />);
    const alpha = screen.getByRole('radio', { name: 'Alpha' }) as HTMLInputElement;
    const gamma = screen.getByRole('radio', { name: 'Gamma' }) as HTMLInputElement;
    alpha.focus();
    fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(gamma);
    expect(gamma.checked).toBe(true);
    expect(gamma.tabIndex).toBe(0);
    expect(alpha.tabIndex).toBe(-1);

    fireEvent.keyDown(gamma, { key: 'ArrowDown' });
    expect(alpha.checked).toBe(true);
    fireEvent.keyDown(alpha, { key: 'End' });
    expect(gamma.checked).toBe(true);
    fireEvent.keyDown(gamma, { key: 'Home' });
    expect(alpha.checked).toBe(true);
    expect(screen.getByRole('radiogroup').getAttribute('aria-orientation')).toBe('horizontal');
    expect(screen.getByRole('radiogroup').closest('.ui-radio-group--horizontal')).not.toBeNull();
  });

  it('disables all choices and exposes translated required/loading state', () => {
    const change = vi.fn();
    render(<RadioGroup label="Sport" value="a" options={options} onValueChange={change} disabled loading required error="Invalid" />);
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio as HTMLInputElement).disabled).toBe(true);
      fireEvent.keyDown(radio, { key: 'ArrowDown' });
    }
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('radiogroup').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe(t('ui.radioGroup.loading'));
    expect(screen.getAllByText(t('ui.radioGroup.required')).length).toBeGreaterThan(0);
  });
});
