// 從 drawer-menu.ts 抽出（首頁瘦身）：登入提示框只需要這個網址，不必為它把整份側邊選單設定帶進首頁主程式。
// drawer-menu.ts 仍轉出同名函式，既有呼叫端不受影響。

/** 取得 Mini App 分享連結（照 A `MINI_APP_BASE_URL`）。 */
export function getMiniAppShareUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const liffId = env?.VITE_LIFF_ID || '';
  return `https://miniapp.line.me/${liffId}`;
}
