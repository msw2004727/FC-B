// 刪除流程和 core/overlay-back 的耦合：鍵名、等確認框那筆歷史紀錄退掉。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetOverlayBackForTest, pushOverlay } from '@/core/overlay-back';
import { OVERLAY_STATE_KEY, waitOverlayReleased } from './delete-competition';

afterEach(() => {
  _resetOverlayBackForTest();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('overlay-back 的 history.state 鍵名', () => {
  it('用公開 API 打開一層 overlay，history.state 帶著刪除流程寫死的鍵名', () => {
    history.replaceState(null, '', '/competitions/cup');
    const release = pushOverlay(() => true);
    expect(history.state).toHaveProperty(OVERLAY_STATE_KEY);
    expect(OVERLAY_STATE_KEY).toBe('__overlay');
    release();
  });
});

describe('waitOverlayReleased', () => {
  it('overlay 還沒退完：等到那筆紀錄退掉才 resolve，之後的取代蓋到詳情那筆', async () => {
    history.replaceState(null, '', '/tournaments');
    history.pushState(null, '', '/competitions/cup');
    const release = pushOverlay(() => true);
    release();
    // 退回在下一刻才發生；這時還帶著鍵名。
    expect(history.state).toHaveProperty(OVERLAY_STATE_KEY);
    let done = false;
    const wait = waitOverlayReleased(2000).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    await wait;
    expect(history.state?.[OVERLAY_STATE_KEY]).toBeUndefined();
    expect(location.pathname).toBe('/competitions/cup');
    history.replaceState(null, '', '/tournaments');
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(location.pathname).toBe('/tournaments');
  });

  it('已經退完（或沒有 overlay）：立刻 resolve，不等', async () => {
    history.replaceState(null, '', '/competitions/cup');
    const timer = vi.spyOn(globalThis, 'setTimeout');
    await waitOverlayReleased();
    expect(timer).not.toHaveBeenCalled();
  });

  it('退不掉（history.back 無效）時最多等 maxMs', async () => {
    vi.spyOn(history, 'back').mockImplementation(() => undefined);
    const release = pushOverlay(() => true);
    release();
    const t0 = Date.now();
    await waitOverlayReleased(120);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(history.state).toHaveProperty(OVERLAY_STATE_KEY);
  });
});
