// Firebase 延遲載入入口。
//
// 本檔在 **執行期** 不靜態載入任何 `firebase/*` 子模組——全部透過動態 `import()`。
// `import type` 僅供型別檢查，編譯後會被剝離，因此首頁初始 bundle 不會被 Firebase SDK 撐大。
//
// 決策：
// - `initializeFirestore` + `persistentLocalCache` + `persistentMultipleTabManager`
//   → 多分頁共用同一份 IndexedDB 快取，避免 A 版曾發生的「多分頁讀取量暴增」與「權限卡住」。
// - 若持久化不可用，退回 `memoryLocalCache()`。
// - Functions region 固定 `asia-east1`（R-CF-001）。
// - `VITE_FIREBASE_EMULATOR === '1'` 且非 PROD 建置時連線 emulator；PROD 一律忽略該旗標。
// - 正式資料庫一律不得從本機網址開啟（fail-closed，見 `assertFirebaseTargetAllowed`）。

import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';

import { FIREBASE_CONFIG } from './firebase-config';

export interface FirebaseContext {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
  functions: Functions;
}

const FUNCTIONS_REGION = 'asia-east1' as const;

let _contextPromise: Promise<FirebaseContext> | null = null;

/** 是否應連線 emulator：僅非 PROD 且明確設定 VITE_FIREBASE_EMULATOR=1。 */
export function shouldUseEmulator(): boolean {
  if (import.meta.env.PROD) return false;
  return import.meta.env.VITE_FIREBASE_EMULATOR === '1';
}

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** 正式資料庫連線被拒（本機網址開啟了會連正式資料庫的程式）。 */
export class FirebaseTargetBlockedError extends Error {
  constructor(hostname: string) {
    super(
      `[firebase] 拒絕連線：本機網址（${hostname}）不得連正式資料庫。`
        + '開發與預覽只能連 emulator（VITE_FIREBASE_EMULATOR=1 的 dev server）。',
    );
    this.name = 'FirebaseTargetBlockedError';
  }
}

/**
 * 連線目標檢查（2026-10-19 事故後新增：本機預覽 PROD 建置時忽略 emulator 旗標、誤連正式 Firestore）。
 * 不連 emulator 時，若網址是本機（localhost／127.0.0.1／::1／*.localhost）就拒絕初始化。
 * 單元測試（MODE=test）不檢查，因為測試一律 mock Firebase。
 */
export function assertFirebaseTargetAllowed(
  useEmulator: boolean,
  hostname: string = typeof location === 'undefined' ? '' : location.hostname,
): void {
  if (useEmulator) return;
  const host = String(hostname || '').trim().toLowerCase();
  if (LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
    throw new FirebaseTargetBlockedError(host);
  }
}

/** 取得（單例）Firebase context。第一個呼叫觸發動態載入；後續回傳同一 Promise。 */
export function getFirebase(): Promise<FirebaseContext> {
  if (!_contextPromise) {
    _contextPromise = initializeFirebaseContext();
  }
  return _contextPromise;
}

async function initializeFirebaseContext(): Promise<FirebaseContext> {
  if (import.meta.env.MODE !== 'test') {
    try {
      assertFirebaseTargetAllowed(shouldUseEmulator());
    } catch (err) {
      // 讓 getFirebase 之後的呼叫都同樣失敗，不留半初始化狀態。
      console.error(err);
      throw err;
    }
  }
  const [appMod, firestoreMod, authMod, functionsMod] = await Promise.all([
    import('firebase/app'),
    import('firebase/firestore'),
    import('firebase/auth'),
    import('firebase/functions'),
  ]);

  const app: FirebaseApp = appMod.getApps().length
    ? appMod.getApp()
    : appMod.initializeApp(FIREBASE_CONFIG);

  const db = initializeFirestoreInstance(app, firestoreMod);
  const auth: Auth = authMod.getAuth(app);
  const functions: Functions = functionsMod.getFunctions(app, FUNCTIONS_REGION);

  if (shouldUseEmulator()) {
    firestoreMod.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    functionsMod.connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    console.warn(
      '[firebase] ⚠️ 使用本機 emulator（firestore:8080 / auth:9099 / functions:5001）；' +
        '此警告只在 VITE_FIREBASE_EMULATOR=1 且非 PROD 建置時出現。',
    );
  }

  return { app, db, auth, functions };
}

type FirestoreModule = typeof import('firebase/firestore');

function initializeFirestoreInstance(
  app: FirebaseApp,
  firestoreMod: FirestoreModule,
): Firestore {
  const canUsePersistence =
    typeof indexedDB !== 'undefined' && typeof window !== 'undefined';
  if (!canUsePersistence) {
    return firestoreMod.initializeFirestore(app, {
      localCache: firestoreMod.memoryLocalCache(),
    });
  }

  try {
    return firestoreMod.initializeFirestore(app, {
      localCache: firestoreMod.persistentLocalCache({
        tabManager: firestoreMod.persistentMultipleTabManager(),
      }),
    });
  } catch (err) {
    console.warn(
      '[firebase] persistentLocalCache 初始化失敗，改用 memoryLocalCache',
      err,
    );
    try {
      return firestoreMod.getFirestore(app);
    } catch (fallbackErr) {
      console.error('[firebase] getFirestore fallback 亦失敗', fallbackErr);
      throw fallbackErr;
    }
  }
}
