import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { BottomNav } from './BottomNav';
import { on } from '@/core/events';
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

  // M-025：點中央 QR 按鈕發出 qr:open 在原頁彈窗，不換頁，且原分頁維持 active。
  it('emits qr:open without changing route when clicking center QR button (M-025)', async () => {
    history.replaceState(null, '', '/activities');
    const qrOpenListener = vi.fn();
    const stop = on('qr:open', qrOpenListener);

    try {
      const { container } = render(<LocationProvider><BottomNav /></LocationProvider>);
      const qrBtn = container.querySelector<HTMLButtonElement>('.bot-tab-qr');
      expect(qrBtn).not.toBeNull();

      await act(() => {
        fireEvent.click(qrBtn!);
      });

      expect(qrOpenListener).toHaveBeenCalledTimes(1);
      expect(location.pathname).toBe('/activities');
      expect(qrBtn?.classList.contains('active')).toBe(false);

      const activeTabs = container.querySelectorAll('.bot-tab.active');
      expect(activeTabs.length).toBe(1);
      expect(activeTabs[0]?.getAttribute('data-page')).toBe('page-activities');
    } finally {
      stop();
    }
  });

  it('marks profile active for /profile and /profile/qr', () => {
    history.replaceState(null, '', '/profile');
    const { container, unmount } = render(<LocationProvider><BottomNav /></LocationProvider>);
    const activeTabs = container.querySelectorAll('.bot-tab.active');
    expect(activeTabs.length).toBe(1);
    expect(activeTabs[0]?.getAttribute('data-page')).toBe('page-profile');
    unmount();

    history.replaceState(null, '', '/profile/qr');
    const rendered = render(<LocationProvider><BottomNav /></LocationProvider>);
    const qrActiveTabs = rendered.container.querySelectorAll('.bot-tab.active');
    expect(qrActiveTabs.length).toBe(1);
    expect(qrActiveTabs[0]?.getAttribute('data-page')).toBe('page-profile');
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

  it('未登入點「我的」照 A 直接帶去 LINE 登入，不進頁（M-034）', () => {
    const onLogin = vi.fn();
    const { container } = render(
      <LocationProvider><BottomNav user={null} onLogin={onLogin} /></LocationProvider>,
    );
    fireEvent.click(container.querySelector('[data-page="page-profile"]') as HTMLElement);
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/');
  });

  it('切分頁後那頁標成返回起點（M-037）', () => {
    const { container } = render(
      <LocationProvider><BottomNav user={{ uid: 'u1', displayName: null, pictureUrl: null }} /></LocationProvider>,
    );
    act(() => {
      fireEvent.click(container.querySelector('[data-page="page-activities"]') as HTMLElement);
    });
    expect(location.pathname).toBe('/activities');
    expect((history.state as Record<string, unknown> | null)?.['__fcbRoot']).toBe(true);
  });
});
