// 解除臨取紅標 Callable `clearLateCancelRed`（FC 契約 late-cancel §6）是否已部署。
// false：用戶卡不顯示「解除臨取紅標」（臨取狀態一行照常顯示）。Functions 部署後改 true 並重建。
// 2026-11-23 21:35 clearLateCancelRed 已部署（00001-yik，顧問 §3.627），改 true；取代原 false。
export const LATE_CANCEL_CLEAR_CALLABLE_DEPLOYED = true;
