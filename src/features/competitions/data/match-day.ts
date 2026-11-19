// 比賽日與後端 K5 相同：台北 00:00～04:59 歸前一個比賽日，05:00 起算當天。
// 既有 summaryShardIdOf 仍是日曆日，進行中一次讀取的斷言鎖著它，這裡不改那支。
// 觀眾監聽與賽程分組用這支的 shardId。

import { taipeiMs, taipeiParts } from '../format';

const DAY_MS = 86_400_000;

export interface MatchDay {
  year: number;
  month: number;
  day: number;
  /** YYYY-MM-DD */
  key: string;
  /** dYYYYMMDD。與後端 K5 摘要片 id 相同。 */
  shardId: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function keyOf(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** 開賽毫秒所屬的比賽日。時區欄位不看，一律台北。 */
export function matchDayOf(ms: number): MatchDay {
  const part = taipeiParts(ms);
  const day = part.hour >= 5
    ? part
    : taipeiParts(taipeiMs(part.year, part.month, part.day, 12, 0) - DAY_MS);
  return {
    year: day.year,
    month: day.month,
    day: day.day,
    key: keyOf(day.year, day.month, day.day),
    shardId: `d${day.year}${pad(day.month)}${pad(day.day)}`,
  };
}

/**
 * 分組裡的時刻。比賽日與日曆日同一天只寫 HH:mm。
 * 凌晨場仍留在前一個比賽日，時刻寫「隔日 HH:mm」。
 * nextDay 省略時用這個句子，七個語系的 competitions.nextDayTime 同一句。
 */
export function kickoffTimeLabel(ms: number, nextDay?: (time: string) => string): string {
  const part = taipeiParts(ms);
  const hm = `${pad(part.hour)}:${pad(part.minute)}`;
  if (keyOf(part.year, part.month, part.day) === matchDayOf(ms).key) return hm;
  return nextDay ? nextDay(hm) : `隔日 ${hm}`;
}

/** 日期與時刻寫在一起時用日曆日，不用比賽日。例：1/10 01:30。 */
export function calendarDateTime(ms: number): string {
  const part = taipeiParts(ms);
  return `${part.month}/${part.day} ${pad(part.hour)}:${pad(part.minute)}`;
}

/** 比賽日中午。分組標題用這一個毫秒，避免凌晨場被標成下一個日曆日。 */
export function matchDayNoon(ms: number): number {
  const day = matchDayOf(ms);
  return taipeiMs(day.year, day.month, day.day, 12, 0);
}
