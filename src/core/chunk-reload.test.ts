import { describe, expect, it, vi } from 'vitest';
import { createChunkReloadGuard, handleChunkLoadFailure, settleRouteLoad } from './chunk-reload';

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

describe('createChunkReloadGuard（DIAG-IOS-IMPORT 修法 B）', () => {
  function setup(start = 1_000_000) {
    const storage = memoryStorage();
    const reload = vi.fn();
    const onStuck = vi.fn();
    let now = start;
    let hidden = false;
    const guard = createChunkReloadGuard(
      { storage, now: () => now, reload },
      () => hidden,
      { readState: () => ({ vis: hidden ? 'hidden' : 'visible', leaving: false }), onStuck },
    );
    return {
      guard,
      reload,
      onStuck,
      storage,
      setHidden: (value: boolean) => { hidden = value; },
      advance: (ms: number) => { now += ms; },
    };
  }

  it('可見時第一次失敗：照舊重載一次並要求擋錯', () => {
    const t = setup();
    expect(t.guard.onPreloadError()).toBe(true);
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('隱藏時失敗：不重載、不擋錯，也不記重載時間', () => {
    const t = setup();
    t.setHidden(true);
    expect(t.guard.onPreloadError()).toBe(false);
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.storage.getItem('fcb:chunk-reload-at')).toBeNull();
  });

  it('隱藏時失敗、回前景：照第一次失敗規則重載一次，之後再回前景不重複', () => {
    const t = setup();
    t.setHidden(true);
    t.guard.onPreloadError();
    t.guard.onPreloadError();
    expect(t.guard.onForeground()).toBe(false); // 還在背景
    t.setHidden(false);
    expect(t.guard.onForeground()).toBe(true);
    expect(t.reload).toHaveBeenCalledTimes(1);
    expect(t.guard.onForeground()).toBe(false);
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('背景中沒有失敗過：回前景什麼都不做', () => {
    const t = setup();
    expect(t.guard.onForeground()).toBe(false);
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('重載後 60 秒內在背景失敗、回前景：不再重載（畫面維持重試），避免無限重載', () => {
    const t = setup();
    t.guard.onPreloadError(); // 可見時第一次失敗 → 重載
    expect(t.reload).toHaveBeenCalledTimes(1);
    t.advance(5_000);
    t.setHidden(true);
    t.guard.onPreloadError();
    t.advance(5_000);
    t.setHidden(false);
    expect(t.guard.onForeground()).toBe(false);
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('P2-1：回前景因 60 秒窗口不重載時補報一筆，帶延後當下的 vis／leaving 與等待毫秒數', () => {
    const t = setup();
    t.guard.onPreloadError(); // 可見時第一次失敗 → 重載
    t.advance(5_000);
    t.setHidden(true);
    const first = new TypeError('Importing a module script failed.');
    t.guard.onPreloadError(first);
    t.advance(1_000);
    t.guard.onPreloadError(new TypeError('second')); // 只記第一筆
    t.advance(2_000);
    expect(t.onStuck).not.toHaveBeenCalled(); // 背景當下不報
    t.setHidden(false);
    expect(t.guard.onForeground()).toBe(false);
    expect(t.onStuck).toHaveBeenCalledTimes(1);
    expect(t.onStuck).toHaveBeenCalledWith({ error: first, vis: 'hidden', leaving: false, waitMs: 3_000 });
  });

  it('回前景有重載時不補報', () => {
    const t = setup();
    t.setHidden(true);
    t.guard.onPreloadError(new TypeError('x'));
    t.setHidden(false);
    expect(t.guard.onForeground()).toBe(true);
    expect(t.onStuck).not.toHaveBeenCalled();
  });

  it('P3：延後超過 5 分鐘才回前景，作廢不重載（仍補報，waitMs 可分辨）', () => {
    const t = setup();
    t.setHidden(true);
    t.guard.onPreloadError(new TypeError('x'));
    t.advance(5 * 60_000 + 1);
    t.setHidden(false);
    expect(t.guard.onForeground()).toBe(false);
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.storage.getItem('fcb:chunk-reload-at')).toBeNull();
    expect(t.onStuck).toHaveBeenCalledWith(expect.objectContaining({ waitMs: 5 * 60_000 + 1 }));
    // 作廢後不再殘留：之後回前景什麼都不做。
    expect(t.guard.onForeground()).toBe(false);
    expect(t.onStuck).toHaveBeenCalledTimes(1);
  });

  it('延後剛好 5 分鐘：仍照第一次失敗規則重載', () => {
    const t = setup();
    t.setHidden(true);
    t.guard.onPreloadError();
    t.advance(5 * 60_000);
    t.setHidden(false);
    expect(t.guard.onForeground()).toBe(true);
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('重載後 60 秒內可見時再失敗：不重載、不擋錯（錯誤交給重試畫面與上報）', () => {
    const t = setup();
    t.guard.onPreloadError();
    t.advance(30_000);
    expect(t.guard.onPreloadError()).toBe(false);
    expect(t.reload).toHaveBeenCalledTimes(1);
  });
});

describe('settleRouteLoad', () => {
  it('載入成功：原樣回傳模組', async () => {
    const Page = () => null;
    const mod = { default: Page };
    await expect(settleRouteLoad(Promise.resolve(mod))).resolves.toBe(mod);
  });

  it('載入失敗：不 reject，改回傳畫出時丟出原錯誤的元件', async () => {
    const error = new TypeError('Importing a module script failed.');
    const mod = await settleRouteLoad(Promise.reject(error));
    expect(() => (mod.default as () => unknown)()).toThrow(error);
  });

  it('拿到 undefined（preloadError 已擋下等重載）：維持載入中，不 resolve 也不 reject', async () => {
    let state = 'pending';
    settleRouteLoad(Promise.resolve(undefined)).then(
      () => { state = 'resolved'; },
      () => { state = 'rejected'; },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state).toBe('pending');
  });
});
