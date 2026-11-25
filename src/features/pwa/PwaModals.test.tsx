import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { SideDrawer } from '@/ui/SideDrawer';
import { getToasts, toast } from '@/ui/Toast';
import { setLocale } from '@/i18n/i18n';
import {
  _setDeferredInstallPromptForTest,
  getDeferredInstallPrompt,
  type BeforeInstallPromptEvent,
} from './pwa-install';
import { PwaModals } from './PwaModals';

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
    // 安裝事件只能用一次，首頁浮球共用同一個事件：用過要清掉。
    expect(getDeferredInstallPrompt()).toBeNull();
  });

  it('無原生安裝提示時，點擊打開系統選擇彈窗，並可切換至 Android 與 iOS 教學（含 5 張教學圖，依步驟順序）', () => {
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
    expect(imgs).toEqual(['/PWA/PWA-ios-menu.jpg', '/PWA/PWA01.jpg', '/PWA/PWA-ios-more.jpg', '/PWA/PWA02.jpg', '/PWA/PWA03.jpg']);

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

  it('教學跟著語系：英文介面顯示英文、iOS 步驟含「≡」「View More」與「Open as Web App」', async () => {
    await setLocale('en');
    try {
      render(<PwaModals step="ios" onChangeStep={vi.fn()} />);
      const text = document.getElementById('pwa-ios-modal')!.textContent ?? '';
      expect(text).toContain('iPhone / iPad install guide');
      expect(text).toContain('Tap "≡" in the address bar');
      expect(text).toContain('Tap "View More"');
      expect(text).toContain('Keep "Open as Web App" turned on');
    } finally {
      await setLocale('zh-TW');
    }
  });

  it('繁中 iOS 教學：站長 11-25 實測後的 6 步（≡ → 分享 → 檢視較多 → 加入主畫面 → 打開為網頁 App），編號連續、圖與步驟對齊', async () => {
    await setLocale('zh-TW');
    render(<PwaModals step="ios" onChangeStep={vi.fn()} />);
    const modal = document.getElementById('pwa-ios-modal')!;
    const nums = Array.from(modal.querySelectorAll('.pwa-guide-num')).map((n) => n.textContent);
    expect(nums).toEqual(['1', '2', '3', '4', '5', '6']);
    const titles = Array.from(modal.querySelectorAll('.pwa-guide-step strong')).map((n) => n.textContent);
    expect(titles).toEqual([
      '複製網址',
      '點網址列左側的「≡」',
      '點選「分享」',
      '點「檢視較多」',
      '往下滑，點選「加入主畫面」',
      '確認「打開為網頁 App」已開啟',
    ]);
    const alts = Array.from(modal.querySelectorAll('img')).map((img) => img.getAttribute('alt'));
    expect(alts).toEqual(['步驟2', '步驟3', '步驟4', '步驟5', '步驟6']);
    expect(modal.textContent).toContain('底部若有分享圖示，點它跳到第 4 步');
  });
});
