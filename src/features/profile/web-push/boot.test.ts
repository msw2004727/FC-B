import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emit } from '@/core/events';
import { evaluateReloadSafety } from '@/core/reload-safety';
import { beginSubmitting } from '@/core/submit-guard';
import {
  _resetWebPushBootForTest,
  beforeSignOut,
  handleWebPushOpenMessage,
  sanitizeOpenPath,
  startWebPushBoot,
  WEB_PUSH_OPEN_MESSAGE,
  type OpenMessageEnv,
} from './boot';
import { _resetWebPushFlowsForTest, _setWebPushDepsForTest } from './flows';
import { clearWebPushRecord, hash32, readWebPushRecord, writeWebPushRecord } from './store';
import { fakeWorld, trackedSub } from './test-fakes';
import { WEB_PUSH_VAPID_KEY_ID } from './config';

const ORIGIN = 'https://toosterx.com';

function makePort(): { postMessage: ReturnType<typeof vi.fn> } {
  return { postMessage: vi.fn() };
}

function msg(data: unknown, source: unknown, port: unknown = makePort()): MessageEvent {
  return { data, source, ports: port ? [port] : [] } as unknown as MessageEvent;
}

function env(over: Partial<OpenMessageEnv> = {}): OpenMessageEnv & { route: ReturnType<typeof vi.fn> } {
  const route = vi.fn();
  return { controller: CONTROLLER, origin: ORIGIN, route, isSafe: () => true, ...over } as OpenMessageEnv & { route: ReturnType<typeof vi.fn> };
}

const CONTROLLER = { id: 'sw' };

