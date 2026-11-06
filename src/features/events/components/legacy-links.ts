// 換站友善（R-CTX-009）：新站在 toosterx.com 上線後，舊站改在 old.toosterx.com；
// 其他主機（next.toosterx.com、本機）舊站仍是 toosterx.com。依主機名稱自動切換，換站不必改碼或重建。
// （取代原本寫死的 'https://toosterx.com/'：換站後會指回新站自己，主辦人被困住，見換站計畫書 F-03。）
const CUTOVER_HOSTS = new Set(['toosterx.com', 'www.toosterx.com']);

export function legacySiteUrl(hostname: string): string {
  return CUTOVER_HOSTS.has(hostname) ? 'https://old.toosterx.com/' : 'https://toosterx.com/';
}

export const LEGACY_SETTLE_URL = legacySiteUrl(typeof location === 'undefined' ? '' : location.hostname);
