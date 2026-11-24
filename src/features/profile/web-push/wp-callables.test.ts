import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const httpsCallable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: (...args: unknown[]) => httpsCallable(...args) }));
vi.mock('@/data/firebase', () => ({ getFirebase: vi.fn(async () => ({ functions: { region: 'asia-east1' } })) }));

import {
  clearWebPushMocks,
  registerWebPushMock,
  registerWebPushSubscription,
  toWebPushCallError,
  unregisterWebPushSubscription,
  WebPushCallError,
} from './wp-callables';

const REQ = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'P', auth: 'A', extra: 'no' },
  vapidKeyId: '726cade1dd107515',
  platform: 'desktop' as const,
  uid: 'should-not-be-sent',
};

describe('C Callable 包裝', () => {
  beforeEach(() => {
    httpsCallable.mockReset();
    clearWebPushMocks();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('live：只送白名單鍵、名稱正確、用 asia-east1 的 functions 實例、10 秒逾時', async () => {
    const call = vi.fn(async () => ({ data: { ok: true } }));
    httpsCallable.mockReturnValue(call);
    await registerWebPushSubscription(REQ);
    expect(httpsCallable).toHaveBeenCalledWith({ region: 'asia-east1' }, 'registerWebPushSubscription', { timeout: 10000 });
    expect(call).toHaveBeenCalledWith({
      endpoint: REQ.endpoint,
      keys: { p256dh: 'P', auth: 'A' },
      vapidKeyId: '726cade1dd107515',
      platform: 'desktop',
    });
    await unregisterWebPushSubscription({ endpoint: REQ.endpoint, other: 1 } as never);
    expect(httpsCallable).toHaveBeenLastCalledWith({ region: 'asia-east1' }, 'unregisterWebPushSubscription', { timeout: 10000 });
    expect(call).toHaveBeenLastCalledWith({ endpoint: REQ.endpoint });
  });

  it('mock 模式不連 Functions', async () => {
    vi.stubEnv('VITE_CALLABLE_MODE', 'mock');
    const handler = vi.fn((data: Record<string, unknown>) => ({ ok: true, data }));
    registerWebPushMock('registerWebPushSubscription', handler);
    await registerWebPushSubscription(REQ);
    expect(httpsCallable).not.toHaveBeenCalled();
    expect(Object.keys(handler.mock.calls[0]![0]).sort()).toEqual(['endpoint', 'keys', 'platform', 'vapidKeyId']);
    await expect(unregisterWebPushSubscription({ endpoint: 'x' })).rejects.toMatchObject({ code: 'internal' });
  });

  it('錯誤碼轉換', () => {
    expect(toWebPushCallError({ code: 'functions/failed-precondition' }).code).toBe('failed-precondition');
    expect(toWebPushCallError({ code: 'functions/resource-exhausted' }).code).toBe('resource-exhausted');
    expect(toWebPushCallError({ code: 'invalid-argument' }).code).toBe('invalid-argument');
    expect(toWebPushCallError({ code: 'functions/unauthenticated' }).code).toBe('unauthenticated');
    expect(toWebPushCallError({ code: 'functions/deadline-exceeded' }).code).toBe('timeout');
    expect(toWebPushCallError({ code: 'functions/unavailable' }).code).toBe('internal');
    expect(toWebPushCallError(new Error('x')).code).toBe('internal');
    const e = new WebPushCallError('timeout');
    expect(toWebPushCallError(e)).toBe(e);
  });

  it('卡住 10 秒 → timeout；錯誤訊息不含 endpoint', async () => {
    vi.useFakeTimers();
    httpsCallable.mockReturnValue(() => new Promise(() => {}));
    const p = registerWebPushSubscription(REQ);
    const caught = p.catch((x: unknown) => x);
    await vi.advanceTimersByTimeAsync(10_000);
    const err = await caught;
    expect(err).toMatchObject({ code: 'timeout' });
    expect(String((err as Error).message)).not.toContain('fcm.googleapis.com');
  });
});
