// 課程（K1～K3）上線開關。
// 計畫書 P1-3：開課、報名、審核、點名形成完整流程（K3 驗收）前，一般用戶看不到課程。
// 打開方式：把 SHOW_COURSES 改 true 後上線；開發與截圖 harness 用建置變數 VITE_SHOW_COURSES=1。
export const SHOW_COURSES = false;

export function isCoursesEnabled(): boolean {
  return SHOW_COURSES || import.meta.env.VITE_SHOW_COURSES === '1';
}
