import { addedClock, LIVE_COPY } from './copy';

/** 終場送出後可撤回的時間。19 秒前送出、現在看得到 2:41，所以窗口是 3 分鐘。 */
export const FINISH_UNDO_MS = 3 * 60 * 1000;

export interface LiveClock {
  /** 比賽時鐘已走秒數。 */
  elapsedSec: number;
  period: 'h1' | 'ht' | 'h2';
  /** 有值且大於 0 時，階段改顯示 `20+2'`，不再寫上半場／下半場。 */
  addedMin: number | null;
}

export interface LiveLink {
  online: boolean;
  /** 離線小標與「已存 N 筆」用的待送數。 */
  pendingCount: number;
  /** 本機儲存不可用。離線條改成醒目警告。 */
  storageUnavailable: boolean;
  /** 畫面能否保持不鎖定。false 時提示關閉手機自動鎖定。 */
  wakeLock: boolean;
}

export function formatMatchClock(elapsedSec: number): string {
  const sec = Math.max(0, Math.floor(elapsedSec));
  const minute = Math.floor(sec / 60);
  const rest = sec % 60;
  return `${String(minute).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** 階段文字。補時優先於上／中／下半場。 */
export function stageLabel(clock: LiveClock): string {
  if (clock.addedMin != null && clock.addedMin > 0) {
    return addedClock(Math.floor(Math.max(0, clock.elapsedSec) / 60), clock.addedMin);
  }
  if (clock.period === 'ht') return LIVE_COPY.periodHt;
  if (clock.period === 'h2') return LIVE_COPY.periodH2;
  return LIVE_COPY.periodH1;
}

export function recordMinute(elapsedSec: number): number {
  return Math.floor(Math.max(0, elapsedSec) / 60);
}

/** 剩餘可撤回的 `m:ss`。過期或沒有終場時間回 null。 */
export function undoClock(finishedAt: number | null, nowMs: number): string | null {
  if (finishedAt == null) return null;
  const left = finishedAt + FINISH_UNDO_MS - nowMs;
  if (left <= 0) return null;
  const total = Math.floor(left / 1000);
  const minute = Math.floor(total / 60);
  const second = total % 60;
  return `${minute}:${String(second).padStart(2, '0')}`;
}
