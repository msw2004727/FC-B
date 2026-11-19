import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginRouteLoading } from './route-loading';
import { _resetFailedPreloadsForTest, installFailedPreloadRecorder } from './failed-preloads';
import { REFRESH_TIMEOUT_MS, _resetRefreshReloadForTest, refreshThenReload } from './refresh-reload';

vi.mock('./route-loading', () => ({
  beginRouteLoading: vi.fn(() => 1),
}));

function addLink(rel: string, href: string): HTMLLinkElement {
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  document.head.appendChild(link);
  return link;
}

function recordFailure(rel: string, href: string): string {
  const link = addLink(rel, href);
  installFailedPreloadRecorder();
  link.dispatchEvent(new Event('error', { bubbles: false }));
  return link.href;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(beginRouteLoading).mockClear();
});

afterEach(() => {
  _resetRefreshReloadForTest();
  _resetFailedPreloadsForTest();
  document.querySelectorAll('link').forEach((node) => node.remove());
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('refreshThenReload', () => {
  it('有記到：只 fetch 記到的網址，參數含 no-cache 與 same-origin，且在第一個 resolve 前全部發出', async () => {
    history.replaceState(null, '', '/events/e1?ref=1#signup');
    const keptA = recordFailure('modulepreload', '/assets/a.js');
    const keptB = recordFailure('preload', '/assets/b.css');
    const other = addLink('stylesheet', '/assets/other.css').href;
    const log: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      log.push(`start:${url}`);
      return new Promise<Response>((resolve) => {
        queueMicrotask(() => {
          log.push(`done:${url}`);
          resolve(new Response(''));
        });
      });
    });
    const reload = vi.fn();
    const pending = refreshThenReload({ fetchImpl, reload, online: () => true });
    expect(log).toEqual([`start:${keptA}`, `start:${keptB}`]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(keptA, { cache: 'no-cache', credentials: 'same-origin' });
    expect(fetchImpl).toHaveBeenCalledWith(keptB, { cache: 'no-cache', credentials: 'same-origin' });
    expect(fetchImpl).not.toHaveBeenCalledWith(other, expect.anything());
    expect(vi.mocked(beginRouteLoading)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(beginRouteLoading)).toHaveBeenCalledWith({ path: '/events/e1' });
    await pending;
    expect(log).toEqual([`start:${keptA}`, `start:${keptB}`, `done:${keptA}`, `done:${keptB}`]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('沒記到：fetch 全部 modulepreload／preload／stylesheet 的 /assets/ 網址', async () => {
    const js = addLink('modulepreload', '/assets/a.js').href;
    const pre = addLink('preload', '/assets/b.js').href;
    const css = addLink('stylesheet', '/assets/c.css').href;
    addLink('icon', '/assets/icon.js');
    addLink('stylesheet', 'https://cdn.example.com/assets/ext.css');
    addLink('modulepreload', '/vendor/nope.js');
    addLink('modulepreload', '/assets/a.js');
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(''));
    const reload = vi.fn();
    const pending = refreshThenReload({ fetchImpl, reload, online: () => true });
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([js, pre, css]);
    await pending;
    expect(reload).toHaveBeenCalledTimes(1);
    expect(vi.mocked(beginRouteLoading)).toHaveBeenCalledWith({ path: location.pathname });
  });

  it('fetch 永不 resolve：3000ms 時 reload 剛好 1 次', async () => {
    expect(REFRESH_TIMEOUT_MS).toBe(3000);
    recordFailure('modulepreload', '/assets/hang.js');
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    const reload = vi.fn();
    const pending = refreshThenReload({ fetchImpl, reload, online: () => true });
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2999);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    await pending;
  });

  it('fetch reject 或同步 throw：仍 reload 1 次', async () => {
    recordFailure('modulepreload', '/assets/bad.js');
    const rejected = vi.fn<typeof fetch>(async () => {
      throw new Error('no');
    });
    const reloadReject = vi.fn();
    await refreshThenReload({ fetchImpl: rejected, reload: reloadReject, online: () => true });
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(reloadReject).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS);
    expect(reloadReject).toHaveBeenCalledTimes(1);

    _resetRefreshReloadForTest();
    _resetFailedPreloadsForTest();
    document.querySelectorAll('link').forEach((node) => node.remove());
    recordFailure('preload', '/assets/sync-a.js');
    recordFailure('stylesheet', '/assets/sync-b.css');
    let calls = 0;
    const throwing = vi.fn<typeof fetch>(() => {
      calls += 1;
      if (calls === 1) throw new Error('sync');
      return Promise.resolve(new Response(''));
    });
    const reloadThrow = vi.fn();
    const pending = refreshThenReload({ fetchImpl: throwing, reload: reloadThrow, online: () => true });
    expect(throwing).toHaveBeenCalledTimes(2);
    await pending;
    expect(reloadThrow).toHaveBeenCalledTimes(1);
  });

  it('離線：fetch 0 次、reload 1 次', async () => {
    recordFailure('modulepreload', '/assets/off.js');
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(''));
    const reload = vi.fn();
    await refreshThenReload({ fetchImpl, reload, online: () => false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('沒有 fetch：不 fetch，直接 reload 1 次', async () => {
    recordFailure('modulepreload', '/assets/nofetch.js');
    const saved = globalThis.fetch;
    Reflect.deleteProperty(globalThis, 'fetch');
    const reload = vi.fn();
    try {
      await refreshThenReload({ reload, online: () => true });
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = saved;
    }
  });

  it('進行中再呼叫：同一個 promise，fetch 不加倍、reload 仍 1 次', async () => {
    recordFailure('modulepreload', '/assets/once.js');
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    const reload = vi.fn();
    const first = refreshThenReload({ fetchImpl, reload, online: () => true });
    const secondFetch = vi.fn<typeof fetch>(async () => new Response(''));
    const secondReload = vi.fn();
    const second = refreshThenReload({ fetchImpl: secondFetch, reload: secondReload, online: () => true });
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(secondFetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(secondReload).not.toHaveBeenCalled();
    await first;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('名單是空的：不 fetch，直接 reload 1 次', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(''));
    const reload = vi.fn();
    await refreshThenReload({ fetchImpl, reload, online: () => true });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(vi.mocked(beginRouteLoading)).not.toHaveBeenCalled();
  });
});
