import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

// T-041 退修 1（顧問定案的登入旗標閘）：
// 上次已登入（localStorage 旗標 fcb:signed-in）→ 先走 Auth，等 Auth 的第一次狀態事件再初始化 Firestore；
// 沒旗標（真訪客）→ 照「首頁公開讀取優先」立即初始化 Firestore，不等 Auth。
// 原因與取捨見 data/firebase.ts 的「登入旗標閘」註解。
// 退修 4：Auth 未能確認註冊（載入失敗、getAuth 失敗、逾時）→ 降級用 memoryLocalCache（不持久化、不參與多分頁協作）；
// Functions 的 import 慢或失敗不得影響旗標閘（Auth 註冊是獨立步驟）。

const FLAG_KEY = 'fcb:signed-in';

const sdk = vi.hoisted(() => ({
  importOrder: [] as string[],
  calls: [] as string[],
  fail: { auth: false, getAuth: false, functions: false },
  /** Firestore 本地快取的設定紀錄（持久化＋多分頁協作 vs 純記憶體）。 */
  cache: [] as string[],
  /** 讓 firebase/functions 的載入卡住（Functions 慢）。 */
  functionsGate: null as null | { promise: Promise<void> },
  authGate: null as null | { promise: Promise<void> },
  /** 讓 firebase/app 的載入卡住，檢查 auth／functions 是否與它並行。 */
  appGate: null as null | { promise: Promise<void> },
  /** firebase/auth 模組載入要多久（毫秒），模擬 Auth chunk 比 Firestore 模組慢。 */
  authDelayMs: 0,
  authReadyFails: false,
  /** 每個案例遞增；模擬 SDK 只在自己的世代內寫紀錄，避免前一案例殘留的非同步工作汙染下一案例。 */
  generation: 0,
  fakeApp: { name: 'fake-app' },
  fakeDb: { name: 'fake-db' },
  fakeFunctions: { name: 'fake-functions' },
}));

/** 只有目前世代的紀錄才算數。 */
function record(gen: number, list: string[], entry: string): void {
  if (gen === sdk.generation) list.push(entry);
}

const fakeAuth = {
  name: 'fake-auth',
  authStateReady: () => {
    record(sdk.generation, sdk.calls, 'authStateReady:called');
    if (sdk.authReadyFails) return Promise.reject(new Error('authStateReady failed'));
    const gen = sdk.generation;
    return (sdk.authGate?.promise ?? Promise.resolve()).then(() => {
      record(gen, sdk.calls, 'authStateReady:resolved');
    });
  },
};

const appFactory = async () => {
  const gen = sdk.generation;
  record(gen, sdk.importOrder, 'app');
  if (sdk.appGate) await sdk.appGate.promise;
  return { getApps: () => [], getApp: () => sdk.fakeApp, initializeApp: () => sdk.fakeApp };
};
const firestoreFactory = async () => {
  const gen = sdk.generation;
  record(gen, sdk.importOrder, 'firestore');
  return {
    initializeFirestore: () => {
      record(gen, sdk.calls, 'initializeFirestore');
      return sdk.fakeDb;
    },
    persistentLocalCache: () => {
      record(gen, sdk.cache, 'persistentLocalCache');
      return {};
    },
    persistentMultipleTabManager: () => {
      record(gen, sdk.cache, 'persistentMultipleTabManager');
      return {};
    },
    memoryLocalCache: () => {
      record(gen, sdk.cache, 'memoryLocalCache');
      return {};
    },
    getFirestore: () => sdk.fakeDb,
    connectFirestoreEmulator: () => undefined,
  };
};
const authFactory = async () => {
  const gen = sdk.generation;
  record(gen, sdk.importOrder, 'auth');
  if (sdk.authDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, sdk.authDelayMs));
  if (sdk.fail.auth) throw new Error('auth chunk failed');
  return {
    getAuth: () => {
      if (sdk.fail.getAuth) throw new Error('getAuth failed');
      record(gen, sdk.calls, 'getAuth');
      return fakeAuth;
    },
    connectAuthEmulator: () => undefined,
  };
};
const functionsFactory = async () => {
  const gen = sdk.generation;
  record(gen, sdk.importOrder, 'functions');
  if (sdk.functionsGate) await sdk.functionsGate.promise;
  if (sdk.fail.functions) throw new Error('functions chunk failed');
  return {
    getFunctions: () => {
      record(gen, sdk.calls, 'getFunctions');
      return sdk.fakeFunctions;
    },
    connectFunctionsEmulator: () => undefined,
  };
};

