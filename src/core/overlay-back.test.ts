import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetOverlayBackForTest, pushOverlay } from './overlay-back';

function firePop(): PopStateEvent {
  const event = new PopStateEvent('popstate', { state: history.state });
  window.dispatchEvent(event);
  return event;
}

describe('overlay-back（U-011 返回鍵先關彈窗）', () => {
  afterEach(() => {
    _resetOverlayBackForTest();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('開彈窗推一筆同網址紀錄，返回鍵只關最上層彈窗、不讓路由收到', () => {
    const href = location.href;
    const push = vi.spyOn(history, 'pushState');
    const lower = vi.fn(() => true);
    const upper = vi.fn(() => true);
    pushOverlay(lower);
    pushOverlay(upper);
    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[0]?.[2]).toBe(href);

    const router = vi.fn();
    window.addEventListener('popstate', router);
    firePop();
    window.removeEventListener('popstate', router);
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
    expect(router).not.toHaveBeenCalled();
  });

  it('送出中回傳 false 時保持開啟並補回一筆紀錄', () => {
    const push = vi.spyOn(history, 'pushState');
    const onBack = vi.fn(() => false);
    pushOverlay(onBack);
    firePop();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(2);
    firePop();
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('用按鈕關閉時退掉那筆紀錄，退回產生的 popstate 不會傳給路由', () => {
    vi.useFakeTimers();
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const release = pushOverlay(() => true);
    release();
    vi.runAllTimers();
    expect(back).toHaveBeenCalledTimes(1);

    const router = vi.fn();
    window.addEventListener('popstate', router);
    firePop();
    window.removeEventListener('popstate', router);
    expect(router).not.toHaveBeenCalled();
  });

  it('關掉後馬上開下一個彈窗時沿用同一筆紀錄，不來回推退', () => {
    vi.useFakeTimers();
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const replace = vi.spyOn(history, 'replaceState');
    const release = pushOverlay(() => true);
    release();
    pushOverlay(() => true);
    vi.runAllTimers();
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('關閉後已換頁就不退紀錄', () => {
    vi.useFakeTimers();
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const release = pushOverlay(() => true);
    release();
    history.pushState({}, '', '/events/x');
    vi.runAllTimers();
    expect(back).not.toHaveBeenCalled();
    history.replaceState({}, '', '/');
  });
});
