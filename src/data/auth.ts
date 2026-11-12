// LINE LIFF → Firebase Auth 登入流程，以及 emulator 專用的 devSignIn。
//
// 正式模式：
//   liff.init → 未登入則 liff.login（帶 redirectUri 回到目前網址，M-036）→ 回到頁面後再次初始化
//   → 取 accessToken → 呼叫 Callable `createCustomToken`（Functions 端驗證 LINE token
//   並簽發 Firebase custom token） → signInWithCustomToken。
//
// emulator 模式：
//   以 `alg: "none"` 無簽章 JWT 呼叫 signInWithCustomToken。**僅** 在 emulator 模式可用。
//
// A 版 Functions 端 `createCustomToken` 會拒絕 localhost / 127.0.0.1 來源
// （`a-createCustomToken-guard.js`），B 端不得嘗試繞過——本地開發請一律使用 emulator + devSignIn。
//
// QA 測試模式（T-024）是經站長核准的第二條簽發路徑，走 issueQaTestToken：
// 伺服器驗證臨時密碼後簽發帶 qa claim 的 token，不是繞過 createCustomToken-guard，
// 也不可沿用 devSignIn。密碼僅供當次 request 使用，不得記錄、快取或附於錯誤。

import { emit } from '@/core/events';
import { toast } from '@/ui/Toast';

import { writeAuthHint } from './auth-hint';
import { callFn } from './callables';
import { getFirebase, shouldUseEmulator } from './firebase';
import { _resetLiffInitForTest, ensureLiffInit, isLiffSdkLoadError } from './liff-init';
import {
  buildCleanLoginRedirectUri,
  cleanLoginParamsFromUrl,
  hasLoginRedirectParams,
  markAutoLoginSuppressed,
  suppressAutoLoginThisPage,
} from './login-redirect';

export interface AuthUser {
  /** Firebase Auth uid；依 R-ID-002，正式模式即 LINE userId。 */
  uid: string;
  displayName: string | null;
  pictureUrl: string | null;
}

/** M-036：觸發 liff.login 重導向或開啟手機外部瀏覽器說明框時拋出，App 不應把此狀態當成登入失敗。 */
export class LoginRedirectingError extends Error {
  readonly isRedirecting = true;
  constructor(message = '[auth] LINE 登入重導向中') {
    super(message);
    this.name = 'LoginRedirectingError';
  }
}

export function isLoginRedirectingError(err: unknown): boolean {
  return (
    err instanceof LoginRedirectingError ||
    Boolean(err && typeof err === 'object' && (err as { isRedirecting?: unknown }).isRedirecting === true)
  );
}

/** 最後一次確認的登入帳號；undefined＝登入狀態尚未確定。 */
let lastKnownAuthUid: string | null | undefined;
let mobileHintAcknowledged = false;

/** 同步取得最後確認的登入帳號（undefined＝尚未確定）。給「只用同帳號快照」等判斷用。 */
export function getLastKnownAuthUid(): string | null | undefined {
  return lastKnownAuthUid;
}

/**
 * M-036：手機外部瀏覽器才顯示登入提示。
 * LINE Mini App（inClient）與 LINE 內建瀏覽器（UA 含 Line/、非 Mini App）直接走 liff.login。
 */