type FirebaseModule = typeof import('./firebase');
let firebase: FirebaseModule;
let warn: MockInstance<typeof console.warn>;
let info: MockInstance<typeof console.info>;

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

/** 降級：Firestore 用 memoryLocalCache，persistentLocalCache／persistentMultipleTabManager 完全沒被呼叫，並記警告。 */
function expectDegradedToMemoryCache(): void {
  expect(sdk.cache).toContain('memoryLocalCache');
  expect(sdk.cache).not.toContain('persistentLocalCache');
  expect(sdk.cache).not.toContain('persistentMultipleTabManager');
  expect(warn.mock.calls.some(([msg]) => String(msg).includes('memoryLocalCache'))).toBe(true);
}

function settledState(promise: Promise<unknown>): { settled: boolean } {
  const state = { settled: false };
  void promise.then(() => { state.settled = true; }, () => { state.settled = true; });
  return state;
}

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  sdk.generation += 1;
  sdk.importOrder.length = 0;
  sdk.calls.length = 0;
  sdk.fail.auth = false;
  sdk.fail.getAuth = false;
  sdk.fail.functions = false;
  sdk.cache.length = 0;
  sdk.functionsGate = null;
  sdk.authGate = null;
  sdk.appGate = null;
  sdk.authDelayMs = 0;
  sdk.authReadyFails = false;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.doMock('firebase/app', appFactory);
  vi.doMock('firebase/firestore', firestoreFactory);
  vi.doMock('firebase/auth', authFactory);
  vi.doMock('firebase/functions', functionsFactory);
  firebase = await import('./firebase');
  firebase._resetFirebaseForTest();
  // 預設逾時（3 秒／10 秒，performance.now() 是 worker 存活時間）在整包平行跑、負載高時會先於測試步驟觸發而偶發失敗
  // （退修 3 F2）。這個檔的案例都把逾時放到足夠大，需要短逾時的案例自己覆寫。
  firebase._setSessionGateTimingForTest({
    afterCoreMs: 60_000,
    capMs: Number.MAX_SAFE_INTEGER,
    registerMaxMs: 60_000,
  });
});

afterEach(() => {
  firebase._resetFirebaseForTest();
  warn.mockRestore();
  info.mockRestore();
  localStorage.clear();
});

