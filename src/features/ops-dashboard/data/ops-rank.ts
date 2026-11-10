/**
 * 兩個排行（字典 §2.4）。純函式，不讀 Firestore。
 * 資料已在所選期間的 `periods.P.topEvents`／`topHosts`（進頁那次 `opsSummary/latest`）。
 * 切期間不再讀。缺欄位、0 筆、`max ≤ 0` 都回空陣列，由畫面整卡不顯示，不當成錯誤。
 */
import type { TopEvent, TopHost } from './ops-summary-types';

/** 字典 §2.4：不足 10 場列實際筆數，超過只留前 10。 */
export const RANK_LIMIT = 10;

export interface RankEventRow {
  docId: string;
  title: string;
  occupied: number;
  max: number;
  /** `/events/:docId`。標題不進網址。 */
  href: string;
}

export interface RankHostRow {
  uid: string;
  name: string;
  events: number;
  registrations: number;
  /** `/profile/:uid`（與 A4 相同）。姓名不進網址。 */
  href: string;
}

function eventHref(docId: string): string {
  return `/events/${encodeURIComponent(docId)}`;
}

function hostHref(uid: string): string {
  return `/profile/${encodeURIComponent(uid)}`;
}

/**
 * 熱門活動：`occupied ÷ max` 高者在前；同率 `occupied` 多者在前；再依歸屬日新者在前。
 * `max ≤ 0` 排除。同 docId 只留排序後的第一筆。
 */
export function rankEvents(list: readonly TopEvent[]): RankEventRow[] {
  const sorted = list.filter((item) => item.docId !== '' && item.max > 0).sort((a, b) => {
    const byFill = b.occupied * a.max - a.occupied * b.max;
    if (byFill !== 0) return byFill;
    if (b.occupied !== a.occupied) return b.occupied - a.occupied;
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? 1 : -1;
    return a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0;
  });
  const out: RankEventRow[] = [];
  const seen = new Set<string>();
  for (const item of sorted) {
    if (seen.has(item.docId)) continue;
    seen.add(item.docId);
    out.push({
      docId: item.docId,
      title: item.title,
      occupied: item.occupied,
      max: item.max,
      href: eventHref(item.docId),
    });
    if (out.length >= RANK_LIMIT) break;
  }
  return out;
}

/**
 * 熱門主辦：場數多者在前，同場數依報名人次（K4）多者在前。
 * 空 uid 排除。同 uid 只留排序後的第一筆。
 */
export function rankHosts(list: readonly TopHost[]): RankHostRow[] {
  const sorted = list.filter((item) => item.uid !== '').sort((a, b) => {
    if (b.events !== a.events) return b.events - a.events;
    if (b.registrations !== a.registrations) return b.registrations - a.registrations;
    return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  });
  const out: RankHostRow[] = [];
  const seen = new Set<string>();
  for (const item of sorted) {
    if (seen.has(item.uid)) continue;
    seen.add(item.uid);
    out.push({
      uid: item.uid,
      name: item.name,
      events: item.events,
      registrations: item.registrations,
      href: hostHref(item.uid),
    });
    if (out.length >= RANK_LIMIT) break;
  }
  return out;
}
