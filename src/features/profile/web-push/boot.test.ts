import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emit } from '@/core/events';
import { evaluateReloadSafety } from '@/core/reload-safety';
import { beginSubmitting } from '@/core/submit-guard';
import {
  _resetWebPushBootForTest,
  beforeSignOut,
  handleWebPushOpenMessage,
  isSafeToRouteForPush,
  isStaticSitePath,
  sanitizeOpenPath,
  STATIC_SITE_SEGMENTS,
  startWebPushBoot,
  WEB_PUSH_OPEN_MESSAGE,
  type OpenMessageEnv,
} from './boot';
import { _resetWebPushFlowsForTest, _setWebPushDepsForTest, enableWebPush } from './flows';
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

  it('焦點停在 checkbox／radio 不算輸入中（審查 P3-1）；文字框、彈窗照樣不安全', () => {
    document.body.innerHTML = '<input id="c" type="checkbox"><input id="r" type="radio"><input id="t" type="text">';
    (document.getElementById('c') as HTMLInputElement).focus();
    expect(isSafeToRouteForPush()).toBe(true);
    (document.getElementById('r') as HTMLInputElement).focus();
    expect(isSafeToRouteForPush()).toBe(true);
    (document.getElementById('t') as HTMLInputElement).focus();
    expect(isSafeToRouteForPush()).toBe(false);
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true"><input id="c2" type="checkbox"></div>');
    (document.getElementById('c2') as HTMLInputElement).focus();
    expect(isSafeToRouteForPush()).toBe(false);
    (document.activeElement as HTMLElement).blur();
  });

  it('靜態頁路徑（§3.716 乙）：安全時先回 routed 再整頁換，不走站內路由', () => {
    for (const path of ['/privacy', '/privacy.html', '/terms', '/blog/', '/blog/football-rules.html', '/seo/football.html', '/manual?x=1', '/event-share/abc']) {
      const order: string[] = [];
      const port = { postMessage: vi.fn((_m: unknown) => { order.push('reply'); }) };
      const assign = vi.fn((_p: string) => { order.push('assign'); });
      const e = env({ assign });
      handleWebPushOpenMessage(msg({ type: WEB_PUSH_OPEN_MESSAGE, v: 1, path }, CONTROLLER, port), e);
      expect(e.route, path).not.toHaveBeenCalled();
      expect(assign, path).toHaveBeenCalledWith(path);
      expect(port.postMessage.mock.calls[0]![0], path).toStrictEqual({ v: 1, result: 'routed' });
      expect(order, path).toEqual(['reply', 'assign']);
    }
    for (const path of ['/', '/inbox', '/events/abc', '/blogx', '/privacy-x', '/teams/blog']) {
      expect(isStaticSitePath(path), path).toBe(false);
    }
  });

  it('靜態頁路徑但不安全 → 一律 kept，不換頁', () => {
    const port = makePort();
    const assign = vi.fn();
    const e = env({ isSafe: () => false, assign });
    handleWebPushOpenMessage(msg({ type: WEB_PUSH_OPEN_MESSAGE, v: 1, path: '/privacy' }, CONTROLLER, port), e);
    expect(assign).not.toHaveBeenCalled();
    expect(e.route).not.toHaveBeenCalled();
    expect(port.postMessage.mock.calls[0]![0]).toStrictEqual({ v: 1, result: 'kept' });
  });

  it('只對清洗後的路徑判斷：站外或不合格路徑退回 / 走站內路由，不整頁換', () => {
    for (const bad of ['//evil.com/privacy', 'https://evil.com/privacy', '/\\privacy']) {
      const assign = vi.fn();
      const e = env({ assign });
      handleWebPushOpenMessage(msg({ type: WEB_PUSH_OPEN_MESSAGE, v: 1, path: bad }, CONTROLLER), e);
      expect(assign, bad).not.toHaveBeenCalled();
      expect(e.route, bad).toHaveBeenCalledWith('/');
    }
  });

  it('靜態路徑清單對著 public/ 頂層與 _routes.json 核對（新增靜態頁要一起登記）', () => {
    const pub = resolve(__dirname, '../../../../public');
    const fromPublic = readdirSync(pub).map((n) => n.replace(/\.html$/, ''));
    const routes = JSON.parse(readFileSync(resolve(pub, '_routes.json'), 'utf8')) as { include: string[] };
    const fromWorker = routes.include.map((p) => p.slice(1).split('/')[0]!);
    const expected = [...new Set([...fromPublic, ...fromWorker])].sort();
    expect([...STATIC_SITE_SEGMENTS].sort()).toEqual(expected);
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

  it('beforeSignOut：Callable 卡住時本機退訂照樣完成、紀錄已刪（審查 P2-1）', async () => {
    const s = fakeWorld({ permission: 'granted', uid: 'u1' });
    s.deps.unregister = () => {
      s.calls.push('unregister');
      return new Promise(() => {});
    };
    _setWebPushDepsForTest(s.deps);
    const sub = trackedSub(s, EP);
    await seed('u1');
    await beforeSignOut(300);
    expect(s.calls).toEqual(['getSubscription', 'unregister', 'unsubscribe']);
    expect(sub.unsubscribed).toBe(true);
    expect(readWebPushRecord()).toBeNull();
  });

  it('使用者流程進行中換人（同步回 busy）→ 流程結束後補跑，前一位的訂閱照樣回收（審查 P3-2）', async () => {
    stubServiceWorker();
    const w = fakeWorld({ permission: 'granted', uid: 'u1' });
    _setWebPushDepsForTest(w.deps);
    const sub = trackedSub(w, EP);
    await seed('u1');
    startWebPushBoot({ route: vi.fn(), isProd: true });
    emit('auth:changed', { uid: 'u1' });
    await vi.waitFor(() => expect(w.calls).toContain('register'));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const orig = w.deps.register;
    let waiting = false;
    w.deps.register = async (req) => { waiting = true; await gate; return orig(req); };
    const pending = enableWebPush('u1', w.deps);
    await vi.waitFor(() => expect(waiting).toBe(true));
    w.state.uid = 'u2';
    emit('auth:changed', { uid: 'u2' });
    await new Promise((r) => setTimeout(r, 20));
    expect(sub.unsubscribed).toBe(false);
    release();
    await pending;
    await vi.waitFor(() => expect(sub.unsubscribed).toBe(true));
    expect(readWebPushRecord()).toBeNull();
  });
});
