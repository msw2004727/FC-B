import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEB_PUSH_REPORT_INTERVAL_MS,
  WEB_PUSH_RETRY_BACKOFF_MS,
  WEB_PUSH_VAPID_KEY_ID,
} from './config';
import {
  _resetWebPushFlowsForTest,
  disableWebPush,
  dropForeignSubscription,
  enableWebPush,
  readWebPushLocalState,
  releaseBeforeSignOut,
  syncWebPushOnBoot,
  webPushPlatformOf,
} from './flows';
import { clearWebPushRecord, hash32, readWebPushRecord, writeWebPushRecord, type WebPushRecord } from './store';
import { fakeWorld, trackedSub, type FakeWorld } from './test-fakes';
import { WebPushCallError } from './wp-callables';

async function seedRecord(world: FakeWorld, uid: string, endpoint: string, extra: Partial<WebPushRecord> = {}): Promise<void> {
  writeWebPushRecord({
    v: 1,
    uidHash: await hash32(uid),
    endpointHash: await hash32(endpoint),
    keyId: WEB_PUSH_VAPID_KEY_ID,
    reportedAt: world.state.now,
    ...extra,
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  clearWebPushRecord();
  _resetWebPushFlowsForTest();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('F 開啟流程', () => {
  it('F1 requestPermission 在第一個 microtask 之前（同步）被呼叫', () => {
    const w = fakeWorld();
    const p = enableWebPush('u1', w.deps);
    expect(w.calls[0]).toBe('requestPermission');
    return p;
  });

  it('F1 查畫面狀態、開機同步、關閉都不會詢問權限', async () => {
    const w = fakeWorld();
    await readWebPushLocalState('u1', w.deps);
    await syncWebPushOnBoot('u1', w.deps);
    await disableWebPush(w.deps);
    await releaseBeforeSignOut(w.deps);
    expect(w.calls).not.toContain('requestPermission');
  });

  it('F2 允許 → subscribe → register → 寫紀錄 → on', async () => {
    const w = fakeWorld();
    await expect(enableWebPush('u1', w.deps)).resolves.toBe('on');
    expect(w.calls).toEqual(['requestPermission', 'getSubscription', 'subscribe', 'register']);
    const rec = readWebPushRecord();
    expect(rec?.uidHash).toBe(await hash32('u1'));
    expect(rec?.endpointHash).toBe(await hash32(w.state.sub!.endpoint));
    expect(rec?.keyId).toBe(WEB_PUSH_VAPID_KEY_ID);
    expect(JSON.stringify(rec)).not.toContain('fcm.googleapis.com');
  });

  it('F3 詢問選封鎖 → blocked；F4 詢問被關掉 → dismissed（不提示）', async () => {
    const a = fakeWorld({ answer: 'denied' });
    await expect(enableWebPush('u1', a.deps)).resolves.toBe('blocked');
    const b = fakeWorld({ answer: 'default' });
    await expect(enableWebPush('u1', b.deps)).resolves.toBe('dismissed');
    expect(a.calls).not.toContain('subscribe');
    expect(b.calls).not.toContain('subscribe');
  });

  it('F5 subscribe 丟錯 → failed，沒有 register', async () => {
    const w = fakeWorld({ subscribeError: new Error('x') });
    await expect(enableWebPush('u1', w.deps)).resolves.toBe('failed');
    expect(w.calls).not.toContain('register');
    expect(readWebPushRecord()).toBeNull();
  });

  it.each(['failed-precondition', 'resource-exhausted', 'invalid-argument', 'unauthenticated', 'internal', 'timeout'] as const)(
    'F6 register 失敗（%s）→ 收回新建訂閱、failed',
    async (code) => {
      const w = fakeWorld({ registerError: new WebPushCallError(code) });
      await expect(enableWebPush('u1', w.deps)).resolves.toBe('failed');
      expect(w.state.sub?.unsubscribed).toBe(true);
      expect(readWebPushRecord()).toBeNull();
    },
  );

  it('F6 沿用既有訂閱時 register 失敗不退訂', async () => {
    const w = fakeWorld({ permission: 'granted', registerError: new WebPushCallError('internal') });
    const sub = trackedSub(w, 'https://fcm.googleapis.com/fcm/send/old');
    await expect(enableWebPush('u1', w.deps)).resolves.toBe('failed');
    expect(sub.unsubscribed).toBe(false);
  });

  it('F7 已有同公鑰訂閱 → 不再 subscribe', async () => {
    const w = fakeWorld({ permission: 'granted' });
    trackedSub(w, 'https://fcm.googleapis.com/fcm/send/old');
    await expect(enableWebPush('u1', w.deps)).resolves.toBe('on');
    expect(w.calls).toEqual(['getSubscription', 'register']);
  });

  it('F7 公鑰不同 → unregister（舊）→ unsubscribe → subscribe → register', async () => {
    const w = fakeWorld({ permission: 'granted' });
    trackedSub(w, 'https://fcm.googleapis.com/fcm/send/old', new Uint8Array(65).fill(4));
    await expect(enableWebPush('u1', w.deps)).resolves.toBe('on');
    expect(w.calls).toEqual(['getSubscription', 'unregister', 'unsubscribe', 'subscribe', 'register']);
  });

  it('F8 關閉：unregister 在 unsubscribe 之前；兩者失敗仍刪紀錄、回 off', async () => {
    const w = fakeWorld({ permission: 'granted' });
    trackedSub(w, 'https://fcm.googleapis.com/fcm/send/a');
    await seedRecord(w, 'u1', 'https://fcm.googleapis.com/fcm/send/a');
    await expect(disableWebPush(w.deps)).resolves.toBe('off');
    expect(w.calls).toEqual(['getSubscription', 'unregister', 'unsubscribe']);
    expect(readWebPushRecord()).toBeNull();

    const f = fakeWorld({ permission: 'granted', unregisterError: new WebPushCallError('internal') });
    const sub = trackedSub(f, 'https://fcm.googleapis.com/fcm/send/b');
    sub.unsubscribe = async () => {
      f.calls.push('unsubscribe');
      throw new Error('nope');
    };
    await seedRecord(f, 'u1', sub.endpoint);
    await expect(disableWebPush(f.deps)).resolves.toBe('off');
    expect(f.calls).toEqual(['getSubscription', 'unregister', 'unsubscribe']);
    expect(readWebPushRecord()).toBeNull();
  });

  it('F9 流程中 uid 換人 → stale、收回新建訂閱、不寫紀錄', async () => {
    const w = fakeWorld();
    const gate = deferred<void>();
    const orig = w.deps.register;
    w.deps.register = async (req) => {
      await gate.promise;
      return orig(req);
    };
    const p = enableWebPush('u1', w.deps);
    await vi.waitFor(() => expect(w.calls).toContain('subscribe'));
    w.state.uid = 'u2';
    gate.resolve();
    await expect(p).resolves.toBe('stale');
    expect(w.state.sub?.unsubscribed).toBe(true);
    expect(readWebPushRecord()).toBeNull();
  });

  it('F10 連按兩次只跑一次；開機同步進行中按開關 → 開機讓路', async () => {
    const w = fakeWorld();
    const first = enableWebPush('u1', w.deps);
    const second = enableWebPush('u1', w.deps);
    await expect(second).resolves.toBe('busy');
    await expect(first).resolves.toBe('on');
    expect(w.calls.filter((c) => c === 'register')).toHaveLength(1);

    // 開機同步卡在 getRegistration 時使用者按開關：開機讓路（yield），使用者流程照跑。
    const b = fakeWorld({ permission: 'granted' });
    await seedRecord(b, 'u1', 'https://fcm.googleapis.com/fcm/send/gone', { reportedAt: b.state.now - WEB_PUSH_REPORT_INTERVAL_MS });
    const gate = deferred<void>();
    const origReg = b.deps.getRegistration;
    let firstCall = true;
    b.deps.getRegistration = async () => {
      if (firstCall) {
        firstCall = false;
        await gate.promise;
      }
      return origReg();
    };
    const boot = syncWebPushOnBoot('u1', b.deps);
    const user = enableWebPush('u1', b.deps);
    gate.resolve();
    await expect(boot).resolves.toBe('yield');
    await expect(user).resolves.toBe('on');
    // 開機同步沒有 subscribe／register，只有使用者那一次。
    expect(b.calls.filter((c) => c === 'register')).toHaveLength(1);
  });

  it('F11 第一次失敗、第二次成功', async () => {
    const w = fakeWorld({ registerError: new WebPushCallError('internal') });
    await expect(enableWebPush('u1', w.deps)).resolves.toBe('failed');
    w.state.registerError = null;
    await expect(enableWebPush('u1', w.deps)).resolves.toBe('on');
    expect(readWebPushRecord()).not.toBeNull();
  });

  it('F12 註冊還沒 active 時等 ready，5 秒逾時 → failed', async () => {
    vi.useFakeTimers();
    const w = fakeWorld({ permission: 'granted', active: false });
    w.deps.ready = () => new Promise(() => {});
    const p = enableWebPush('u1', w.deps);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe('failed');
  });

  it('沒有 SW 註冊 → failed（不自行註冊）', async () => {
    const w = fakeWorld({ permission: 'granted', hasRegistration: false });
    await expect(enableWebPush('u1', w.deps)).resolves.toBe('failed');
  });
});

describe('B 開機同步', () => {
  const EP = 'https://fcm.googleapis.com/fcm/send/a';

  it('沒紀錄：0 次呼叫（即使已有權限也不替人訂閱）', async () => {
    const w = fakeWorld({ permission: 'granted' });
    await expect(syncWebPushOnBoot('u1', w.deps)).resolves.toBe('noop');
    expect(w.calls).toEqual([]);
  });

  it('紀錄新於 7 天：不呼叫 Callable', async () => {
    const w = fakeWorld({ permission: 'granted' });
    trackedSub(w, EP);
    await seedRecord(w, 'u1', EP, { reportedAt: w.state.now - WEB_PUSH_REPORT_INTERVAL_MS + 1 });
    await expect(syncWebPushOnBoot('u1', w.deps)).resolves.toBe('noop');
    expect(w.calls).not.toContain('register');
  });

  it('≥ 7 天：register 一次、更新 reportedAt', async () => {
    const w = fakeWorld({ permission: 'granted' });
    trackedSub(w, EP);
    await seedRecord(w, 'u1', EP, { reportedAt: w.state.now - WEB_PUSH_REPORT_INTERVAL_MS });
    await expect(syncWebPushOnBoot('u1', w.deps)).resolves.toBe('reported');
    expect(w.calls.filter((c) => c === 'register')).toHaveLength(1);
    expect(readWebPushRecord()?.reportedAt).toBe(w.state.now);
  });

  it('訂閱不見了 → subscribe＋register；subscribe 被拒 → 刪紀錄', async () => {
    const w = fakeWorld({ permission: 'granted' });
    await seedRecord(w, 'u1', EP);
    await expect(syncWebPushOnBoot('u1', w.deps)).resolves.toBe('reported');
    expect(w.calls).toEqual(['getSubscription', 'subscribe', 'register']);

    const r = fakeWorld({ permission: 'granted', subscribeError: new Error('NotAllowedError') });
    await seedRecord(r, 'u1', EP);
    await expect(syncWebPushOnBoot('u1', r.deps)).resolves.toBe('cleared');
    expect(readWebPushRecord()).toBeNull();
  });

  it('endpoint 變了 → register', async () => {
    const w = fakeWorld({ permission: 'granted' });
    trackedSub(w, 'https://fcm.googleapis.com/fcm/send/new');
    await seedRecord(w, 'u1', EP);
    await expect(syncWebPushOnBoot('u1', w.deps)).resolves.toBe('reported');
    expect(w.calls).toEqual(['getSubscription', 'register']);
  });

  it('公鑰變了 → unregister → unsubscribe → subscribe → register（§5.5 順序）', async () => {
    const w = fakeWorld({ permission: 'granted' });
    trackedSub(w, EP, new Uint8Array(65).fill(4));
    await seedRecord(w, 'u1', EP);
    await expect(syncWebPushOnBoot('u1', w.deps)).resolves.toBe('reported');
    expect(w.calls).toEqual(['getSubscription', 'unregister', 'unsubscribe', 'subscribe', 'register']);
  });

  it('紀錄 keyId 不同（舊瀏覽器沒有 options）也走換版', async () => {
    const w = fakeWorld({ permission: 'granted' });
    trackedSub(w, EP, null);
    await seedRecord(w, 'u1', EP, { keyId: 'oldkeyid00000000' });
    await expect(syncWebPushOnBoot('u1', w.deps)).resolves.toBe('reported');
    expect(w.calls).toEqual(['getSubscription', 'unregister', 'unsubscribe', 'subscribe', 'register']);
  });

  it('權限被撤銷 → unregister＋unsubscribe、刪紀錄', async () => {
    const w = fakeWorld({ permission: 'denied' });
    trackedSub(w, EP);
    await seedRecord(w, 'u1', EP);
    await expect(syncWebPushOnBoot('u1', w.deps)).resolves.toBe('cleared');
    expect(w.calls).toEqual(['getSubscription', 'getSubscription', 'unregister', 'unsubscribe']);
    expect(readWebPushRecord()).toBeNull();
  });

  it('別人的紀錄、沒人登入 → unsubscribe＋清，不 register、不 unregister', async () => {
    for (const uid of ['u2', null]) {
      const w = fakeWorld({ permission: 'granted' });
      const sub = trackedSub(w, EP);
      await seedRecord(w, 'u1', EP);
      await expect(syncWebPushOnBoot(uid, w.deps)).resolves.toBe('dropped');
      expect(sub.unsubscribed).toBe(true);
      expect(w.calls).not.toContain('register');
      expect(w.calls).not.toContain('unregister');
      expect(readWebPushRecord()).toBeNull();
    }
  });

  it('dropForeignSubscription：自己的紀錄不動', async () => {
    const w = fakeWorld({ permission: 'granted' });
    const sub = trackedSub(w, EP);
    await seedRecord(w, 'u1', EP);
    await expect(dropForeignSubscription('u1', w.deps)).resolves.toBe(false);
    expect(sub.unsubscribed).toBe(false);
  });

  it('failAt 6 小時內不重試；過了才試', async () => {
    const w = fakeWorld({ permission: 'granted' });
    trackedSub(w, EP);
    await seedRecord(w, 'u1', EP, { reportedAt: 0, failAt: w.state.now - WEB_PUSH_RETRY_BACKOFF_MS + 1 });
    await expect(syncWebPushOnBoot('u1', w.deps)).resolves.toBe('noop');
    expect(w.calls).toEqual([]);
    w.state.now += 1;
    await expect(syncWebPushOnBoot('u1', w.deps)).resolves.toBe('reported');
  });

  it('register 失敗（internal）→ 寫 failAt；failed-precondition → 同 keyId 不再試', async () => {
    const w = fakeWorld({ permission: 'granted', registerError: new WebPushCallError('internal') });
    trackedSub(w, EP);
    await seedRecord(w, 'u1', EP, { reportedAt: 0 });
    await expect(syncWebPushOnBoot('u1', w.deps)).resolves.toBe('failed');
    expect(readWebPushRecord()?.failAt).toBe(w.state.now);

    clearWebPushRecord();
    const k = fakeWorld({ permission: 'granted', registerError: new WebPushCallError('failed-precondition') });
    trackedSub(k, EP);
    await seedRecord(k, 'u1', EP, { reportedAt: 0 });
    await expect(syncWebPushOnBoot('u1', k.deps)).resolves.toBe('failed');
    expect(readWebPushRecord()?.rejectedKeyId).toBe(WEB_PUSH_VAPID_KEY_ID);
    k.calls.length = 0;
    k.state.now += WEB_PUSH_RETRY_BACKOFF_MS * 10;
    await expect(syncWebPushOnBoot('u1', k.deps)).resolves.toBe('noop');
    expect(k.calls).toEqual([]);
  });

  it('register 回 invalid-argument → 收回訂閱、刪紀錄；unauthenticated → 不動', async () => {
    const w = fakeWorld({ permission: 'granted', registerError: new WebPushCallError('invalid-argument') });
    const sub = trackedSub(w, EP);
    await seedRecord(w, 'u1', EP, { reportedAt: 0 });
    await syncWebPushOnBoot('u1', w.deps);
    expect(sub.unsubscribed).toBe(true);
    expect(readWebPushRecord()).toBeNull();

    const u = fakeWorld({ permission: 'granted', registerError: new WebPushCallError('unauthenticated') });
    trackedSub(u, EP);
    await seedRecord(u, 'u1', EP, { reportedAt: 0 });
    await syncWebPushOnBoot('u1', u.deps);
    expect(readWebPushRecord()?.failAt).toBeUndefined();
  });

  it('沒有 SW 註冊 → no-op', async () => {
    const w = fakeWorld({ permission: 'granted', hasRegistration: false });
    await seedRecord(w, 'u1', EP, { reportedAt: 0 });
    await expect(syncWebPushOnBoot('u1', w.deps)).resolves.toBe('noop');
  });
});

describe('登出前與畫面狀態', () => {
  const EP = 'https://fcm.googleapis.com/fcm/send/a';

  it('releaseBeforeSignOut：自己的紀錄 → unregister → unsubscribe → 刪；別人的不呼叫解除', async () => {
    const w = fakeWorld({ permission: 'granted' });
    trackedSub(w, EP);
    await seedRecord(w, 'u1', EP);
    await releaseBeforeSignOut(w.deps);
    expect(w.calls).toEqual(['getSubscription', 'unregister', 'unsubscribe']);
    expect(readWebPushRecord()).toBeNull();

    const o = fakeWorld({ permission: 'granted', uid: 'u2' });
    trackedSub(o, EP);
    await seedRecord(o, 'u1', EP);
    await releaseBeforeSignOut(o.deps);
    expect(o.calls).toEqual([]);
  });

  it('readWebPushLocalState：各狀態', async () => {
    expect(await readWebPushLocalState('u1', fakeWorld({ hasRegistration: false }).deps)).toBe('hidden');
    expect(await readWebPushLocalState('u1', fakeWorld({ permission: 'denied' }).deps)).toBe('blocked');
    expect(await readWebPushLocalState('u1', fakeWorld({ permission: 'default' }).deps)).toBe('off');
    const w = fakeWorld({ permission: 'granted' });
    expect(await readWebPushLocalState('u1', w.deps)).toBe('off');
    await seedRecord(w, 'u1', EP);
    expect(await readWebPushLocalState('u1', w.deps)).toBe('needs-sync');
    trackedSub(w, EP);
    expect(await readWebPushLocalState('u1', w.deps)).toBe('on');
    expect(await readWebPushLocalState('u2', w.deps)).toBe('off');
    w.state.now += WEB_PUSH_REPORT_INTERVAL_MS;
    expect(await readWebPushLocalState('u1', w.deps)).toBe('needs-sync');
  });

  it('平台判斷', () => {
    expect(webPushPlatformOf('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile', false, 5)).toBe('android');
    expect(webPushPlatformOf('Mozilla/5.0 (Windows NT 10.0) Chrome/130', false, 0)).toBe('desktop');
    expect(webPushPlatformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) Mobile/15E148', true, 5)).toBe('ios_pwa');
    expect(webPushPlatformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) Mobile/15E148', false, 5)).toBe('other');
  });
});
