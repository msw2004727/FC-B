import { describe, expect, it, vi } from 'vitest';
import { handleChunkLoadFailure } from './chunk-reload';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
  };
}

describe('handleChunkLoadFailure', () => {
  it('第一次失敗：重載並回傳 true', () => {
    const reload = vi.fn();
    expect(handleChunkLoadFailure({ storage: memoryStorage(), now: () => 1_000_000, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('60 秒內第二次失敗：不重載，讓錯誤照常顯示', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    handleChunkLoadFailure({ storage, now: () => 1_000_000, reload });
    expect(handleChunkLoadFailure({ storage, now: () => 1_030_000, reload })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('超過 60 秒後再失敗：可再重載一次', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    handleChunkLoadFailure({ storage, now: () => 1_000_000, reload });
    expect(handleChunkLoadFailure({ storage, now: () => 1_061_000, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('沒有 sessionStorage：不重載（無法防止迴圈）', () => {
    const reload = vi.fn();
    expect(handleChunkLoadFailure({ storage: null, now: () => 1, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
