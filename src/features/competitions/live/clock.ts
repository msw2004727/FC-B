import type { MatchClock } from '../data/types';
import { addedClock, LIVE_COPY } from './copy';

/** 終場送出後可撤回的時間。19 秒前送出、現在看得到 2:41，所以窗口是 3 分鐘。 */
export const FINISH_UNDO_MS = 3 * 60 * 1000;

export interface LiveClock {
  /** 比賽時鐘已走秒數。 */
  elapsedSec: number;
  period: 'h1' | 'ht' | 'h2';
  /** 有值且大於 0 時，階段改顯示 `45+2'`，不再寫上半場／下半場。 */
  addedMin: number | null;
  /**
   * 補時字樣的基準分鐘，不跟目前秒數走。
   * 沒填時上半場與中場用 45、下半場用 90。
   */
  periodBaseMin?: number | null;
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

/** 由 clockBase 推出的讀數。暫停與中場的 holdSec 是這一段已經過的秒數。 */
export interface ClockReading {
  elapsedSec: number;
  /** 走時中是 null。暫停或中場是 now − startedAt。 */
  holdSec: number | null;
  period: string;
}

/**
 * 比賽時鐘。只看 clockBase，不改狀態與比分。
 * - running：已進行秒數＝ pausedSec ＋ (now − startedAt)。pausedSec 是這一段開始前已累積的秒數。
 * - 非 running：已進行秒數＝ pausedSec（凍結）。暫停時長＝ now − startedAt（startedAt 是暫停開始）。
 * - 中場（period ht）同一套。holdSec 就是已休息多久。
 */
export function clockFromBase(clockBase: MatchClock, nowMs: number): ClockReading {
  if (clockBase.running) {
    const started = clockBase.startedAt ?? nowMs;
    const extra = Math.max(0, nowMs - started) / 1000;
    return {
      elapsedSec: Math.max(0, clockBase.pausedSec) + extra,
      holdSec: null,
      period: clockBase.period,
    };
  }
  const holdSec = clockBase.startedAt == null ? 0 : Math.max(0, nowMs - clockBase.startedAt) / 1000;
  return {
    elapsedSec: Math.max(0, clockBase.pausedSec),
    holdSec,
    period: clockBase.period,
  };
}

export function asPeriod(period: string): LiveClock['period'] {
  if (period === 'ht' || period === 'h2') return period;
  return 'h1';
}

export function formatMatchClock(elapsedSec: number): string {
  const sec = Math.max(0, Math.floor(elapsedSec));
  const minute = Math.floor(sec / 60);
  const rest = sec % 60;
  return `${String(minute).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** 補時基準。有 periodBaseMin 就用它，否則上半場／中場 45、下半場 90。 */
export function addedBaseMin(clock: LiveClock): number {
  if (clock.periodBaseMin != null) return clock.periodBaseMin;
  return clock.period === 'h2' ? 90 : 45;
}

/** 階段文字。補時優先於上／中／下半場，基準分鐘不跟秒數跳動。 */
export function stageLabel(clock: LiveClock): string {
  if (clock.addedMin != null && clock.addedMin > 0) {
    return addedClock(addedBaseMin(clock), clock.addedMin);
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
