// 經驗值顯示開關（2026-10-20 站長：新版關閉經驗值功能，經驗值照舊累計）。
// false：不顯示頂部列 EXP、使用者膠囊的 Lv、個人頁等級條；活動完成後經驗值仍照 A 累計（新舊版資料一致）。
// 要恢復顯示時改 true，並同步 index.html 開頁骨架的頂部列（boot-shell.test.ts 會檢查）。
export const SHOW_EXP = false;