describe('有登入旗標（上次已登入）：Auth 先走，Firestore 等 Auth 的第一次狀態事件', () => {
  it('Firestore 初始化發生在 auth 第一次狀態事件「之後」', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    const gate = deferred();
    sdk.authGate = gate;

    const core = firebase.getFirebaseCore();
    const coreState = settledState(core);
    // 先等到 Auth 載入完並開始等第一次狀態事件（模組解析在高負載下可能很慢，不能用固定等待）
    await vi.waitFor(() => expect(sdk.calls).toContain('authStateReady:called'), { timeout: 10_000 });
    // 此時 gate 還關著：Firestore 還沒初始化、core 也還沒 resolve
    expect(sdk.calls).toContain('getAuth');
    expect(sdk.calls).not.toContain('initializeFirestore');
    expect(coreState.settled).toBe(false);

    gate.resolve();
    const ctx = await core;
    expect(ctx.db).toBe(sdk.fakeDb);
    expect(sdk.calls.indexOf('authStateReady:resolved')).toBeGreaterThan(-1);
    expect(sdk.calls.indexOf('initializeFirestore')).toBeGreaterThan(sdk.calls.indexOf('authStateReady:resolved'));
    expect(sdk.calls.indexOf('getAuth')).toBeLessThan(sdk.calls.indexOf('initializeFirestore'));
    // 正常路徑：持久化＋多分頁協作，沒有降級
    expect(sdk.cache).toEqual(expect.arrayContaining(['persistentLocalCache', 'persistentMultipleTabManager']));
    expect(sdk.cache).not.toContain('memoryLocalCache');
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

  it('保險：Auth 已註冊、但第一次狀態事件不來 → 逾時後放行 Firestore（記 info：Auth 已註冊，Firestore 會自己等）', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    sdk.authGate = deferred(); // 永遠不 resolve
    firebase._setSessionGateTimingForTest({ afterCoreMs: 50 });

    const startedAt = Date.now();
    const ctx = await firebase.getFirebaseCore();
    expect(ctx.db).toBe(sdk.fakeDb);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40);
    // 放行時 Auth 一定已經註冊進 app
    expect(sdk.calls.indexOf('getAuth')).toBeGreaterThan(-1);
    expect(sdk.calls.indexOf('getAuth')).toBeLessThan(sdk.calls.indexOf('initializeFirestore'));
    expect(info.mock.calls.some(([msg]) => String(msg).includes('第一次狀態事件'))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    // Auth 已註冊：放行時仍用持久化，不降級
    expect(sdk.cache).toContain('persistentLocalCache');
    expect(sdk.cache).not.toContain('memoryLocalCache');
  });

  it('保險：整體上限已過（capMs 用完）→ 不再等第一次狀態事件，但 Auth 仍已註冊', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    sdk.authGate = deferred();
    firebase._setSessionGateTimingForTest({ capMs: 0 });

    const startedAt = Date.now();
    await firebase.getFirebaseCore(); // 若錯誤地去等永遠不 resolve 的 gate，這裡會卡到測試逾時
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(sdk.calls.indexOf('getAuth')).toBeGreaterThan(-1);
    expect(sdk.calls.indexOf('getAuth')).toBeLessThan(sdk.calls.indexOf('initializeFirestore'));
  });

  // ── 退修 3 F3：逾時只計 authStateReady()；Auth 註冊本身不能被 3 秒逾時放行 ──
  it('回歸：Auth chunk 比 Firestore 模組慢（延遲 200 ms）且 afterCoreMs 只有 50 ms → Firestore 仍排在 getAuth 之後', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    sdk.authDelayMs = 200;
    firebase._setSessionGateTimingForTest({ afterCoreMs: 50 });

    await firebase.getFirebaseCore();

    expect(sdk.calls.indexOf('getAuth')).toBeGreaterThan(-1);
    expect(sdk.calls.indexOf('getAuth')).toBeLessThan(sdk.calls.indexOf('initializeFirestore'));
  });

  it('回歸：capMs 用完時 Auth 還沒載入完 → 仍等 Auth 註冊進 app 才初始化 Firestore', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    sdk.authDelayMs = 150;
    firebase._setSessionGateTimingForTest({ capMs: 0 });

    await firebase.getFirebaseCore();

    expect(sdk.calls.indexOf('getAuth')).toBeGreaterThan(-1);
    expect(sdk.calls.indexOf('getAuth')).toBeLessThan(sdk.calls.indexOf('initializeFirestore'));
  });

  it('保險：Auth 註冊超過 registerMaxMs 還沒好（不得已）→ 放行 Firestore 並記警告', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    sdk.authDelayMs = 4000; // Auth 載入要 4 秒；registerMaxMs 只有 50 ms，不該等它
    firebase._setSessionGateTimingForTest({ registerMaxMs: 50 });

    const startedAt = Date.now();
    const ctx = await firebase.getFirebaseCore();
    expect(ctx.db).toBe(sdk.fakeDb);
    expect(Date.now() - startedAt).toBeLessThan(3500);
    expect(sdk.calls).toContain('initializeFirestore');
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('還沒註冊進 app'))).toBe(true);
    // 退修 4 P1-a：Auth 沒能確認註冊 → 降級用 memoryLocalCache，不持久化、不參與多分頁協作
    expectDegradedToMemoryCache();
  });

  it('保險：authStateReady() 自己 reject → 記警告並放行，core 不會永久失敗', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    sdk.authReadyFails = true;

    const ctx = await firebase.getFirebaseCore();
    expect(ctx.db).toBe(sdk.fakeDb);
    expect(sdk.calls).toContain('initializeFirestore');
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('authStateReady() 失敗'))).toBe(true);
    expect(sdk.cache).toContain('persistentLocalCache'); // Auth 已註冊，不降級
    expect(sdk.cache).not.toContain('memoryLocalCache');
    // 之後再呼叫仍是同一個成功的 core
    await expect(firebase.getFirebaseCore()).resolves.toMatchObject({ db: sdk.fakeDb });
  });

  // ── 退修 3 F5：有旗標時 app 初始化與 auth／functions 的 import 並行 ──
  it('有旗標時 auth／functions 的 import 不必等 app 載入完（並行，和 main 一樣少一個往返）', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    const appGate = deferred();
    sdk.appGate = appGate; // app 模組卡住

    const full = firebase.getFirebase();
    // app 的 gate 還關著，但 auth 與 functions 的下載應該已經開始（並行）
    await vi.waitFor(
      () => expect(sdk.importOrder).toEqual(expect.arrayContaining(['app', 'auth', 'functions'])),
      { timeout: 10_000 },
    );
    expect(sdk.calls).not.toContain('getAuth');

    appGate.resolve();
    const ctx = await full;
    expect(ctx.auth).toBe(fakeAuth);
  });

  it('沒旗標時 auth 仍然排在 core 與暫緩之後才載入（不因並行改動而提早評估 firebase/auth）', async () => {
    const appGate = deferred();
    sdk.appGate = appGate;
    firebase.armFirebaseAuthHold({ capMs: 60_000, afterCoreMs: 60_000 });
    firebase.trackPublicRead(new Promise(() => undefined));

    void firebase.getFirebase();
    await wait(60);
    expect(sdk.importOrder).not.toContain('auth');
    appGate.resolve();
    await firebase.getFirebaseCore();
    await wait(60);
    expect(sdk.importOrder).not.toContain('auth'); // 暫緩中
  });

  it('保險：Auth 模組載入失敗 → 放行 Firestore 並警告，降級用 memoryLocalCache；getFirebase() 仍會拒絕讓呼叫端知道', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    sdk.fail.auth = true;

    const ctx = await firebase.getFirebaseCore();
    expect(ctx.db).toBe(sdk.fakeDb);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('Auth 載入或註冊失敗'))).toBe(true);
    expectDegradedToMemoryCache();
    await expect(firebase.getFirebase()).rejects.toThrow();
  });

  // ── 退修 4 P1-a：Auth 未能確認註冊的降級路徑不得以持久化＋多分頁協作啟動 Firestore ──
  it('getAuth() 丟錯 → 當成 Auth 沒註冊成功：降級用 memoryLocalCache（persistent 沒被呼叫）', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    sdk.fail.getAuth = true;

    const ctx = await firebase.getFirebaseCore();

    expect(ctx.db).toBe(sdk.fakeDb);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('Auth 載入或註冊失敗'))).toBe(true);
    expectDegradedToMemoryCache();
  });

  // ── 退修 4 P1-b：旗標閘只等 Auth 註冊，Functions 的 import 慢或失敗不得被當成「Auth 沒好」 ──
  it('Functions 的 import 失敗、Auth 正常 → Firestore 仍等 getAuth 之後才初始化，走持久化（不降級）', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    sdk.fail.functions = true;

    const ctx = await firebase.getFirebaseCore();

    expect(ctx.db).toBe(sdk.fakeDb);
    expect(sdk.calls.indexOf('getAuth')).toBeGreaterThan(-1);
    expect(sdk.calls.indexOf('getAuth')).toBeLessThan(sdk.calls.indexOf('initializeFirestore'));
    expect(sdk.cache).toEqual(expect.arrayContaining(['persistentLocalCache', 'persistentMultipleTabManager']));
    expect(sdk.cache).not.toContain('memoryLocalCache');
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('Auth 未能確認註冊'))).toBe(false);
    // 需要完整 context 的呼叫端仍然會知道 Functions 載不到
    await expect(firebase.getFirebase()).rejects.toThrow();
  });

  it('Functions 的 import 很慢（卡住）、Auth 正常 → Firestore 不等 Functions；getFirebase() 仍等到 Functions 就緒才回傳', async () => {
    localStorage.setItem(FLAG_KEY, '1');
    const functionsGate = deferred();
    sdk.functionsGate = functionsGate;

    const full = firebase.getFirebase();
    const fullState = settledState(full);
    const ctx = await firebase.getFirebaseCore(); // 若錯誤地等 Functions，這裡會卡到測試逾時

    expect(ctx.db).toBe(sdk.fakeDb);
    expect(sdk.calls.indexOf('getAuth')).toBeLessThan(sdk.calls.indexOf('initializeFirestore'));
    expect(sdk.cache).toContain('persistentLocalCache');
    expect(sdk.calls).not.toContain('getFunctions'); // Functions 還沒好
    expect(fullState.settled).toBe(false);

    functionsGate.resolve();
    const complete = await full;
    expect(complete.functions).toBe(sdk.fakeFunctions);
    expect(complete.auth).toBe(fakeAuth);
  }, 8000);
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
    // 真訪客照舊用持久化＋多分頁協作（沒有私人監聽，沒有 P2-1 窗口）
    expect(sdk.cache).toContain('persistentLocalCache');
    expect(sdk.cache).not.toContain('memoryLocalCache');
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
