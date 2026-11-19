import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetOverlayBackForTest } from '@/core/overlay-back';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { getMiniAppShareUrl } from '@/ui/mini-app-share-url';
import { isStandalonePwa } from '@/features/pwa/pwa-install';
import { isIosStandalone } from '@/data/login-redirect';
import { MobileLineLoginHintModal } from './MobileLineLoginHintModal';

vi.mock('@/ui/mini-app-share-url', () => ({
  getMiniAppShareUrl: () => 'https://miniapp.line.me/2008123456-AbCd',
}));

vi.mock('@/features/pwa/pwa-install', () => ({
  isStandalonePwa: vi.fn(() => false),
}));

// 測試同步更新：登入提示改版

beforeEach(async () => {
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
  vi.mocked(isStandalonePwa).mockReturnValue(false);
  setNavigator({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 0 });
});

afterEach(() => {
  cleanup();
  _resetOverlayBackForTest();
});

function setNavigator({ userAgent, maxTouchPoints }: { userAgent: string; maxTouchPoints: number }) {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

function renderOpen(onConfirm = vi.fn(), onCancel = vi.fn()) {
  render(
    <MobileLineLoginHintModal open onConfirm={onConfirm} onCancel={onCancel} />,
  );
  return { onConfirm, onCancel };
}

describe('MobileLineLoginHintModal', () => {
  it('主按鈕文字與 href 是 Mini App 網址，同分頁導向，並顯示使用說明', () => {
    renderOpen();

    const link = screen.getByRole('link', { name: '在 LINE App 中登入' });
    const url = getMiniAppShareUrl();
    expect(url).toBe('https://miniapp.line.me/2008123456-AbCd');
    expect(link.getAttribute('href')).toBe(url);
    expect(link.getAttribute('target')).toBeNull();
    expect(link.querySelector('path')?.getAttribute('d')).toContain('M12 3C6.48 3');
    expect(screen.getByText('之後都在 LINE 裡使用')).toBeTruthy();
  });

  it('次要按鈕呼叫 onConfirm，沒有複製連結，有瀏覽器登入說明', () => {
    const { onConfirm } = renderOpen();

    fireEvent.click(screen.getByRole('button', { name: '用目前瀏覽器登入' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '複製連結' })).toBeNull();
    expect(screen.queryByText('複製連結')).toBeNull();
    expect(screen.queryByText('選一種方式即可')).toBeNull();
    expect(screen.getByText('LINE 確認後回到這個瀏覽器')).toBeTruthy();
    expect(screen.queryByText('登入完成會開在新分頁，舊分頁可關閉')).toBeNull();
  });

  it('點背景不關閉，取消與 ✕ 會關閉', () => {
    const { onCancel } = renderOpen();
    fireEvent.click(document.getElementById('modal-overlay') as HTMLElement);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('關閉時不渲染', () => {
    render(<MobileLineLoginHintModal open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('旗標開啟時主畫面模式顯示按鈕', () => {
    setNavigator({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      maxTouchPoints: 5,
    });
    vi.mocked(isStandalonePwa).mockReturnValue(true);
    renderOpen();

    expect(screen.getByRole('link', { name: '在 LINE App 中登入' })).toBeTruthy();
    expect(screen.getByText('之後都在 LINE 裡使用')).toBeTruthy();
    expect(screen.getByRole('button', { name: '用目前瀏覽器登入' })).toBeTruthy();
    expect(screen.getByText('或')).toBeTruthy();
    expect(screen.getByText('在瀏覽器確認後回到 App')).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
  });

  const showBothScenarios: Array<[string, string, number, boolean]> = [
    ['Android standalone', 'Mozilla/5.0 (Linux; Android 13)', 5, true],
    ['iOS 非 standalone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5, false],
    ['桌機', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0, false],
  ];

  for (const [label, userAgent, maxTouchPoints, standalone] of showBothScenarios) {
    it(`${label} 時兩個按鈕都在`, () => {
      setNavigator({ userAgent, maxTouchPoints });
      vi.mocked(isStandalonePwa).mockReturnValue(standalone);
      renderOpen();

      expect(screen.getByRole('button', { name: '用目前瀏覽器登入' })).toBeTruthy();
      expect(screen.getByText('或')).toBeTruthy();
      expect(screen.getByText('LINE 確認後回到這個瀏覽器')).toBeTruthy();
    });
  }

  it('isIosStandalone 判斷各平台與 standalone', () => {
    expect(isIosStandalone('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', true, 5)).toBe(true);
    expect(isIosStandalone('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', true, 5)).toBe(true);
    expect(isIosStandalone('Mozilla/5.0 (iPod touch; CPU iPhone OS 17_0 like Mac OS X)', true, 5)).toBe(true);
    expect(isIosStandalone('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', true, 5)).toBe(true);
    expect(isIosStandalone('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', true, 1)).toBe(false);
    expect(isIosStandalone('Mozilla/5.0 (Linux; Android 13)', true, 5)).toBe(false);
    expect(isIosStandalone('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', false, 5)).toBe(false);
    expect(isIosStandalone('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', false, 0)).toBe(false);
  });
});

describe('主畫面 App 的瀏覽器登入小字（顧問 §3.339）', () => {
  it('iOS 主畫面模式顯示「回到 App」的小字，不寫「回到這個瀏覽器」', () => {
    setNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 });
    vi.mocked(isStandalonePwa).mockReturnValue(true);
    renderOpen();
    expect(screen.getByText('用目前瀏覽器登入')).toBeTruthy();
    const note = screen.getByText('在瀏覽器確認後回到 App');
    expect(note.getAttribute('data-i18n')).toBe('lineLoginHint.browserLoginNoteApp');
    expect(screen.queryByText('LINE 確認後回到這個瀏覽器')).toBeNull();
  });

  it('一般瀏覽器維持原本的小字', () => {
    setNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 });
    vi.mocked(isStandalonePwa).mockReturnValue(false);
    renderOpen();
    expect(screen.getByText('LINE 確認後回到這個瀏覽器')).toBeTruthy();
    expect(screen.queryByText('在瀏覽器確認後回到 App')).toBeNull();
  });
});
