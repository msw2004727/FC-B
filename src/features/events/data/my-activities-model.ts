/**
 * 「活動管理」頁的純函式模型，對齊舊版 A `js/modules/event/event-manage.js#renderMyActivities`。
 */
import type { ViewerView } from '@/features/profile/data/viewer';
import { operateContextFromViewer } from './event-create-context';
import { canManageAllActivities } from './operate-permissions';
import { parseEventDateRange } from './terminal';
import { eventCapacity } from './presentation';
import type { EventDoc } from './types';
import { canListPrivateEvent, isEventDelegate, isEventOwner } from './visibility';

export type MyActivityTab = 'all' | 'upcoming' | 'open' | 'full' | 'ended' | 'cancelled';

export interface MyActivityTabConfig {
  readonly id: MyActivityTab;
  readonly labelKey: string;
}

/** 分頁順序與文字照 `a-my-activities.html` */
export const MY_ACTIVITY_TABS: readonly MyActivityTabConfig[] = [
  { id: 'all', labelKey: 'events.manage.tab.all' },
  { id: 'upcoming', labelKey: 'events.manage.tab.upcoming' },
  { id: 'open', labelKey: 'events.manage.tab.open' },
  { id: 'full', labelKey: 'events.manage.tab.full' },
  { id: 'ended', labelKey: 'events.manage.tab.ended' },
  { id: 'cancelled', labelKey: 'events.manage.tab.cancelled' },
] as const;

export const MY_ACTIVITY_DEFAULT_PAGE_SIZE = 10;

export type ProgressTone = 'danger' | 'warning' | 'success';

/**
 * 照 A `renderMyActivities`：
 * 1. 有 `event.edit_all`（或 `_canManageAllActivities`）看全部；其他人只看自己是 owner 或 delegate 的活動。
 * 2. 用 `canListPrivateEvent` 過濾私密活動。
 * 3. 分頁為 `'all'` 時不篩，其餘依原始 `event.status === tab` 篩選。
 */
export function filterManageableEvents(
  events: readonly EventDoc[] | null | undefined,
  viewer: ViewerView,
  tab: MyActivityTab = 'all',
): EventDoc[] {
  if (!Array.isArray(events)) return [];
  const operateCtx = operateContextFromViewer(viewer);
  const isAdmin = canManageAllActivities(operateCtx) || viewer.hasPermission('event.edit_all');

  let list = events.slice();
  if (!isAdmin) {
    list = list.filter(
      (event) => isEventOwner(event, viewer.uid) || isEventDelegate(event, viewer.uid),
    );
  }
  list = list.filter((event) => canListPrivateEvent(event, viewer));

  if (tab !== 'all') {
    const nowMs = Date.now();
    list = list.filter((event) => effectiveEventStatus(event, nowMs) === tab);
  }
  return list;
}

/**
 * A `renderMyActivities` 先跑 `_autoEndExpiredEvents()`（只改本機快取、不寫資料庫），
 * 分頁再用同步後的 status。這裡照 A `_getEventEffectiveStatus` 算出畫面用的有效狀態：
 * 已取消／已結束照舊；開始時間已過＝已結束；報名開放時間在未來＝即將開放；否則看是否額滿。
 * 額滿判斷用 `eventCapacity`（current ≥ max），與 A `_isEventTrulyFull` 的報名投影計算可能略有差異。
 */
export function effectiveEventStatus(event: EventDoc, nowMs: number = Date.now()): string {
  if (event.status === 'cancelled') return 'cancelled';
  if (event.status === 'ended') return 'ended';
  const startMs = getStartMs(event);
  if (startMs !== Number.MAX_SAFE_INTEGER && startMs <= nowMs) return 'ended';
  const regOpenRaw = (event as EventDoc & { regOpenTime?: unknown }).regOpenTime;
  if (typeof regOpenRaw === 'string' && regOpenRaw) {
    const regOpenMs = new Date(regOpenRaw).getTime();
    if (!Number.isNaN(regOpenMs) && regOpenMs > nowMs) return 'upcoming';
  }
  const capacity = eventCapacity(event);
  return capacity.max !== null && capacity.max > 0 && capacity.current !== null && capacity.current >= capacity.max
    ? 'full'
    : 'open';
}

