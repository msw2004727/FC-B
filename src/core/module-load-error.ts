// 程式檔（模組）載入失敗的辨識與標記（顧問 §3.259／§3.260）。
// 這個檔不得 import 任何模組：callables.ts（首頁共用 chunk）與 error-report.ts（入口）都引用它，
// 有依賴會讓打包把 error-report 等一起拖進 callables 的 chunk（實測開機總下載多約 1.2 KB）。

/** 三種瀏覽器原生訊息（iOS WebKit、Chromium、Firefox）。 */
export const MODULE_LOAD_FAILURE_RE = /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i;

/**
 * 動態載入回空值時的標記錯誤碼：chunk-reload 守門 preventDefault 後 Vite 會回 undefined、原錯誤被吞掉，
 * 載入點在這時丟出帶這個 code／name 的錯誤，報名錯誤轉換與上報器才認得出是載入失敗。
 */
export const MODULE_LOAD_FAILED_CODE = 'MODULE_LOAD_FAILED';

export function moduleLoadFailedError(what: string): Error {
  const err = new Error(`Module load returned empty: ${what}`) as Error & { code: string };
  err.name = MODULE_LOAD_FAILED_CODE;
  err.code = MODULE_LOAD_FAILED_CODE;
  return err;
}

/**
 * 程式檔載入失敗：帶上面標記碼的錯誤（含被包成 CallableError 的），或三種原生訊息。
 * 只看標記與訊息，不把 TypeError 整類當成載入失敗。
 */
export function isModuleLoadFailure(err: unknown): boolean {
  if (err && typeof err === 'object' && (err as { code?: unknown }).code === MODULE_LOAD_FAILED_CODE) return true;
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return MODULE_LOAD_FAILURE_RE.test(message);
}
