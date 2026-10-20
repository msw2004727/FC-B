import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetRouteLoadingForTest,
  beginRouteLoading,
  endRouteLoading,
  getRouteFailureToast,
  getRouteLoadingCopy,
} from './route-loading';

describe('route-loading（M-047 換頁載入提示）', () => {
  afterEach(() => {
    _resetRouteLoadingForTest();
    vi.useRealTimers();
  });

  it('提示文字照 A 頁名', () => {
    expect(getRouteLoadingCopy('/activities')).toBe('正在載入活動列表...');
    expect(getRouteLoadingCopy('/events/e1')).toBe('正在載入活動詳情...');
    expect(getRouteLoadingCopy('/unknown')).toBe('資料載入中...');
  });

  it('220ms 後才出現、3.2 秒改成網路較慢、結束時至少顯示 280ms', () => {
    vi.useFakeTimers();
    const seq = beginRouteLoading({ path: '/teams' });
    const el = document.getElementById('status-hint');
    expect(el?.parentElement?.classList.contains('legacy-ui')).toBe(true);
    expect(el?.style.display).toBe('none');
    vi.advanceTimersByTime(230);
    expect(el?.style.display).toBe('inline-flex');
    expect(el?.textContent).toBe('正在載入俱樂部列表...');
    vi.advanceTimersByTime(3200);
    expect(el?.textContent).toBe('網路較慢，資料仍在載入中...');
    endRouteLoading(seq);
    expect(el?.style.display).toBe('none');
  });

  it('逾時與失敗提示照 A 文字', () => {
    expect(getRouteFailureToast('/activities', { code: 'route-step-timeout' })).toBe(
      '網路較慢，活動頁暫時無法開啟，請稍後再試',
    );
    expect(getRouteFailureToast('/teams', { code: 'route-step-timeout' })).toBe(
      '網路較慢，頁面暫時無法開啟，請稍後再試',
    );
    expect(getRouteFailureToast('/teams', new Error('x'))).toBe('頁面載入失敗，請稍後再試');
  });
});
