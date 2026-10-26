import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// T-041：開在首頁時，先讓首頁的公開讀取（events／banners／announcements）跑完，再讓 Auth 註冊。
// 原因見 data/firebase.ts 的「首頁公開讀取優先」：Auth 一註冊進 Firestore，Firestore 的非同步佇列就停到
// Auth 初始化完成（登入者實測 2～4 秒），公開資料的查詢與回應也跟著排在後面。

const sdk = vi.hoisted(() => ({
  importOrder: [] as string[],
  calls: [] as string[],
  fakeApp: { name: 'fake-app' },
  fakeDb: { name: 'fake-db' },
  fakeAuth: { name: 'fake-auth' },
  fakeFunctions: { name: 'fake-functions' },
}));

const appFactory = async () => {
  sdk.importOrder.push('app');
  return {
    getApps: () => [],
    getApp: () => sdk.fakeApp,
    initializeApp: () => sdk.fakeApp,
  };
};
const firestoreFactory = async () => {
  sdk.importOrder.push('firestore');
  return {
    initializeFirestore: () => sdk.fakeDb,
    persistentLocalCache: () => ({}),
    persistentMultipleTabManager: () => ({}),
    memoryLocalCache: () => ({}),
    getFirestore: () => sdk.fakeDb,
    connectFirestoreEmulator: () => undefined,
  };
};
const authFactory = async () => {
  sdk.importOrder.push('auth');
  return {
    getAuth: () => {
      sdk.calls.push('getAuth');
      return sdk.fakeAuth;
    },
    connectAuthEmulator: () => undefined,
  };
};
const functionsFactory = async () => {
  sdk.importOrder.push('functions');
  return {
    getFunctions: () => sdk.fakeFunctions,
    connectFunctionsEmulator: () => undefined,
  };
};

type FirebaseModule = typeof import('./firebase');
let firebase: FirebaseModule;

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (e: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stateOf(promise: Promise<unknown>): { settled: boolean } {
  const state = { settled: false };
  void promise.then(() => { state.settled = true; }, () => { state.settled = true; });
  return state;
}

beforeEach(async () => {
  vi.resetModules();
  sdk.importOrder.length = 0;
  sdk.calls.length = 0;
  vi.doMock('firebase/app', appFactory);
  vi.doMock('firebase/firestore', firestoreFactory);
  vi.doMock('firebase/auth', authFactory);
  vi.doMock('firebase/functions', functionsFactory);
  firebase = await import('./firebase');
});

afterEach(() => {
  firebase._resetFirebaseForTest();
});

describe('Auth 暫緩（首頁公開讀取優先）', () => {
  it('沒有暫緩時，whenFirebaseAuthAllowed 立即 resolve、trackPublicRead 原樣回傳', async () => {
    const read = Promise.resolve(42);
    expect(firebase.trackPublicRead(read)).toBe(read);
    const state = stateOf(firebase.whenFirebaseAuthAllowed());
    await wait(5);
    expect(state.settled).toBe(true);
  });

  it('暫緩中：全部登記的公開讀取處理完（成功或失敗）才放行', async () => {
    firebase.armFirebaseAuthHold({ settleMs: 5 });
    const events = deferred<number>();
    const banners = deferred<number>();
    const announcements = deferred<number>();
    firebase.trackPublicRead(events.promise);
    firebase.trackPublicRead(banners.promise);
    firebase.trackPublicRead(announcements.promise);
    const allowed = stateOf(firebase.whenFirebaseAuthAllowed());

    events.resolve(1);
    banners.reject(new Error('banners failed'));
    await wait(30);
    expect(allowed.settled).toBe(false); // 公告還沒回來

    announcements.resolve(3);
    await wait(30);
    expect(allowed.settled).toBe(true);
  });

  it('trackPublicRead 不改變讀取本身的結果與錯誤', async () => {
    firebase.armFirebaseAuthHold({ settleMs: 5 });
    await expect(firebase.trackPublicRead(Promise.resolve('ok'))).resolves.toBe('ok');
    await expect(firebase.trackPublicRead(Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  it('讀取緊接著登記（同一批 effect）時不會在中間提早放行', async () => {
    firebase.armFirebaseAuthHold({ settleMs: 20 });
    const first = deferred();
    firebase.trackPublicRead(first.promise);
    const allowed = stateOf(firebase.whenFirebaseAuthAllowed());

    first.resolve();
    await wait(5); // 還在 settle 等待期內，又登記了第二個讀取
    const second = deferred();
    firebase.trackPublicRead(second.promise);
    await wait(40);
    expect(allowed.settled).toBe(false);

    second.resolve();
    await wait(40);
    expect(allowed.settled).toBe(true);
  });

  it('離開首頁（releaseFirebaseAuthHold）立刻放行，且可重複呼叫', async () => {
    firebase.armFirebaseAuthHold();
    firebase.trackPublicRead(new Promise(() => undefined)); // 永遠不回來的讀取
    const allowed = stateOf(firebase.whenFirebaseAuthAllowed());
    await wait(5);
    expect(allowed.settled).toBe(false);

    firebase.releaseFirebaseAuthHold();
    firebase.releaseFirebaseAuthHold();
    await wait(5);
    expect(allowed.settled).toBe(true);
  });

  it('保險：公開讀取沒回來，整體上限到了也會放行', async () => {
    firebase.armFirebaseAuthHold({ capMs: 30 });
    firebase.trackPublicRead(new Promise(() => undefined));
    const allowed = stateOf(firebase.whenFirebaseAuthAllowed());
    await wait(10);
    expect(allowed.settled).toBe(false);
    await wait(60);
    expect(allowed.settled).toBe(true);
  });

  it('保險：core 就緒後再等 afterCoreMs，公開讀取沒回來也會放行', async () => {
    firebase.armFirebaseAuthHold({ afterCoreMs: 40 });
    firebase.trackPublicRead(new Promise(() => undefined));
    const allowed = stateOf(firebase.whenFirebaseAuthAllowed());

    await firebase.getFirebaseCore();
    await wait(10);
    expect(allowed.settled).toBe(false);
    await wait(80);
    expect(allowed.settled).toBe(true);
  });

  it('暫緩中 getFirebase() 不會載入也不會初始化 auth；放行後才載入，且 getFirebase 一定等到 auth 就緒', async () => {
    firebase.armFirebaseAuthHold({ afterCoreMs: 5000 });
    const read = deferred();
    firebase.trackPublicRead(read.promise);

    const full = firebase.getFirebase();
    const fullState = stateOf(full);
    await firebase.getFirebaseCore();
    await wait(40);
    // 公開讀取還沒處理完：auth／functions 連 import 都還沒開始（模組一評估就會把 Auth 註冊進 app）
    expect(sdk.importOrder).not.toContain('auth');
    expect(sdk.calls).not.toContain('getAuth');
    expect(fullState.settled).toBe(false);

    read.resolve();
    const ctx = await full;
    expect(sdk.importOrder.indexOf('auth')).toBeGreaterThan(sdk.importOrder.indexOf('firestore'));
    expect(sdk.calls).toContain('getAuth');
    expect(ctx.auth).toBe(sdk.fakeAuth);
    expect(ctx.functions).toBe(sdk.fakeFunctions);
  });

  it('getFirebaseCore 在暫緩期間照常、不受影響', async () => {
    firebase.armFirebaseAuthHold({ afterCoreMs: 5000 });
    firebase.trackPublicRead(new Promise(() => undefined));
    const core = await firebase.getFirebaseCore();
    expect(core.db).toBe(sdk.fakeDb);
  });
});
