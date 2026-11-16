import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { DRAWER_MENUS } from './drawer-menu';
import { DRAWER_MENU_ICON_KEYS, DrawerMenuIcon, drawerMenuIconKey } from './drawer-menu-icons';

afterEach(() => cleanup());

describe('抽屜選單圖示', () => {
  it('每個非標題入口都有專屬圖示，鍵集合剛好 17 個', () => {
    const keys = DRAWER_MENUS
      .filter((entry) => !entry.divider && !entry.sectionLabel)
      .map((entry) => drawerMenuIconKey(entry));
    expect(keys).toHaveLength(17);
    expect(new Set(keys).size).toBe(17);
    expect([...DRAWER_MENU_ICON_KEYS].sort()).toEqual([...keys].sort());
    for (const key of keys) expect(key.length).toBeGreaterThan(0);
  });

  it('每顆圖示是 24 viewBox、aria-hidden、stroke 2，且有 path／circle／rect', () => {
    for (const key of DRAWER_MENU_ICON_KEYS) {
      const { container, unmount } = render(<DrawerMenuIcon page={key} />);
      const svg = container.querySelector('.dg-ico svg');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('stroke-width')).toBe('2');
      expect(svg?.querySelector('path, circle, rect')).not.toBeNull();
      expect(svg?.classList.contains('drawer-status')).toBe(false);
      unmount();
    }
  });
});
