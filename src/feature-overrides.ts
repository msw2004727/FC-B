// 建置期功能開關（原本定義在 features.config.ts，該檔仍轉出同名常數）。
// 用法範例：
//   FEATURE_OVERRIDES = { 'notifications': false }   // 強制關閉
//   FEATURE_OVERRIDES = { 'tournaments': true }      // 強制開啟（含 reserved）
// 未列出的功能：預設開啟；reserved 功能預設關閉。
//
// 獨立成檔的原因（首頁瘦身）：feature-registry 只需要這個常數。若從 features.config 取，
// 任何引用註冊表的延遲載入 chunk（例如收件匣頁經 action-registry）都會靜態連到全部功能清單與首頁，
// 打包器因此把首頁共用模組拆成許多額外的小 chunk，首屏要多下載十幾個檔案。本檔不得 import 任何功能模組。

export const FEATURE_OVERRIDES: Record<string, boolean> = {};
