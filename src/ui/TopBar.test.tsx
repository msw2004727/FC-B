import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { TopBar, _resetBrokenAvatarUrlsForTest } from './TopBar';
import {
  ACTIVE_SPORT_STORAGE_KEY,
  _resetSportFilterForTest,
  getActiveSport,
  setActiveSport,
} from '@/core/sport-filter';
import { setTheme } from '@/core/theme';
import * as authMod from '@/data/auth';
import type { EventDoc } from '@/features/events/data/types';
import { toast } from '@/ui/Toast';

// 這組測試驗證「顯示經驗值」時的畫面；新版預設關閉（src/core/exp-display.ts），關閉時的行為另有測試。
vi.mock('@/core/exp-display', () => ({ SHOW_EXP: true }));

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string) => key,
}));

const mockEventsState = {
  events: [] as EventDoc[],
};

// 亮綠點只在打開下拉時讀「已載入」的活動快照（不觸發讀取），這裡直接提供快照。
vi.mock('@/features/events/data/events-repo', () => ({
  getEventsRepo: () => ({ getSnapshot: () => ({ active: mockEventsState.events, terminal: [] }) }),
}));

beforeEach(() => {
  setTheme('light');
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  window.history.replaceState({}, '', '/');
  _resetSportFilterForTest();
  _resetBrokenAvatarUrlsForTest();
  mockEventsState.events = [];
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

  // 測試同步更新：照 A（M-168）authPending 且無 user 時頭像占位顯示 guest-avatar-icon。
  it('shows guest-avatar-icon placeholder while auth is pending and no user', () => {
    const { container } = render(
      <TopBar drawerOpen={false} onMenuClick={() => undefined} authPending />,
    );
    const avatar = container.querySelector('#line-avatar-topbar');
    expect(avatar).not.toBeNull();
    expect(avatar?.querySelector('svg.guest-avatar-icon')).not.toBeNull();
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

  it('opens the drawer and toggles #sport-picker-dropdown when clicking sport button', () => {
    const menu = vi.fn();
    const { container } = render(<TopBar drawerOpen onMenuClick={menu} />);
    fireEvent.click(screen.getByRole('button', { name: '選單' }));
    expect(menu).toHaveBeenCalledOnce();

    const sportBtn = screen.getByRole('button', { name: '切換運動項目' });
    const dropdown = container.querySelector('#sport-picker-dropdown');
    expect(dropdown?.classList.contains('open')).toBe(false);
    expect(sportBtn.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(sportBtn);
    expect(dropdown?.classList.contains('open')).toBe(true);
    expect(sportBtn.getAttribute('aria-expanded')).toBe('true');

    // 點擊外部關閉下拉
    fireEvent.click(document.body);
    expect(dropdown?.classList.contains('open')).toBe(false);
    expect(sportBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('selects a sport from dropdown, updates button icon (SVG/img/emoji), saves to localStorage, and shows toast', () => {
    const toastSpy = vi.spyOn(toast, 'show');
    const { container } = render(<TopBar drawerOpen={false} onMenuClick={() => undefined} />);
    const sportBtn = container.querySelector<HTMLButtonElement>('#sport-picker-btn')!;
    fireEvent.click(sportBtn);

    const pickleballOption = container.querySelector<HTMLButtonElement>(
      '.sport-picker-item[data-sport="pickleball"]',
    )!;
    expect(pickleballOption).not.toBeNull();
    // 匹克球使用自訂 SVG 圖示
    expect(pickleballOption.querySelector('svg')).not.toBeNull();

    fireEvent.click(pickleballOption);
    expect(getActiveSport()).toBe('pickleball');
    expect(localStorage.getItem(ACTIVE_SPORT_STORAGE_KEY)).toBe('pickleball');
    expect(toastSpy).toHaveBeenCalledWith({ message: '已切換為 匹克球' });
    expect(sportBtn.querySelector('.sport-picker-icon svg')).not.toBeNull();
    expect(container.querySelector('#sport-picker-dropdown')?.classList.contains('open')).toBe(false);

    // 切換到足球時顯示自訂圖片 /img/Socce.png
    act(() => {
      setActiveSport('football');
    });
    expect(sportBtn.querySelector('.sport-picker-icon img')?.getAttribute('src')).toBe('/img/Socce.png');
  });

  it('highlights .has-events green dot for sports with active public events (M-022)', async () => {
    mockEventsState.events = [
      { id: 'e1', title: '足球團', sportTag: 'football', status: 'open' } as EventDoc,
      { id: 'e2', title: '私密籃球', sportTag: 'basketball', status: 'open', privateEvent: true } as EventDoc,
      { id: 'e3', title: '已結束羽球', sportTag: 'badminton', status: 'ended' } as EventDoc,
    ];
    const { container } = render(<TopBar drawerOpen={false} onMenuClick={() => undefined} />);
    fireEvent.click(container.querySelector('#sport-picker-btn')!);
    await waitFor(() =>
      expect(container.querySelector('.sport-picker-item[data-sport="football"]')?.classList.contains('has-events')).toBe(true),
    );
    const allItem = container.querySelector('.sport-picker-item[data-sport="all"]');
    const footballItem = container.querySelector('.sport-picker-item[data-sport="football"]');
    const basketballItem = container.querySelector('.sport-picker-item[data-sport="basketball"]');
    const badmintonItem = container.querySelector('.sport-picker-item[data-sport="badminton"]');

    expect(allItem?.classList.contains('has-events')).toBe(true);
    expect(footballItem?.classList.contains('has-events')).toBe(true);
    expect(basketballItem?.classList.contains('has-events')).toBe(false);
    expect(badmintonItem?.classList.contains('has-events')).toBe(false);
  });

  it('supports keyboard navigation (ArrowDown, ArrowUp, Enter, Escape) in sport picker dropdown (U-004)', () => {
    const { container } = render(<TopBar drawerOpen={false} onMenuClick={() => undefined} />);
    const wrapper = container.querySelector<HTMLElement>('#sport-picker-wrapper')!;
    const sportBtn = container.querySelector<HTMLButtonElement>('#sport-picker-btn')!;

    fireEvent.click(sportBtn);
    const items = container.querySelectorAll<HTMLButtonElement>('.sport-picker-item[data-sport]');
    expect(document.activeElement).toBe(items[0]); // 預設焦點在目前選項（all）

    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]); // football

    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[2]); // basketball

    fireEvent.keyDown(wrapper, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[1]); // football

    fireEvent.keyDown(wrapper, { key: 'Enter' });
    expect(getActiveSport()).toBe('football');
    expect(container.querySelector('#sport-picker-dropdown')?.classList.contains('open')).toBe(false);

    // 重新打開並測試 Escape 關閉
    fireEvent.click(sportBtn);
    expect(container.querySelector('#sport-picker-dropdown')?.classList.contains('open')).toBe(true);
    fireEvent.keyDown(wrapper, { key: 'Escape' });
    expect(container.querySelector('#sport-picker-dropdown')?.classList.contains('open')).toBe(false);
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

  it('T-033：已登入但名稱頭像還沒到（isSyncing）→ 同步小轉圈；資料到了 → 換成首字', () => {
    const user = { uid: 'U0000000000000000000000000000001', displayName: null, pictureUrl: null };
    const view = render(<TopBar drawerOpen={false} onMenuClick={() => undefined} user={user} isSyncing />);
    const avatar = () => view.container.querySelector('#line-avatar-topbar');
    expect(avatar()?.classList.contains('line-avatar-loading')).toBe(true);
    expect(avatar()?.querySelector('.line-avatar-spinner')).not.toBeNull();
    expect(avatar()?.textContent).toBe('');

    view.rerender(
      <TopBar drawerOpen={false} onMenuClick={() => undefined} user={{ ...user, displayName: '小明' }} isSyncing={false} />,
    );
    expect(avatar()?.classList.contains('line-avatar-loading')).toBe(false);
    expect(avatar()?.querySelector('.line-avatar-spinner')).toBeNull();
    expect(avatar()?.textContent).toBe('小');
  });

  it('T-033：資料同步完成、兩邊都沒有名稱 → 顯示「?」而不是轉圈', () => {
    const user = { uid: 'U0000000000000000000000000000001', displayName: null, pictureUrl: null };
    const { container } = render(<TopBar drawerOpen={false} onMenuClick={() => undefined} user={user} isSyncing={false} />);
    const avatar = container.querySelector('#line-avatar-topbar');
    expect(avatar?.classList.contains('line-avatar-loading')).toBe(false);
    expect(avatar?.textContent).toBe('?');
  });

  it('T-033：isSyncing 但已有頭像網址 → 不轉圈（照 A：只有「同步中且尚無頭像網址」才轉）', () => {
    const user = { uid: 'U0000000000000000000000000000001', displayName: null, pictureUrl: 'https://example.test/a.png' };
    const { container } = render(<TopBar drawerOpen={false} onMenuClick={() => undefined} user={user} isSyncing />);
    expect(container.querySelector('#line-avatar-topbar')?.classList.contains('line-avatar-loading')).toBe(false);
  });

  it('opens #user-menu-dropdown when clicking avatar, closes on outside click, and calls signOut on logout (M-017)', async () => {
    const signOutSpy = vi.spyOn(authMod, 'signOut').mockResolvedValue();
    const { container } = render(
      <TopBar
        drawerOpen={false}
        onMenuClick={() => undefined}
        user={{ uid: 'u1', displayName: '王大明', pictureUrl: null }}
        crown
      />,
    );

    const userTopbar = container.querySelector('#line-user-topbar');
    expect(userTopbar?.classList.contains('has-identity-crown')).toBe(true);

    const avatar = container.querySelector<HTMLElement>('#line-avatar-topbar')!;
    const menu = container.querySelector<HTMLElement>('#user-menu-dropdown')!;
    expect(menu.style.display).toBe('none');

    fireEvent.click(avatar);
    expect(menu.style.display).toBe('');
    expect(container.querySelector('#user-menu-name')?.textContent).toBe('王大明');

    // 點擊外部關閉選單
    fireEvent.click(document.body);
    expect(menu.style.display).toBe('none');

    // 再次打開並點擊登出
    fireEvent.click(avatar);
    const logoutBtn = container.querySelector<HTMLButtonElement>('.user-menu-logout')!;
    fireEvent.click(logoutBtn);
    await waitFor(() => expect(signOutSpy).toHaveBeenCalledOnce());
    expect(menu.style.display).toBe('none');
  });
});
