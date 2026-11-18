import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseApp } from 'firebase/app';
import {
  _resetCpFirebaseForTest,
  _setCpFirebaseDepsForTest,
  getCpFirebase,
  type CpFirebaseDeps,
} from './cp-firebase';

const app = { name: 'cp-test-app' } as FirebaseApp;

function install(useEmulator: boolean, extra?: {
  connectFunctions?: () => void;
  getApp?: () => Promise<FirebaseApp>;
}) {
  const memory = { kind: 'memory' };
  const db = { kind: 'asia-main-db' };
  const functions = { kind: 'asia-east1-functions' };
  const initializeFirestore = vi.fn(() => db);
  const memoryLocalCache = vi.fn(() => memory);
  const persistentLocalCache = vi.fn(() => {
    throw new Error('不得碰主庫的持久化快取');
  });
  const connectFirestoreEmulator = vi.fn();
  const getFunctions = vi.fn(() => functions);
  const connectFunctionsEmulator = vi.fn(extra?.connectFunctions);
  const deps: CpFirebaseDeps = {
    getApp: extra?.getApp ?? (async () => app),
    useEmulator: () => useEmulator,
    loadFirestore: async () => ({
      initializeFirestore,
      memoryLocalCache,
      persistentLocalCache,
      connectFirestoreEmulator,
    }) as never,
    loadFunctions: async () => ({
      getFunctions,
      connectFunctionsEmulator,
    }) as never,
  };
  _setCpFirebaseDepsForTest(deps);
  return {
    memory,
    db,
    functions,
    initializeFirestore,
    memoryLocalCache,
    persistentLocalCache,
    connectFirestoreEmulator,
    getFunctions,
    connectFunctionsEmulator,
  };
}

describe('getCpFirebase（asia-main 記憶體快取，不改主庫）', () => {
  afterEach(() => {
    _setCpFirebaseDepsForTest(null);
    _resetCpFirebaseForTest();
  });

  it('用同一個 app 建立 asia-main，只使用 memoryLocalCache', async () => {
    const sdk = install(false);
    const ctx = await getCpFirebase();
    expect(ctx.app).toBe(app);
    expect(ctx.db).toBe(sdk.db);
    expect(ctx.functions).toBe(sdk.functions);
    expect(sdk.memoryLocalCache).toHaveBeenCalledTimes(1);
    expect(sdk.initializeFirestore).toHaveBeenCalledWith(app, { localCache: sdk.memory }, 'asia-main');
    expect(sdk.getFunctions).toHaveBeenCalledWith(app, 'asia-east1');
    expect(sdk.persistentLocalCache).not.toHaveBeenCalled();
    expect(sdk.connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(sdk.connectFunctionsEmulator).not.toHaveBeenCalled();
  });

  it('模擬器模式連同一個 127.0.0.1 模擬器', async () => {
    const sdk = install(true);
    await getCpFirebase();
    expect(sdk.connectFirestoreEmulator).toHaveBeenCalledWith(sdk.db, '127.0.0.1', 8080);
    expect(sdk.connectFunctionsEmulator).toHaveBeenCalledWith(sdk.functions, '127.0.0.1', 5001);
  });

  it('functions 已經接上模擬器時略過 already 錯誤', async () => {
    const sdk = install(true, {
      connectFunctions: () => {
        throw new Error('Functions instance has already been configured with an emulator');
      },
    });
    await expect(getCpFirebase()).resolves.toMatchObject({ functions: sdk.functions });
  });

  it('同一輪呼叫共用一個 Promise；失敗後清掉，下一次可以重試', async () => {
    let attempts = 0;
    const sdk = install(false, {
      getApp: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('暫時失敗');
        return app;
      },
    });
    const first = getCpFirebase();
    expect(getCpFirebase()).toBe(first);
    await expect(first).rejects.toThrow('暫時失敗');
    const second = await getCpFirebase();
    expect(second.db).toBe(sdk.db);
    expect(sdk.initializeFirestore).toHaveBeenCalledTimes(1);
    expect(attempts).toBe(2);
  });

  it('主庫檔仍用持久化快取，而且沒有 asia-main', () => {
    const main = readFileSync(resolve(__dirname, '../../../data/firebase.ts'), 'utf8');
    const here = readFileSync(resolve(__dirname, './cp-firebase.ts'), 'utf8');
    expect(main).toContain('persistentLocalCache');
    expect(main).not.toContain('asia-main');
    expect(here).toContain('memoryLocalCache');
    expect(here).toContain("'asia-main'");
    expect(here).toContain("'asia-east1'");
    expect(here).not.toContain('persistentLocalCache');
  });
});
