import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

// T-041 退修 1（顧問定案的登入旗標閘）：
// 上次已登入（localStorage 旗標 fcb:signed-in）→ 先走 Auth，等 Auth 的第一次狀態事件再初始化 Firestore；
// 沒旗標（真訪客）→ 照「首頁公開讀取優先」立即初始化 Firestore，不等 Auth。
// 原因與取捨見 data/firebase.ts 的「登入旗標閘」註解。

const FLAG_KEY = 'fcb:signed-in';

const sdk = vi.hoisted(() => ({
  importOrder: [] as string[],
  calls: [] as string[],
  fail: { auth: false },
  authGate: null as null | { promise: Promise<void> },
  fakeApp: { name: 'fake-app' },
  fakeDb: { name: 'fake-db' },
  fakeFunctions: { name: 'fake-functions' },
}));

const fakeAuth = {
  name: 'fake-auth',
  authStateReady: () => {
    sdk.calls.push('authStateReady:called');
    return (sdk.authGate?.promise ?? Promise.resolve()).then(() => {
      sdk.calls.push('authStateReady:resolved');
    });
  },
};

const appFactory = async () => {
  sdk.importOrder.push('app');
  return { getApps: () => [], getApp: () => sdk.fakeApp, initializeApp: () => sdk.fakeApp };
};
const firestoreFactory = async () => {
  sdk.importOrder.push('firestore');
  return {
    initializeFirestore: () => {
      sdk.calls.push('initializeFirestore');
      return sdk.fakeDb;
    },
    persistentLocalCache: () => ({}),
    persistentMultipleTabManager: () => ({}),
    memoryLocalCache: () => ({}),
    getFirestore: () => sdk.fakeDb,
    connectFirestoreEmulator: () => undefined,
  };
};
const authFactory = async () => {
  sdk.importOrder.push('auth');
  if (sdk.fail.auth) throw new Error('auth chunk failed');
  return {
    getAuth: () => {
      sdk.calls.push('getAuth');
      return fakeAuth;
    },
    connectAuthEmulator: () => undefined,
  };
};
const functionsFactory = async () => {
  sdk.importOrder.push('functions');
  return { getFunctions: () => sdk.fakeFunctions, connectFunctionsEmulator: () => undefined };
};

type FirebaseModule = typeof import('./firebase');
let firebase: FirebaseModule;
let warn: MockInstance<typeof console.warn>;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function settledState(promise: Promise<unknown>): { settled: boolean } {
  const state = { settled: false };
  void promise.then(() => { state.settled = true; }, () => { state.settled = true; });
  return state;
}

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  sdk.importOrder.length = 0;
  sdk.calls.length = 0;
  sdk.fail.auth = false;
  sdk.authGate = null;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.doMock('firebase/app', appFactory);
  vi.doMock('firebase/firestore', firestoreFactory);
  vi.doMock('firebase/auth', authFactory);
  vi.doMock('firebase/functions', functionsFactory);
  firebase = await import('./firebase');
  firebase._resetFirebaseForTest();
});

afterEach(() => {
  firebase._resetFirebaseForTest();
  warn.mockRestore();
  localStorage.clear();
});

