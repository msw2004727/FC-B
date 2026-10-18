import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { TopBar } from './TopBar';
import { on } from '@/core/events';
import { _setDictLoaderForTest, t } from '@/i18n/i18n';
import { prepareShellLocale } from './shell-test-utils';

beforeEach(prepareShellLocale);
afterEach(() => {
  cleanup();
  _setDictLoaderForTest(null);
});

describe('TopBar', () => {
  it('renders the A control order and translated accessible labels', () => {
    render(<TopBar drawerOpen={false} onMenuClick={() => undefined} />);
    expect(screen.getByRole('banner').classList.contains('ui-top-bar')).toBe(true);
    const menu = screen.getByRole('button', { name: t('ui.topBar.menu') });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(menu.getAttribute('aria-controls')).toBe('side-drawer');
    expect(screen.getByRole('link', { name: t('ui.topBar.notifications') })
      .getAttribute('href')).toBe('/inbox');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: t('ui.topBar.login') })).toBeNull();
  });

  it('opens the drawer and emits the sport event', () => {
    const menu = vi.fn();
    const sport = vi.fn();
    const unsubscribe = on('sport:picker-open', sport);
    try {
      render(<TopBar drawerOpen onMenuClick={menu} />);
      fireEvent.click(screen.getByRole('button', { name: t('ui.topBar.menu') }));
      fireEvent.click(screen.getByRole('button', { name: t('ui.topBar.sport') }));
      expect(menu).toHaveBeenCalledOnce();
      expect(sport).toHaveBeenCalledWith({});
      expect(screen.getByRole('button', { name: t('ui.topBar.menu') })
        .getAttribute('aria-expanded')).toBe('true');
    } finally {
      unsubscribe();
    }
  });

  it('disables a pending login without changing its label', () => {
    const login = vi.fn();
    render(<TopBar drawerOpen={false} onMenuClick={() => undefined}
      onLogin={login} loginPending />);
    const button = screen.getByRole('button', {
      name: t('ui.topBar.login'),
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    button.click();
    expect(login).not.toHaveBeenCalled();
  });
});
