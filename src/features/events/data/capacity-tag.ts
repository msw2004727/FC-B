/**
 * 活動卡人數標籤「XX/XX」（2026-11-13 站長定案：風格三，狀態變色膠囊）。
 *
 * 口徑同活動列表計量條與詳情頁報名卡：已報＝actualConfirmedCount（不含團隊保留未報），上限＝活動上限欄位；
 * 沒有上限只顯示已報數（計量條同樣不畫比例、讀屏唸「已報 N 人」）。
 * 已結束、已取消、外部活動不顯示（同計量條）。只用活動文件既有欄位，不新增讀取。
 * 活動頁、個人頁「相關活動」、俱樂部頁活動卡共用。
 */
import { actualConfirmedCount, type DetailEvent } from './detail-model';
import { getEventParticipantStats } from './participant-stats';
import type { EventDoc } from './types';

/** wait＝有候補（優先）、full＝額滿、nomax＝不限人數、upcoming＝尚未開放報名、open＝報名中。 */
export type CapacityTagState = 'open' | 'full' | 'wait' | 'upcoming' | 'nomax';

/**
 * 付款狀態外觀的預留接點（站長 11-13：只留程式接點、畫面不放）。
 * 目前沒有任何呼叫端傳入；外觀是標籤右上角的小圓點（絕對定位，不改標籤寬度）。
 */
export type CapacityTagPayment = 'pending' | 'paid';

export interface CapacityTagModel {
  confirmed: number;
  /** 0＝不限人數。 */
  max: number;
  state: CapacityTagState;
  /** 「128/200」這類 6 字以上的人數：收起人形圖示，標籤不比狀態標籤欄寬（標題不被擠）。 */
  long: boolean;
}

/** 長數字門檻（含斜線的字數）。 */
export const CAPACITY_TAG_LONG_CHARS = 6;

export function buildCapacityTagModel(event: EventDoc, effectiveStatus: string): CapacityTagModel | null {
  if (String(event.type || '') === 'external') return null;
  if (effectiveStatus === 'ended' || effectiveStatus === 'cancelled') return null;
  const stats = getEventParticipantStats(event, []);
  const confirmed = actualConfirmedCount(event as DetailEvent);
  const max = stats.maxCount;
  const full = effectiveStatus === 'full' || (max > 0 && confirmed + stats.reservedRemainingCount >= max);
  const state: CapacityTagState = stats.waitlistCount > 0 ? 'wait'
    : full ? 'full'
      : max <= 0 ? 'nomax'
        : effectiveStatus === 'upcoming' ? 'upcoming'
          : 'open';
  const text = max > 0 ? `${confirmed}/${max}` : String(confirmed);
  return { confirmed, max, state, long: text.length >= CAPACITY_TAG_LONG_CHARS };
}
