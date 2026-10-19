/**
 * 活動列表的本機快照（stale-first）。
 *
 * 照 A 的做法：先用上次讀到的活動畫面，背景再向伺服器更新（A `firebase-service.js` 的
 * stale-while-revalidate＋localStorage 快取；時效照 A `PERFORMANCE_LIMITS.publicBootSnapshotMaxAgeMs` 30 分鐘）。
 * 2026-10-19 新舊版實測：二次開啟時 A 主要內容 0.6～1.9 秒、B 1.5～3.3 秒，差距來自 B 每次都等伺服器。
 *
 * - 只存活動文件本身（與 A 快取相同的公開活動資料）；畫面仍由 getVisibleEvents 依目前使用者過濾。
 * - 讀寫失敗（私密模式、容量滿）一律忽略，退回等伺服器。
 */
import type { EventDoc } from './types';

const SNAPSHOT_KEY = 'fcb:events-snapshot:v1';
export const EVENTS_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;

interface StoredSnapshot {
  savedAt: number;
  events: EventDoc[];
}

/** 讀快照；過期、格式不符或讀取失敗回 null。 */
export function readEventsSnapshot(nowMs: number = Date.now()): EventDoc[] | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSnapshot> | null;
    if (!parsed || typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.events)) return null;
    if (nowMs - parsed.savedAt > EVENTS_SNAPSHOT_MAX_AGE_MS || parsed.savedAt > nowMs + 60_000) return null;
    return parsed.events;
  } catch {
    return null;
  }
}

/** 寫快照；失敗忽略。 */
export function writeEventsSnapshot(events: readonly EventDoc[], nowMs: number = Date.now()): void {
  try {
    const payload: StoredSnapshot = { savedAt: nowMs, events: [...events] };
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(payload));
  } catch {
    /* 容量滿或停用時不影響主流程 */
  }
}

/** 測試用。 */
export function _clearEventsSnapshotForTest(): void {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* 忽略 */
  }
}
