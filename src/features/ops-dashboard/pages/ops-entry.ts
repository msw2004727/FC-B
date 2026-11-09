/**
 * 兩段延遲載入的第一段（很小）。首頁主程式只記這一個 chunk 檔名；
 * 頁面本體（OpsPage）的 JS、CSS 檔名與相依清單記在這個 chunk 裡，不進首頁主程式（首頁 gzip 已貼近 60KB 上限）。
 * 載入失敗照常由 App 的路由載入處理（提示、可重試），因為路由的 load 會等到第二段完成。
 */
export const loadOpsPage = () => import('./OpsPage');
