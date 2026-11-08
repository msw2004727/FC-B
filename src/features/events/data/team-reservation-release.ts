/**
 * 團隊預留自動釋出（FC 計畫書 team-reservation-auto-release-plan §3.1／§3.3）。
 * 前端只寫 `teamReservationReleaseHours`；`teamReservationReleasedAt`／`teamReservationReleasedSummary`
 * 由 Functions 排程 `releaseTeamReservations` 寫，這裡只讀、只做顯示，不打 Firestore。
 */
import { parseEventStartMs } from '@/core/event-time';

/** 允許的釋出時數（站長 11-08 定）；0＝不自動釋出。 */
export const TEAM_RESERVATION_RELEASE_HOURS = [0, 3, 6, 12, 24, 48, 72] as const;
export type TeamReservationReleaseHours = typeof TEAM_RESERVATION_RELEASE_HOURS[number];

const HOUR_MS = 3_600_000;

/** 缺欄位、非允許值一律視為 0（與 Functions「非允許值視為 0」一致）。 */
export function normalizeReleaseHours(value: unknown): TeamReservationReleaseHours {
  return typeof value === 'number' && (TEAM_RESERVATION_RELEASE_HOURS as readonly number[]).includes(value)
    ? value as TeamReservationReleaseHours
    : 0;
}

/** `teamReservationReleasedAt` 存在即終態（Timestamp、序列化後的物件或字串都算），不解析時間。 */
export function hasTeamReservationReleasedAt(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * `teamReservationReleasedSummary` 先驗形狀（計畫書 §3.2）：陣列，每項 teamId 為非空字串、
 * releasedSlots 為非負整數；不符的項目不計。回傳有效項目數。
 */
export function countReleasedSummary(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return raw.filter((item: unknown) => {
    if (!item || typeof item !== 'object') return false;
    const record = item as { teamId?: unknown; releasedSlots?: unknown };
    return typeof record.teamId === 'string' && record.teamId.trim() !== ''
      && typeof record.releasedSlots === 'number'
      && Number.isInteger(record.releasedSlots) && record.releasedSlots >= 0;
  }).length;
}

/** 距釋出剩餘毫秒 → 倒數文字；三段一律 Math.floor。 */
export function formatReleaseCountdown(ms: number): string {
  if (!(ms > 0)) return '即將釋出';
  if (ms < HOUR_MS) return `${Math.floor(ms / 60_000)} 分鐘後釋出`;
  if (ms < 48 * HOUR_MS) return `${Math.floor(ms / HOUR_MS)} 小時後釋出`;
  return `${Math.floor(ms / (24 * HOUR_MS))} 天後釋出`;
}

export type TeamReservationReleaseMeta =
  | { kind: 'none' }
  | { kind: 'countdown'; text: string; soon: boolean }
  | { kind: 'released' };

export interface TeamReservationReleaseEvent {
  status?: string;
  date?: unknown;
  teamReservationReleaseHours?: unknown;
  teamReservationReleasedAt?: unknown;
  teamReservationReleasedSummary?: unknown;
}

/** 與詳情頁 calcCountdown 同一套開始時間：斜線日期字串，台北牆鐘。 */
function detailStartMs(date: unknown): number | null {
  if (typeof date !== 'string' || (date.split(' ')[0] ?? '').split('/').length < 3) return null;
  return parseEventStartMs(date);
}

/**
 * C2 報名卡「團隊保留」段的釋出狀態。
 * - 已釋出且摘要有效項目 > 0，且目前沒有團隊保留：released（顯示「團隊保留已釋出」）。
 * - hours>0、未釋出、有團隊保留、活動未開始也未結束／取消：countdown。
 * - 其餘：none（文字與原本完全相同）。
 */
export function getTeamReservationReleaseMeta(
  event: TeamReservationReleaseEvent,
  reservedCount: number,
  nowMs: number,
): TeamReservationReleaseMeta {
  if (hasTeamReservationReleasedAt(event.teamReservationReleasedAt)) {
    // 釋出後團隊職員手動再預留（reservedCount>0）時照常顯示數字，避免「已釋出」蓋掉仍佔位的名額。
    return reservedCount <= 0 && countReleasedSummary(event.teamReservationReleasedSummary) > 0
      ? { kind: 'released' }
      : { kind: 'none' };
  }
  const hours = normalizeReleaseHours(event.teamReservationReleaseHours);
  if (hours <= 0 || reservedCount <= 0) return { kind: 'none' };
  if (event.status === 'ended' || event.status === 'cancelled') return { kind: 'none' };
  const startMs = detailStartMs(event.date);
  // 已開始的活動排程不處理（releaseAt <= now < startMs 才釋出），不顯示倒數。
  if (startMs === null || nowMs >= startMs) return { kind: 'none' };
  const remainingMs = startMs - hours * HOUR_MS - nowMs;
  return { kind: 'countdown', text: formatReleaseCountdown(remainingMs), soon: remainingMs < HOUR_MS };
}
