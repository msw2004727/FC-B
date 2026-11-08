import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  EVENT_DETAIL_SESSION_TTL_MS,
  loadEventDetailThroughSessionCache,
  type SessionDetailCacheEntry,
} from './event-detail-session-cache';

function cache(): Map<string, SessionDetailCacheEntry<{ n: number }>> {
  return new Map();
}

describe('loadEventDetailThroughSessionCache', () => {
  it('30 秒內同 publicId 只讀一次，進行中與剛完成都算', async () => {
    const store = cache();
    let resolve!: (value: { n: number } | null) => void;
    const load = vi.fn(() => new Promise<{ n: number } | null>((done) => {
      resolve = done;
    }));
    const start = 1_000;
    const first = loadEventDetailThroughSessionCache(store, 'abc', 0, load, start);
    const inflight = loadEventDetailThroughSessionCache(store, 'abc', 0, load, start + 1);
    expect(inflight).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    resolve({ n: 1 });
    await expect(first).resolves.toEqual({ n: 1 });
    const again = loadEventDetailThroughSessionCache(
      store,
      'abc',
      0,
      load,
      start + EVENT_DETAIL_SESSION_TTL_MS - 1,
    );
    expect(again).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    await expect(again).resolves.toEqual({ n: 1 });
  });

  it('滿 30 秒重讀', async () => {
    const store = cache();
    const load = vi.fn(async () => ({ n: 1 }));
    const start = 5_000;
    await loadEventDetailThroughSessionCache(store, 'abc', 0, load, start);
    await loadEventDetailThroughSessionCache(store, 'abc', 0, load, start + EVENT_DETAIL_SESSION_TTL_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reload 不是 0 時不讀也不寫快取，已有的成功項目留著', async () => {
    const store = cache();
    const load = vi.fn(async () => ({ n: 1 }));
    await loadEventDetailThroughSessionCache(store, 'abc', 1, load, 0);
    expect(store.size).toBe(0);
    store.set('abc', { at: 0, promise: Promise.resolve({ n: 9 }) });
    await expect(loadEventDetailThroughSessionCache(store, 'abc', 2, load, 10)).resolves.toEqual({ n: 1 });
    expect(load).toHaveBeenCalledTimes(2);
    await expect(loadEventDetailThroughSessionCache(store, 'abc', 0, load, 10)).resolves.toEqual({ n: 9 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('讀取失敗不快取，resolve null 要快取', async () => {
    const store = cache();
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(null);
    await expect(loadEventDetailThroughSessionCache(store, 'abc', 0, load, 0)).rejects.toThrow('offline');
    expect(store.size).toBe(0);
    await expect(loadEventDetailThroughSessionCache(store, 'abc', 0, load, 1)).resolves.toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    await expect(loadEventDetailThroughSessionCache(store, 'abc', 0, load, 2)).resolves.toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('同步丟出不快取', async () => {
    const store = cache();
    const load = vi.fn(() => {
      throw new Error('sync');
    });
    await expect(loadEventDetailThroughSessionCache(store, 'abc', 0, load, 0)).rejects.toThrow('sync');
    expect(store.size).toBe(0);
    await expect(loadEventDetailThroughSessionCache(store, 'abc', 0, load, 1)).rejects.toThrow('sync');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('頁面保留 uid key，只有第一次載入走這層快取', () => {
    const page = readFileSync(resolve(__dirname, '../pages/EventDetailPage.tsx'), 'utf8');
    expect(page).toContain('key={`${routeId}:${viewer.uid ?? \'guest\'}`}');
    expect(page.match(/loadEventDetailThroughSessionCache\(/g)).toHaveLength(2);
    expect(page.match(/loadEventDetail\(/g)).toHaveLength(3);
    expect(page).toContain("setRosterPhase('ready')");
    expect(page).toContain('rosterAutoHold.current = true');
    expect(page).toContain('useState(Boolean(viewer.uid))');
    expect(page.match(/setPhase\('ready'\)/g)).toHaveLength(1);
  });
});
