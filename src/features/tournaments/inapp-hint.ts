// 「這台裝置上次站內賽事閘門有過」的本機線索（只存 '1'，不存 UID 或任何個人資料）。
// 有這個線索、而且上次是登入狀態（fcb:signed-in）時，賽事頁一進來就先畫站內，不先閃外部清單（顧問 11-20 選方案 2）。
// 只有伺服器明確判定看不到（未公開且非測試員／管理員、或登出）才清掉；閘門 2 秒逾時、讀取失敗、程式檔載入失敗都不清。
// 鍵名用 fcb: 前綴，舊站 A 沒有任何 fcb: 開頭的鍵（11-20 查過 A 的 js／app.js／index.html）。
// 讀寫都包 try/catch：讀不到就當沒有線索，走原本的路徑。

export const CP_INAPP_HINT_KEY = 'fcb:cp-inapp-seen:v1';

export function readInAppHint(): boolean {
  try {
    return localStorage.getItem(CP_INAPP_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeInAppHint(seen: boolean): void {
  try {
    if (seen) localStorage.setItem(CP_INAPP_HINT_KEY, '1');
    else localStorage.removeItem(CP_INAPP_HINT_KEY);
  } catch {
    // 寫不進去就下次照原本的路徑，不影響功能。
  }
}
