import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { BottomNav } from './BottomNav';
import { _resetForTest, registerFeatures, setRemoteFlags } from '@/core/feature-registry';
import { manifest as home } from '@/features/home';
import { manifest as events } from '@/features/events';
import { manifest as clubs } from '@/features/clubs';
import { manifest as inbox } from '@/features/inbox';
import { manifest as profile } from '@/features/profile';
import { manifest as checkin } from '@/features/checkin';

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string) => key,
}));

beforeEach(() => {
  _resetForTest();
  history.replaceState(null, '', '/');
  registerFeatures([home, events, clubs, inbox, profile, checkin]);
});

afterEach(() => {
  cleanup();
  _resetForTest();
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('BottomNav (legacy A DOM & CSS)', () => {
  it('wraps #bottom-tabs in .legacy-ui.legacy-chrome and renders 5 tabs + center QR in A order', () => {
    const { container } = render(<LocationProvider><BottomNav /></LocationProvider>);
    const wrapper = container.querySelector('.legacy-ui.legacy-chrome');
    expect(wrapper).not.toBeNull();
    const nav = wrapper?.querySelector('nav#bottom-tabs');
    expect(nav).not.toBeNull();

    const tabs = Array.from(container.querySelectorAll<HTMLElement>('.bot-tab'));
    expect(tabs.map((el) => el.getAttribute('data-page'))).toEqual([
      'page-tournaments',
      'page-teams',
      'page-home',
      'page-activities',
      'page-profile',
    ]);
    expect(tabs.map((el) => el.textContent?.trim())).toEqual([
      '賽事',
      '俱樂部',
      '首頁',
      '活動',
      '我的',
    ]);

    const centerWrap = container.querySelector('.bot-tab-center-wrap');
    expect(centerWrap).not.toBeNull();
    expect(centerWrap?.querySelector('.bot-tab-qr')).not.toBeNull();
    expect(centerWrap?.querySelector('[data-page="page-home"]')).not.toBeNull();

    const homeTab = container.querySelector('[data-page="page-home"]');
    expect(homeTab?.classList.contains('active')).toBe(true);
  });

  // 測試同步更新（R-QA-005）：照 A，中央鈕是「我的 QR Code」（/profile/qr），不是掃碼頁。
  it('marks only QR active on /profile/qr', () => {
    history.replaceState(null, '', '/profile/qr');
    const { container } = render(<LocationProvider><BottomNav /></LocationProvider>);
    expect(container.querySelectorAll('.bot-tab.active').length).toBe(0);
    expect(container.querySelector('.bot-tab-qr')?.getAttribute('aria-current')).toBe('page');
  });

  it('marks profile active for /profile', () => {
    history.replaceState(null, '', '/profile');
    const { container } = render(<LocationProvider><BottomNav /></LocationProvider>);
    const activeTabs = container.querySelectorAll('.bot-tab.active');
    expect(activeTabs.length).toBe(1);
    expect(activeTabs[0]?.getAttribute('data-page')).toBe('page-profile');
  });

  it.each(['/activities', '/events/public-event'])('marks activities active on %s', (path) => {
    history.replaceState(null, '', path);
    const { container } = render(<LocationProvider><BottomNav /></LocationProvider>);
    const activeTabs = container.querySelectorAll('.bot-tab.active');
    expect(activeTabs.length).toBe(1);
    expect(activeTabs[0]?.getAttribute('data-page')).toBe('page-activities');
  });

  it('marks clubs active on /teams/public-team', () => {
    history.replaceState(null, '', '/teams/public-team');
    const { container } = render(<LocationProvider><BottomNav /></LocationProvider>);
    const activeTabs = container.querySelectorAll('.bot-tab.active');
    expect(activeTabs.length).toBe(1);
    expect(activeTabs[0]?.getAttribute('data-page')).toBe('page-teams');
  });

  it('hides QR button when profile feature is disabled', async () => {
    const { container } = render(<LocationProvider><BottomNav /></LocationProvider>);
    await act(() => setRemoteFlags({ profile: false }));
    expect(container.querySelector('.bot-tab-qr')).toBeNull();
    await act(() => setRemoteFlags({}));
    expect(container.querySelector('.bot-tab-qr')).not.toBeNull();
  });
});
