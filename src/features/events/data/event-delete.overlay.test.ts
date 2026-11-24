import { afterEach, describe, expect, it } from 'vitest';
import { markHistoryRoot } from '@/core/back-guard';
import { _resetOverlayBackForTest, pushOverlay } from '@/core/overlay-back';
import { waitOverlayReleased } from './event-delete';

// 活動內頁快速刪除（站長 11-24）：刪除成功 → 關確認框 → 等它那筆同網址歷史紀錄退掉 → goBack。
// 直接從外部連結進站（沒有上一頁）時，退掉後目前紀錄要是本站起點，goBack 才會改走活動列表（取代），不會留下已刪除的活動。
afterEach(() => _resetOverlayBackForTest());

describe('waitOverlayReleased', () => {
  it('直接進站：確認框關閉後等到那筆紀錄退掉，目前紀錄回到起點', async () => {
    markHistoryRoot();
    const release = pushOverlay(() => true);
    expect((history.state as Record<string, unknown>).__overlay).toBeTypeOf('number');
    release();
    // 釋放是下一刻才退，這時仍停在確認框那筆（它也帶著起點標記，直接 goBack 會取代錯的那筆）。
    expect((history.state as Record<string, unknown>).__overlay).toBeTypeOf('number');
    expect(await waitOverlayReleased()).toBe(true);
    const state = history.state as Record<string, unknown>;
    expect(state.__overlay).toBeUndefined();
    expect(state.__fcbRoot).toBe(true);
  });

  it('沒有確認框紀錄時立刻返回 true', async () => {
    const start = Date.now();
    expect(await waitOverlayReleased()).toBe(true);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('逾時仍沒退掉回 false（呼叫端改走活動列表）', async () => {
    pushOverlay(() => true);
    expect(await waitOverlayReleased(40)).toBe(false);
  });
});
