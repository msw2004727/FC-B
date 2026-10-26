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
// - 啟動順序（T-041）：真訪客立即啟動 Firestore、Auth 等首頁公開讀取跑完再註冊（「首頁公開讀取優先」）；
//   上次已登入（localStorage 旗標 `fcb:signed-in`）則 Auth 先走、等 Auth 的第一次狀態事件再初始化 Firestore
//   （「登入旗標閘」，避免新分頁以未登入身分成為 Firestore 主分頁）。

import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';

import { readAuthHint } from './auth-hint';
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

let _appPromise: Promise<FirebaseApp> | null = null;
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

/** 目標檢查＋初始化 app（單例）。core 與 extras 共用，目標檢查失敗時兩邊都失敗，不留半初始化狀態。 */
function getFirebaseApp(): Promise<FirebaseApp> {
  if (!_appPromise) {
    _appPromise = initializeFirebaseApp();
  }
  return _appPromise;
}

async function initializeFirebaseApp(): Promise<FirebaseApp> {
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
  const appMod = await import('firebase/app');
  return appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG);
}

async function initializeFirebaseCore(): Promise<FirebaseCoreContext> {
  const [app, firestoreMod] = await Promise.all([
    getFirebaseApp(),
    import('firebase/firestore'),
  ]);

  // 上次已登入（旗標）：先等 Auth 的第一次狀態事件，再初始化 Firestore（見下方「登入旗標閘」）。
  if (sessionFlagAtStart()) await waitForFirstAuthState();

  const db = initializeFirestoreInstance(app, firestoreMod);

  if (shouldUseEmulator()) {
    firestoreMod.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    console.warn(
      '[firebase] ⚠️ 使用本機 emulator（firestore:8080 / auth:9099 / functions:5001）；' +
        '此警告只在 VITE_FIREBASE_EMULATOR=1 且非 PROD 建置時出現。',
    );
  }

  coreReadyForAuthHold();
  return { app, db };
}

async function initializeFirebaseExtras(): Promise<FirebaseExtras> {
  const app = await getFirebaseApp();
  if (!sessionFlagAtStart()) {
    // 訪客（沒有登入旗標）：firestore 的下載先於 auth／functions 開始，
    // 開在首頁時再等首頁的公開讀取處理完才讓 Auth 註冊（見下方「首頁公開讀取優先」）。
    await getFirebaseCore();
    await whenFirebaseAuthAllowed();
  }
  // 有登入旗標：Auth 先走（core 反過來等 Auth 的第一次狀態事件），這裡不能等 core，否則互等。
  const [authMod, functionsMod] = await Promise.all([
    import('firebase/auth'),
    import('firebase/functions'),
  ]);

  const auth: Auth = authMod.getAuth(app);
  const functions: Functions = functionsMod.getFunctions(app, FUNCTIONS_REGION);

  if (shouldUseEmulator()) {
    authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    functionsMod.connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  }

  return { auth, functions };
}

// ── 首頁公開讀取優先（T-041）────────────────────────────
//
// Firestore SDK 的行為（node_modules/@firebase/firestore 的 FirebaseAuthCredentialsProvider）：
// 只要 Auth 註冊進同一個 app，Firestore 的非同步佇列就會停到 Auth 初始化完成才繼續——
// 不管 Auth 是在 Firestore 之前或之後才註冊。Auth 初始化（還原登入者）包含 popup／redirect 解析器的
// iframe、token 刷新（securetoken）與 accounts:lookup，登入者實測要 2～4 秒；這段時間連「公開資料」的
// 查詢與回應都排在後面（2026-10-26 站長已登入瀏覽器實測：Firebase 大 chunk 4.1 s 載完，
// 第一個 Firestore Listen 要到 8.2 s）。
// 首頁的 events／banners／announcements 都是 `allow read: if true`，不需要登入身分，所以開在首頁（路徑 `/`）時，
// 先讓這三個公開讀取跑完，再讓 Auth 註冊（import firebase/auth 與 getAuth）。
// 保險：公開讀取沒有回來也最多等到 core 就緒後 3 秒、整體 10 秒；離開首頁（導向其他頁、分享連結導向）立即放行。

