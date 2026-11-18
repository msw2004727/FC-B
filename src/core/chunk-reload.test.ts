import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n/i18n';
import { RELOAD_AT_KEY, handleChunkLoadFailure, installChunkReloadGuard } from './chunk-reload';
import { _resetReloadSafetyForTest, canReloadAfterChunkFailure } from './reload-safety';
import { _resetSubmitGuardForTest, beginSubmitting } from './submit-guard';

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

describe('顧問 §3.255 C′：不能自動重載時', () => {
  afterEach(() => {
    _resetSubmitGuardForTest();
    _resetReloadSafetyForTest();
    document.body.innerHTML = '';
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

  it('/events/<id> 安全時自動重載並寫時間戳；60 秒內第二次不重載、不提示', () => {
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
    expect(onBlocked).not.toHaveBeenCalled();
  });
});

describe('installChunkReloadGuard', () => {
  beforeAll(async () => {
    await setLocale('zh-TW');
  });

  afterEach(() => {
    _resetSubmitGuardForTest();
    _resetReloadSafetyForTest();
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
});
