// LINE LIFF → Firebase Auth 登入流程，以及 emulator 專用的 devSignIn。
//
// 正式模式：
//   liff.init → 未登入則 liff.login（LIFF 會重導向）→ 回到頁面後再次初始化
//   → 取 accessToken → 呼叫 Callable `createCustomToken`（Functions 端驗證 LINE token
//   並簽發 Firebase custom token） → signInWithCustomToken。
//
// emulator 模式：
//   以 `alg: "none"` 無簽章 JWT 呼叫 signInWithCustomToken。**僅** 在 emulator 模式可用。
//
// A 版 Functions 端 `createCustomToken` 會拒絕 localhost / 127.0.0.1 來源
// （`a-createCustomToken-guard.js`），B 端不得嘗試繞過——本地開發請一律使用 emulator + devSignIn。

import { emit } from '@/core/events';

import { callFn } from './callables';
import { getFirebase, shouldUseEmulator } from './firebase';

export interface AuthUser {
  /** Firebase Auth uid；依 R-ID-002，正式模式即 LINE userId。 */
  uid: string;
  displayName: string | null;
  pictureUrl: string | null;
}

/** 最後一次確認的登入帳號；undefined＝登入狀態尚未確定。 */
let lastKnownAuthUid: string | null | undefined;

/** 同步取得最後確認的登入帳號（undefined＝尚未確定）。給「只用同帳號快照」等判斷用。 */
export function getLastKnownAuthUid(): string | null | undefined {
  return lastKnownAuthUid;
}

function emitAuth(uid: string | null): void {
  lastKnownAuthUid = uid;
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

  const liffModule = await import('@line/liff');
  const liff = liffModule.default;

  await liff.init({ liffId });

  if (!liff.isLoggedIn()) {
    // liff.login() 會觸發 OAuth 重導向；呼叫後通常不會返回。
    liff.login();
    throw new Error('[auth] LINE 登入未完成（已觸發 liff.login 重導向）');
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
