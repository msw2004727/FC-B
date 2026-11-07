import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetOverlayBackForTest } from '@/core/overlay-back';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { getMiniAppShareUrl } from '@/ui/drawer-menu';
import { MobileLineLoginHintModal } from './MobileLineLoginHintModal';

vi.mock('@/ui/drawer-menu', () => ({
  getMiniAppShareUrl: () => 'https://miniapp.line.me/2008123456-AbCd',
}));

// 測試同步更新：登入提示改版

beforeEach(async () => {
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  _resetOverlayBackForTest();
});

function renderOpen(onConfirm = vi.fn(), onCancel = vi.fn()) {
  render(
    <MobileLineLoginHintModal open onConfirm={onConfirm} onCancel={onCancel} />,
  );
  return { onConfirm, onCancel };
}

describe('MobileLineLoginHintModal', () => {
  it('主按鈕文字與 href 是 Mini App 網址，同分頁導向', () => {
    renderOpen();

    const link = screen.getByRole('link', { name: '在 LINE App 開啟' });
    const url = getMiniAppShareUrl();
    expect(url).toBe('https://miniapp.line.me/2008123456-AbCd');
    expect(link.getAttribute('href')).toBe(url);
    expect(link.getAttribute('target')).toBeNull();
    expect(link.querySelector('path')?.getAttribute('d')).toContain('M12 3C6.48 3');
  });

  it('次要按鈕呼叫 onConfirm，沒有複製連結，有新分頁說明', () => {
    const { onConfirm } = renderOpen();

    fireEvent.click(screen.getByRole('button', { name: '前往 LINE 登入頁' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '複製連結' })).toBeNull();
    expect(screen.queryByText('複製連結')).toBeNull();
    expect(screen.queryByText('選一種方式即可')).toBeNull();
    expect(screen.getByText('登入完成會開在新分頁，舊分頁可關閉')).toBeTruthy();
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
});
