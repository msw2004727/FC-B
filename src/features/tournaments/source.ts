// 站內／外部分頁的預設與網址。選擇記在 ?src= ，返回時瀏覽器歷史還停在這一頁。
// 預設停在外部（顧問 §3.373：第一次上線不自動切到站內，閘門通過只補切換，使用者點了才換；
// 取代原本「G7 前預設停在站內」）。沒有 ?src 時：這台裝置上次閘門有過就先畫站內（見 inapp-hint.ts），否則外部。
// 使用者點選後兩側都明確寫進網址（?src=in／?src=ext），重新整理或返回都留在點的那一側
// （顧問 11-20 方案 2 條件 3，取代 §3.373「預設那一側不寫進網址」：預設變成因人而異後，不寫會被帶回站內）。
// ASSUMPTION: 非法 ?src 不主動清網址，只回預設。使用者改選來源時才重寫查詢字串。

export const COMPETITIONS_DEFAULT_SOURCE = 'ext' as const;

export type CompetitionSource = 'in' | 'ext';

/** 不認得、沒有參數，都回到 COMPETITIONS_DEFAULT_SOURCE。 */
export function competitionSourceFromQuery(value: string | null | undefined): CompetitionSource {
  if (value === 'in' || value === 'ext') return value;
  return COMPETITIONS_DEFAULT_SOURCE;
}

/**
 * 把來源寫進既有的 query，兩側都明確寫 src，其餘參數保留。回傳含開頭 ? 的查詢字串。
 */
export function withCompetitionSource(search: string, source: CompetitionSource): string {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  params.set('src', source);
  return `?${params.toString()}`;
}

/** pathname 不加尾端斜線以外的整理；呼叫端傳目前的 pathname。 */
export function tournamentsSourcePath(pathname: string, search: string, source: CompetitionSource): string {
  return `${pathname}${withCompetitionSource(search, source)}`;
}
