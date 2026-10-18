import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { getCurrentLocale, t } from '@/i18n/i18n';
import { Stepper } from './Stepper';
import { setupUi3Tests } from './ui3-test-utils';

setupUi3Tests();

describe('Stepper', () => {
  it('supports fractional steps, boundaries and keyboard navigation', () => {
    function Example() {
      const [value, setValue] = useState(0.2);
      return (
        <Stepper
          label="Quantity"
          value={value}
          min={0}
          max={0.3}
          step={0.1}
          onValueChange={setValue}
          size="lg"
        />
      );
    }

    render(<Example />);
    const spin = screen.getByRole('spinbutton', { name: 'Quantity' });
    const label = getCurrentLocale().startsWith('zh') ? ' Quantity' : 'Quantity';
    const increaseName = t('ui.stepper.increase', { label });
    const decreaseName = t('ui.stepper.decrease', { label });
    const increase = screen.getByRole('button', { name: increaseName }) as HTMLButtonElement;
    const decrease = screen.getByRole('button', { name: decreaseName }) as HTMLButtonElement;

    expect(increase.getAttribute('title')).toBe(increaseName);
    expect(decrease.getAttribute('title')).toBe(decreaseName);
    if (getCurrentLocale().startsWith('zh')) {
      expect(increaseName).toContain(' Quantity');
      expect(decreaseName).toContain(' Quantity');
    }

    expect(spin.closest('.ui-stepper--lg')).not.toBeNull();
    fireEvent.click(increase);
    expect(spin.getAttribute('aria-valuenow')).toBe('0.3');
    expect(increase.disabled).toBe(true);

    fireEvent.keyDown(spin, { key: 'Home' });
    expect(spin.getAttribute('aria-valuenow')).toBe('0');
    expect(decrease.disabled).toBe(true);

    fireEvent.keyDown(spin, { key: 'ArrowUp' });
    expect(spin.getAttribute('aria-valuenow')).toBe('0.1');
    fireEvent.keyDown(spin, { key: 'End' });
    expect(spin.getAttribute('aria-valuenow')).toBe('0.3');
    fireEvent.keyDown(spin, { key: 'ArrowDown' });
    expect(spin.getAttribute('aria-valuenow')).toBe('0.2');

    fireEvent.click(decrease);
    expect(spin.getAttribute('aria-valuenow')).toBe('0.1');
  });

  it.each([
    { disabled: true, loading: false },
    { disabled: false, loading: true },
    { disabled: true, loading: true },
  ])('blocks controls for %o', ({ disabled, loading }) => {
    const change = vi.fn();
    render(
      <Stepper
        label="Quantity"
        value={1}
        onValueChange={change}
        disabled={disabled}
        loading={loading}
      />,
    );
    const spin = screen.getByRole('spinbutton');
    fireEvent.keyDown(spin, { key: 'ArrowUp' });
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(change).not.toHaveBeenCalled();
    expect(spin.getAttribute('aria-disabled')).toBe('true');
    expect(spin.getAttribute('tabindex')).toBe('-1');
    if (loading) {
      expect(screen.getByRole('status').textContent).toBe(t('ui.stepper.loading'));
    } else {
      expect(screen.queryByRole('status')).toBeNull();
    }
  });
});
