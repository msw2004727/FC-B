// 站內／外部分頁的預設與網址。選擇記在 ?src= ，返回時瀏覽器歷史還停在這一頁。
// G7 前預設停在站內。預設那一側不寫進網址，另一側才寫（現在是 ?src=ext）。
// ASSUMPTION: 非法 ?src 不主動清網址，只回預設。使用者改選來源時才重寫查詢字串。

export const COMPETITIONS_DEFAULT_SOURCE = 'in' as const;

export type CompetitionSource = 'in' | 'ext';

/** 不認得、沒有參數，都回到 COMPETITIONS_DEFAULT_SOURCE。 */
export function competitionSourceFromQuery(value: string | null | undefined): CompetitionSource {
  if (value === 'in' || value === 'ext') return value;
  return COMPETITIONS_DEFAULT_SOURCE;
}

/**
 * 把來源寫進既有的 query。選到預設值就拿掉 src，其餘參數保留。
 * 回傳含開頭 ? 的查詢字串；沒有參數時回空字串。
 */
export function withCompetitionSource(search: string, source: CompetitionSource): string {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  if (source === COMPETITIONS_DEFAULT_SOURCE) params.delete('src');
  else params.set('src', source);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** pathname 不加尾端斜線以外的整理；呼叫端傳目前的 pathname。 */
export function tournamentsSourcePath(pathname: string, search: string, source: CompetitionSource): string {
  return `${pathname}${withCompetitionSource(search, source)}`;
}
