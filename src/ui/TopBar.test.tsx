import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { TopBar } from './TopBar';
import { on } from '@/core/events';
import { setTheme } from '@/core/theme';
import { toast } from '@/ui/Toast';

// 這組測試驗證「顯示經驗值」時的畫面；新版預設關閉（src/core/exp-display.ts），關閉時的行為另有測試。
vi.mock('@/core/exp-display', () => ({ SHOW_EXP: true }));

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string) => key,
}));

beforeEach(() => {
  setTheme('light');
});

afterEach(() => {
  cleanup();
  setTheme('light');
  vi.restoreAllMocks();
});

describe('TopBar (legacy A DOM & CSS)', () => {
  it('wraps #top-bar in .legacy-ui.legacy-chrome and renders A structure in order', () => {
    const login = vi.fn();
    const { container } = render(
      <TopBar drawerOpen={false} onMenuClick={() => undefined} onLogin={login} />,
    );
    const wrapper = container.querySelector('.legacy-ui.legacy-chrome');
    expect(wrapper).not.toBeNull();
    const header = wrapper?.querySelector('header#top-bar');
    expect(header).not.toBeNull();

    const menu = container.querySelector<HTMLButtonElement>('#menu-toggle');
    expect(menu).not.toBeNull();
    expect(menu?.querySelectorAll('span').length).toBe(3);
    expect(menu?.getAttribute('aria-expanded')).toBe('false');

    const right = container.querySelector('.top-bar-right');
    expect(Array.from(right?.children ?? []).map((node) => node.id)).toEqual([
      'points-display',
      'sport-picker-wrapper',
      'notif-btn',
      'line-login-wrapper',
    ]);

    expect(container.querySelector('#points-value')?.textContent).toBe('-'); // A updatePointsDisplay：未接 EXP 前顯示「-」
    expect(container.querySelector('#sport-picker-btn .sp-all-label')?.textContent).toBe('All');
    expect(container.querySelector('#notif-btn')?.getAttribute('href')).toBe('/inbox');

    const loginBtn = container.querySelector<HTMLButtonElement>('#line-login-btn');
    expect(loginBtn).not.toBeNull();
    fireEvent.click(loginBtn!);
    expect(login).toHaveBeenCalledOnce();
  });

  it('switches #top-logo-img src between light and dark theme and falls back to png on error', () => {
    setTheme('light');
    const { container } = render(
      <TopBar drawerOpen={false} onMenuClick={() => undefined} />,
    );
    const img = container.querySelector<HTMLImageElement>('#top-logo-img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/assets/logo-black.webp');

    act(() => {
      setTheme('dark');
    });
    expect(img?.getAttribute('src')).toBe('/assets/logo-white.webp');

    fireEvent.error(img!);
    expect(img?.getAttribute('src')).toBe('/assets/logo-white.png');
  });

  it('shows unavailable toast when clicking points display', () => {
    const spy = vi.spyOn(toast, 'show');
    const { container } = render(
      <TopBar drawerOpen={false} onMenuClick={() => undefined} />,
    );
    const points = container.querySelector<HTMLElement>('#points-display');
    expect(points).not.toBeNull();
    fireEvent.click(points!);
    expect(spy).toHaveBeenCalledWith({ message: '此功能尚未開放，請先使用舊版' });
  });

  it('opens the drawer and emits sport:picker-open', () => {
    const menu = vi.fn();
    const sport = vi.fn();
    const unsubscribe = on('sport:picker-open', sport);
    try {
      render(<TopBar drawerOpen onMenuClick={menu} />);
      fireEvent.click(screen.getByRole('button', { name: '選單' }));
      fireEvent.click(screen.getByRole('button', { name: '切換運動項目' }));
      expect(menu).toHaveBeenCalledOnce();
      expect(sport).toHaveBeenCalledWith({});
    } finally {
      unsubscribe();
    }
  });

  it('登入確認中且上次已登入：顯示頭像位置、不顯示登入按鈕', () => {
    const { container } = render(<TopBar drawerOpen={false} onMenuClick={() => {}} onLogin={() => {}} authPending />);
    expect(container.querySelector('#line-avatar-topbar.line-avatar-fallback')).toBeTruthy();
    expect(container.querySelector('#line-login-btn')).toBeNull();
  });

  it('disables pending login and replaces with #line-user-topbar for signed-in user', () => {
    const login = vi.fn();
    const view = render(
      <TopBar drawerOpen={false} onMenuClick={() => undefined} onLogin={login} loginPending />,
    );
    const btn = view.container.querySelector<HTMLButtonElement>('#line-login-btn');
    expect(btn?.disabled).toBe(true);
    btn?.click();
    expect(login).not.toHaveBeenCalled();

    view.rerender(
      <TopBar
        drawerOpen={false}
        onMenuClick={() => undefined}
        onLogin={login}
        user={{ uid: 'member-1', displayName: 'Alex', pictureUrl: null }}
      />,
    );
    expect(view.container.querySelector('#line-login-btn')).toBeNull();
    expect(view.container.querySelector('#line-user-topbar')).not.toBeNull();
    expect(view.container.querySelector('#line-avatar-topbar')?.textContent).toBe('A');
  });
});
