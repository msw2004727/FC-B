// 網頁推播（W5）前端常數。公鑰與 key id 是公開值，必須與 FC `functions/web-push-config.js` 逐字相同
// （跨 repo 無法 import；key id＝sha256(公鑰字串) 前 16 碼，由 config.test.ts 鎖住兩者一致）。
// 換金鑰照 W2 runbook：伺服器、Callable 與這裡同一批換。

export const WEB_PUSH_VAPID_PUBLIC_KEY =
  'BH_ixX7vhX5QjtwewYj-50ylvKTaGiV4ErQMVSJiXIL7H3gGFKY4QwJFeB35GzqZLxG7Ia2Pft3Cw4ywUNmpyRY';
export const WEB_PUSH_VAPID_KEY_ID = '726cade1dd107515';

/** 已開啟的裝置每 7 天向伺服器回報一次（W2 §5.1）。 */
export const WEB_PUSH_REPORT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** 開機同步失敗後 6 小時內不再試。 */
export const WEB_PUSH_RETRY_BACKOFF_MS = 6 * 60 * 60 * 1000;
/** 每支 Callable 的上限。 */
export const WEB_PUSH_CALL_TIMEOUT_MS = 10 * 1000;
/** 等 SW 啟用（serviceWorker.ready）的上限。 */
export const WEB_PUSH_READY_TIMEOUT_MS = 5 * 1000;

/**
 * 開通前只有 QA 帳號看得到開關（顧問 §3.699 Q5）；開通批次改成 true 讓所有人看到。
 * 不用 isInternalTestMode()：那是建置層級旗標，正式建置預設為真，不能拿來分人。
 */
export const WEB_PUSH_UI_PUBLIC = false;
