/**
 * 伺服器結算與管理用 Callable 函式（如 confirmEventAttendance 等）是否已部署。
 *
 * true：正取名單顯示「完成」並走伺服器結算；未報名單只 flush 即時存檔，不發經驗值。
 * 改回 false 可回退成「關閉編輯」與舊版結算提示，不執行正取名單伺服器結算。
 */
export const CALLABLES_DEPLOYED = true;
