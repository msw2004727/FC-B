/**
 * 活動列表的本機快照（stale-first）。
 *
 * 照 A 的做法：先用上次讀到的活動畫面，背景再向伺服器更新（A `firebase-service.js` 的
 * stale-while-revalidate＋localStorage 快取；時效照 A `PERFORMANCE_LIMITS.publicBootSnapshotMaxAgeMs` 30 分鐘）。
 * 2026-10-19 新舊版實測：二次開啟時 A 主要內容 0.6～1.9 秒、B 1.5～3.3 秒，差距來自 B 每次都等伺服器。
 *
 * 安全約束（技術顧問 Fable 2026-10-19，SPEED-1-1 放寬訪客讀取）：
 * - 快照記錄存它的帳號（訪客為 'guest'）。帳號不符只跳過不刪，不會拿另一個帳號的快照來畫。
 * - 登入者的快照要等登入模組確認的帳號與畫面使用者相同才讀、才寫（守門在 use-events）。
 * - 訪客可以在登入狀態尚未確定時先讀 guest 快照（第一次 render）。寫入與讀出都再過一次訪客視角，
 *   私密活動與俱樂部限定不會留在 guest 快照裡。沒有 `v` 的舊資料仍接受；`v` 有寫但不是目前版本則整份不用。
 * - 超過約 1MB 不存（LINE WebView 的 localStorage 額度小）。
 * - 讀寫失敗（私密模式、容量滿）一律忽略，退回等伺服器。
 */
import type { EventDoc, ViewerContext } from './types';
import { getVisibleEvents } from './visibility';

export const EVENTS_SNAPSHOT_STORAGE_KEY = 'fcb:events-snapshot:v2';
const LEGACY_KEYS = ['fcb:events-snapshot:v1'];
/** 信封版本。缺欄的舊 v2 仍讀；明示其他版本整份丟棄（防舊格式污染）。 */
export const EVENTS_SNAPSHOT_FORMAT = 2;
export const EVENTS_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
export const EVENTS_SNAPSHOT_MAX_CHARS = 1_000_000;

const GUEST_VIEWER: ViewerContext = {
  uid: null,
  teamIds: new Set<string>(),
  hasPermission: () => false,
  roleLevel: 0,
};

interface StoredSnapshot {
  v?: number;
  owner: string;
  savedAt: number;
  events: EventDoc[];
}

/** 登入者原樣留下（頁面再用自己的視角濾）。訪客只留 getVisibleEvents 的訪客可見活動。 */
export function eventsRetainedForSnapshot(uid: string | null, events: readonly EventDoc[]): EventDoc[] {
  if (uid !== null) return [...events];
  return getVisibleEvents(events, GUEST_VIEWER, []);
}

function ownerOf(uid: string | null): string {
  return uid ? `uid:${uid}` : 'guest';
}

function removeSnapshot(): void {
  try {
    localStorage.removeItem(EVENTS_SNAPSHOT_STORAGE_KEY);
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

function versionOk(parsed: Partial<StoredSnapshot>): boolean {
  return parsed.v === undefined || parsed.v === EVENTS_SNAPSHOT_FORMAT;
}

/** 讀快照：帳號不符、過期、格式版本不符或讀取失敗回 null。訪客再濾一次可見性。 */
export function readEventsSnapshot(uid: string | null, nowMs: number = Date.now()): EventDoc[] | null {
  try {
    const raw = localStorage.getItem(EVENTS_SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSnapshot> | null;
    if (!parsed || typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.events)) return null;
    if (!versionOk(parsed)) return null;
    // 帳號不符只跳過不刪：剛開頁時 viewer 尚未載入會先是訪客，不能因此刪掉本人的快照。
    // 換帳號後由新帳號的寫入覆蓋（同一個 key）。
    if (parsed.owner !== ownerOf(uid)) return null;
    if (nowMs - parsed.savedAt > EVENTS_SNAPSHOT_MAX_AGE_MS || parsed.savedAt > nowMs + 60_000) return null;
    return eventsRetainedForSnapshot(uid, parsed.events);
  } catch {
    return null;
  }
}

/** 寫快照；太大就不存（並刪掉舊的），失敗忽略。 */
export function writeEventsSnapshot(
  uid: string | null,
  events: readonly EventDoc[],
  nowMs: number = Date.now(),
): void {
  try {
    const payload: StoredSnapshot = {
      v: EVENTS_SNAPSHOT_FORMAT,
      owner: ownerOf(uid),
      savedAt: nowMs,
      events: eventsRetainedForSnapshot(uid, events),
    };
    const text = JSON.stringify(payload);
    if (text.length > EVENTS_SNAPSHOT_MAX_CHARS) {
      removeSnapshot();
      return;
    }
    localStorage.setItem(EVENTS_SNAPSHOT_STORAGE_KEY, text);
  } catch {
    /* 容量滿或停用時不影響主流程 */
  }
}

/** 測試用。 */
export function _clearEventsSnapshotForTest(): void {
  removeSnapshot();
}