// A `_parseEventStartDate(e?.date)`：只讀 `date`；無法解析回傳 `Number.MAX_SAFE_INTEGER`。
function getStartMs(event: EventDoc | null | undefined): number {
  if (!event) return Number.MAX_SAFE_INTEGER;
  const range = parseEventDateRange(event.date);
  const ms = range ? range.startMs : NaN;
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

function isTerminal(event: EventDoc | null | undefined): boolean {
  return event?.status === 'ended' || event?.status === 'cancelled';
}

/**
 * 照 A `_sortMyActivitiesByNearestTime`＋`renderMyActivities` 的置頂優先序：
 * 1. 先按 `pinned`（置頂在前，兩者皆置頂時依 `pinOrder` 升冪）。
 * 2. 非已結束／已取消在前，已結束／已取消排最後。
 * 3. 距離 `now` 越近越前面（`Math.abs(startMs - now)`）。
 * 4. 距離相同時開始時間較早者在前。
 * 5. 再相同時依 `String(id || '').localeCompare` 排序。
 */
export function sortMyActivitiesByNearestTime(
  events: readonly EventDoc[] | null | undefined,
  now: number = Date.now(),
): EventDoc[] {
  if (!Array.isArray(events)) return [];
  const nowMs = Number.isFinite(now) ? now : Date.now();

  const byTime = [...events].sort((a, b) => {
    const ta = isTerminal(a) ? 1 : 0;
    const tb = isTerminal(b) ? 1 : 0;
    if (ta !== tb) return ta - tb;

    const aMs = getStartMs(a);
    const bMs = getStartMs(b);
    const aDist = Math.abs(aMs - nowMs);
    const bDist = Math.abs(bMs - nowMs);
    if (aDist !== bDist) return aDist - bDist;

    if (aMs !== bMs) return aMs - bMs;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });

  return byTime.sort((a, b) => {
    const aExt = a as (EventDoc & { pinned?: unknown; pinOrder?: unknown }) | undefined;
    const bExt = b as (EventDoc & { pinned?: unknown; pinOrder?: unknown }) | undefined;
    const ap = aExt?.pinned ? 1 : 0;
    const bp = bExt?.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    if (ap && bp) {
      const ao = Number(aExt?.pinOrder) || 0;
      const bo = Number(bExt?.pinOrder) || 0;
      if (ao !== bo) return ao - bo;
    }
    return 0;
  });
}

/** 照 A `_getMyActivityPagingKey` */
export function getMyActivityPagingKey(
  filter: string = 'all',
  creatorFilter: string = '',
): string {
  const f = filter || 'all';
  const creator = creatorFilter || '';
  return `${f}::${creator}`;
}

/** 照 A `_getMyActivityVisibleLimit` */
export function getMyActivityVisibleLimit(
  filter: string = 'all',
  visibleCounts?: Readonly<Record<string, number>> | null,
  pageSize: number = MY_ACTIVITY_DEFAULT_PAGE_SIZE,
  creatorFilter: string = '',
): number {
  const safePageSize = Math.max(1, Number(pageSize) || MY_ACTIVITY_DEFAULT_PAGE_SIZE);
  const key = getMyActivityPagingKey(filter, creatorFilter);
  const current = Number(visibleCounts?.[key] || 0);
  return Math.max(safePageSize, current || safePageSize);
}

/** 照 A `renderMyActivities` 的人數進度條顏色門檻：≥100% danger、≥70% warning、其他 success */
export function progressTone(pct: number): ProgressTone {
  const n = Number(pct) || 0;
  if (n >= 100) return 'danger';
  if (n >= 70) return 'warning';
  return 'success';
}
