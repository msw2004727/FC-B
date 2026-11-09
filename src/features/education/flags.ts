// 課程（K1～K3）上線開關。
// 計畫書 P1-3：開課、報名、審核、點名形成完整流程（K3 驗收）前，一般用戶看不到課程。
// 打開方式：把 SHOW_COURSES 改 true 後上線；開發與截圖 harness 用建置變數 VITE_SHOW_COURSES=1。
// 用建置期常數（不是函式呼叫），關閉時壓縮器會把課程路由整段拿掉，首頁主程式不多帶課程的程式碼。
export const SHOW_COURSES = false;

export const COURSES_ENABLED: boolean = SHOW_COURSES || import.meta.env.VITE_SHOW_COURSES === '1';