beforeEach(() => {
  document.body.innerHTML = '';
  clearWebPushRecord();
  _resetWebPushFlowsForTest();
  _resetWebPushBootForTest();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  _setWebPushDepsForTest(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('P 頁面端訊息（D1 (B)，W4.1 SW 協定）', () => {
  it('訊息格式鎖定：{ type: toosterx:webpush-open, v: 1, path } ＋ ports[0]；回覆 { v: 1, result }', () => {
    expect(WEB_PUSH_OPEN_MESSAGE).toBe('toosterx:webpush-open');
    const port = makePort();
    const e = env();
    handleWebPushOpenMessage(msg({ type: 'toosterx:webpush-open', v: 1, path: '/inbox' }, CONTROLLER, port), e);
    expect(e.route).toHaveBeenCalledWith('/inbox');
    expect(port.postMessage).toHaveBeenCalledTimes(1);
    expect(port.postMessage.mock.calls[0]![0]).toStrictEqual({ v: 1, result: 'routed' });
  });

  it('來源不是 controller、型別或版本不對、沒有 port → 不理、不回覆', () => {
    const cases: Array<[unknown, unknown, unknown]> = [
      [{ type: WEB_PUSH_OPEN_MESSAGE, v: 1, path: '/inbox' }, { id: 'other' }, makePort()],
      [{ type: WEB_PUSH_OPEN_MESSAGE, v: 1, path: '/inbox' }, null, makePort()],
      [{ type: 'toosterx:other', v: 1, path: '/inbox' }, CONTROLLER, makePort()],
      [{ type: WEB_PUSH_OPEN_MESSAGE, v: 2, path: '/inbox' }, CONTROLLER, makePort()],
      [{ type: WEB_PUSH_OPEN_MESSAGE, v: '1', path: '/inbox' }, CONTROLLER, makePort()],
      [{ type: WEB_PUSH_OPEN_MESSAGE, v: 1, path: '/inbox' }, CONTROLLER, null],
      [null, CONTROLLER, makePort()],
    ];
    for (const [data, source, port] of cases) {
      const e = env();
      handleWebPushOpenMessage(msg(data, source, port), e);
      expect(e.route).not.toHaveBeenCalled();
      if (port) expect((port as { postMessage: ReturnType<typeof vi.fn> }).postMessage).not.toHaveBeenCalled();
    }
    // 沒有 controller（未受控）也不理
    const e = env({ controller: null });
    const port = makePort();
    handleWebPushOpenMessage(msg({ type: WEB_PUSH_OPEN_MESSAGE, v: 1, path: '/inbox' }, null, port), e);
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it('路徑檢查不合格 → 退回 /', () => {
    for (const bad of ['//evil.com', '/\\evil.com', 'javascript:alert(1)', '/inbox\nx', 'https://evil.com/', '', 42, '/a\u0000b']) {
      expect(sanitizeOpenPath(bad, ORIGIN), String(bad)).toBe('/');
    }
    expect(sanitizeOpenPath('/inbox', ORIGIN)).toBe('/inbox');
    expect(sanitizeOpenPath('/events/abc?x=1', ORIGIN)).toBe('/events/abc?x=1');
    const e = env();
    handleWebPushOpenMessage(msg({ type: WEB_PUSH_OPEN_MESSAGE, v: 1, path: '//evil.com' }, CONTROLLER), e);
    expect(e.route).toHaveBeenCalledWith('/');
  });

  it('不安全 → 不 route、回 kept', () => {
    const port = makePort();
    const e = env({ isSafe: () => false });
    handleWebPushOpenMessage(msg({ type: WEB_PUSH_OPEN_MESSAGE, v: 1, path: '/inbox' }, CONTROLLER, port), e);
    expect(e.route).not.toHaveBeenCalled();
    expect(port.postMessage.mock.calls[0]![0]).toStrictEqual({ v: 1, result: 'kept' });
  });

  it('真的 evaluateReloadSafety：彈窗開著、焦點在輸入框、送出中 → 不安全（kept）', () => {
    const isSafe = (): boolean => evaluateReloadSafety({ ignorePageSafety: true }).safe;
    expect(isSafe()).toBe(true);
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    expect(isSafe()).toBe(false);
    document.body.innerHTML = '<input id="x">';
    (document.getElementById('x') as HTMLInputElement).focus();
    expect(isSafe()).toBe(false);
    (document.activeElement as HTMLElement).blur();
    document.body.innerHTML = '';
    const end = beginSubmitting('signup');
    expect(isSafe()).toBe(false);
    end();
    expect(isSafe()).toBe(true);
  });

  it('route 丟錯 → 不回覆、不往外拋', () => {
    const port = makePort();
    const e = env({ route: () => { throw new Error('boom'); } });
    expect(() => handleWebPushOpenMessage(msg({ type: WEB_PUSH_OPEN_MESSAGE, v: 1, path: '/inbox' }, CONTROLLER, port), e)).not.toThrow();
    expect(port.postMessage).not.toHaveBeenCalled();
  });
});

describe('B 開機模組', () => {
  const EP = 'https://fcm.googleapis.com/fcm/send/a';

  async function seed(uid: string): Promise<void> {
    writeWebPushRecord({ v: 1, uidHash: await hash32(uid), endpointHash: await hash32(EP), keyId: WEB_PUSH_VAPID_KEY_ID, reportedAt: 0 });
  }

  function stubServiceWorker(): void {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: null, addEventListener: vi.fn(), startMessages: vi.fn() },
    });
  }

  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it('非 PROD → no-op（不碰訂閱）', async () => {
    stubServiceWorker();
    const w = fakeWorld({ permission: 'granted' });
    _setWebPushDepsForTest(w.deps);
    await seed('u1');
    startWebPushBoot({ route: vi.fn(), isProd: false });
    emit('auth:changed', { uid: null });
    await new Promise((r) => setTimeout(r, 20));
    expect(w.calls).toEqual([]);
    expect(readWebPushRecord()).not.toBeNull();
  });

  it('PROD：auth:changed 變 null → unsubscribe＋清紀錄（不呼叫解除）；之後換人 → 清別人的', async () => {
    stubServiceWorker();
    const w = fakeWorld({ permission: 'granted', uid: 'u1' });
    _setWebPushDepsForTest(w.deps);
    const sub = trackedSub(w, EP);
    await seed('u1');
    startWebPushBoot({ route: vi.fn(), isProd: true });
    emit('auth:changed', { uid: 'u1' });
    await vi.waitFor(() => expect(w.calls).toContain('register'));
    emit('auth:changed', { uid: null });
    await vi.waitFor(() => expect(sub.unsubscribed).toBe(true));
    expect(readWebPushRecord()).toBeNull();
    expect(w.calls).not.toContain('unregister');
    // 掛了 message 監聽（D1 (B)）
    expect((navigator.serviceWorker.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('message');
  });

  it('beforeSignOut：自己的紀錄 → 解除＋退訂；Callable 卡住最多等 2 秒就回來', async () => {
    const w = fakeWorld({ permission: 'granted', uid: 'u1' });
    _setWebPushDepsForTest(w.deps);
    trackedSub(w, EP);
    await seed('u1');
    await beforeSignOut();
    expect(w.calls).toEqual(['getSubscription', 'unregister', 'unsubscribe']);
    expect(readWebPushRecord()).toBeNull();

    vi.useFakeTimers();
    const s = fakeWorld({ permission: 'granted', uid: 'u1' });
    s.deps.unregister = () => new Promise(() => {});
    _setWebPushDepsForTest(s.deps);
    trackedSub(s, EP);
    await seed('u1');
    let done = false;
    const p = beforeSignOut().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });
});
