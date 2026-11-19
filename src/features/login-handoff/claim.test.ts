import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { beginClaim, _resetClaimForTest } from './claim';
import { LOGIN_HANDOFF_STORAGE_KEY } from '@/data/login-redirect';
import { _setReplaceForTest } from './nav';
import { writePending } from './pending';
import { renderWait, type WaitHandlers, type WaitView } from './view';

const callFn = vi.hoisted(() => vi.fn());
const signIn = vi.hoisted(() => vi.fn(async () => ({ uid: 'u' })));

vi.mock('@/data/callables', () => ({ callFn }));

vi.mock('@/data/auth', () => ({
  signIn,
  isLoginRedirectingError: (err: unknown) => Boolean(
    err && typeof err === 'object' && (err as { isRedirecting?: unknown }).isRedirecting === true,
  ),
}));

vi.mock('./view', () => ({
  renderWait: vi.fn(),
  renderRelay: vi.fn(),
}));

const SECRET = 'cd'.repeat(32);
const CLOCK = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as const;

// useFakeTimers 會換掉全域計時器。digest 在背景執行緒，假計時器推進不到；
// 這裡留模組載入時的 setTimeout／performance.now，等待才不受假時間影響。
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realNow = performance.now.bind(performance);

let visibility: DocumentVisibilityState = 'visible';
const replaced: string[] = [];

function installVisibility(): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
}

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function lastView(): WaitView | null | undefined {
  return vi.mocked(renderWait).mock.calls.at(-1)?.[0];
}

function handlers(): WaitHandlers {
  const found = vi.mocked(renderWait).mock.calls.at(-1)?.[1];
  if (!found) throw new Error('no wait handlers');
  return found;
}

function realWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    realSetTimeout(() => { resolve(); }, ms);
  });
}

async function untilCalls(count: number): Promise<void> {
  const start = realNow();
  while (realNow() - start < 2000) {
    if (callFn.mock.calls.length >= count) return;
    await vi.advanceTimersByTimeAsync(0);
    if (callFn.mock.calls.length >= count) return;
    await realWait(10);
  }
  expect(callFn.mock.calls.length).toBeGreaterThanOrEqual(count);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...CLOCK] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  visibility = 'visible';
  installVisibility();
  replaced.length = 0;
  _setReplaceForTest((url) => { replaced.push(url); });
  localStorage.clear();
  replaced.length = 0;
  callFn.mockReset();
  signIn.mockReset();
  vi.mocked(renderWait).mockClear();
  _resetClaimForTest();
  writePending({ secret: SECRET, createdAt: Date.now() });
});

afterEach(() => {
  _resetClaimForTest();
  _setReplaceForTest(null);
  vi.useRealTimers();
  localStorage.clear();
  visibility = 'visible';
});

