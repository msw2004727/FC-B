/**
 * 活動列表的本機快照（stale-first）。
 *
 * 照 A 的做法：先用上次讀到的活動畫面，背景再向伺服器更新（A `firebase-service.js` 的
 * stale-while-revalidate＋localStorage 快取；時效照 A `PERFORMANCE_LIMITS.publicBootSnapshotMaxAgeMs` 30 分鐘）。
 * 2026-10-19 新舊版實測：二次開啟時 A 主要內容 0.6～1.9 秒、B 1.5～3.3 秒，差距來自 B 每次都等伺服器。
 *
 * 安全約束（技術顧問 Fable 2026-10-19）：
 * - 快照記錄存它的帳號（訪客為 'guest'）；只有目前使用者與快照帳號相同、且與登入模組確認的帳號一致才使用，
 *   不會拿前一個帳號的快照先畫，也不會在使用者資料載入前以訪客身分先畫。
 * - 畫面仍由 getVisibleEvents 依目前使用者過濾（R-EVT-010～011）。
 * - 超過約 1MB 不存（LINE WebView 的 localStorage 額度小）。
 * - 讀寫失敗（私密模式、容量滿）一律忽略，退回等伺服器。
 */
import type { EventDoc } from './types';

const SNAPSHOT_KEY = 'fcb:events-snapshot:v2';
const LEGACY_KEYS = ['fcb:events-snapshot:v1'];
export const EVENTS_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
export const EVENTS_SNAPSHOT_MAX_CHARS = 1_000_000;

interface StoredSnapshot {
  owner: string;
  savedAt: number;
  events: EventDoc[];
}

function ownerOf(uid: string | null): string {
  return uid ? `uid:${uid}` : 'guest';
}

function removeSnapshot(): void {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

/** 讀快照：帳號不符、過期、格式不符或讀取失敗回 null。 */
export function readEventsSnapshot(uid: string | null, nowMs: number = Date.now()): EventDoc[] | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSnapshot> | null;
    if (!parsed || typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.events)) return null;
    // 帳號不符只跳過不刪：剛開頁時 viewer 尚未載入會先是訪客，不能因此刪掉本人的快照。
    // 換帳號後由新帳號的寫入覆蓋（同一個 key）。
    if (parsed.owner !== ownerOf(uid)) return null;
    if (nowMs - parsed.savedAt > EVENTS_SNAPSHOT_MAX_AGE_MS || parsed.savedAt > nowMs + 60_000) return null;
    return parsed.events;
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
    const payload: StoredSnapshot = { owner: ownerOf(uid), savedAt: nowMs, events: [...events] };
    const text = JSON.stringify(payload);
    if (text.length > EVENTS_SNAPSHOT_MAX_CHARS) {
      removeSnapshot();
      return;
    }
    localStorage.setItem(SNAPSHOT_KEY, text);
  } catch {
    /* 容量滿或停用時不影響主流程 */
  }
}

/** 測試用。 */
export function _clearEventsSnapshotForTest(): void {
  removeSnapshot();
}
