import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// T-041 A4④：Firebase 拆兩段載入。
// - getFirebaseCore()：只載 app＋firestore，首頁資料路徑先到先用
// - getFirebase()：core ＋ auth／functions 都就緒才 resolve（延後載入的模組「被呼叫時會 await 就緒」）
// 動態 import 以可控制完成時機的 gate 模擬，才能觀察「還沒就緒時呼叫端被擋住」。

interface Gate {
  promise: Promise<void>;
  open: () => void;
  opened: boolean;
}

function makeGate(): Gate {
  let open!: () => void;
  const gate: Gate = {
    promise: new Promise<void>((resolve) => {
      open = () => {
        gate.opened = true;
        resolve();
      };
    }),
    open: () => open(),
    opened: false,
  };
  return gate;
}

const sdk = vi.hoisted(() => ({
  gates: {} as Record<'app' | 'firestore' | 'auth' | 'functions', { promise: Promise<void> }>,
  /** 設為 true 時，對應子模組的動態 import 會失敗（模擬 chunk 下載失敗）。 */
  fail: { auth: false },
  /** 各 SDK 子模組被 import（工廠被執行）的順序。 */
  importOrder: [] as string[],
  calls: [] as string[],
  fakeApp: { name: 'fake-app' },
  fakeDb: { name: 'fake-db' },
  fakeAuth: { name: 'fake-auth' },
  fakeFunctions: { name: 'fake-functions' },
}));

const appFactory = async () => {
  sdk.importOrder.push('app');
  await sdk.gates.app.promise;
  return {
    getApps: () => [],
    getApp: () => sdk.fakeApp,
    initializeApp: () => {
      sdk.calls.push('initializeApp');
      return sdk.fakeApp;
    },
  };
};

const firestoreFactory = async () => {
  sdk.importOrder.push('firestore');
  await sdk.gates.firestore.promise;
  return {
    initializeFirestore: () => {
      sdk.calls.push('initializeFirestore');
      return sdk.fakeDb;
    },
    persistentLocalCache: () => ({}),
    persistentMultipleTabManager: () => ({}),
    memoryLocalCache: () => ({}),
    getFirestore: () => sdk.fakeDb,
    connectFirestoreEmulator: () => {
      sdk.calls.push('connectFirestoreEmulator');
    },
  };
};

const authFactory = async () => {
  sdk.importOrder.push('auth');
  await sdk.gates.auth.promise;
  if (sdk.fail.auth) throw new Error('auth chunk failed');
  return {
    getAuth: (app: unknown) => {
      sdk.calls.push(`getAuth:${(app as { name: string }).name}`);
      return sdk.fakeAuth;
    },
    connectAuthEmulator: () => {
      sdk.calls.push('connectAuthEmulator');
    },
  };
};

const functionsFactory = async () => {
  sdk.importOrder.push('functions');
  await sdk.gates.functions.promise;
  return {
    getFunctions: (app: unknown, region: string) => {
      sdk.calls.push(`getFunctions:${(app as { name: string }).name}:${region}`);
      return sdk.fakeFunctions;
    },
    connectFunctionsEmulator: () => {
      sdk.calls.push('connectFunctionsEmulator');
    },
  };
};

type FirebaseModule = typeof import('./firebase');
let firebase: FirebaseModule;
const gates = {} as Record<'app' | 'firestore' | 'auth' | 'functions', Gate>;

