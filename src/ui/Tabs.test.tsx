import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { Text } from '@/ui/Text';
import { t } from '@/i18n/i18n';
import { Tabs, type TabsItem } from './Tabs';
import { setupUi3Tests } from './ui3-test-utils';

setupUi3Tests();

const items: TabsItem[] = [
  { id: 'a', label: 'Alpha', panel: <Text>Panel A</Text> },
  { id: 'b', label: 'Beta', panel: <Text>Panel B</Text>, disabled: true },
  { id: 'c', label: 'Gamma', panel: <Text>Panel C</Text> },
];

describe('Tabs', () => {
  it('supports roving focus, arrows, Home/End, and linked panels', () => {
    function Example() {
      const [value, setValue] = useState('a');
      return <Tabs label="Sections" items={items} value={value} onValueChange={setValue} />;
    }
    render(<Example />);
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    const gamma = screen.getByRole('tab', { name: 'Gamma' });
    alpha.focus();

    fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(gamma);
    expect(gamma.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').id).toBe(gamma.getAttribute('aria-controls'));
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(gamma.id);

    fireEvent.keyDown(gamma, { key: 'ArrowRight' });
    expect(alpha.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(alpha, { key: 'End' });
    expect(gamma.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(gamma, { key: 'Home' });
    expect(alpha.getAttribute('aria-selected')).toBe('true');
  });

  it.each(['underline', 'pill', 'segmented'] as const)('renders %s and disables loading tabs', (variant) => {
    const { container } = render(
      <Tabs label="Sections" items={items} value="a" onValueChange={() => { throw new Error('Unexpected change'); }} variant={variant} disabled loading />,
    );
    expect(container.querySelector(`.ui-tabs--${variant}`)).not.toBeNull();
    for (const tab of screen.getAllByRole('tab')) {
      expect((tab as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(tab);
      fireEvent.keyDown(tab, { key: 'ArrowRight' });
    }
    expect(screen.getByRole('status').textContent).toBe(t('ui.tabs.loading'));
  });

  it('supports RTL arrow direction', () => {
    function Example() {
      const [value, setValue] = useState('a');
      return <Tabs label="Sections" items={items} value={value} onValueChange={setValue} dir="rtl" />;
    }
    render(<Example />);
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    alpha.focus();
    fireEvent.keyDown(alpha, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Gamma' }).getAttribute('aria-selected')).toBe('true');
  });

  it('expands labels measured above two lines instead of truncating', async () => {
    const { rerender } = render(
      <Tabs label="Sections" items={items} value="a" onValueChange={() => undefined} />,
    );
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    const text = alpha.querySelector<HTMLElement>('.ui-tabs__label');
    if (!text) throw new Error('Missing label');
    // jsdom 沒有排版引擎；局部提供量測值，不宣稱瀏覽器視覺驗收。
    text.style.lineHeight = '20px';
    Object.defineProperty(text, 'scrollHeight', { configurable: true, value: 80 });

    rerender(
      <Tabs
        label="Sections"
        items={[{ ...items[0]!, label: 'Alpha expanded' }, ...items.slice(1)]}
        value="a"
        onValueChange={() => undefined}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Alpha expanded' }).classList.contains('ui-tabs__tab--wide')).toBe(true);
    });
  });
});
