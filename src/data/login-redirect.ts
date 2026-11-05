// LINE 授權回跳的網址處理（純函式，不載入 LIFF；App 首屏可直接用）。
// 外部瀏覽器走完 liff.login 會帶 code＋liffClientId 回到原頁；從 liff.line.me 開啟會帶 liff.state。
// 只有這兩種情況開頁時才載入 LIFF 接手登入（照 A 開頁 liff.init 的效果），一般開頁仍不載 LIFF（T-041 首頁速度）。

/** 網址是否帶 LINE 授權回跳參數。 */
export function hasLoginRedirectParams(href: string): boolean {
  try {
    const params = new URL(href).searchParams;
    return (params.has('code') && params.has('liffClientId')) || params.has('liff.state');
  } catch {
    return false;
  }
}

/** 使用者在 LINE 授權頁取消（帶 error＋liffClientId 回來）：不必載入 LIFF，清掉參數即可。 */
export function hasLoginCancelParams(href: string): boolean {
  try {
    const params = new URL(href).searchParams;
    return params.has('error') && params.has('liffClientId');
  } catch {
    return false;
  }
}

/**
 * LINE 授權回跳會帶的查詢參數。照 A `js/line-auth.js:595-605` 的清單，另加 liff.state：
 * 只在開頁判斷時用到，留在網址上會讓之後每次開頁都再進接手（Grok 交叉審查 P2）。
 */
const LOGIN_REDIRECT_PARAM_KEYS = [
  'code',
  'state',
  'liffClientId',
  'liffRedirectUri',
  'error',
  'error_description',
  'liff.state',
] as const;

/** M-036：照 A `js/line-auth.js:595-605` 清理 OAuth 查詢參數並組出回跳網址。 */
export function buildCleanLoginRedirectUri(href: string): string {
  try {
    const url = new URL(href);
    LOGIN_REDIRECT_PARAM_KEYS.forEach((key) => {
      url.searchParams.delete(key);
    });
    return url.toString();
  } catch {
    return href;
  }
}

/**
 * 分享連結改寫（/?event=… → /events/…）時，把來源網址上的授權回跳參數帶到目的網址，
 * 留給 liff.init 讀；不帶的話 code 會被改寫吃掉，接手登入靜默失敗（Grok 交叉審查 P2）。
 * 來源沒有回跳參數時原樣回傳目的網址。
 */
export function carryLoginRedirectParams(fromUrl: string, toPath: string): string {
  try {
    const from = new URL(fromUrl, 'https://toosterx.invalid').searchParams;
    const present = LOGIN_REDIRECT_PARAM_KEYS.filter((key) => from.has(key));
    if (present.length === 0) return toPath;
    const to = new URL(toPath, 'https://toosterx.invalid');
    for (const key of present) {
      for (const value of from.getAll(key)) to.searchParams.append(key, value);
    }
    return `${to.pathname}${to.search}${to.hash}`;
  } catch {
    return toPath;
  }
}

/** 把目前網址上的 OAuth 參數清掉（照 A `_cleanUrl`），避免重新整理或分享時帶著 code。 */
export function cleanLoginParamsFromUrl(): void {
  try {
    const clean = buildCleanLoginRedirectUri(location.href);
    if (clean !== location.href) history.replaceState(history.state, '', clean);
  } catch {
    /* ignore */
  }
}

// 「下一次開頁不要自動登入」旗標（sessionStorage，只活在這個分頁）。
// 公開個人頁掛載就自動要求登入（照 A `_requireProtectedActionLogin`）；剛在 LINE 授權頁取消、或剛登出重整時，
// 若照常自動登入，桌面外部瀏覽器會被反覆送去 LINE、登出等於無效（Grok 第二輪 P1）。
// 寫入：取消參數清掉前、登出重整前；讀取：App 開頁時讀一次並刪掉，下一次開頁恢復自動登入。
const AUTO_LOGIN_SUPPRESS_KEY = 'fcb:suppress-auto-login';

// 「這一頁不要自動登入」的記憶體旗標：登出／清除快取一開始就設（重整前這一頁也擋得住，Grok 第三輪 P2、P3），
// 也是 sessionStorage 寫不進去時的退路（至少這一頁有效，Grok 第三輪 P3）。整頁重整後自然歸零。
let suppressedThisPage = false;

/** 只擋這一頁的自動登入（不留到下一次開頁）。 */
export function suppressAutoLoginThisPage(): void {
  suppressedThisPage = true;
}

export function isAutoLoginSuppressedThisPage(): boolean {
  return suppressedThisPage;
}

/** 測試用：歸零記憶體旗標。 */
export function _resetAutoLoginSuppressForTest(): void {
  suppressedThisPage = false;
}

export function markAutoLoginSuppressed(reason: 'cancel' | 'logout'): void {
  suppressedThisPage = true;
  try {
    sessionStorage.setItem(AUTO_LOGIN_SUPPRESS_KEY, reason);
  } catch {
    /* 儲存不可用：只剩記憶體旗標（這一頁有效） */
  }
}

/** 讀出並刪掉旗標；有旗標（或這一頁已標記）回 true（這次開頁不自動登入）。 */
export function consumeAutoLoginSuppressed(): boolean {
  let stored = false;
  try {
    stored = sessionStorage.getItem(AUTO_LOGIN_SUPPRESS_KEY) !== null;
    if (stored) sessionStorage.removeItem(AUTO_LOGIN_SUPPRESS_KEY);
  } catch {
    /* 儲存不可用：看記憶體旗標 */
  }
  return stored || suppressedThisPage;
}
