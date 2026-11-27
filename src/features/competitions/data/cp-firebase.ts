// 賽事第 2 步的第二個 Firestore（具名資料庫 asia-main）與 asia-east1 Callable。
// 延遲建立：本模組被 import 時不連線，第一次 getCpFirebase() 才建立。
// 只用記憶體快取，不得改主庫（src/data/firebase.ts）的持久化快取。
//
// ASSUMPTION: 模擬器位址沿用主庫客戶端的 127.0.0.1:8080／5001（firebase.ts 沒有讀 FIRESTORE_EMULATOR_HOST）。
// ASSUMPTION: 同一個 functions 實例若已被主庫接上模擬器，略過「already」錯誤。

import type { FirebaseApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import { getFirebase, shouldUseEmulator } from '@/data/firebase';

const ASIA_MAIN_DB = 'asia-main';
const FUNCTIONS_REGION = 'asia-east1';
const EMULATOR_HOST = '127.0.0.1';
const FIRESTORE_EMULATOR_PORT = 8080;
const FUNCTIONS_EMULATOR_PORT = 5001;

export interface CpFirebase {
  app: FirebaseApp;
  db: Firestore;
  functions: Functions;
}

export interface CpFirebaseDeps {
  getApp: () => Promise<FirebaseApp>;
  useEmulator: () => boolean;
  loadFirestore?: () => Promise<typeof import('firebase/firestore')>;
  loadFunctions?: () => Promise<typeof import('firebase/functions')>;
}

const defaultDeps: CpFirebaseDeps = {
  getApp: async () => (await getFirebase()).app,
  useEmulator: shouldUseEmulator,
};

let depsOverride: CpFirebaseDeps | null = null;
let pending: Promise<CpFirebase> | null = null;

/** 測試用：換成假的 SDK／app。傳 null 恢復預設，並清掉進行中的初始化。 */
export function _setCpFirebaseDepsForTest(deps: CpFirebaseDeps | null): void {
  depsOverride = deps;
  pending = null;
}

/** 測試用：清掉單例，讓下一次重新建立。 */
export function _resetCpFirebaseForTest(): void {
  pending = null;
}

function ignoreAlreadyConnected(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (!/already/i.test(message)) throw err;
}

async function openCpFirebase(deps: CpFirebaseDeps): Promise<CpFirebase> {
  const app = await deps.getApp();
  const [firestoreMod, functionsMod] = await Promise.all([
    (deps.loadFirestore ?? (() => import('firebase/firestore')))(),
    (deps.loadFunctions ?? (() => import('firebase/functions')))(),
  ]);

  // 第三個參數是具名資料庫。不呼叫不帶 databaseId 的 initializeFirestore，避免動到主庫快取。
  const db = firestoreMod.initializeFirestore(app, {
    localCache: firestoreMod.memoryLocalCache(),
  }, ASIA_MAIN_DB);

  if (deps.useEmulator()) {
    try {
      firestoreMod.connectFirestoreEmulator(db, EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
    } catch (err) {
      ignoreAlreadyConnected(err);
    }
  }

  const functions = functionsMod.getFunctions(app, FUNCTIONS_REGION);
  if (deps.useEmulator()) {
    try {
      functionsMod.connectFunctionsEmulator(functions, EMULATOR_HOST, FUNCTIONS_EMULATOR_PORT);
    } catch (err) {
      ignoreAlreadyConnected(err);
    }
  }

  return { app, db, functions };
}

/** 取得 asia-main 與 asia-east1。失敗會清掉單例，下一次可以重試（L-08）。 */
export function getCpFirebase(): Promise<CpFirebase> {
  if (!pending) {
    const run = openCpFirebase(depsOverride ?? defaultDeps);
    pending = run;
    run.catch(() => {
      if (pending === run) pending = null;
    });
  }
  return pending;
}

/** 這一頁是否已開始建立 asia-main 實例（唯讀，不觸發建立）。 */
export function isCpFirebaseStarted(): boolean {
  return pending !== null;
}