const AUTH_HOLD_AFTER_CORE_MS = 3000;
const AUTH_HOLD_CAP_MS = 10_000;
const AUTH_HOLD_SETTLE_MS = 50;

interface AuthHold {
  promise: Promise<void>;
  release: () => void;
  released: boolean;
  pending: number;
  afterCoreMs: number;
  settleMs: number;
  capTimer: ReturnType<typeof setTimeout> | null;
  coreTimer: ReturnType<typeof setTimeout> | null;
  settleTimer: ReturnType<typeof setTimeout> | null;
}

let authHold: AuthHold | null = null;

export interface AuthHoldOptions {
  /** core 就緒後，公開讀取最多再等多久（預設 3000 ms）。 */
  afterCoreMs?: number;
  /** 從啟動算起的整體上限（預設 10000 ms）。 */
  capMs?: number;
  /** 最後一個讀取處理完後再等多久才放行（預設 50 ms）。 */
  settleMs?: number;
}

/** 開始暫緩 Auth 註冊（冪等）。開在首頁時由本模組載入時呼叫；其他情境不呼叫＝完全不暫緩。 */
export function armFirebaseAuthHold(options: AuthHoldOptions = {}): void {
  if (authHold) return;
  let resolve!: () => void;
  const hold: AuthHold = {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    release: () => resolve(),
    released: false,
    pending: 0,
    afterCoreMs: options.afterCoreMs ?? AUTH_HOLD_AFTER_CORE_MS,
    settleMs: options.settleMs ?? AUTH_HOLD_SETTLE_MS,
    capTimer: null,
    coreTimer: null,
    settleTimer: null,
  };
  hold.capTimer = setTimeout(releaseFirebaseAuthHold, options.capMs ?? AUTH_HOLD_CAP_MS);
  authHold = hold;
}

/** 放行 Auth 註冊（冪等）。公開讀取處理完、逾時、離開首頁時呼叫。 */
export function releaseFirebaseAuthHold(): void {
  const hold = authHold;
  if (!hold || hold.released) return;
  hold.released = true;
  for (const timer of [hold.capTimer, hold.coreTimer, hold.settleTimer]) {
    if (timer !== null) clearTimeout(timer);
  }
  hold.release();
}

/** Auth 可以註冊了嗎？沒有暫緩或已放行時立即 resolve。 */
export function whenFirebaseAuthAllowed(): Promise<void> {
  return authHold && !authHold.released ? authHold.promise : Promise.resolve();
}

/**
 * 登記一個首頁的公開讀取（不需要登入身分的查詢）。全部登記的讀取都處理完（成功或失敗）後放行 Auth。
 * 沒有暫緩時原樣回傳；不改變讀取本身的結果與錯誤。
 */
export function trackPublicRead<T>(read: Promise<T>): Promise<T> {
  const hold = authHold;
  if (!hold || hold.released) return read;
  hold.pending += 1;
  const done = (): void => {
    hold.pending -= 1;
    if (hold.pending > 0 || hold.released) return;
    // 其他讀取可能緊接著登記，等一小段時間確定真的沒有了再放行。
    if (hold.settleTimer !== null) clearTimeout(hold.settleTimer);
    hold.settleTimer = setTimeout(() => {
      if (hold.pending === 0) releaseFirebaseAuthHold();
    }, hold.settleMs);
  };
  read.then(done, done);
  return read;
}

/** core 就緒（Firestore 可以開始查詢）後，公開讀取最多再等 3 秒。 */
function coreReadyForAuthHold(): void {
  const hold = authHold;
  if (!hold || hold.released) return;
  if (hold.coreTimer !== null) clearTimeout(hold.coreTimer);
  hold.coreTimer = setTimeout(releaseFirebaseAuthHold, hold.afterCoreMs);
}

