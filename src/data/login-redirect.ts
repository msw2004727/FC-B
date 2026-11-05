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

/** 把目前網址上的 OAuth 參數清掉（照 A `_cleanUrl`），避免重新整理或分享時帶著 code。 */
export function cleanLoginParamsFromUrl(): void {
  try {
    const clean = buildCleanLoginRedirectUri(location.href);
    if (clean !== location.href) history.replaceState(history.state, '', clean);
  } catch {
    /* ignore */
  }
}
