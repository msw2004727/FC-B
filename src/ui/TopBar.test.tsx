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
  it('renders sport, notifications and signed-out login in A order', () => {
    const login = vi.fn();
    const { container } = render(
      <TopBar drawerOpen={false} onMenuClick={() => undefined} onLogin={login} />,
    );
    expect(screen.getByRole('banner').classList.contains('ui-top-bar')).toBe(true);
    const menu = screen.getByRole('button', { name: t('ui.topBar.menu') });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(menu.getAttribute('aria-controls')).toBe('side-drawer');
    const actions = container.querySelector('.ui-top-bar__actions');
    expect(Array.from(actions?.children ?? []).map((node) => node.id)).toEqual([
      'sport-picker-btn', 'notif-btn', 'line-login-btn',
    ]);
    expect(screen.getByRole('button', { name: t('ui.topBar.sport') }).textContent)
      .toBe(t('ui.shell.sportAll'));
    expect(screen.getByRole('link', { name: t('ui.topBar.notifications') })
      .getAttribute('href')).toBe('/inbox');
    fireEvent.click(screen.getByRole('button', { name: t('ui.topBar.login') }));
    expect(login).toHaveBeenCalledOnce();
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

  it('disables pending login and displays loading without changing its accessible name', () => {
    const login = vi.fn();
    const { container } = render(
      <TopBar drawerOpen={false} onMenuClick={() => undefined}
        onLogin={login} loginPending />,
    );
    const button = screen.getByRole('button', {
      name: t('ui.topBar.login'),
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('.ui-top-bar__spinner')).not.toBeNull();
    button.click();
    expect(login).not.toHaveBeenCalled();
  });

  it('replaces login with Avatar for an authenticated user', () => {
    const { container } = render(
      <TopBar drawerOpen={false} onMenuClick={() => undefined} onLogin={vi.fn()}
        user={{ uid: 'member-1', displayName: 'Alex', pictureUrl: null }} />,
    );
    expect(screen.queryByRole('button', { name: t('ui.topBar.login') })).toBeNull();
    expect(screen.getByRole('link', { name: t('nav.profile') })
      .getAttribute('href')).toBe('/profile');
    expect(container.querySelector('.ui-avatar')).not.toBeNull();
  });
});
