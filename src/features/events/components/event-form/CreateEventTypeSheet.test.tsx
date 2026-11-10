import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import { CreateEventTypeSheet } from './CreateEventTypeSheet';

const sheetCss = readFileSync(resolve(__dirname, 'create-event-type-sheet.css'), 'utf8');

const mocks = vi.hoisted(() => ({
  show: vi.fn(),
  allowed: true,
  back: null as null | (() => boolean),
  release: vi.fn(),
}));

vi.mock('@/ui/Toast', () => ({ toast: { show: mocks.show } }));
vi.mock('@/core/overlay-back', () => ({
  pushOverlay: (callback: () => boolean) => {
    mocks.back = callback;
    return mocks.release;
  },
}));
vi.mock('../../data/event-create-guard', () => ({
  canCreateEvent: () => mocks.allowed,
}));
vi.mock('../../data/event-create-context', () => ({
  createEventContextFromViewer: () => ({}),
}));

// ASSUMPTION: 附件未提供 ViewerView 完整欄位；測試只使用本卡讀取的欄位。
const viewer = { uid: 'u1', role: 'coach', displayName: '主辦人' } as ViewerView;

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  mocks.allowed = true;
  mocks.back = null;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('CreateEventTypeSheet', () => {
  it('逐字輸出 A 的文字、停用屬性與 portal', () => {
    render(
      <CreateEventTypeSheet open viewer={viewer} onClose={vi.fn()} onCustom={vi.fn()} />,
    );
    for (const text of [
      '選擇活動類型',
      '自訂活動',
      '建立可報名的活動（含人數、費用等設定）',
      '活動連結',
      '連結外部平台活動，點擊直接跳轉',
      '取消',
    ]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    const overlay = document.getElementById('create-event-type-sheet');
    expect(overlay?.parentElement?.className).toBe('legacy-ui');
    expect(overlay?.parentElement?.parentElement).toBe(document.body);
    const external = document.getElementById('cets-external');
    expect(external?.getAttribute('aria-disabled')).toBe('true');
    expect(external?.getAttribute('data-feature-locked')).toBe('true');
    expect(external?.classList.contains('cets-option-lock')).toBe(true);
    expect(external?.getAttribute('style')).toBeNull();
  });

  it('活動連結只顯示尚未開放', () => {
    const close = vi.fn();
    const custom = vi.fn();
    render(<CreateEventTypeSheet open viewer={viewer} onClose={close} onCustom={custom} />);
    fireEvent.click(screen.getByText('活動連結'));
    expect(mocks.show).toHaveBeenCalledWith({ message: '功能尚未開放' });
    expect(close).not.toHaveBeenCalled();
    expect(custom).not.toHaveBeenCalled();
  });

  it('自訂活動先關 sheet 再開表單', () => {
    const calls: string[] = [];
    render(
      <CreateEventTypeSheet
        open
        viewer={viewer}
        onClose={() => calls.push('close')}
        onCustom={() => calls.push('custom')}
      />,
    );
    fireEvent.click(screen.getByText('自訂活動'));
    expect(calls).toEqual(['close', 'custom']);
  });

  it('取消、遮罩與返回鍵可關閉；sheet 內容不誤關', () => {
    const close = vi.fn();
    const view = render(
      <CreateEventTypeSheet open viewer={viewer} onClose={close} onCustom={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('選擇活動類型'));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('取消'));
    expect(close).toHaveBeenCalledTimes(1);
    const overlay = document.getElementById('create-event-type-sheet');
    if (!overlay) throw new Error('缺少 sheet');
    fireEvent.click(overlay);
    expect(close).toHaveBeenCalledTimes(2);
    expect(mocks.back?.()).toBe(true);
    expect(close).toHaveBeenCalledTimes(3);
    view.unmount();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('沒有權限不開 sheet，並顯示 A 原文', () => {
    mocks.allowed = false;
    const close = vi.fn();
    render(
      <CreateEventTypeSheet open viewer={viewer} onClose={close} onCustom={vi.fn()} />,
    );
    expect(document.getElementById('create-event-type-sheet')).toBeNull();
    expect(mocks.show).toHaveBeenCalledWith({
      message: '權限不足：需要建立活動權限',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('顯示後權限撤銷，handler 仍拒絕建立', () => {
    const custom = vi.fn();
    render(
      <CreateEventTypeSheet open viewer={viewer} onClose={vi.fn()} onCustom={custom} />,
    );
    mocks.allowed = false;
    fireEvent.click(screen.getByText('自訂活動'));
    expect(custom).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledWith({
      message: '權限不足：需要建立活動權限',
    });
  });

  it('銅金面板 class：橫槓、兩個選項、取消，沒有 emoji，鎖頭只在活動連結', () => {
    render(
      <CreateEventTypeSheet open viewer={viewer} onClose={vi.fn()} onCustom={vi.fn()} />,
    );
    const overlay = document.getElementById('create-event-type-sheet');
    if (!overlay) throw new Error('缺少 sheet');
    expect(overlay.classList.contains('cets-overlay')).toBe(true);
    expect(overlay.getAttribute('style')).toBeNull();
    expect(overlay.querySelector('.cets-panel')).toBeTruthy();
    expect(overlay.querySelector('.cets-grab')).toBeTruthy();
    expect(overlay.querySelectorAll('.cets-option').length).toBe(2);
    expect(document.getElementById('cets-cancel')?.classList.contains('cets-cancel')).toBe(true);

    const custom = document.getElementById('cets-custom');
    const external = document.getElementById('cets-external');
    expect(custom?.classList.contains('cets-option-main')).toBe(true);
    expect(custom?.querySelector('.cets-chev')).toBeTruthy();
    expect(custom?.querySelector('.cets-lock')).toBeNull();
    expect(external?.getAttribute('aria-disabled')).toBe('true');
    expect(external?.querySelector('.cets-lock')).toBeTruthy();
    expect(external?.querySelector('.cets-chev')).toBeNull();

    const html = overlay.innerHTML;
    expect(html).not.toContain('📋');
    expect(html).not.toContain('🔗');
    expect(overlay.querySelectorAll('svg').length).toBe(4);
    for (const svg of overlay.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('樣式檔含減少動態、webkit 毛玻璃與不支援 backdrop-filter 的退回', () => {
    expect(sheetCss).toContain('prefers-reduced-motion');
    expect(sheetCss).toContain('-webkit-backdrop-filter');
    expect(sheetCss).toContain('@supports not');
    expect(sheetCss).toContain('blur(18px) saturate(160%)');
    expect(sheetCss).toContain('rgba(17,24,39,.95)');
    expect(sheetCss).toContain('rgba(0,0,0,.6)');
    expect(sheetCss).toContain('position: fixed');
    expect(sheetCss).toContain('z-index: 1300');
    expect(sheetCss).toContain('animation-delay: .10s');
    expect(sheetCss).toContain('animation-delay: .18s');
    expect(sheetCss).toContain('站長 2026-11-10 選定 B 銅金；R-UI-005 例外');
  });
});
