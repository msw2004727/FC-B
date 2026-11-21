// 站內／外部分頁的預設與網址。選擇記在 ?src= ，返回時瀏覽器歷史還停在這一頁。
// 預設站內（站長 11-21 指示「我要預設是站內賽事」：取代顧問 §3.373「預設停在外部」與 11-20 方案 2
// 「這台裝置上次閘門有過才先畫站內」，因為站內賽事 11-21 已對外開放，訪客與第一次來的人也該先看到站內）。
// 沒有 ?src 時一律先畫站內；閘門沒過、讀取失敗或 12 秒上限到了才退回外部（見 TournamentsPage.tsx）。
// 使用者點選後兩側都明確寫進網址（?src=in／?src=ext），重新整理或返回都留在點的那一側
// （顧問 11-20 方案 2 條件 3，取代 §3.373「預設那一側不寫進網址」：預設變成因人而異後，不寫會被帶回站內）。
// ASSUMPTION: 非法 ?src 不主動清網址，只回預設。使用者改選來源時才重寫查詢字串。

export const COMPETITIONS_DEFAULT_SOURCE = 'in' as const;

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
