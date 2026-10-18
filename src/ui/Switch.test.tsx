import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { t } from '@/i18n/i18n';
import { Switch } from './Switch';
import { setupUi3Tests } from './ui3-test-utils';

setupUi3Tests();

describe('Switch', () => {
  it('toggles once with Space/Enter and ignores repeated keydown', () => {
    function Example() {
      const [checked, setChecked] = useState(false);
      return <Switch label="Notifications" checked={checked} onCheckedChange={setChecked} />;
    }
    render(<Example />);
    const button = screen.getByRole('switch', { name: 'Notifications' });
    expect(button.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(t('ui.switch.off'))).toBeTruthy();

    fireEvent.keyDown(button, { key: ' ' });
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.closest('.ui-switch--checked')).not.toBeNull();

    fireEvent.keyDown(button, { key: ' ', repeat: true });
    expect(button.getAttribute('aria-checked')).toBe('true');

    fireEvent.keyDown(button, { key: 'Enter' });
    expect(button.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-checked')).toBe('true');
  });

  it('blocks disabled/loading interaction', () => {
    const change = vi.fn();
    render(<Switch label="Notifications" checked={false} onCheckedChange={change} disabled loading />);
    const button = screen.getByRole('switch') as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(change).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe(t('ui.switch.loading'));
  });
});
