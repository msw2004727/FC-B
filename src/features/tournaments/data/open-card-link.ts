/**
 * 賽事卡外連。點擊當下同步走共用分頁，不先 await。
 * 卡片網址契約只收 https（normalizeHttpsUrl）；其他協定不開。
 */
import { openExternal } from '@/core/open-external';
import { normalizeHttpsUrl } from './card-model';

export function openCardLink(url: string): void {
  const safe = normalizeHttpsUrl(url);
  if (!safe) return;
  openExternal(safe);
}
