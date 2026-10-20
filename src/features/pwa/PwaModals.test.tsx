import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { SideDrawer } from '@/ui/SideDrawer';
import { getToasts, toast } from '@/ui/Toast';
import {
  _setDeferredInstallPromptForTest,
  type BeforeInstallPromptEvent,
} from './pwa-install';

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string) => key,
}));

beforeEach(() => {
  toast.clear();
  _setDeferredInstallPromptForTest(null);
});

afterEach(() => {
  cleanup();
  toast.clear();
  _setDeferredInstallPromptForTest(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PWA Install button and Modals (M-030, M-031, U-007)', () => {
  it('抽屜「下載APP」按鈕永遠顯示（無 display:none）', () => {
    render(
      <LocationProvider>
        <SideDrawer open onClose={vi.fn()} />
      </LocationProvider>,
    );
    const btn = document.getElementById('pwa-install-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.style.display).not.toBe('none');
  });

  it('有原生安裝提示（beforeinstallprompt）時，點擊直接呼叫 prompt()，不開系統選擇彈窗', () => {
    const promptFn = vi.fn().mockResolvedValue(undefined);
    const fakeEvent = {
      prompt: promptFn,
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
    } as unknown as BeforeInstallPromptEvent;
    _setDeferredInstallPromptForTest(fakeEvent);

    render(
      <LocationProvider>
        <SideDrawer open onClose={vi.fn()} />
      </LocationProvider>,
    );
    fireEvent.click(document.getElementById('pwa-install-btn')!);
    expect(promptFn).toHaveBeenCalledTimes(1);
    expect(document.getElementById('pwa-system-picker')).toBeNull();
  });

  it('無原生安裝提示時，點擊打開系統選擇彈窗，並可切換至 Android 與 iOS 教學（含 /PWA/PWA01~03.jpg）', () => {
    render(
      <LocationProvider>
        <SideDrawer open onClose={vi.fn()} />
      </LocationProvider>,
    );
    fireEvent.click(document.getElementById('pwa-install-btn')!);
    expect(document.getElementById('pwa-system-picker')).not.toBeNull();

    // 切換到 Android 教學
    fireEvent.click(document.getElementById('pwa-pick-android')!);
    expect(document.getElementById('pwa-system-picker')).toBeNull();
    expect(document.getElementById('pwa-android-modal')).not.toBeNull();
    fireEvent.click(document.getElementById('pwa-android-close')!);
    expect(document.getElementById('pwa-android-modal')).toBeNull();

    // 再次點開並切換到 iOS 教學
    fireEvent.click(document.getElementById('pwa-install-btn')!);
    fireEvent.click(document.getElementById('pwa-pick-ios')!);
    const iosModal = document.getElementById('pwa-ios-modal')!;
    expect(iosModal).not.toBeNull();
    const imgs = Array.from(iosModal.querySelectorAll('img')).map((img) => img.getAttribute('src'));
    expect(imgs).toEqual(['/PWA/PWA01.jpg', '/PWA/PWA02.jpg', '/PWA/PWA03.jpg']);

    fireEvent.click(document.getElementById('pwa-ios-close')!);
    expect(document.getElementById('pwa-ios-modal')).toBeNull();
  });

  it('U-007：已安裝（display-mode: standalone）時點「下載APP」先提示「你已在使用 APP 版」再打開教學選擇窗', () => {
    // jsdom 沒有 matchMedia，用 stubGlobal 提供（spyOn 只能監看已存在的函式）。
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    render(
      <LocationProvider>
        <SideDrawer open onClose={vi.fn()} />
      </LocationProvider>,
    );
    fireEvent.click(document.getElementById('pwa-install-btn')!);
    expect(getToasts().some((t) => t.message === '你已在使用 APP 版')).toBe(true);
    expect(document.getElementById('pwa-system-picker')).not.toBeNull();
  });
});
