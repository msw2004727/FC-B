// 「上次是否已登入」的本機線索（只存 '1'，不存 UID）。
// Firebase 登入狀態存在 IndexedDB，開頁時無法同步讀取；index.html 骨架與 App 首次畫面用這個線索
// 先畫頭像位置，避免已登入的人看到「LINE 登入」按鈕閃一下再換成頭像。
// 鍵名與 index.html 開頁腳本一致，改名要兩邊一起改。
// 頭像紀錄（fcb:avatar）只存 https 圖片網址，不存 UID；登出、帳號失效時跟登入旗標一起清。

export const AUTH_HINT_KEY = 'fcb:signed-in';
export const AVATAR_HINT_KEY = 'fcb:avatar';

export function readAuthHint(): boolean {
  try {
    return localStorage.getItem(AUTH_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function readAvatarHint(): string | null {
  try {
    const v = localStorage.getItem(AVATAR_HINT_KEY);
    return v && v.indexOf('https://') === 0 ? v : null;
  } catch {
    return null;
  }
}

export function writeAvatarHint(url: string | null): void {
  try {
    if (url && url.indexOf('https://') === 0) localStorage.setItem(AVATAR_HINT_KEY, url);
    else localStorage.removeItem(AVATAR_HINT_KEY);
  } catch {
    // 靜默略過。
  }
}

export function writeAuthHint(signedIn: boolean): void {
  try {
    if (signedIn) localStorage.setItem(AUTH_HINT_KEY, '1');
    else {
      localStorage.removeItem(AUTH_HINT_KEY);
      localStorage.removeItem(AVATAR_HINT_KEY);
    }
  } catch {
    // 無法寫入就退回「未登入」外觀，不影響功能。
  }
}
