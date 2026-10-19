/**
 * 伺服器結算與管理用 Callable 函式（如 confirmEventAttendance 等）是否已部署。
 *
 * 伺服器函式 confirmEventAttendance 等部署後改 true。
 * 當此旗標為 false 時，出席表管理模式不顯示「完成」也不執行前端經驗值／放鴿子結算（R-STAT-000），
 * 改顯示「關閉編輯」並引導至舊版結算。
 */
export const CALLABLES_DEPLOYED = false;
