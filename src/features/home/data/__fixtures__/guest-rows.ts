import type { EventDoc } from '@/features/events/data/types';
import { computeGuestSportRows, type GuestSportRows } from '../sport-rows';

const FIXTURE_NOW = Date.UTC(2026, 9, 27, 3, 0, 0);

/**
 * 測試用：用「訪客可見計算」造出「每個運動 N 場」的統計，例如 `guestRowsOf({ football: 7 })`。
 * 首屏快照的寫入函式只收 computeGuestSportRows() 的輸出，測試造資料也不能繞過它（不提供任何手寫陣列的後門）。
 * 活動日期固定在 2030 年，離 FIXTURE_NOW 差數年，與時區無關。
 */
export function guestRowsOf(counts: Record<string, number>): GuestSportRows {
  const events: EventDoc[] = Object.entries(counts).flatMap(([sportTag, count]) =>
    Array.from(
      { length: count },
      (_, i) => ({ id: `${sportTag}-${i}`, status: 'open', date: '2030/10/20 18:00~20:00', sportTag }) as EventDoc,
    ),
  );
  return computeGuestSportRows(events, FIXTURE_NOW);
}
