import { SPORTS, eventSportTag } from '@/features/events/data/sports';
import type { EventDoc, ViewerContext } from '@/features/events/data/types';
import { getVisibleEvents } from '@/features/events/data/visibility';
import { parseEventDateRange } from './next-activity';

export interface SportRow {
  key: string;
  label: string;
  symbol: string;
  count: number;
}

/** 訪客視角（沒有帳號、沒有俱樂部、沒有權限）：首屏快照的運動統計一律用它算，不帶任何帳號資料（T-042）。 */
export const GUEST_VIEWER: ViewerContext = {
  uid: null,
  teamIds: new Set<string>(),
  hasPermission: () => false,
  roleLevel: 0,
};

export function isPublicActiveHomeEvent(event: EventDoc, nowMs: number): boolean {
  if (!event || !(event.id || event._docId || event.docId)) return false;
  const status = String(event.status || '').toLowerCase();
  if (['ended', 'cancelled', 'canceled', 'archived'].includes(status)) return false;
  if (event.privateEvent === true || event.teamOnly === true) return false;
  const range = parseEventDateRange(event.date ?? event.startAt ?? event.startTime);
  const startMs = range?.startMs ?? 0;
  return startMs === 0 || startMs > nowMs;
}

/** 首頁「運動快速入口」：已通過可見性過濾的活動 → 進行中公開活動依運動分類計數（多的在前，同數量依 SPORTS 順序）。 */
export function computeSportRows(visibleEvents: readonly EventDoc[], nowMs: number): SportRow[] {
  const publicActive = visibleEvents.filter((ev) => isPublicActiveHomeEvent(ev, nowMs));
  const counts = new Map<string, number>();
  for (const ev of publicActive) {
    const key = eventSportTag(ev) || 'football';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const order = new Map<string, number>(SPORTS.map((item, idx) => [item.key, idx]));
  return SPORTS.map((item) => ({
    key: item.key,
    label: item.label,
    symbol: item.symbol,
    count: counts.get(item.key) || 0,
  }))
    .filter((item) => item.count > 0)
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0);
    });
}

/**
 * 訪客視角的運動統計：**首屏快照唯一允許的寫入來源**（T-042，顧問裁定 P1-1 採 A）。
 * 型別帶品牌（只能由 `computeGuestSportRows` 產生），`writeSportsSnapshot` 的簽章只收這個型別，其他來源（例如登入者視角的
 * `computeSportRows` 輸出、手寫陣列）編譯不過；同時登記在 WeakSet，執行期也拒絕沒登記過的輸入（防 `as` 強轉）。
 */
export type GuestSportRows = readonly SportRow[] & { readonly __guestVisibleSportRows: true };

const guestRows = new WeakSet<object>();

export function computeGuestSportRows(events: readonly EventDoc[], nowMs: number): GuestSportRows {
  const rows = Object.freeze(computeSportRows(getVisibleEvents(events, GUEST_VIEWER, []), nowMs));
  guestRows.add(rows);
  return rows as GuestSportRows;
}

/** 這份統計是不是 `computeGuestSportRows` 產生的（執行期檢查，給快照寫入函式用）。 */
export function isGuestSportRows(value: unknown): value is GuestSportRows {
  return typeof value === 'object' && value !== null && guestRows.has(value);
}
