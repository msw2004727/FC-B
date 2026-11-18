// 經驗值顯示開關（2026-10-20 站長：新版關閉經驗值功能，經驗值照舊累計）。
// false：不顯示頂部列 EXP、使用者膠囊的 Lv、個人頁等級條；發放另由下方 EXP_GRANT_ENABLED 控制（11-16 起停發）。
// 要恢復顯示時改 true，並同步 index.html 開頁骨架的頂部列（boot-shell.test.ts 會檢查）。
export const SHOW_EXP = false;

// 取代 10-20 經驗值照舊累計；2026-11-16 站長定案停發（顧問 §3.185）；恢復時改回 true 並換版號，停發期間不累計、日後需補算。
export const EXP_GRANT_ENABLED = false;
