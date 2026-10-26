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
// - 分兩段載入（T-041）：`getFirebaseCore()` 只載 app＋firestore（首頁資料路徑先到先用）；
//   auth＋functions 排在 core 之後才開始下載，由 `getFirebase()` 負責等它們就緒。
//   所有需要 auth／functions 的呼叫端一律走 `getFirebase()`（它會 await 兩段都就緒才回傳），
//   不會出現「第一次點沒反應」；只讀公開資料、只要 db 的呼叫端才用 `getFirebaseCore()`。

import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';

import { FIREBASE_CONFIG } from './firebase-config';

/** 第一段：app＋firestore（首頁資料路徑只需要這兩個）。 */
export interface FirebaseCoreContext {
  app: FirebaseApp;
  db: Firestore;
}

/** 第二段：auth＋functions（排在 core 之後才下載）。 */
interface FirebaseExtras {
  auth: Auth;
  functions: Functions;
}

export interface FirebaseContext extends FirebaseCoreContext, FirebaseExtras {}

const FUNCTIONS_REGION = 'asia-east1' as const;

let _corePromise: Promise<FirebaseCoreContext> | null = null;
let _extrasPromise: Promise<FirebaseExtras> | null = null;
let _contextPromise: Promise<FirebaseContext> | null = null;

/** 是否應連線 emulator：僅非 PROD 且明確設定 VITE_FIREBASE_EMULATOR=1。 */
export function shouldUseEmulator(): boolean {
  if (import.meta.env.PROD) return false;
  return import.meta.env.VITE_FIREBASE_EMULATOR === '1';
}

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** 本機或區網網址（含手機連開發機時的私有 IP 與 *.local）。 */
export function isLocalOrPrivateHostname(hostname: string): boolean {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return false;
  if (LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

/** 實際連線目標（給 console 與內測角標顯示，讓連錯資料庫能被看見）。 */
export function firebaseTargetLabel(): string {
  return `${FIREBASE_CONFIG.projectId} · ${shouldUseEmulator() ? 'emulator' : 'prod'}`;
}

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
 * 不連 emulator 時，若網址是本機或區網（localhost／127.0.0.1／::1／*.localhost／*.local／
 * 10.x、172.16～31.x、192.168.x 私有 IP）就拒絕初始化（2026-10-19 Fable 補：手機連開發機時是私有 IP）。
 * 單元測試（MODE=test）不檢查，因為測試一律 mock Firebase。
 */
export function assertFirebaseTargetAllowed(
  useEmulator: boolean,
  hostname: string = typeof location === 'undefined' ? '' : location.hostname,
): void {
  if (useEmulator) return;
  const host = String(hostname || '').trim().toLowerCase();
  if (isLocalOrPrivateHostname(host)) {
    throw new FirebaseTargetBlockedError(host);
  }
}

/**
 * 取得（單例）app＋firestore。第一個呼叫觸發動態載入；後續回傳同一 Promise。
 * 不會載入 auth／functions；需要它們的呼叫端請用 `getFirebase()`。
 */
export function getFirebaseCore(): Promise<FirebaseCoreContext> {
  if (!_corePromise) {
    _corePromise = initializeFirebaseCore();
  }
  return _corePromise;
}

/**
 * 取得（單例）完整 Firebase context（app＋firestore＋auth＋functions）。
 * 回傳的 Promise 要等 core 與 auth／functions 都就緒才會 resolve，所以呼叫端拿到的 `auth`、`functions` 一定可用。
 * auth／functions 的下載排在 core 之後（讓 firestore 先拿到頻寬），第一次呼叫本函式時才開始。
 */
export function getFirebase(): Promise<FirebaseContext> {
  if (!_contextPromise) {
    _contextPromise = Promise.all([getFirebaseCore(), getFirebaseExtras()]).then(
      ([core, extras]) => ({ ...core, ...extras }),
    );
  }
  return _contextPromise;
}

function getFirebaseExtras(): Promise<FirebaseExtras> {
  if (!_extrasPromise) {
    _extrasPromise = initializeFirebaseExtras();
  }
  return _extrasPromise;
}

async function initializeFirebaseCore(): Promise<FirebaseCoreContext> {
  if (import.meta.env.MODE !== 'test') {
    try {
      assertFirebaseTargetAllowed(shouldUseEmulator());
    } catch (err) {
      // 讓 getFirebase 之後的呼叫都同樣失敗，不留半初始化狀態。
      console.error(err);
      throw err;
    }
    console.info(`[firebase] 連線目標：${firebaseTargetLabel()}`);
  }
  const [appMod, firestoreMod] = await Promise.all([
    import('firebase/app'),
    import('firebase/firestore'),
  ]);

  const app: FirebaseApp = appMod.getApps().length
    ? appMod.getApp()
    : appMod.initializeApp(FIREBASE_CONFIG);

  const db = initializeFirestoreInstance(app, firestoreMod);

  if (shouldUseEmulator()) {
    firestoreMod.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    console.warn(
      '[firebase] ⚠️ 使用本機 emulator（firestore:8080 / auth:9099 / functions:5001）；' +
        '此警告只在 VITE_FIREBASE_EMULATOR=1 且非 PROD 建置時出現。',
    );
  }

  return { app, db };
}

async function initializeFirebaseExtras(): Promise<FirebaseExtras> {
  // 先等 core：目標檢查失敗時 extras 一起失敗；firestore 的下載也先於 auth／functions 開始。
  const core = await getFirebaseCore();
  const [authMod, functionsMod] = await Promise.all([
    import('firebase/auth'),
    import('firebase/functions'),
  ]);

  const auth: Auth = authMod.getAuth(core.app);
  const functions: Functions = functionsMod.getFunctions(core.app, FUNCTIONS_REGION);

  if (shouldUseEmulator()) {
    authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    functionsMod.connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  }

  return { auth, functions };
}

/** 測試用：清掉單例（每個測試用全新的載入狀態）。 */
export function _resetFirebaseForTest(): void {
  _corePromise = null;
  _extrasPromise = null;
  _contextPromise = null;
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