/** 讓還在排隊的 microtask 與 vitest 的模組解析（會碰檔案系統）都有機會跑完。 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

function pendingState<T>(promise: Promise<T>): { settled: boolean; value?: T; error?: unknown } {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    (value) => {
      state.settled = true;
      state.value = value;
    },
    (error: unknown) => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
}

beforeEach(async () => {
  vi.resetModules();
  // vi.mock 的工廠結果會在整個檔案內被快取；用 doMock 讓每個測試的 SDK 模擬都是全新的（才有各自的 gate）。
  vi.doMock('firebase/app', appFactory);
  vi.doMock('firebase/firestore', firestoreFactory);
  vi.doMock('firebase/auth', authFactory);
  vi.doMock('firebase/functions', functionsFactory);
  sdk.importOrder.length = 0;
  sdk.calls.length = 0;
  sdk.fail.auth = false;
  for (const key of ['app', 'firestore', 'auth', 'functions'] as const) {
    gates[key] = makeGate();
    sdk.gates[key] = gates[key];
  }
  firebase = await import('./firebase');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getFirebaseCore（app＋firestore 先到）', () => {
  it('只載 app 與 firestore；auth 與 functions 完全不載入', async () => {
    gates.app.open();
    gates.firestore.open();

    const core = await firebase.getFirebaseCore();
    await settle();

    expect(core.app).toBe(sdk.fakeApp);
    expect(core.db).toBe(sdk.fakeDb);
    expect(sdk.importOrder.sort()).toEqual(['app', 'firestore']);
    expect(sdk.calls).toEqual(['initializeApp', 'initializeFirestore']);
  });

  it('firestore 沒到之前不 resolve；到了就 resolve（不等 auth／functions）', async () => {
    gates.app.open();
    const core = pendingState(firebase.getFirebaseCore());
    await settle();
    expect(core.settled).toBe(false);

    gates.firestore.open();
    await settle();
    expect(core.settled).toBe(true);
  });

  it('單例：重複呼叫回同一個 Promise', () => {
    expect(firebase.getFirebaseCore()).toBe(firebase.getFirebaseCore());
  });
});

describe('getFirebase（延後載入的 auth／functions：被呼叫時會 await 就緒）', () => {
  it('core 已就緒但 auth／functions 還沒到：getFirebase() 不會提早 resolve，也不會給出 undefined 的 auth／functions', async () => {
    gates.app.open();
    gates.firestore.open();
    await firebase.getFirebaseCore();

    const full = pendingState(firebase.getFirebase());
    await settle();
    // 這時 auth／functions 的下載已開始，但都還沒完成
    expect(sdk.importOrder).toEqual(expect.arrayContaining(['auth', 'functions']));
    expect(full.settled).toBe(false);

    gates.auth.open();
    await settle();
    expect(full.settled).toBe(false); // functions 還沒到

    gates.functions.open();
    await settle();
    expect(full.settled).toBe(true);
    expect(full.value?.auth).toBe(sdk.fakeAuth);
    expect(full.value?.functions).toBe(sdk.fakeFunctions);
    expect(full.value?.db).toBe(sdk.fakeDb);
    expect(full.value?.app).toBe(sdk.fakeApp);
  });

  it('getFirebaseCore 早於 getFirebase 就緒（首頁資料不必等 auth／functions）', async () => {
    gates.app.open();
    gates.firestore.open();

    const full = pendingState(firebase.getFirebase());
    const core = pendingState(firebase.getFirebaseCore());
    await settle();

    expect(core.settled).toBe(true);
    expect(full.settled).toBe(false);
  });

  it('auth／functions 的下載排在 app＋firestore 之後才開始（firestore 先拿頻寬）', async () => {
    const full = firebase.getFirebase();
    await settle();
    // core 還沒完成：auth／functions 連 import 都還沒開始
    expect(sdk.importOrder.sort()).toEqual(['app', 'firestore']);

    gates.app.open();
    gates.firestore.open();
    await settle();
    expect(sdk.importOrder).toEqual(expect.arrayContaining(['auth', 'functions']));
    expect(sdk.importOrder.indexOf('auth')).toBeGreaterThan(sdk.importOrder.indexOf('firestore'));

    gates.auth.open();
    gates.functions.open();
    await full;
  });

  it('同時多個呼叫端等待：全部拿到同一份 context，getAuth／getFunctions 只初始化一次', async () => {
    const a = firebase.getFirebase();
    const b = firebase.getFirebase();
    expect(a).toBe(b);

    gates.app.open();
    gates.firestore.open();
    gates.auth.open();
    gates.functions.open();
    const [ctxA, ctxB] = await Promise.all([a, b]);

    expect(ctxA).toBe(ctxB);
    expect(sdk.calls.filter((c) => c.startsWith('getAuth'))).toEqual(['getAuth:fake-app']);
    expect(sdk.calls.filter((c) => c.startsWith('getFunctions'))).toEqual([
      'getFunctions:fake-app:asia-east1',
    ]);
  });

  it('auth 以 core 的 app 初始化（getAuth(app) 初始化方式不變，卡④才會改）', async () => {
    gates.app.open();
    gates.firestore.open();
    gates.auth.open();
    gates.functions.open();
    await firebase.getFirebase();
    expect(sdk.calls).toContain('getAuth:fake-app');
  });

  it('auth 的下載失敗：getFirebase() 拒絕（呼叫端 catch 得到），getFirebaseCore() 不受影響', async () => {
    sdk.fail.auth = true;
    gates.app.open();
    gates.firestore.open();
    gates.auth.open();
    gates.functions.open();

    await expect(firebase.getFirebaseCore()).resolves.toMatchObject({ db: sdk.fakeDb });
    await expect(firebase.getFirebase()).rejects.toThrow();
  });
});

describe('emulator 連線', () => {
  it('firestore 的 emulator 在 core 連好；auth／functions 在它們就緒前連好（getFirebase resolve 時一定已連）', async () => {
    vi.stubEnv('VITE_FIREBASE_EMULATOR', '1');
    gates.app.open();
    gates.firestore.open();

    await firebase.getFirebaseCore();
    expect(sdk.calls).toContain('connectFirestoreEmulator');
    expect(sdk.calls).not.toContain('connectAuthEmulator');

    const full = firebase.getFirebase();
    gates.auth.open();
    gates.functions.open();
    await full;

    expect(sdk.calls).toEqual(expect.arrayContaining([
      'connectAuthEmulator',
      'connectFunctionsEmulator',
    ]));
    expect(sdk.calls.indexOf('getAuth:fake-app')).toBeLessThan(sdk.calls.indexOf('connectAuthEmulator'));
  });
});
