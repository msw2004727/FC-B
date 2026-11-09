import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';

// 首頁瘦身：側邊選單改成 App 畫完才下載。這裡用真的 App 確認接線：
// 選單照常開關、props 照傳，且 Android 安裝提示事件仍在開站時就由 App 接住（不必等選單下載完）。

const drawer = vi.hoisted(() => ({
  props: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/core/feature-registry', () => ({
  useRegistryVersion: () => 0,
  getActiveRoutes: () => [{ path: '/', load: async () => ({ default: () => <p>首頁</p> }) }],
}));
vi.mock('@/ui/TopBar', () => ({
  TopBar: ({ onMenuClick }: { onMenuClick: () => void }) => (
    <button type="button" onClick={onMenuClick}>選單</button>
  ),
}));
vi.mock('@/ui/BottomNav', () => ({ BottomNav: () => null }));
vi.mock('@/ui/SideDrawer', () => ({
  SideDrawer: (props: Record<string, unknown>) => {
    drawer.props.push(props);
    return props.open ? (
      <nav data-testid="drawer">
        <button type="button" onClick={props.onClose as () => void}>關閉</button>
      </nav>
    ) : null;
  },
}));
vi.mock('@/core/font-size', () => ({ initFontSize: () => undefined }));
vi.mock('@/data/auth', () => ({
  onAuthChanged: () => () => undefined,
  getCurrentUser: async () => null,
  getLastKnownAuthUid: () => null,
  signIn: vi.fn(),
}));

import { App } from './App';
import { _resetSideDrawerLoaderForTest } from './LazySideDrawer';
import { getDeferredInstallPrompt } from '@/features/pwa/pwa-install';

beforeEach(() => {
  drawer.props.length = 0;
  history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  _resetSideDrawerLoaderForTest();
});

describe('App 的延遲載入側邊選單', () => {
  it('點選單會打開、點關閉會收起；選單元件收到 App 的登入狀態', async () => {
    render(<App />);
    await waitFor(() => expect(drawer.props.length).toBeGreaterThan(0));
    expect(drawer.props[drawer.props.length - 1]?.open).toBe(false);
    expect(drawer.props[drawer.props.length - 1]?.user).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '選單' }));
    });
    await waitFor(() => expect(screen.getByTestId('drawer')).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    });
    await waitFor(() => expect(screen.queryByTestId('drawer')).toBeNull());
  });

  it('選單還沒下載前，開站就接住 beforeinstallprompt（選單的「安裝 APP」才叫得出原生安裝框）', async () => {
    // 讓選單永遠下載不完：證明綁定不是選單掛載時才做。
    _resetSideDrawerLoaderForTest(() => new Promise(() => undefined));
    render(<App />);
    const event = new Event('beforeinstallprompt', { cancelable: true });
    window.dispatchEvent(event);
    expect(getDeferredInstallPrompt()).toBe(event);
    expect(event.defaultPrevented).toBe(true);
    expect(drawer.props).toEqual([]);
  });
});