describe('有登入旗標（上次已登入）：Auth 先走，Firestore 等 Auth 的第一次狀態事件', () => {
  it('Firestore 初始化發生在 auth 第一次狀態事件「之後」', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    const gate = deferred();
    sdk.authGate = gate;

    const core = firebase.getFirebaseCore();
    const coreState = settledState(core);
    await wait(60);
    // Auth 已載入並開始等第一次狀態事件，Firestore 還沒初始化、core 也還沒 resolve
    expect(sdk.calls).toContain('getAuth');
    expect(sdk.calls).toContain('authStateReady:called');
    expect(sdk.calls).not.toContain('initializeFirestore');
    expect(coreState.settled).toBe(false);

    gate.resolve();
    const ctx = await core;
    expect(ctx.db).toBe(sdk.fakeDb);
    expect(sdk.calls.indexOf('authStateReady:resolved')).toBeGreaterThan(-1);
    expect(sdk.calls.indexOf('initializeFirestore')).toBeGreaterThan(sdk.calls.indexOf('authStateReady:resolved'));
    expect(sdk.calls.indexOf('getAuth')).toBeLessThan(sdk.calls.indexOf('initializeFirestore'));
  });

  it('不暫緩 Auth：即使首頁暫緩機制被啟動，有旗標時 Auth 仍然立刻載入（Auth 先走，不會互等）', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    firebase.armFirebaseAuthHold({ capMs: 60_000, afterCoreMs: 60_000 });
    firebase.trackPublicRead(new Promise(() => undefined)); // 永遠不回來的公開讀取

    const full = await firebase.getFirebase();
    expect(full.auth).toBe(fakeAuth);
    expect(sdk.importOrder).toContain('auth');
  });

  it('getFirebase() 照常回傳四個欄位', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    const ctx = await firebase.getFirebase();
    expect(ctx).toMatchObject({ app: sdk.fakeApp, db: sdk.fakeDb, auth: fakeAuth, functions: sdk.fakeFunctions });
  });

  it('保險：Auth 的第一次狀態事件不來 → 逾時後照樣放行 Firestore，並記警告', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    sdk.authGate = deferred(); // 永遠不 resolve
    firebase._setSessionGateTimingForTest({ afterCoreMs: 50, capMs: 60_000 });

    const startedAt = Date.now();
    const ctx = await firebase.getFirebaseCore();
    expect(ctx.db).toBe(sdk.fakeDb);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40);
    expect(sdk.calls).toContain('initializeFirestore');
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('等不到 Auth 的第一次狀態事件'))).toBe(true);
  });

  it('保險：整體上限已過（capMs 用完）→ 不再等，立即放行', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    sdk.authGate = deferred();
    firebase._setSessionGateTimingForTest({ afterCoreMs: 60_000, capMs: 0 });

    const startedAt = Date.now();
    await firebase.getFirebaseCore();
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(sdk.calls).toContain('initializeFirestore');
  });

  it('保險：Auth 模組載入失敗 → 放行 Firestore 並警告；getFirebase() 仍會拒絕讓呼叫端知道', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    sdk.fail.auth = true;

    const ctx = await firebase.getFirebaseCore();
    expect(ctx.db).toBe(sdk.fakeDb);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('Auth 載入失敗'))).toBe(true);
    await expect(firebase.getFirebase()).rejects.toThrow();
  });
});

describe('沒有登入旗標（真訪客）：照舊立即初始化 Firestore，不等 Auth', () => {
  it('Firestore 立即初始化；Auth 完全沒被碰（沒人要 auth 時不載入）', async () => {
    sdk.authGate = deferred(); // 就算 Auth 永遠不回來也不影響
    const ctx = await firebase.getFirebaseCore();
    expect(ctx.db).toBe(sdk.fakeDb);
    await wait(30);
    expect(sdk.calls).toEqual(['initializeFirestore']);
    expect(sdk.importOrder).not.toContain('auth');
    expect(sdk.calls).not.toContain('authStateReady:called');
  });

  it('旗標壞掉或 localStorage 不能用 → 當成訪客，不丟錯', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    try {
      firebase._resetFirebaseForTest();
      const ctx = await firebase.getFirebaseCore();
      expect(ctx.db).toBe(sdk.fakeDb);
      expect(sdk.calls).toEqual(['initializeFirestore']);
    } finally {
      getItem.mockRestore();
    }
  });

  it('旗標是啟動時決定的：同一個頁面中途才登入（寫入旗標）不會讓 core 與 extras 互等', async () => {
    const core = await firebase.getFirebaseCore();
    localStorage.setItem(FLAG_KEY, '1'); // 會話中才登入
    const full = await firebase.getFirebase();
    expect(full.db).toBe(core.db);
    expect(full.auth).toBe(fakeAuth);
  });
});
