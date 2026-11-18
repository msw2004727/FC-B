import { describe, expect, it } from 'vitest';
import { taipeiMs } from '../format';
import {
  championName,
  daysUntilStart,
  formatGoalDiff,
  groupSchedule,
  liveStrip,
  publicMark,
  scheduleDayLabel,
  showsScore,
  standingLines,
  taipeiDayKey,
} from './schedule-present';
import type { StandingDoc, StandingRow, SummaryEntry } from './types';

function entry(partial: Partial<SummaryEntry> & Pick<SummaryEntry, 'id' | 'k' | 'st'>): SummaryEntry {
  return {
    dv: 'dv_1',
    r: 1,
    no: 1,
    v: '1號場',
    h: { id: 'en_h', n: '海風隊' },
    a: { id: 'en_a', n: '山貓隊' },
    s: [0, 0],
    wo: null,
    ...partial,
  };
}

function row(partial: Partial<StandingRow> & Pick<StandingRow, 'teamId' | 'name' | 'points' | 'rank'>): StandingRow {
  return {
    played: 4,
    win: 1,
    draw: 1,
    loss: 2,
    goalsFor: 5,
    goalsAgainst: 5,
    goalDiff: 0,
    ...partial,
  };
}

function table(rows: StandingRow[], hasUnresolvedTie: boolean): StandingDoc {
  return {
    id: 'dv_1__group__A',
    divisionId: 'dv_1',
    groupId: 'A',
    rows,
    version: 1,
    hasUnresolvedTie,
    manualOverride: false,
    updatedAt: null,
  };
}

const JAN9_AM = taipeiMs(2027, 1, 9, 9, 0);
const JAN9_PM = taipeiMs(2027, 1, 9, 14, 30);
const JAN10 = taipeiMs(2027, 1, 10, 9, 0);
const NOW_LIVE = taipeiMs(2027, 1, 9, 12, 0);

describe('台北日期分組', () => {
  it('週六標題、今天標記、時間待定收在最後', () => {
    expect(taipeiDayKey(taipeiMs(2027, 1, 9, 0, 0))).toBe('2027-01-09');
    // UTC 前一天 16:00 已是台北 1 月 9 日
    expect(scheduleDayLabel(Date.UTC(2027, 0, 8, 16, 0), NOW_LIVE, '（今天）')).toBe('1月9日　週六（今天）');
    expect(scheduleDayLabel(JAN10, NOW_LIVE, '（今天）')).toBe('1月10日　週日');

    const groups = groupSchedule([
      entry({ id: 'late', k: JAN10, st: 'scheduled', no: 2, v: '2號場', h: { id: 'en_b', n: '青鳥隊' }, a: { id: 'en_c', n: '赤焰隊' } }),
      entry({ id: 'tbd', k: null, st: 'postponed', v: null, h: { id: 'en_h', n: '海風隊' }, a: { id: 'en_d', n: '赤焰隊' } }),
      entry({ id: 'am', k: JAN9_AM, st: 'confirmed', s: [2, 1] }),
      entry({ id: 'pm', k: JAN9_PM, st: 'scheduled', v: '2號場' }),
    ], NOW_LIVE, { tbd: '時間待定', today: '（今天）' });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.days.map((day) => day.label)).toEqual(['1月9日　週六（今天）', '1月10日　週日', '時間待定']);
    expect(groups[0]?.days[0]?.matches.map((match) => match.time)).toEqual(['09:00', '14:30']);
    expect(groups[0]?.days[0]?.matches[0]).toMatchObject({ score: [2, 1], mark: null, venue: '1號場' });
    expect(groups[0]?.days[0]?.matches[1]).toMatchObject({ score: null, venue: '2號場' });
    expect(groups[0]?.days[2]?.matches[0]).toMatchObject({ time: null, mark: 'moved' });
  });

  it('組別照給定順序，未賽的 0:0 不顯示成比分', () => {
    const groups = groupSchedule([
      entry({ id: 'u', dv: 'dv_u', k: JAN9_AM, st: 'scheduled' }),
      entry({ id: 'a', dv: 'dv_a', k: JAN9_AM, st: 'finished', s: [1, 0] }),
    ], NOW_LIVE, { tbd: '時間待定', today: '（今天）' }, ['dv_a', 'dv_u']);
    expect(groups.map((group) => group.divisionId)).toEqual(['dv_a', 'dv_u']);
    expect(showsScore(entry({ id: 'x', k: JAN9_AM, st: 'scheduled' }))).toBe(false);
  });
});

