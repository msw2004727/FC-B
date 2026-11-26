// 解除臨取紅標 Callable `clearLateCancelRed`（FC 契約 late-cancel §6）是否已部署。
// false：用戶卡不顯示「解除臨取紅標」（臨取狀態一行照常顯示）。Functions 部署後改 true 並重建。
// 2026-11-23 21:35 clearLateCancelRed 已部署（00001-yik，顧問 §3.627），改 true；取代原 false。
export const LATE_CANCEL_CLEAR_CALLABLE_DEPLOYED = true;

// 黑標也能解除（站長 §3.821）需要新版 clearLateCancelRed（FC 分支 cp-po-lc-clear）。舊版後端對黑標回 ok 但什麼都沒清，
// 前端又是樂觀更新，會讓管理員以為已解除（靜默失敗）。後端部署並讀回後才改 true；false 時黑標只顯示、不出解除鈕。
// 2026-11-26 新版 clearLateCancelRed 已部署（00001-yik → 00002-nab，FC main 18bf73de5，顧問 §3.822／§3.824 讀回正常），改 true；取代原 false。
export const LATE_CANCEL_CLEAR_BLACK_DEPLOYED = true;
