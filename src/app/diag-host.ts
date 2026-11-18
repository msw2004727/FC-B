/** 內測站角標只在這個主機出現。正式站 toosterx.com 不渲染、也不讀寫這份紀錄。 */
export const DIAG_HOST = 'next.toosterx.com';

export function readHostname(): string {
  try {
    return typeof location === 'undefined' ? '' : location.hostname;
  } catch {
    return '';
  }
}
