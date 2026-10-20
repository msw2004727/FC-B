// 「上次是否已登入」的本機線索（只存 '1'，不存 UID）。
// Firebase 登入狀態存在 IndexedDB，開頁時無法同步讀取；index.html 骨架與 App 首次畫面用這個線索
// 先畫頭像位置，避免已登入的人看到「LINE 登入」按鈕閃一下再換成頭像。
// 鍵名與 index.html 開頁腳本一致，改名要兩邊一起改。

export const AUTH_HINT_KEY = 'fcb:signed-in';

export function readAuthHint(): boolean {
  try {
    return localStorage.getItem(AUTH_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeAuthHint(signedIn: boolean): void {
  try {
    if (signedIn) localStorage.setItem(AUTH_HINT_KEY, '1');
    else localStorage.removeItem(AUTH_HINT_KEY);
  } catch {
    // 無法寫入就退回「未登入」外觀，不影響功能。
  }
}
