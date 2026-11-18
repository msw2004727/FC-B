import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n/i18n';
import { RELOAD_AT_KEY, _resetChunkReloadGuardForTest, handleChunkLoadFailure, installChunkReloadGuard } from './chunk-reload';
import { _resetReloadSafetyForTest, canReloadAfterChunkFailure } from './reload-safety';
import { _resetSubmitGuardForTest, beginSubmitting } from './submit-guard';
import { _resetRouteLoadPendingForTest, beginRouteLoad } from './route-load-pending';

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

describe('顧問 §3.255 C′：不能自動重載時（以下在路由載入中）', () => {
  beforeEach(() => {
    beginRouteLoad();
  });

  afterEach(() => {
    _resetSubmitGuardForTest();
    _resetReloadSafetyForTest();
    _resetRouteLoadPendingForTest();
    document.body.innerHTML = '';
  });

  it('路由載入中剛好遇到背景預載失敗：判斷不分來源，會重載一次（預期內，顧問 §3.263）；60 秒內不再重載', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const deps = {
      storage,
      now: () => 1_000_000,
      reload,
      canReload: () => canReloadAfterChunkFailure({ currentPath: '/events/e1' }).safe,
      onBlocked: vi.fn(),
    };
    expect(handleChunkLoadFailure(deps)).toBe(true);
    expect(handleChunkLoadFailure(deps)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('送出中不重載：不寫時間戳、回傳 false（不 preventDefault）、改呼叫 onBlocked', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const onBlocked = vi.fn();
    const end = beginSubmitting('signup');
    const handled = handleChunkLoadFailure({
      storage,
      now: () => 1_000_000,
      reload,
      canReload: () => canReloadAfterChunkFailure({ currentPath: '/events/e1' }).safe,
      onBlocked,
    });
    end();
    expect(handled).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.getItem(RELOAD_AT_KEY)).toBeNull();
    expect(onBlocked).toHaveBeenCalledWith(reload);
  });

  it('被擋下後送出結束再失敗：仍有那一次自動重載', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const deps = {
      storage,
      now: () => 1_000_000,
      reload,
      canReload: () => canReloadAfterChunkFailure({ currentPath: '/events/e1' }).safe,
      onBlocked: vi.fn(),
    };
    const end = beginSubmitting('signup');
    expect(handleChunkLoadFailure(deps)).toBe(false);
    end();
    expect(handleChunkLoadFailure(deps)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(RELOAD_AT_KEY)).toBe('1000000');
  });

  it('/events/<id> 安全時自動重載並寫時間戳；60 秒內第二次不重載、改出中性提示（顧問 §3.268 乙）', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const onBlocked = vi.fn();
    let now = 1_000_000;
    const deps = {
      storage,
      now: () => now,
      reload,
      canReload: () => canReloadAfterChunkFailure({ currentPath: '/events/e1' }).safe,
      onBlocked,
    };
    expect(handleChunkLoadFailure(deps)).toBe(true);
    now += 30_000;
    expect(handleChunkLoadFailure(deps)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledWith(reload);
    expect(storage.getItem(RELOAD_AT_KEY)).toBe('1000000');
  });
});

describe('sessionStorage 讀取丟錯（Flash 差異審 P2）', () => {
  it('讀不到時間戳、寫入卻成功的 storage：連續失敗都不自動重載、不寫入（fail-closed）', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: () => { throw new Error('read denied'); },
      setItem: (k: string, v: string) => { map.set(k, v); },
    };
    const reload = vi.fn();
    const onBlocked = vi.fn();
    const deps = { storage, now: () => 1_000_000, reload, canReload: () => true, onBlocked };
    expect(handleChunkLoadFailure(deps)).toBe(false);
    expect(handleChunkLoadFailure(deps)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });

  it('deps.now 丟錯：不重載、不寫入、不拋', () => {
    const reload = vi.fn();
    const setItem = vi.fn();
    const storage = { getItem: () => null, setItem };
    expect(handleChunkLoadFailure({ storage, now: () => { throw new Error('clock'); }, reload, canReload: () => true })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});


describe('installChunkReloadGuard', () => {
  beforeAll(async () => {
    await setLocale('zh-TW');
  });

  afterEach(() => {
    _resetSubmitGuardForTest();
    _resetReloadSafetyForTest();
    _resetChunkReloadGuardForTest();
    vi.restoreAllMocks();
    sessionStorage.clear();
    history.replaceState(null, '', '/');
  });

  it('不能重載時：不 preventDefault（原錯誤照丟）、不寫時間戳、顯示「載入失敗｜重新載入」', () => {
    installChunkReloadGuard();
    history.replaceState(null, '', '/events/e1');
    const end = beginSubmitting('signup');
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    end();
    expect(event.defaultPrevented).toBe(false);
    expect(sessionStorage.getItem(RELOAD_AT_KEY)).toBeNull();
    const prompt = document.getElementById('sw-reload-deferred-prompt');
    expect(prompt?.dataset.mode).toBe('chunk');
    expect(prompt?.textContent).toContain('載入失敗');
    expect(prompt?.textContent).toContain('重新載入');
    expect(prompt?.textContent).not.toContain('有新版本');
  });

  it('已排重載後同頁連發的失敗事件（多個 CSS、模組本身）：都 preventDefault、不出提示（Opus 終審 P3-1）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // jsdom 的 location.reload 未實作
    installChunkReloadGuard();
    const fire = () => {
      const event = new Event('vite:preloadError', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(fire()).toBe(true);
    const at = sessionStorage.getItem(RELOAD_AT_KEY);
    expect(at).not.toBeNull();
    expect(fire()).toBe(true);
    expect(fire()).toBe(true);
    expect(sessionStorage.getItem(RELOAD_AT_KEY)).toBe(at);
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();
  });

  it('本頁沒有排過重載（例如重載後的新頁）：60 秒窗內再失敗照常不攔、出提示', () => {
    installChunkReloadGuard();
    sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now() - 5_000));
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.getElementById('sw-reload-deferred-prompt')?.dataset.mode).toBe('chunk');
  });
});

describe('背景載入失敗（沒有路由在載入；顧問 §3.263 甲）', () => {
  afterEach(() => {
    _resetReloadSafetyForTest();
    _resetRouteLoadPendingForTest();
    vi.restoreAllMocks();
  });

  it('詳情頁背景預載失敗：不重載、不寫時間戳、回傳 false（不 preventDefault）、出中性提示', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const onBlocked = vi.fn();
    expect(handleChunkLoadFailure({
      storage,
      now: () => 1_000_000,
      reload,
      canReload: () => canReloadAfterChunkFailure({ currentPath: '/events/e1' }).safe,
      onBlocked,
    })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.getItem(RELOAD_AT_KEY)).toBeNull();
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it('離線時路由載入失敗：不重載、不寫時間戳、出中性提示', () => {
    const settled = beginRouteLoad();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const storage = memoryStorage();
    const reload = vi.fn();
    const onBlocked = vi.fn();
    expect(handleChunkLoadFailure({
      storage,
      now: () => 1_000_000,
      reload,
      canReload: () => canReloadAfterChunkFailure({ currentPath: '/events/e1' }).safe,
      onBlocked,
    })).toBe(false);
    settled();
    expect(reload).not.toHaveBeenCalled();
    expect(storage.getItem(RELOAD_AT_KEY)).toBeNull();
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });
});