describe('claim', () => {
  it('前景每 6 秒一次，5.999 秒不打', async () => {
    callFn.mockRejectedValue(codeError('not-found'));
    await beginClaim();
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(callFn.mock.calls[0]).toEqual([
      'lineLoginHandoff',
      { op: 'claim', handoffSecret: SECRET },
    ]);
    await vi.advanceTimersByTimeAsync(5999);
    expect(callFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(callFn).toHaveBeenCalledTimes(2);
  });

  it('背景不輪詢；回前景一次；沒有先隱藏的第二次 visible 不打；之後仍 6 秒', async () => {
    callFn.mockRejectedValue(codeError('not-found'));
    await beginClaim();
    expect(callFn).toHaveBeenCalledTimes(1);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await untilCalls(1);
    expect(callFn).toHaveBeenCalledTimes(1);

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(callFn).toHaveBeenCalledTimes(1);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await untilCalls(2);
    expect(callFn).toHaveBeenCalledTimes(2);

    document.dispatchEvent(new Event('visibilitychange'));
    await untilCalls(2);
    expect(callFn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(6000);
    expect(callFn).toHaveBeenCalledTimes(3);
  });

  it('我已完成停用 3 秒，期間只有一個請求', async () => {
    visibility = 'hidden';
    callFn.mockRejectedValue(codeError('functions/resource-exhausted'));
    await beginClaim();
    expect(callFn).not.toHaveBeenCalled();
    handlers().onDone();
    await untilCalls(1);
    expect(lastView()).toMatchObject({ kind: 'wait', busy: true });
    expect(callFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(lastView()).toMatchObject({ kind: 'wait', busy: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(lastView()).toMatchObject({ kind: 'wait', busy: false });
    expect(callFn).toHaveBeenCalledTimes(1);
  });

  it('resource-exhausted 退避 10、20、40、60、60 秒', async () => {
    callFn.mockRejectedValue(codeError('functions/resource-exhausted'));
    await beginClaim();
    const gaps = [10_000, 20_000, 40_000, 60_000, 60_000];
    expect(callFn).toHaveBeenCalledTimes(1);
    for (let i = 0; i < gaps.length; i += 1) {
      const gap = gaps[i] ?? 0;
      await vi.advanceTimersByTimeAsync(gap - 1);
      expect(callFn).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(callFn).toHaveBeenCalledTimes(i + 2);
    }
  });

  it('unavailable 與網路錯誤的第一段也是 10 秒，不是 6 秒', async () => {
    callFn.mockRejectedValueOnce(codeError('unavailable'));
    await beginClaim();
    await vi.advanceTimersByTimeAsync(5999);
    expect(callFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4001);
    expect(callFn).toHaveBeenCalledTimes(2);

    _resetClaimForTest();
    vi.mocked(renderWait).mockClear();
    callFn.mockReset();
    writePending({ secret: SECRET, createdAt: Date.now() });
    callFn.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await beginClaim();
    await vi.advanceTimersByTimeAsync(5999);
    expect(callFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4001);
    expect(callFn).toHaveBeenCalledTimes(2);
  });

  it('按鈕觸發的 not-found 顯示還沒收到，pending 留著，輪詢繼續', async () => {
    callFn.mockRejectedValue(codeError('functions/not-found'));
    await beginClaim();
    expect(lastView()).toMatchObject({ kind: 'wait' });
    handlers().onDone();
    await untilCalls(2);
    expect(lastView()).toMatchObject({ kind: 'notYet' });
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toContain(SECRET);
    const count = callFn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(callFn.mock.calls.length).toBe(count + 1);
  });

  it('not-found 到 5 分鐘顯示逾時並清掉 pending，之後不再打', async () => {
    callFn.mockRejectedValue(codeError('functions/not-found'));
    await beginClaim();
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).not.toBeNull();
    expect(lastView()?.kind).not.toBe('timeout');
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(lastView()).toEqual({ kind: 'timeout' });
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toBeNull();
    const count = callFn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(callFn.mock.calls.length).toBe(count);
  });

  it('成功：同源才 location.replace，liffRedirectUri 保留原值，並停止輪詢', async () => {
    const original = `${location.origin}/events/e?tab=1&fcbHandoff=${'ab'.repeat(32)}`;
    callFn.mockResolvedValue({
      code: 'abc.def',
      liffClientId: '2008123456',
      liffRedirectUri: original,
    });
    await beginClaim();
    expect(replaced).toHaveLength(1);
    const next = new URL(replaced[0] ?? 'http://invalid.test/');
    expect(next.origin).toBe(location.origin);
    expect(next.pathname).toBe('/events/e');
    expect(next.searchParams.has('fcbHandoff')).toBe(false);
    expect(next.searchParams.get('tab')).toBe('1');
    expect(next.searchParams.get('code')).toBe('abc.def');
    expect(next.searchParams.get('liffClientId')).toBe('2008123456');
    expect(next.searchParams.get('liffRedirectUri')).toBe(original);
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toBeNull();
    const count = callFn.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(callFn.mock.calls.length).toBe(count);
  });

  it('不同源當成失敗：不換頁、顯示逾時、清掉 pending', async () => {
    callFn.mockResolvedValue({
      code: 'abc.def',
      liffClientId: '2008123456',
      liffRedirectUri: 'https://evil.example/steal',
    });
    await beginClaim();
    expect(replaced).toEqual([]);
    expect(lastView()).toEqual({ kind: 'timeout' });
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toBeNull();
  });

  it('同時只有一個 claim；在途時按鈕排隊，結束後才打下一發', async () => {
    let rejectFirst: (err: unknown) => void = () => undefined;
    callFn.mockRejectedValue(codeError('not-found'));
    callFn.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectFirst = reject;
    }));
    const running = beginClaim();
    await untilCalls(1);
    handlers().onDone();
    await vi.advanceTimersByTimeAsync(6000);
    expect(callFn).toHaveBeenCalledTimes(1);
    rejectFirst(codeError('not-found'));
    await running;
    expect(callFn).toHaveBeenCalledTimes(2);
  });

  it('重新登入清掉 pending、卸載等待框，並呼叫 signIn', async () => {
    callFn.mockRejectedValue(codeError('not-found'));
    signIn.mockRejectedValueOnce(Object.assign(new Error('go'), { isRedirecting: true }));
    const authMod = await import('@/data/auth');
    expect(authMod.signIn).toBe(signIn);
    await beginClaim();
    handlers().onRestart();
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toBeNull();
    expect(lastView()).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(signIn).toHaveBeenCalledOnce();
  });

  it('關閉後 pending 留著，輪詢繼續', async () => {
    callFn.mockRejectedValue(codeError('not-found'));
    await beginClaim();
    handlers().onClose();
    expect(lastView()).toBeNull();
    expect(localStorage.getItem(LOGIN_HANDOFF_STORAGE_KEY)).toContain(SECRET);
    await vi.advanceTimersByTimeAsync(6000);
    expect(callFn).toHaveBeenCalledTimes(2);
  });
});
