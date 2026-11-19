import { describe, expect, it } from 'vitest';
import { taipeiMs } from '../format';
import { summaryShardIdOf } from './schedule-load';
import { calendarDateTime, kickoffTimeLabel, matchDayNoon, matchDayOf } from './match-day';

function at(year: number, month: number, day: number, hour: number, minute: number): number {
  return taipeiMs(year, month, day, hour, minute);
}

describe('matchDayOf', () => {
  it('00:00 歸前一個比賽日', () => {
    expect(matchDayOf(at(2026, 12, 5, 0, 0))).toMatchObject({
      year: 2026,
      month: 12,
      day: 4,
      key: '2026-12-04',
      shardId: 'd20261204',
    });
  });

  it('04:59 仍歸前一個比賽日', () => {
    expect(matchDayOf(at(2026, 12, 5, 4, 59)).shardId).toBe('d20261204');
    expect(matchDayOf(at(2026, 12, 5, 4, 59)).key).toBe('2026-12-04');
  });

  it('05:00 起算當天', () => {
    expect(matchDayOf(at(2026, 12, 5, 5, 0))).toMatchObject({
      key: '2026-12-05',
      shardId: 'd20261205',
    });
    expect(matchDayOf(at(2026, 12, 5, 23, 30)).shardId).toBe('d20261205');
  });

  it('跨月、跨年：1 月 1 日 03:00 歸 12 月 31 日', () => {
    expect(matchDayOf(at(2027, 1, 1, 3, 0))).toMatchObject({
      year: 2026,
      month: 12,
      day: 31,
      key: '2026-12-31',
      shardId: 'd20261231',
    });
    expect(matchDayNoon(at(2027, 1, 1, 3, 0))).toBe(at(2026, 12, 31, 12, 0));
  });

  it('00:30 的比賽日片與既有日曆片不同', () => {
    const ms = at(2026, 12, 5, 0, 30);
    expect(matchDayOf(ms).shardId).toBe('d20261204');
    expect(summaryShardIdOf(ms)).toBe('d20261205');
  });
});

describe('時刻顯示', () => {
  it('同一比賽日只寫 HH:mm', () => {
    expect(kickoffTimeLabel(at(2026, 12, 5, 9, 0))).toBe('09:00');
    expect(kickoffTimeLabel(at(2026, 12, 5, 5, 0))).toBe('05:00');
  });

  it('凌晨場寫隔日 HH:mm，全頁同一句', () => {
    expect(kickoffTimeLabel(at(2026, 12, 5, 1, 30))).toBe('隔日 01:30');
    expect(kickoffTimeLabel(at(2026, 12, 5, 0, 0))).toBe('隔日 00:00');
    expect(kickoffTimeLabel(at(2026, 12, 5, 4, 59))).toBe('隔日 04:59');
    expect(kickoffTimeLabel(at(2026, 12, 5, 1, 30), (time) => `隔日 ${time}`)).toBe('隔日 01:30');
  });

  it('日期與時刻寫在一起用日曆日', () => {
    expect(calendarDateTime(at(2026, 1, 10, 1, 30))).toBe('1/10 01:30');
    expect(calendarDateTime(at(2027, 1, 1, 3, 0))).toBe('1/1 03:00');
    expect(calendarDateTime(at(2026, 12, 5, 9, 5))).toBe('12/5 09:05');
  });
});
