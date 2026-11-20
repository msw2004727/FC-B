// 建置期功能開關（原本定義在 features.config.ts，該檔仍轉出同名常數）。
// 用法範例：
//   FEATURE_OVERRIDES = { 'notifications': false }   // 強制關閉
//   FEATURE_OVERRIDES = { 'tournaments': true }      // 強制開啟（含 reserved）
// 未列出的功能：預設開啟；reserved 功能預設關閉。
//
// 獨立成檔的原因（首頁瘦身）：feature-registry 只需要這個常數。若從 features.config 取，
// 任何引用註冊表的延遲載入 chunk（例如收件匣頁經 action-registry）都會靜態連到全部功能清單與首頁，
// 打包器因此把首頁共用模組拆成許多額外的小 chunk，首屏要多下載十幾個檔案。本檔不得 import 任何功能模組。

/**
 * 賽事第 2 步（建賽與名單）建置期開關，預設關閉；要打開改成 true。
 * 用獨立的字面常數（不是物件屬性）讓打包器在關閉時把賽事路由整段刪掉，首頁入口包不增加
 * （首頁 gzip 上限 60,000 B；改成物件屬性判斷時實測超出 20 B）。
 */
export const COMPETITIONS_ENABLED = true;

export const FEATURE_OVERRIDES: Record<string, boolean> = {
  // manifest 是 reserved，沒有 true 不會啟用；關閉時 competitions/load.ts 不會去載 asia-main／asia-east1。本檔仍然不得 import 功能模組。
  competitions: COMPETITIONS_ENABLED,
};