describe('場次小標與進行中條', () => {
  it('待確認、棄權、改期', () => {
    expect(publicMark(entry({ id: 'p', k: JAN9_AM, st: 'finished', s: [3, 3] }))).toBe('pending');
    expect(publicMark(entry({ id: 'w', k: JAN9_AM, st: 'walkover', wo: 'away', s: [0, 2] }))).toBe('forfeit');
    expect(publicMark(entry({ id: 'm', k: null, st: 'postponed' }))).toBe('moved');
    expect(publicMark(entry({ id: 'c', k: JAN9_AM, st: 'confirmed', s: [2, 1] }))).toBeNull();
    expect(publicMark(entry({ id: 's', k: JAN9_PM, st: 'scheduled' }))).toBeNull();
  });

  it('今天場數不含待定；下一場是現在之後最早的一場', () => {
    const strip = liveStrip([
      entry({ id: 'done', k: JAN9_AM, st: 'confirmed', s: [2, 1] }),
      entry({ id: 'next', k: JAN9_PM, st: 'scheduled', v: '2號場' }),
      entry({ id: 'later', k: taipeiMs(2027, 1, 9, 15, 30), st: 'scheduled' }),
      entry({ id: 'sun', k: JAN10, st: 'scheduled' }),
      entry({ id: 'tbd', k: null, st: 'scheduled', v: null }),
    ], NOW_LIVE);
    expect(strip).toEqual({ today: 3, next: '14:30' });
    expect(liveStrip([entry({ id: 'past', k: JAN9_AM, st: 'confirmed' })], NOW_LIVE)).toEqual({ today: 1, next: null });
  });

  it('距開賽用台北日曆，不是滿 24 小時', () => {
    expect(daysUntilStart(taipeiMs(2027, 1, 9, 8, 0), taipeiMs(2027, 1, 6, 23, 0))).toBe(3);
    expect(daysUntilStart(taipeiMs(2027, 1, 9, 8, 0), taipeiMs(2027, 1, 9, 1, 0))).toBe(0);
  });
});

describe('積分榜同分', () => {
  const rows = [
    row({ teamId: 'a', name: '海風隊', points: 10, rank: 1, win: 3, draw: 1, loss: 0, goalsFor: 10, goalsAgainst: 3, goalDiff: 7 }),
    row({ teamId: 'b', name: '銀河隊', points: 5, rank: 5, goalsFor: 5, goalsAgainst: 5, goalDiff: 0 }),
    row({ teamId: 'c', name: '雷霆隊', points: 5, rank: 6, goalsFor: 5, goalsAgainst: 5, goalDiff: 0 }),
  ];

  it('還沒裁定時兩隊同名次並標同分；第一名用強調色', () => {
    const lines = standingLines(table(rows, true));
    expect(lines.map((line) => [line.name, line.rank, line.tie, line.top])).toEqual([
      ['海風隊', 1, false, true],
      ['銀河隊', 5, true, false],
      ['雷霆隊', 5, true, false],
    ]);
    expect(formatGoalDiff(7)).toBe('+7');
    expect(formatGoalDiff(0)).toBe('0');
    expect(formatGoalDiff(-4)).toBe('-4');
    expect(championName([table(rows, true)])).toBe('海風隊');
  });

  it('主辦已裁定時積分相同也不標同分、不改名次', () => {
    const lines = standingLines(table(rows, false));
    expect(lines.map((line) => [line.rank, line.tie])).toEqual([[1, false], [5, false], [6, false]]);
  });

  it('並列第一都是強調色，冠軍取第一列', () => {
    const tied = standingLines(table([
      row({ teamId: 'a', name: '海風隊', points: 10, rank: 1 }),
      row({ teamId: 'b', name: '山貓隊', points: 10, rank: 2 }),
    ], true));
    expect(tied.map((line) => [line.rank, line.tie, line.top])).toEqual([
      [1, true, true],
      [1, true, true],
    ]);
    expect(championName([table([
      row({ teamId: 'a', name: '海風隊', points: 10, rank: 1 }),
      row({ teamId: 'b', name: '山貓隊', points: 10, rank: 2 }),
    ], true)])).toBe('海風隊');
    expect(championName([])).toBeNull();
  });
});
