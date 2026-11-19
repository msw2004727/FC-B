import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n/i18n';
import {
  RELOAD_AT_KEY,
  RELOAD_STALL_MS,
  _resetChunkReloadGuardForTest,
  handleChunkLoadFailure,
  installChunkReloadGuard,
  isChunkReloadScheduled,
  waitForChunkReloadCancelled,
} from './chunk-reload';
import { _resetFailedPreloadsForTest, installFailedPreloadRecorder } from './failed-preloads';
import { REFRESH_TIMEOUT_MS, _resetRefreshReloadForTest, _setRefreshReloadForTest } from './refresh-reload';
import { _resetReloadSafetyForTest, canReloadAfterChunkFailure } from './reload-safety';
import * as reloadSafety from './reload-safety';
import { _resetRouteLoadingForTest } from './route-loading';
import { _resetSubmitGuardForTest, beginSubmitting } from './submit-guard';
import { _resetRouteLoadPendingForTest, beginRouteLoad, isRouteLoadPending } from './route-load-pending';
import { getToasts, toast } from '@/ui/Toast';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
  };
}

describe('停滯計時器常數界限', () => {
  it('RELOAD_STALL_MS >= 5 秒、REFRESH_TIMEOUT_MS > 0，且兩者相加 < 60 秒窗', () => {
    expect(RELOAD_STALL_MS).toBeGreaterThanOrEqual(5_000);
    expect(REFRESH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(REFRESH_TIMEOUT_MS + RELOAD_STALL_MS).toBeLessThan(60_000);
  });
});

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
    _resetRefreshReloadForTest();
    _resetFailedPreloadsForTest();
    _resetRouteLoadingForTest();
    document.querySelectorAll('link').forEach((node) => node.remove());
    vi.unstubAllGlobals();
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

  it('等待期間開始送出：刷新後不重整，出現延後提示（§3.295(a)）', async () => {
    installFailedPreloadRecorder();
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = '/assets/guard.js';
    document.head.appendChild(link);
    link.dispatchEvent(new Event('error', { bubbles: false }));

    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    installChunkReloadGuard();
    history.replaceState(null, '', '/');
    sessionStorage.clear();
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(fetchMock).toHaveBeenCalled();

    const end = beginSubmitting('signup');
    resolveFetch(new Response(''));
    await vi.waitFor(() => {
      expect(document.getElementById('sw-reload-deferred-prompt')?.dataset.mode).toBe('chunk');
    });
    const navErrors = errorSpy.mock.calls.filter((args) => args.some((arg) => String(arg).includes('Not implemented: navigation')));
    expect(navErrors).toHaveLength(0);
    end();
  });

  it('等待後被擋：取消排程、時間戳不回滾，之後的失敗回到正常處理（§3.297 P2）', async () => {
    // 沒有排程時立刻 resolve。
    await expect(waitForChunkReloadCancelled()).resolves.toBeUndefined();

    installFailedPreloadRecorder();
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = '/assets/x.js';
    document.head.appendChild(link);
    link.dispatchEvent(new Event('error', { bubbles: false }));

    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    installChunkReloadGuard();
    history.replaceState(null, '', '/');
    sessionStorage.clear();

    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(isChunkReloadScheduled()).toBe(true);
    expect(fetchMock).toHaveBeenCalled();

    let cancelled = false;
    const pending = (async () => {
      await waitForChunkReloadCancelled();
      cancelled = true;
    })();
    await Promise.resolve();
    expect(cancelled).toBe(false);

    const end = beginSubmitting('signup');
    resolveFetch(new Response(''));
    await vi.waitFor(() => {
      expect(isChunkReloadScheduled()).toBe(false);
    });
    await pending;
    expect(cancelled).toBe(true);

    const at = sessionStorage.getItem(RELOAD_AT_KEY);
    expect(at).not.toBeNull();

    const again = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(again);
    // 窗內不再默默 preventDefault，回到正常處理：出提示。
    expect(again.defaultPrevented).toBe(false);
    expect(document.getElementById('sw-reload-deferred-prompt')?.dataset.mode).toBe('chunk');
    expect(sessionStorage.getItem(RELOAD_AT_KEY)).toBe(at);

    // 取消之後沒有排程，再等也立刻 resolve。
    await expect(waitForChunkReloadCancelled()).resolves.toBeUndefined();
    end();
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

function recordModulepreload(href: string): string {
  installFailedPreloadRecorder();
  const link = document.createElement('link');
  link.rel = 'modulepreload';
  link.href = href;
  document.head.appendChild(link);
  link.dispatchEvent(new Event('error', { bubbles: false }));
  return link.href;
}

function holdFetch(): { fetchMock: ReturnType<typeof vi.fn<typeof fetch>>; resolveAll: () => void } {
  const pending: Array<(value: Response) => void> = [];
  const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => {
    pending.push(resolve);
  }));
  return {
    fetchMock,
    resolveAll: () => {
      const batch = pending.splice(0, pending.length);
      if (batch.length === 0) throw new Error('沒有等待中的刷新');
      for (const resolve of batch) resolve(new Response(''));
    },
  };
}

function clickReloadNow(): void {
  const button = document.querySelector<HTMLButtonElement>('#sw-reload-deferred-prompt [data-sw-reload-now]');
  if (!button) throw new Error('沒有重新載入按鈕');
  button.click();
}

describe('甲案：等待後只重查同一頁與使用者正在做的事', () => {
  beforeAll(async () => {
    await setLocale('zh-TW');
  });

  beforeEach(() => {
    _resetRouteLoadPendingForTest();
    _resetChunkReloadGuardForTest();
    _resetRefreshReloadForTest();
    _resetFailedPreloadsForTest();
    _resetReloadSafetyForTest();
    _resetSubmitGuardForTest();
    _resetRouteLoadingForTest();
    sessionStorage.clear();
    document.body.innerHTML = '';
    document.querySelectorAll('link').forEach((node) => node.remove());
    history.replaceState(null, '', '/');
    toast.clear();
  });

  afterEach(() => {
    _resetRouteLoadPendingForTest();
    _resetChunkReloadGuardForTest();
    _resetRefreshReloadForTest();
    _resetFailedPreloadsForTest();
    _resetReloadSafetyForTest();
    _resetSubmitGuardForTest();
    _resetRouteLoadingForTest();
    document.querySelectorAll('link').forEach((node) => node.remove());
    document.querySelectorAll('.modal.open').forEach((node) => node.remove());
    document.body.innerHTML = '';
    toast.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sessionStorage.clear();
    history.replaceState(null, '', '/');
  });

  it('詳情頁單元：beginRouteLoad 後失敗，立刻 settle，等待後仍重整一次', async () => {
    const assetUrl = recordModulepreload('/assets/detail-unit.js');
    const { fetchMock, resolveAll } = holdFetch();
    vi.stubGlobal('fetch', fetchMock);
    const reload = vi.fn();
    _setRefreshReloadForTest(reload);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const settled = beginRouteLoad();
    installChunkReloadGuard();
    history.replaceState(null, '', '/events/e1');
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    // (a)(b) 失敗當下已放行並寫下時間戳。刷新在下一個回合才發出。
    expect(event.defaultPrevented).toBe(true);
    expect(Number(sessionStorage.getItem(RELOAD_AT_KEY))).toBeGreaterThan(0);
    settled();
    expect(isRouteLoadPending()).toBe(false);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(assetUrl, expect.objectContaining({ cache: 'no-cache' })));
    expect(isRouteLoadPending()).toBe(false);
    resolveAll();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // (d)(e)
    expect(reload).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();
  });

  it('等待中換頁：不重整、出提示', async () => {
    recordModulepreload('/assets/leave.js');
    const { fetchMock, resolveAll } = holdFetch();
    vi.stubGlobal('fetch', fetchMock);
    const reload = vi.fn();
    _setRefreshReloadForTest(reload);
    const settled = beginRouteLoad();
    installChunkReloadGuard();
    history.replaceState(null, '', '/events/e1');
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    history.replaceState(null, '', '/teams/t1');
    settled();
    resolveAll();
    await vi.waitFor(() => expect(document.getElementById('sw-reload-deferred-prompt')?.dataset.mode).toBe('chunk'));
    expect(reload).not.toHaveBeenCalled();
    expect(document.querySelectorAll('#sw-reload-deferred-prompt')).toHaveLength(1);
  });

  it('不安全頁的提示框手動重整：刷新後 reload 一次，提示不重複', async () => {
    const assetUrl = recordModulepreload('/assets/unsafe.js');
    const { fetchMock, resolveAll } = holdFetch();
    vi.stubGlobal('fetch', fetchMock);
    const reload = vi.fn();
    _setRefreshReloadForTest(reload);
    installChunkReloadGuard();
    history.replaceState(null, '', '/teams/t1');
    // 彈窗開著：守門那次 reload 的等待後判斷會擋，手動路徑只擋送出中，所以仍要重整。
    const modal = document.createElement('div');
    modal.className = 'modal open';
    document.body.appendChild(modal);
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.getElementById('sw-reload-deferred-prompt')?.dataset.mode).toBe('chunk');
    clickReloadNow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(assetUrl, expect.objectContaining({ cache: 'no-cache' })));
    resolveAll();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('詳情頁背景載入失敗：出提示，按重新載入後 reload 一次', async () => {
    recordModulepreload('/assets/bg.js');
    const { fetchMock, resolveAll } = holdFetch();
    vi.stubGlobal('fetch', fetchMock);
    const reload = vi.fn();
    _setRefreshReloadForTest(reload);
    installChunkReloadGuard();
    history.replaceState(null, '', '/events/e1');
    expect(isRouteLoadPending()).toBe(false);
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(sessionStorage.getItem(RELOAD_AT_KEY)).toBeNull();
    expect(document.getElementById('sw-reload-deferred-prompt')?.textContent).toContain('重新載入');
    clickReloadNow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    resolveAll();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();
  });

  it('提示框手動重整遇到送出中：不重整、吐司一次、提示框還在；結束後再按才重整', async () => {
    recordModulepreload('/assets/busy.js');
    const { fetchMock, resolveAll } = holdFetch();
    vi.stubGlobal('fetch', fetchMock);
    const reload = vi.fn();
    _setRefreshReloadForTest(reload);
    installChunkReloadGuard();
    history.replaceState(null, '', '/teams/t1');
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(document.querySelectorAll('#sw-reload-deferred-prompt')).toHaveLength(1);
    clickReloadNow();
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const end = beginSubmitting('signup');
    try {
      resolveAll();
      await vi.waitFor(() => expect(document.querySelectorAll('#sw-reload-deferred-prompt')).toHaveLength(1));
      expect(reload).not.toHaveBeenCalled();
      const busy = getToasts().filter((item) => item.message.includes('目前操作尚未完成'));
      expect(busy).toHaveLength(1);
      expect(document.querySelector('#sw-reload-deferred-prompt [data-sw-reload-now]')).not.toBeNull();
    } finally {
      end();
    }
    clickReloadNow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolveAll();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('等待中開啟彈窗：不重整、出提示（M7）', async () => {
    recordModulepreload('/assets/modal.js');
    const { fetchMock, resolveAll } = holdFetch();
    vi.stubGlobal('fetch', fetchMock);
    const reload = vi.fn();
    _setRefreshReloadForTest(reload);
    const settled = beginRouteLoad();
    installChunkReloadGuard();
    history.replaceState(null, '', '/events/e1');
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const modal = document.createElement('div');
    modal.className = 'modal open';
    document.body.appendChild(modal);
    settled();
    resolveAll();
    await vi.waitFor(() => expect(document.getElementById('sw-reload-deferred-prompt')?.dataset.mode).toBe('chunk'));
    expect(reload).not.toHaveBeenCalled();
    expect(isChunkReloadScheduled()).toBe(false);
  });

  it('已排重整、reload 已呼叫但不導航：總延遲前不出提示，到點才取消、叫醒等待、提示框一次，之後的失敗不再被默默 preventDefault', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const reload = vi.fn();
    _setRefreshReloadForTest(reload);
    try {
      installChunkReloadGuard();
      history.replaceState(null, '', '/');
      const event = new Event('vite:preloadError', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(isChunkReloadScheduled()).toBe(true);
      expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();

      let cancelled = false;
      const pending = (async () => {
        await waitForChunkReloadCancelled();
        cancelled = true;
      })();
      await Promise.resolve();
      expect(cancelled).toBe(false);

      const total = REFRESH_TIMEOUT_MS + RELOAD_STALL_MS;
      await vi.advanceTimersByTimeAsync(total - 1);
      expect(cancelled).toBe(false);
      expect(isChunkReloadScheduled()).toBe(true);
      expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();

      await vi.advanceTimersByTimeAsync(1);
      expect(cancelled).toBe(true);
      await pending;
      expect(isChunkReloadScheduled()).toBe(false);
      expect(reload).toHaveBeenCalledTimes(1);
      const prompts = document.querySelectorAll('#sw-reload-deferred-prompt');
      expect(prompts).toHaveLength(1);
      expect((prompts[0] as HTMLElement).dataset.mode).toBe('chunk');

      const again = new Event('vite:preloadError', { cancelable: true });
      window.dispatchEvent(again);
      expect(again.defaultPrevented).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('測試重置會叫醒等待並清掉停滯計時器', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const reload = vi.fn();
    _setRefreshReloadForTest(reload);
    try {
      installChunkReloadGuard();
      history.replaceState(null, '', '/');
      window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
      expect(isChunkReloadScheduled()).toBe(true);
      expect(reload).toHaveBeenCalledTimes(1);

      let cancelled = false;
      const pending = waitForChunkReloadCancelled().then(() => {
        cancelled = true;
      });
      await Promise.resolve();
      expect(cancelled).toBe(false);

      _resetChunkReloadGuardForTest();
      await Promise.resolve();
      expect(cancelled).toBe(true);
      await pending;

      await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS + RELOAD_STALL_MS);
      expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();
      expect(isChunkReloadScheduled()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('被擋路徑已取消時，推進總延遲不會再多出提示或多呼叫（已取消不重複出提示）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const promptSpy = vi.spyOn(reloadSafety, 'showChunkFailurePrompt');
    recordModulepreload('/assets/stall-blocked.js');
    const { fetchMock, resolveAll } = holdFetch();
    vi.stubGlobal('fetch', fetchMock);
    const reload = vi.fn();
    _setRefreshReloadForTest(reload);
    let end: (() => void) | undefined;
    try {
      installChunkReloadGuard();
      history.replaceState(null, '', '/');
      const event = new Event('vite:preloadError', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(isChunkReloadScheduled()).toBe(true);
      expect(fetchMock).toHaveBeenCalled();

      end = beginSubmitting('signup');
      resolveAll();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      expect(isChunkReloadScheduled()).toBe(false);
      expect(reload).not.toHaveBeenCalled();
      expect(promptSpy).toHaveBeenCalledTimes(1);
      expect(document.querySelectorAll('#sw-reload-deferred-prompt')).toHaveLength(1);
      expect(document.getElementById('sw-reload-deferred-prompt')?.dataset.mode).toBe('chunk');

      await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS + RELOAD_STALL_MS);
      expect(promptSpy).toHaveBeenCalledTimes(1);
      expect(document.querySelectorAll('#sw-reload-deferred-prompt')).toHaveLength(1);
      expect(reload).not.toHaveBeenCalled();
      expect(isChunkReloadScheduled()).toBe(false);
    } finally {
      end?.();
      vi.useRealTimers();
    }
  });

  it('送出中只出提示後，新的排程卡住到點仍再出提示（prompted 歸零）', async () => {
    // 前一次失敗因送出中只出提示、不排程，prompted 留在 true。
    // 使用者按「稍後」只收提示框，不會把 prompted 清掉。
    // 之後新的排程若頁面沒換掉，到點必須再出提示；armReloadStallTimer 開頭要把 prompted 歸零。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const reload = vi.fn();
    let end: (() => void) | undefined;
    try {
      installChunkReloadGuard();
      history.replaceState(null, '', '/');
      end = beginSubmitting('signup');

      const blocked = new Event('vite:preloadError', { cancelable: true });
      window.dispatchEvent(blocked);
      expect(blocked.defaultPrevented).toBe(false);
      expect(isChunkReloadScheduled()).toBe(false);
      expect(sessionStorage.getItem(RELOAD_AT_KEY)).toBeNull();
      expect(document.getElementById('sw-reload-deferred-prompt')?.dataset.mode).toBe('chunk');

      const later = document.querySelector<HTMLButtonElement>('#sw-reload-deferred-prompt [data-sw-reload-later]');
      expect(later).not.toBeNull();
      later?.click();
      expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();

      end();
      end = undefined;

      // 被擋的那次不會寫時間戳。仍明確清掉，讓下一次失敗不受 60 秒窗限制、可以排程
      //（不把時鐘推進超過 60 秒）。
      sessionStorage.removeItem(RELOAD_AT_KEY);

      recordModulepreload('/assets/prompted-reset.js');
      const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response('')));
      vi.stubGlobal('fetch', fetchMock);
      _setRefreshReloadForTest(reload);

      const scheduled = new Event('vite:preloadError', { cancelable: true });
      window.dispatchEvent(scheduled);
      expect(scheduled.defaultPrevented).toBe(true);
      expect(isChunkReloadScheduled()).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      // 刷新成功、reload 被呼叫，但替身不導航，頁面留在原地。
      expect(reload).toHaveBeenCalledTimes(1);
      expect(document.getElementById('sw-reload-deferred-prompt')).toBeNull();

      await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS + RELOAD_STALL_MS);
      expect(document.getElementById('sw-reload-deferred-prompt')?.dataset.mode).toBe('chunk');
      expect(isChunkReloadScheduled()).toBe(false);
    } finally {
      end?.();
      vi.useRealTimers();
    }
  });
});
