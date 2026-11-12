// DIAG-IOS-IMPORT 修法 B：installChunkReloadGuard 的事件接線（vite:preloadError、pagehide／pageshow、visibilitychange）。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./reload-safety', () => ({ requestSafeReload: vi.fn() }));

import { requestSafeReload } from './reload-safety';
import { installChunkReloadGuard, RELOAD_AT_KEY } from './chunk-reload';

const safeReload = vi.mocked(requestSafeReload);
let visibility: DocumentVisibilityState = 'visible';

function preloadError(): Event {
  const event = new Event('vite:preloadError', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

function setVisibility(value: DocumentVisibilityState): void {
  visibility = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('installChunkReloadGuard', () => {
  beforeAll(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    // 監聽只能裝一次（正式環境由 main.tsx 呼叫一次），整個檔案共用。
    installChunkReloadGuard();
  });

  afterAll(() => {
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });

  beforeEach(() => {
    sessionStorage.clear();
    safeReload.mockClear();
    visibility = 'visible';
    window.dispatchEvent(new Event('pageshow'));
    safeReload.mockClear();
  });

  it('可見時第一次失敗：經安全重載檢查重載一次並擋錯', () => {
    const event = preloadError();
    expect(safeReload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(sessionStorage.getItem(RELOAD_AT_KEY)).not.toBeNull();
  });

  it('vis=hidden 時失敗不重載、不擋錯；回前景才重載一次', () => {
    setVisibility('hidden');
    const event = preloadError();
    expect(safeReload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    setVisibility('visible');
    expect(safeReload).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    setVisibility('visible');
    expect(safeReload).toHaveBeenCalledTimes(1);
  });

  it('pagehide 之後失敗不重載；bfcache 還原（pageshow）時才處理', () => {
    window.dispatchEvent(new Event('pagehide'));
    const event = preloadError();
    expect(safeReload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    window.dispatchEvent(new Event('pageshow'));
    expect(safeReload).toHaveBeenCalledTimes(1);
  });

  it('重載後 60 秒內在背景再失敗：回前景不再重載', () => {
    sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now() - 5_000));
    setVisibility('hidden');
    preloadError();
    setVisibility('visible');
    expect(safeReload).not.toHaveBeenCalled();
  });
});
