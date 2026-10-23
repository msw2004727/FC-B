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

/** M-036：照 A `_isMobileExternalBrowser`——不在 LINE App 內、且是手機（含 PWA）。 */
export function isMobileExternalBrowser(inClient: boolean, userAgent: string): boolean {
  if (inClient) return false;
  return /Android|iPhone|iPad|iPod/i.test(userAgent);
}

export function acknowledgeMobileLoginHint(): void {
  mobileHintAcknowledged = true;
}

/** M-036：照 A `js/line-auth.js:595-605` 清理 OAuth 查詢參數並組出回跳網址。 */
export function buildCleanLoginRedirectUri(href: string): string {
  try {
    const url = new URL(href);
    [
      'code',
      'state',
      'liffClientId',
      'liffRedirectUri',
      'error',
      'error_description',
    ].forEach((key) => {
      url.searchParams.delete(key);
    });
    return url.toString();
  } catch {
    return href;
  }
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
 */
export async function signIn(): Promise<AuthUser> {
  if (shouldUseEmulator()) {
    throw new Error(
      '[auth] emulator 模式請改用 devSignIn(uid, claims)；正式 signIn 會呼叫 A 版 createCustomToken，' +
        '其會拒絕 localhost 來源。',
    );
  }

  const liffId = import.meta.env.VITE_LIFF_ID;
  if (!liffId) {
    throw new Error('[auth] 缺少 VITE_LIFF_ID 設定（請見 .env.example）');
  }

  let liff: typeof import('@line/liff').default;
  try {
    const liffModule = await import('@line/liff');
    liff = liffModule.default;
  } catch (err) {
    toast.show({ message: 'LIFF SDK 載入失敗、請重新整理頁面' });
    throw err;
  }

  try {
    await liff.init({ liffId });
  } catch (err) {
    toast.show({ message: 'LINE 登入初始化失敗、請關閉 APP 重開' });
    throw err;
  }

  if (!liff.isLoggedIn()) {
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

  const { customToken: rawCustomToken } = await callFn('createCustomToken', { accessToken });
  if (typeof rawCustomToken !== 'string' || !rawCustomToken) {
    throw new Error('[auth] createCustomToken 未回傳 customToken');
  }
  const customToken = rawCustomToken;

  const [authMod, ctx] = await Promise.all([import('firebase/auth'), getFirebase()]);
  const credential = await authMod.signInWithCustomToken(ctx.auth, customToken);
  const user = credential.user;

  let displayName: string | null = null;
  let pictureUrl: string | null = null;
  try {
    const profile = await liff.getProfile();
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

/** 登出 Firebase Auth；不主動 liff.logout（可由 UI 另行決定）。 */
export async function signOut(): Promise<void> {
  const [authMod, ctx] = await Promise.all([import('firebase/auth'), getFirebase()]);
  await authMod.signOut(ctx.auth);
}

export interface QaClaims {
  persona: string | null;
  agent: string | null;
  /** qaExp：epoch ms；claim 缺或型別不符為 null。 */
  exp: number | null;
}

/** QA 測試模式登入：呼叫 issueQaTestToken → signInWithCustomToken。密碼不落地（見檔頭規則）。 */
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
    const credential = await authMod.signInWithCustomToken(ctx.auth, customToken);
    const user = credential.user;
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
 * 目前登入者的 QA 狀態；未登入或 claims.qa !== true 回 null。不強制刷新 token。
 * 有帶 expectedUid 時，讀取前與 getIdTokenResult 之後都必須仍是該 uid。
 * 沒帶參數時不核對 uid。
 */
export async function readQaClaims(expectedUid?: string): Promise<QaClaims | null> {
  try {
    const ctx = await getFirebase();
    const currentUser = ctx.auth.currentUser;
    if (!currentUser) return null;
    if (expectedUid !== undefined && currentUser.uid !== expectedUid) return null;

    const { claims } = await currentUser.getIdTokenResult();
    if (
      ctx.auth.currentUser !== currentUser ||
      (expectedUid !== undefined && currentUser.uid !== expectedUid) ||
      claims.qa !== true
    ) {
      return null;
    }

    return {
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
    };
  } catch {
    return null;
  }
}

/**
 * 登出 QA：expectedUid 是按下登出當下要結束的使用者；
 * currentUser 為 null 或 uid 不符時不 signOut、不清任何 key 並回 false，
 * 相符且 signOut 成功並清完 localStorage 前綴與 sessionStorage `_lineLoginRetryCount` 後回 true，
 * signOut 拒絕則清理後照樣拒絕。
 */
export async function signOutQa(expectedUid: string): Promise<boolean> {
  const ctx = await getFirebase();
  const currentUser = ctx.auth.currentUser;
  if (currentUser == null || currentUser.uid !== expectedUid) return false;

  try {
    await signOut();
  } finally {
    // 出處：SideDrawer.tsx executeClearCache；限清帳號相關資料，避免影響離線資源。
    const prefixes = ['shub_c_', 'shub_ts_', 'shub_cache_', 'LIFF', 'toosterx:auth'];
    const exactKeys = ['sporthub_auto_exp_rules', 'sporthub_auto_exp_logs'];

    try {
      const keys = Object.keys(localStorage);
      for (const key of keys) {
        if (prefixes.some((prefix) => key.startsWith(prefix)) || exactKeys.includes(key)) {
          try {
            localStorage.removeItem(key);
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }

    try {
      sessionStorage.removeItem('_lineLoginRetryCount');
    } catch {
      /* ignore */
    }
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