export function isMobileExternalBrowser(inClient: boolean, userAgent: string): boolean {
  if (inClient) return false;
  if (/\bLine\//i.test(userAgent)) return false;
  return /Android|iPhone|iPad|iPod/i.test(userAgent);
}

export function acknowledgeMobileLoginHint(): void {
  mobileHintAcknowledged = true;
}

// 回跳網址清理搬到 login-redirect.ts（App 首屏要用、不必載入本檔的 Firebase 相依），這裡沿用並保留原匯出。
export { buildCleanLoginRedirectUri };

/** 登出（signOutAndReload、清除快取、QA 登出）執行中：期間 signIn 一律不做。 */
let signingOut = false;
/** 進行中的 signIn（共用同一支 Promise）。 */
let inflightSignIn: Promise<AuthUser> | null = null;

/** 測試用：歸零模組層的登入／登出狀態（同一測試檔多案共用模組時用）。 */
export function _resetAuthForTest(): void {
  lastKnownAuthUid = undefined;
  signingOut = false;
  inflightSignIn = null;
  _resetLiffInitForTest();
}

/**
 * 登出開始：這一頁擋自動登入、進行中的換發作廢（世代 +1）、signIn 暫停。
 * 回傳收尾函式：成功且即將重整時不放開閘門（重整前不再登入），失敗時放開。
 */
function beginSignOutGate(): (release: boolean) => void {
  const wasGated = signingOut;
  signingOut = true;
  signInGeneration += 1;
  suppressAutoLoginThisPage();
  return (release) => {
    if (release && !wasGated) signingOut = false;
  };
}
/** 每次 signIn 的世代編號：換發逾時或有新的 signIn 之後，舊那次晚到的結果不採用。 */
let signInGeneration = 0;

/** liff.init／LIFF 登出的等待上限（照 A `LineAuth.init` 的 8 秒 `_withTimeout`）。 */
export const LIFF_STEP_TIMEOUT_MS = 8000;
/** createCustomToken＋signInWithCustomToken 的等待上限。 */
export const LOGIN_TOKEN_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[auth] ${label} 逾時（${ms}ms）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function emitAuth(uid: string | null): void {
  lastKnownAuthUid = uid;
  writeAuthHint(uid !== null);
  try {
    emit('auth:changed', { uid });
  } catch (err) {
    console.error('[auth] emit auth:changed 失敗', err);
  }
}

// ── 對外 API ───────────────────────────────────────────

/**
 * 正式登入流程（LINE LIFF → Firebase custom token）。
 * 失敗時拋錯，呼叫端需自行處理 UI。
 * interactive=false：開頁接手 LINE 授權回跳用；LIFF 沒有登入時不再導向 LINE（避免回跳失敗時無限重導），
 * 改拋 LoginRedirectingError（呼叫端不顯示錯誤）。
 */
export async function signIn(options: { interactive?: boolean } = {}): Promise<AuthUser> {
  // 登出進行中（等 LIFF 登出或重整前）：不登入，頁面自動要求登入會在這裡停住（Opus P3-4）。
  if (signingOut) throw new LoginRedirectingError('[auth] 登出中，略過登入');
  // 進行中的 signIn 共用同一支 Promise：各頁按鈕與 App 接手同時登入時只 liff.init 一次，
  // 不會先完成的那次清掉另一次還沒讀到的 code（Grok 第三輪 P3）。
  if (inflightSignIn) return inflightSignIn;
  // 網址還帶授權回跳參數時一律非互動：各頁按鈕直接呼叫 signIn() 也不會在 code 被處理前 liff.login()
  // （Grok 第二輪 P3）。
  const interactive = options.interactive !== false && !hasLoginRedirectParams(location.href);
  const run = runSignIn(interactive);
  inflightSignIn = run;
  try {
    return await run;
  } finally {
    if (inflightSignIn === run) inflightSignIn = null;
  }
}

/** 目前登入者 uid（最後已知；未知時看 Firebase currentUser，最多等 Auth 還原 8 秒）；讀不到回 null。 */
async function currentSignedInUid(): Promise<string | null> {
  if (lastKnownAuthUid) return lastKnownAuthUid;
  try {
    const ctx = await withTimeout(getFirebase(), LIFF_STEP_TIMEOUT_MS, '讀取 Firebase');
    const auth = ctx.auth as typeof ctx.auth & { authStateReady?: () => Promise<void> };
    if (typeof auth.authStateReady === 'function') {
      await withTimeout(auth.authStateReady(), LIFF_STEP_TIMEOUT_MS, '等待 Auth 還原');
    }
    return auth.currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

async function runSignIn(interactive: boolean): Promise<AuthUser> {
  const generation = ++signInGeneration;
  // liff.init 之前就失敗的三處（emulator、缺設定、SDK 載入失敗）也先清回跳參數，
  // code 不留在網址被重整或分享（Grok 交叉審查 P2）。
  if (shouldUseEmulator()) {
    cleanLoginParamsFromUrl();
    throw new Error(
      '[auth] emulator 模式請改用 devSignIn(uid, claims)；正式 signIn 會呼叫 A 版 createCustomToken，' +
        '其會拒絕 localhost 來源。',
    );
  }

  const liffId = import.meta.env.VITE_LIFF_ID;
  if (!liffId) {
    cleanLoginParamsFromUrl();
    throw new Error('[auth] 缺少 VITE_LIFF_ID 設定（請見 .env.example）');
  }

  // 與 Mini App 預先初始化共用 ensureLiffInit：進行中與成功後都是同一支 Promise，不重複 init。
  // 成功／失敗之後的登入判斷與 redirectUri 維持原樣。
  let liff: Awaited<ReturnType<typeof ensureLiffInit>>;
  try {
    liff = await ensureLiffInit();
  } catch (err) {
    // 初始化失敗也要清掉回跳參數：留著舊 code 會讓下次 init 再拿過期 code 失敗（照 A init 失敗分支的 _cleanUrl）。
    // SDK 載入失敗同樣先清（Grok 交叉審查 P2）。
    cleanLoginParamsFromUrl();
    if (isLiffSdkLoadError(err)) {
      toast.show({ message: 'LIFF SDK 載入失敗、請重新整理頁面' });
      throw err.cause instanceof Error ? err.cause : err;
    }
    toast.show({ message: 'LINE 登入初始化失敗、請關閉 APP 重開' });
    throw err;
  }
  // 回跳的 code 已由 liff.init 處理完，清掉網址參數（照 A initSDK 之後的 _cleanUrl）。
  cleanLoginParamsFromUrl();

  if (!liff.isLoggedIn()) {
    if (!interactive) {
      throw new LoginRedirectingError('[auth] LINE 授權回跳後未取得登入');
    }
    // M-036：手機外部瀏覽器先顯示 LINE 登入提示框（照 A `js/line-auth.js` login 的同一段檢查）
    let inClient = false;
    try {
      inClient = liff.isInClient();
    } catch {
      inClient = false;
    }
    if (!mobileHintAcknowledged && isMobileExternalBrowser(inClient, navigator.userAgent)) {
      emit('auth:mobile-login-hint', {});
      throw new LoginRedirectingError('[auth] 等待手機外部瀏覽器登入提示確認');
    }
    // 導向 LINE 前再確認一次：Firebase 已有登入者（整頁打開時 Auth 晚一步還原）就不導向（Grok 第三輪 P1）。
    // 登出在這段期間開始也不導向。
    if (await currentSignedInUid() !== null || signingOut) {
      throw new LoginRedirectingError('[auth] 已有登入者，不導向 LINE');
    }
    // liff.login() 會觸發 OAuth 重導向；呼叫後通常不會返回。
    // M-036：照 A 帶 redirectUri＝目前網址（清理 OAuth 參數後），登入完回到原本那頁；在首頁時不帶。不顯示失敗錯誤。
    const redirectUri = buildCleanLoginRedirectUri(location.href);
    if (redirectUri === new URL('/', location.origin).toString()) {
      liff.login();
    } else {
      liff.login({ redirectUri });
    }
    throw new LoginRedirectingError();
  }

  const accessToken = liff.getAccessToken();
  if (!accessToken) {
    throw new Error('[auth] 無法取得 LINE access token，LIFF session 可能失效');
  }

  // 換發 Firebase 登入：Callable 預設約 70 秒才放棄，登入鈕會一直停著；設 15 秒上限（Grok 交叉審查 P3）。
  // 逾時、或之後又有新的 signIn／登出開始：這次晚到的 custom token 不再拿去登入（Grok 第二輪 P3）。
  let expired = false;
  const user = await withTimeout((async () => {
    const { customToken: rawCustomToken } = await callFn('createCustomToken', { accessToken });
    if (typeof rawCustomToken !== 'string' || !rawCustomToken) {
      throw new Error('[auth] createCustomToken 未回傳 customToken');
    }
    const [authMod, ctx] = await Promise.all([import('firebase/auth'), getFirebase()]);
    const stale = (): boolean => expired || signingOut || generation !== signInGeneration;
    if (stale()) {
      throw new Error('[auth] 登入換發已過期，略過晚到的結果');
    }
    const credential = await authMod.signInWithCustomToken(ctx.auth, rawCustomToken);
    // 已送出的 signInWithCustomToken 在逾時或登出開始後才回來：立刻登出丟掉這次登入（Grok 第三輪 P3）。
    if (stale()) {
      try {
        await authMod.signOut(ctx.auth);
      } catch (err) {
        console.error('[auth] 丟棄過期登入時登出失敗', err);
      }
      throw new Error('[auth] 登入換發已過期，已登出晚到的登入');
    }
    return credential.user;
  })(), LOGIN_TOKEN_TIMEOUT_MS, '登入換發').catch((err: unknown) => {
    expired = true;
    throw err;
  });

  let displayName: string | null = null;
  let pictureUrl: string | null = null;
  try {
    // 同一份結果交給會員文件同步（user-doc-sync.ts 讀 fcbProfile），登入時只呼叫一次 getProfile。
    const profile = await ((liff as { fcbProfile?: unknown }).fcbProfile = liff.getProfile());
    displayName = profile.displayName ?? null;
    pictureUrl = profile.pictureUrl ?? null;
  } catch (err) {
    console.warn('[auth] liff.getProfile() 失敗，僅使用 Firebase Auth 身份', err);
  }

  const authUser: AuthUser = {
    uid: user.uid,
    displayName: displayName ?? user.displayName ?? null,
    pictureUrl: pictureUrl ?? user.photoURL ?? null,
  };
  emitAuth(authUser.uid);
  return authUser;
}

/**
 * 僅 emulator 模式可用：以無簽章 custom token 直接登入。
 * 正式建置呼叫會拋錯。
 */
export async function devSignIn(
  uid: string,
  claims: Record<string, unknown> = {},
): Promise<AuthUser> {
  if (!shouldUseEmulator()) {
    throw new Error('[auth] devSignIn 僅在 emulator 模式可用（VITE_FIREBASE_EMULATOR=1 且非 PROD）');
  }
  if (!uid) throw new Error('[auth] devSignIn 需要 uid');

  const nowSec = Math.floor(Date.now() / 1000);
  const token = buildUnsignedCustomToken(uid, claims, nowSec);

  const [authMod, ctx] = await Promise.all([import('firebase/auth'), getFirebase()]);
  const credential = await authMod.signInWithCustomToken(ctx.auth, token);
  const user = credential.user;
  emitAuth(user.uid);
  return {
    uid: user.uid,
    displayName: user.displayName,
    pictureUrl: user.photoURL,
  };
}

/** 登出 Firebase Auth；不主動 liff.logout（使用者按的登出走 signOutAndReload）。 */
export async function signOut(): Promise<void> {
  const [authMod, ctx] = await Promise.all([import('firebase/auth'), getFirebase()]);
  await authMod.signOut(ctx.auth);
}

/** LIFF 已登入就登出（本次還沒 init 過先 init）；沒有 LIFF 設定時略過。 */
async function logoutLiff(): Promise<void> {
  const liffId = import.meta.env.VITE_LIFF_ID;
  if (!liffId || shouldUseEmulator()) return;
  // 走同一支 ensureLiffInit：預先初始化或剛登入過就不會再 init。
  const liff = await ensureLiffInit();
  if (liff.isLoggedIn()) liff.logout();
}

/** 只做 LINE 登出（最多等 8 秒，失敗只記錄）；給抽屜「清除快取」在刪 LIFF* 之前用。 */
export async function logoutLineSession(): Promise<void> {
  try {
    await withTimeout(logoutLiff(), LIFF_STEP_TIMEOUT_MS, 'LINE 登出');
  } catch (err) {
    console.warn('[auth] LINE 登出失敗', err);
  }
}

/**
 * 使用者按「登出」：照 A `LineAuth.logout`——Firebase signOut → LIFF 已登入則 liff.logout()
 * （本次沒 init 過先 init，最多等 8 秒）→ 清本機帳號資料（含 LIFF* key）與登入旗標 → 重新整理。
 * 取代 ddc5ad9 的「先清本機再 LIFF」：先刪 LIFF* 會讓之後 init 認不出登入而跳過 liff.logout（Grok 交叉審查 P2）；
 * LIFF 逾時或失敗時，重整前照樣刪 LIFF* key。
 * Firebase signOut 失敗：使用者其實仍登入，不清旗標、不重整，提示重試，回傳 false（Grok 交叉審查 P2）。
 * QA 帳號（claims.qa）：照橫幅「登出 QA」走 signOutQa（不 init LIFF、不重整，Grok 第二輪 P3）。
 * 帳號狀態讀不到（unknown，最多等 8 秒）：不 init LIFF，其餘照做。
 * 重整前寫「剛登出」旗標：重整後這次開頁不自動要求登入（公開個人頁不會又被送去 LINE，Grok 第二輪 P1）。
 * 執行期間 signIn 一律不做（Opus P3-4）。
 */
export async function signOutAndReload(
  reload: () => void = () => location.reload(),
): Promise<boolean> {
  if (signingOut) return false;
  // 一開始就關閘：這一頁擋自動登入、進行中的換發作廢（Grok 第三輪 P1、P3）。
  const endGate = beginSignOutGate();
  let release = true;
  try {
    let status: QaAccountStatus;
    try {
      status = await withTimeout(inspectQaAccount(), LIFF_STEP_TIMEOUT_MS, '讀取帳號狀態');
    } catch {
      status = { kind: 'unknown' };
    }
    if (status.kind === 'qa') {
      try {
        const current = await getCurrentUser();
        return current !== null && await signOutQa(current.uid);
      } catch (err) {
        console.error('[auth] QA 登出失敗', err);
        toast.show({ message: '登出失敗，請再試一次' });
        return false;
      }
    }
    try {
      await signOut();
    } catch (err) {
      console.error('[auth] 登出 Firebase 失敗', err);
      toast.show({ message: '登出失敗，請再試一次' });
      return false;
    }
    if (status.kind !== 'unknown') await logoutLineSession();
    clearAccountLocalState();
    lastKnownAuthUid = null;
    writeAuthHint(false);
    markAutoLoginSuppressed('logout');
    // 即將重整：閘門不放開，重整前這一頁不會再登入（Grok 第三輪 P3）。
    release = false;
    try {
      reload();
    } catch (err) {
      console.error('[auth] 重新整理失敗', err);
    }
    return true;
  } finally {
    endGate(release);
  }
}

/**
 * 抽屜「清除快取」的登出段：與 signOutAndReload 同一道閘（signOut 之前就擋這一頁的自動登入）→
 * Firebase signOut → LINE 登出（最多 8 秒）→ 寫剛登出旗標。
 * 回傳 false＝Firebase 登出失敗（已提示），呼叫端不可刪 LIFF*、不可重整（Grok 第三輪 P2）。
 * 回傳 true 時閘門不放開（呼叫端接著清快取並重整）。
 */
export async function signOutForCacheClear(): Promise<boolean> {
  const endGate = beginSignOutGate();
  try {
    await signOut();
  } catch (err) {
    console.error('[auth] 清除快取時登出 Firebase 失敗', err);
    toast.show({ message: '登出失敗，請再試一次' });
    endGate(true);
    return false;
  }
  await logoutLineSession();
  lastKnownAuthUid = null;
  writeAuthHint(false);
  markAutoLoginSuppressed('logout');
  return true;
}

export interface QaClaims {
  persona: string | null;
  agent: string | null;
  /** qaExp：epoch ms；claim 缺或型別不符為 null。 */
  exp: number | null;
}

// 出處：SideDrawer.tsx executeClearCache；限清帳號相關資料，避免影響離線資源與主題等與帳號無關的設定。
// 'fcb:events-snapshot:'：活動列表快照以登入者 uid 分隔，內含他人的 blockedUids／creatorUid 等欄位，登出（整頁重載後是訪客）時不會再被讀到也不會被覆寫，必須在這裡清掉（顧問 §3.106，L-43）。
const ACCOUNT_STORAGE_PREFIXES = ['shub_c_', 'shub_ts_', 'shub_cache_', 'LIFF', 'toosterx:auth', 'fcb:events-snapshot:'];
const ACCOUNT_STORAGE_EXACT_KEYS = ['sporthub_auto_exp_rules', 'sporthub_auto_exp_logs'];

/** 換帳號前拍下的帳號相關 localStorage（key → 當時的值）。 */
export type AccountLocalSnapshot = ReadonlyMap<string, string | null>;

/** 目前 localStorage 內屬於帳號的 key 與值；儲存空間不可用回空表。 */
export function snapshotAccountLocalState(): AccountLocalSnapshot {
  const snapshot = new Map<string, string | null>();
  try {
    for (const key of Object.keys(localStorage)) {
      if (
        ACCOUNT_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
        ACCOUNT_STORAGE_EXACT_KEYS.includes(key)
      ) {
        snapshot.set(key, localStorage.getItem(key));
      }
    }
  } catch {
    /* ignore */
  }
  return snapshot;
}

/**
 * 清掉上一位使用者殘留的本機帳號資料；signOutQa 與 QA 登入切換帳號共用。
 * 不帶參數＝清掉此刻所有帳號相關 key（登出）。
 * 帶 snapshot＝只清「快照時存在、且現在值沒被改寫」的 key：換帳號時 Firebase 的觀察者可能在
 * signInWithCustomToken 回傳前就觸發，新帳號當下寫入的同前綴 key（或改寫同名 key）不會被誤清。
 * sessionStorage `_lineLoginRetryCount` 兩種模式都清。
 * options.keepLiff：保留 LIFF* key（QA 登出不碰 LINE 的工作階段，Grok 第三輪 P3）。
 * 儲存空間不可用或單一 key 移除失敗都靜默略過（其餘 key 照清）。
 */
export function clearAccountLocalState(
  snapshot?: AccountLocalSnapshot,
  options: { keepLiff?: boolean } = {},
): void {
  let targets: string[] = [];
  try {
    if (snapshot === undefined) {
      targets = Object.keys(localStorage).filter(
        (key) =>
          ACCOUNT_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
          ACCOUNT_STORAGE_EXACT_KEYS.includes(key),
      );
    } else {
      for (const [key, value] of snapshot) {
        if (localStorage.getItem(key) === value) targets.push(key);
      }
    }
  } catch {
    /* ignore */
  }
  if (options.keepLiff === true) targets = targets.filter((key) => !key.startsWith('LIFF'));

  for (const key of targets) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  try {
    sessionStorage.removeItem('_lineLoginRetryCount');
  } catch {
    /* ignore */
  }
}

/**
 * QA 測試模式登入：呼叫 issueQaTestToken → signInWithCustomToken。密碼不落地（見檔頭規則）。
 * 登入前若**確認**是非 QA 帳號（一般 LINE 帳號），成功後才清掉該帳號殘留的本機資料（clearAccountLocalState）；
 * 登入前帳號狀態讀不到（unknown）時保守不清理，QA 登入照常完成——殘留的 key 會在日後 signOutQa 時清掉。
 * 密碼錯誤、伺服器拒絕或 signInWithCustomToken 失敗時，原帳號與它的本機資料一律不動。
 */
export async function signInWithQa(password: string, persona: string): Promise<AuthUser> {
  try {
    if (password === '' || persona === '') {
      throw new Error('[auth] QA login failed');
    }

    const { customToken } = await callFn('issueQaTestToken', { password, persona });
    if (typeof customToken !== 'string' || customToken.length === 0) {
      throw new Error('[auth] QA login failed');
    }

    const [authMod, ctx] = await Promise.all([import('firebase/auth'), getFirebase()]);
    // 伺服器已接受密碼；此刻 currentUser 仍是登入前的帳號，換人前先確認它是不是一般帳號，
    // 並拍下它的帳號相關 key（之後只清這些，新帳號在觀察者回呼中寫入的不會被誤清）。
    const previous = ctx.auth.currentUser;
    const previousStatus = previous != null ? await inspectQaAccount(previous.uid) : null;
    const leftover = previousStatus?.kind === 'regular' ? snapshotAccountLocalState() : null;
    const credential = await authMod.signInWithCustomToken(ctx.auth, customToken);
    const user = credential.user;
    if (leftover !== null) clearAccountLocalState(leftover);
    emitAuth(user.uid);
    return {
      uid: user.uid,
      displayName: user.displayName,
      pictureUrl: user.photoURL,
    };
  } catch {
    throw new Error('[auth] QA login failed');
  }
}

/**
 * 目前登入者的 QA 狀態，四種：
 * - none：沒有登入者；
 * - qa：claims.qa === true，附 claims；
 * - regular：成功讀到 token claims，且確認 claims.qa !== true（一般帳號）；
 * - unknown：讀不到——getFirebase／getIdTokenResult 拋錯、uid 與 expectedUid 不符、讀取途中換人。
 * 呼叫端要「確認是一般帳號才動作」時只能認 regular，unknown 不得當成一般帳號。
 */
export type QaAccountStatus =
  | { kind: 'none' }
  | { kind: 'qa'; claims: QaClaims }
  | { kind: 'regular' }
  | { kind: 'unknown' };

/**
 * 讀目前登入者的 QA 狀態。不強制刷新 token。
 * 有帶 expectedUid 時，讀取前與 getIdTokenResult 之後都必須仍是該 uid（否則 unknown）。
 * 沒帶參數時不核對 uid。
 */
export async function inspectQaAccount(expectedUid?: string): Promise<QaAccountStatus> {
  try {
    const ctx = await getFirebase();
    const currentUser = ctx.auth.currentUser;
    if (!currentUser) return { kind: 'none' };
    if (expectedUid !== undefined && currentUser.uid !== expectedUid) return { kind: 'unknown' };

    const { claims } = await currentUser.getIdTokenResult();
    if (
      ctx.auth.currentUser !== currentUser ||
      (expectedUid !== undefined && currentUser.uid !== expectedUid)
    ) {
      return { kind: 'unknown' };
    }
    if (claims.qa !== true) return { kind: 'regular' };

    return {
      kind: 'qa',
      claims: {
        persona:
          typeof claims.qaPersona === 'string' && claims.qaPersona.length > 0
            ? claims.qaPersona
            : null,
        agent:
          typeof claims.qaAgent === 'string' && claims.qaAgent.length > 0
            ? claims.qaAgent
            : null,
        exp:
          typeof claims.qaExp === 'number' && Number.isFinite(claims.qaExp)
            ? claims.qaExp
            : null,
      },
    };
  } catch {
    return { kind: 'unknown' };
  }
}

/**
 * 目前登入者的 QA claims；未登入、不是 QA、或任何讀不到的情況一律回 null。
 * 需要分辨「確認不是 QA」與「讀不到」時改用 inspectQaAccount。
 */
export async function readQaClaims(expectedUid?: string): Promise<QaClaims | null> {
  const status = await inspectQaAccount(expectedUid);
  return status.kind === 'qa' ? status.claims : null;
}

/**
 * 登出 QA：expectedUid 是按下登出當下要結束的使用者；
 * currentUser 為 null 或 uid 不符時不 signOut、不清任何 key 並回 false，
 * 相符且 signOut 成功並清完 localStorage 前綴（LIFF* 保留）與 sessionStorage `_lineLoginRetryCount` 後回 true。
 * 取代原「signOut 拒絕仍清理、LIFF* 一併清」：拒絕時使用者仍登入，不清任何 key 照樣拒絕；
 * QA 登出不碰 LINE 工作階段，LIFF* 保留（Grok 第三輪 P3）。
 * 執行期間與 signOutAndReload 同一道閘（這一頁擋自動登入、signIn 暫停），QA 橫幅登出也一樣（Grok 第三輪 P3）。
 */
export async function signOutQa(expectedUid: string): Promise<boolean> {
  const ctx = await getFirebase();
  const currentUser = ctx.auth.currentUser;
  if (currentUser == null || currentUser.uid !== expectedUid) return false;

  const endGate = beginSignOutGate();
  try {
    await signOut();
    clearAccountLocalState(undefined, { keepLiff: true });
  } finally {
    endGate(true);
  }

  return true;
}

/** 訂閱 Auth 狀態變更；回傳取消訂閱函式。第一次呼叫會先 lazy 載入 firebase/auth。 */
export function onAuthChanged(cb: (user: AuthUser | null) => void): () => void {
  let stop: (() => void) | null = null;
  let cancelled = false;

  void (async () => {
    try {
      const [authMod, ctx] = await Promise.all([import('firebase/auth'), getFirebase()]);
      if (cancelled) return;
      const unsubscribe = authMod.onAuthStateChanged(ctx.auth, (user) => {
        const au: AuthUser | null = user
          ? { uid: user.uid, displayName: user.displayName, pictureUrl: user.photoURL }
          : null;
        try {
          cb(au);
        } catch (err) {
          console.error('[auth] onAuthChanged listener 拋錯', err);
        }
        emitAuth(user?.uid ?? null);
      });
      if (cancelled) unsubscribe();
      else stop = unsubscribe;
    } catch (err) {
      console.error('[auth] onAuthChanged 初始化失敗', err);
    }
  })();

  return () => {
    cancelled = true;
    if (stop) {
      stop();
      stop = null;
    }
  };
}

/** 讀取目前登入者；未登入回傳 null。 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const ctx = await getFirebase();
  const user = ctx.auth.currentUser;
  if (!user) return null;
  return { uid: user.uid, displayName: user.displayName, pictureUrl: user.photoURL };
}

// ── 純函式（供測試／內部使用） ─────────────────────────

const EMULATOR_ISSUER = 'fc-b-emulator@localhost';
const IDENTITY_TOOLKIT_AUD =
  'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

function base64urlUtf8(input: string): string {
  // 標準 base64 → base64url；btoa 僅處理 Latin-1，先對 UTF-8 位元組編碼。
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * 組裝 emulator 專用無簽章 custom token（JWT header `{"alg":"none","typ":"JWT"}`）。
 *
 * Payload 依 Firebase custom token 規格：
 *   iss、sub、aud、iat、exp、uid、claims。
 * iss / sub 對 Auth emulator 只是任意字串；真實環境一律由 Functions 端簽發，不走本函式。
 */
export function buildUnsignedCustomToken(
  uid: string,
  claims: Record<string, unknown>,
  nowSec: number,
): string {
  const header = { alg: 'none', typ: 'JWT' } as const;
  const payload = {
    iss: EMULATOR_ISSUER,
    sub: EMULATOR_ISSUER,
    aud: IDENTITY_TOOLKIT_AUD,
    iat: nowSec,
    exp: nowSec + 3600,
    uid,
    claims: claims ?? {},
  };
  const headerPart = base64urlUtf8(JSON.stringify(header));
  const payloadPart = base64urlUtf8(JSON.stringify(payload));
  // 第三段為簽章，`alg: none` 時留空（仍須保留結尾的 `.`）。
  return `${headerPart}.${payloadPart}.`;
}
