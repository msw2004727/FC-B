import { beforeEach, describe, expect, it, vi } from 'vitest';
import { incrementEventViewCount, mergeViewCount, validViewCountResponse } from './event-view-count';

const mocks = vi.hoisted(() => ({ callFn: vi.fn(), getCurrentUser: vi.fn() }));
vi.mock('@/data/callables', () => ({ callFn: mocks.callFn }));
vi.mock('@/data/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockReturnValue({ uid: 'u' });
});

describe('M-090：瀏覽數', () => {
  it('拒絕不合法回傳，顯示取最大值', () => {
    expect(validViewCountResponse({ incremented: false, viewCount: 0 })).toBe(true);
    for (const value of [
      null, {}, { incremented: true, viewCount: -1 },
      { incremented: true, viewCount: 1.2 }, { incremented: 'yes', viewCount: 2 },
    ]) expect(validViewCountResponse(value)).toBe(false);
    expect(mergeViewCount(9, 3, '12', undefined)).toBe(12);
  });

  it('訪客不呼叫；使用 public ID 與文件 ID', async () => {
    expect(await incrementEventViewCount(null, 'public', 'doc')).toBeNull();
    expect(mocks.callFn).not.toHaveBeenCalled();
    mocks.callFn.mockResolvedValue({ incremented: true, viewCount: 4 });
    await incrementEventViewCount('u', 'public', 'doc');
    expect(mocks.callFn).toHaveBeenCalledWith('incrementEventViewCount', {
      eventId: 'public', docId: 'doc',
    });
  });

  it('同 UID 活動飛行中只呼叫一次；完成後可再送', async () => {
    let resolve!: (value: { incremented: boolean; viewCount: number }) => void;
    mocks.callFn.mockReturnValue(new Promise(done => { resolve = done; }));
    const first = incrementEventViewCount('u', 'same', 'doc');
    const second = incrementEventViewCount('u', 'same', 'doc');
    expect(second).toBe(first);
    await vi.waitFor(() => expect(mocks.callFn).toHaveBeenCalledTimes(1));
    resolve({ incremented: true, viewCount: 5 });
    await first;
    mocks.callFn.mockResolvedValue({ incremented: false, viewCount: 5 });
    await incrementEventViewCount('u', 'same', 'doc');
    expect(mocks.callFn).toHaveBeenCalledTimes(2);
  });

  it('失敗清除飛行中狀態，第二次成功', async () => {
    mocks.callFn.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ incremented: true, viewCount: 6 });
    expect(await incrementEventViewCount('u', 'retry', 'doc')).toBeNull();
    expect(await incrementEventViewCount('u', 'retry', 'doc'))
      .toEqual({ incremented: true, viewCount: 6 });
  });

  it('呼叫前 UID 已改變不送出', async () => {
    mocks.getCurrentUser.mockReturnValue({ uid: 'other' });
    expect(await incrementEventViewCount('u', 'changed', 'doc')).toBeNull();
    expect(mocks.callFn).not.toHaveBeenCalled();
  });

  it('回傳前登出不交付結果', async () => {
    let resolve!: (value: { incremented: boolean; viewCount: number }) => void;
    mocks.callFn.mockReturnValue(new Promise(done => { resolve = done; }));
    const pending = incrementEventViewCount('u', 'logout', 'doc');
    await vi.waitFor(() => expect(mocks.callFn).toHaveBeenCalledTimes(1));
    mocks.getCurrentUser.mockReturnValue(null);
    resolve({ incremented: true, viewCount: 7 });
    expect(await pending).toBeNull();
  });
});