// ── 登入旗標閘（T-041 退修 1，顧問定案）────────────────────
//
// 上面「公開讀取優先」讓 Firestore 在 Auth 註冊之前就以未登入身分啟動。對真訪客沒問題（沒有私人監聽），
// 但對登入者有一個窗口：Firestore 多分頁持久化（persistentMultipleTabManager）由「主分頁」用自己的憑證替所有分頁
// 跑監聽；新開的 `/` 分頁若在 Auth 註冊前就啟動 Firestore，而舊分頁的主分頁租約已過期（背景超過 5 分鐘或被凍結），
// 新分頁會成為主分頁，以未登入身分重新監聽「所有分頁」的查詢；Rules 拒絕私人監聽（identityPrivate、私訊、收件匣），
// permission-denied 廣播回舊分頁，那些監聽就永久終止，使用者不重整也看不到錯。main 沒有這個窗口。
// 解法：登入成功時 emitAuth 會寫旗標（既有的 `fcb:signed-in`，見 auth-hint.ts；登出、帳號失效時 Auth 發出 null 狀態，
// 同一處清掉；讀寫都包 try/catch）。啟動時：
//   - 有旗標（上次已登入）→ 先走 Auth（不暫緩），等 Auth 的第一次狀態事件（`auth.authStateReady()`）再初始化 Firestore；
//   - 沒旗標（真訪客）→ 照「公開讀取優先」立即啟動 Firestore。
// 注意：「第一次狀態事件」不是只讀 IndexedDB——SDK 發事件前會先 getIdToken()（過期才刷新 securetoken）與
// accounts:lookup（見 @firebase/auth 的 reloadAndSetCurrentUserOrClear），且 getAuth 預設還會先處理 redirect 解析器的 iframe，
// 所以登入者實際等待是網路往返（量測 2～4 秒），和修前一樣；訪客的速度收益則完整保留。
// 保險：Auth 載入失敗或事件遲遲不來，沿用 3 秒（Firestore 模組就緒後）／10 秒（整體）上限，逾時照樣放行並警告，
// 不會讓登入者永遠卡住；放行時 Auth 已註冊進 app，Firestore 仍會自己等 Auth 初始化完成，不會以未登入身分啟動。

let sessionFlag: boolean | null = null;
let sessionGateTiming = { afterCoreMs: AUTH_HOLD_AFTER_CORE_MS, capMs: AUTH_HOLD_CAP_MS };

/** 啟動時的登入旗標（只讀一次，頁面生命週期內不變——core 與 extras 誰等誰由它決定，不能中途翻轉造成互等）。 */
function sessionFlagAtStart(): boolean {
  sessionFlag ??= readAuthHint();
  return sessionFlag;
}

async function waitForFirstAuthState(): Promise<void> {
  const elapsedMs = typeof performance !== 'undefined' ? performance.now() : 0;
  const timeoutMs = Math.max(0, Math.min(sessionGateTiming.afterCoreMs, sessionGateTiming.capMs - elapsedMs));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const ready = getFirebaseExtras().then(
    async ({ auth }) => {
      await auth.authStateReady();
      return 'ready' as const;
    },
    (err: unknown) => {
      console.warn('[firebase] Auth 載入失敗，Firestore 照常啟動', err);
      return 'failed' as const;
    },
  );
  const outcome = await Promise.race([ready, timeout]);
  if (timer !== null) clearTimeout(timer);
  if (outcome === 'timeout') {
    console.warn(`[firebase] 等不到 Auth 的第一次狀態事件（${Math.round(timeoutMs)} ms），Firestore 照常啟動`);
  }
}

// 開在首頁才暫緩（且沒有登入旗標）：單元測試（MODE=test）不自動啟動，測試需要時自己呼叫 armFirebaseAuthHold()。
if (
  import.meta.env.MODE !== 'test'
  && typeof location !== 'undefined'
  && location.pathname === '/'
  && !sessionFlagAtStart()
) {
  armFirebaseAuthHold();
}

/** 測試用：縮短登入旗標閘的逾時（毫秒）。 */
export function _setSessionGateTimingForTest(timing: { afterCoreMs: number; capMs: number }): void {
  sessionGateTiming = timing;
}

/** 測試用：清掉單例、暫緩狀態與旗標快取（每個測試用全新的載入狀態）。 */
export function _resetFirebaseForTest(): void {
  _appPromise = null;
  _corePromise = null;
  _extrasPromise = null;
  _contextPromise = null;
  releaseFirebaseAuthHold();
  authHold = null;
  sessionFlag = null;
  sessionGateTiming = { afterCoreMs: AUTH_HOLD_AFTER_CORE_MS, capMs: AUTH_HOLD_CAP_MS };
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
