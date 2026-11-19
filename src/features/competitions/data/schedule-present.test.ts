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
  scheduleHeading,
  showsScore,
  standingHeading,
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

const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
const LABELS = { tbd: '時間待定', today: '（今天）', weekdays: WEEKDAYS };

function row(partial: Partial<StandingRow> & Pick<StandingRow, 'teamId' | 'name' | 'points' | 'rank'>): StandingRow {
  return {
    played: 4,
    win: 1,
    draw: 1,
    loss: 2,
    goalsFor: 5,
    goalsAgainst: 5,
    goalDiff: 0,
    hasUnresolvedTie: false,
    tiedWith: [],
    decidedBy: null,
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
    manualOverride: null,
    ranking: null,
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
    expect(scheduleDayLabel(Date.UTC(2027, 0, 8, 16, 0), NOW_LIVE, '（今天）', WEEKDAYS)).toBe('1月9日　週六（今天）');
    expect(scheduleDayLabel(JAN10, NOW_LIVE, '（今天）', WEEKDAYS)).toBe('1月10日　週日');
    expect(scheduleDayLabel(JAN9_AM, NOW_LIVE, '（今天）', ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])).toBe('1月9日　Sat（今天）');

    const groups = groupSchedule([
      entry({ id: 'late', k: JAN10, st: 'scheduled', no: 2, v: '2號場', h: { id: 'en_b', n: '青鳥隊' }, a: { id: 'en_c', n: '赤焰隊' } }),
      entry({ id: 'tbd', k: null, st: 'postponed', v: null, h: { id: 'en_h', n: '海風隊' }, a: { id: 'en_d', n: '赤焰隊' } }),
      entry({ id: 'am', k: JAN9_AM, st: 'confirmed', s: [2, 1] }),
      entry({ id: 'pm', k: JAN9_PM, st: 'scheduled', v: '2號場' }),
      entry({ id: 'off', k: JAN9_AM, st: 'cancelled', no: 9 }),
    ], NOW_LIVE, LABELS);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.days.map((day) => day.label)).toEqual(['1月9日　週六（今天）', '1月10日　週日', '時間待定']);
    expect(groups[0]?.days[0]?.matches.map((match) => match.time)).toEqual(['09:00', '09:00', '14:30']);
    expect(groups[0]?.days[0]?.matches[0]).toMatchObject({ score: [2, 1], mark: null, venue: '1號場' });
    expect(groups[0]?.days[0]?.matches[2]).toMatchObject({ score: null, venue: '2號場' });
    expect(groups[0]?.days[2]?.matches[0]).toMatchObject({ time: null, mark: 'moved' });
    expect(groups[0]?.days[0]?.matches.map((match) => match.mark)).toEqual([null, 'cancelled', null]);
  });

  it('組別照給定順序，未賽的 0:0 不顯示成比分', () => {
    const groups = groupSchedule([
      entry({ id: 'u', dv: 'dv_u', k: JAN9_AM, st: 'scheduled' }),
      entry({ id: 'a', dv: 'dv_a', k: JAN9_AM, st: 'finished', s: [1, 0] }),
    ], NOW_LIVE, LABELS, ['dv_a', 'dv_u']);
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
    expect(publicMark(entry({ id: 'x', k: JAN9_AM, st: 'cancelled' }))).toBe('cancelled');
  });

  it('今天場數不含待定與已取消；下一場只看 scheduled 且時間 ≥ now', () => {
    const strip = liveStrip([
      entry({ id: 'done', k: JAN9_AM, st: 'confirmed', s: [2, 1] }),
      entry({ id: 'next', k: JAN9_PM, st: 'scheduled', v: '2號場' }),
      entry({ id: 'later', k: taipeiMs(2027, 1, 9, 15, 30), st: 'scheduled' }),
      entry({ id: 'sun', k: JAN10, st: 'scheduled' }),
      entry({ id: 'tbd', k: null, st: 'scheduled', v: null }),
      entry({ id: 'off', k: taipeiMs(2027, 1, 9, 16, 0), st: 'cancelled' }),
      entry({ id: 'moved', k: taipeiMs(2027, 1, 9, 13, 0), st: 'postponed' }),
      entry({ id: 'live', k: taipeiMs(2027, 1, 9, 13, 30), st: 'live' }),
    ], NOW_LIVE);
    expect(strip).toEqual({ today: 5, next: '14:30' });
    expect(liveStrip([entry({ id: 'past', k: JAN9_AM, st: 'confirmed' })], NOW_LIVE)).toEqual({ today: 1, next: null });
    expect(liveStrip([
      entry({ id: 'now', k: NOW_LIVE, st: 'scheduled' }),
      entry({ id: 'off', k: NOW_LIVE, st: 'cancelled' }),
    ], NOW_LIVE)).toEqual({ today: 1, next: '12:00' });
  });

  it('01:30 算前一個比賽日的今天，當天白天場不算', () => {
    const now = taipeiMs(2027, 1, 10, 1, 30);
    const strip = liveStrip([
      entry({ id: 'night', k: taipeiMs(2027, 1, 9, 20, 0), st: 'confirmed', s: [1, 0] }),
      entry({ id: 'early', k: now, st: 'scheduled' }),
      entry({ id: 'morning', k: taipeiMs(2027, 1, 10, 9, 0), st: 'scheduled' }),
      entry({ id: 'off', k: taipeiMs(2027, 1, 9, 22, 0), st: 'cancelled' }),
    ], now);
    expect(strip).toEqual({ today: 2, next: '01:30' });
  });

  it('距開賽用台北日曆，不是滿 24 小時', () => {
    expect(daysUntilStart(taipeiMs(2027, 1, 9, 8, 0), taipeiMs(2027, 1, 6, 23, 0))).toBe(3);
    expect(daysUntilStart(taipeiMs(2027, 1, 9, 8, 0), taipeiMs(2027, 1, 9, 1, 0))).toBe(0);
  });
});

describe('積分榜同分', () => {
  const rows = [
    row({ teamId: 'a', name: '海風隊', points: 10, rank: 1, win: 3, draw: 1, loss: 0, goalsFor: 10, goalsAgainst: 3, goalDiff: 7 }),
    row({
      teamId: 'b', name: '銀河隊', points: 5, rank: 5, goalsFor: 5, goalsAgainst: 5, goalDiff: 0,
      hasUnresolvedTie: true, tiedWith: ['c'],
    }),
    row({
      teamId: 'c', name: '雷霆隊', points: 5, rank: 6, goalsFor: 5, goalsAgainst: 5, goalDiff: 0,
      hasUnresolvedTie: true, tiedWith: ['b'],
    }),
  ];

  it('列上未裁定時兩隊同名次並標同分；第一名用強調色', () => {
    const lines = standingLines(table(rows, true));
    expect(lines.map((line) => [line.name, line.rank, line.tie, line.top])).toEqual([
      ['海風隊', 1, false, true],
      ['銀河隊', 5, true, false],
      ['雷霆隊', 5, true, false],
    ]);
    expect(formatGoalDiff(7)).toBe('+7');
    expect(formatGoalDiff(0)).toBe('0');
    expect(formatGoalDiff(-4)).toBe('-4');
    expect(championName(table(rows, true))).toEqual({ name: '海風隊', pending: false });
  });

  it('積分相同但已分出名次時不標同分、不改名次', () => {
    const decided = rows.map((item) => ({ ...item, hasUnresolvedTie: false, tiedWith: [] }));
    const lines = standingLines(table(decided, true));
    expect(lines.map((line) => [line.rank, line.tie])).toEqual([[1, false], [5, false], [6, false]]);
    expect(lines.map((line) => line.samePoints)).toEqual([false, true, true]);
    expect(championName(table(decided, false))).toEqual({ name: '海風隊', pending: false });
  });

  it('decidedBy 優先：有裁定就不是待裁定，即使 hasUnresolvedTie 仍是 true', () => {
    const ruled = rows.map((item) => (
      item.teamId === 'a' ? item : { ...item, decidedBy: 'host' as const }
    ));
    const lines = standingLines(table(ruled, true));
    expect(lines.map((line) => [line.name, line.tie, line.decidedBy, line.samePoints, line.rank])).toEqual([
      ['海風隊', false, null, false, 1],
      ['銀河隊', false, 'host', true, 5],
      ['雷霆隊', false, 'host', true, 6],
    ]);
  });

  it('已取消 0：0 畫 vs；有分數才顯示；原因留在列上', () => {
    expect(showsScore(entry({ id: 'z', k: JAN9_AM, st: 'cancelled', s: [0, 0] }))).toBe(false);
    expect(showsScore(entry({ id: 'z2', k: JAN9_AM, st: 'cancelled', s: [1, 0] }))).toBe(true);
    const groups = groupSchedule([
      entry({ id: 'off', k: JAN9_AM, st: 'cancelled', cr: '大雨，場地無法使用' }),
    ], NOW_LIVE, LABELS);
    expect(groups[0]?.days[0]?.matches[0]?.reason).toBe('大雨，場地無法使用');
    expect(groups[0]?.days[0]?.matches[0]?.mark).toBe('cancelled');
    expect(groupSchedule([
      entry({ id: 'keep', k: JAN9_AM, st: 'scheduled', cr: '不顯示' }),
    ], NOW_LIVE, LABELS)[0]?.days[0]?.matches[0]?.reason).toBeNull();
    expect(groupSchedule([
      entry({ id: 'blank', k: JAN9_AM, st: 'cancelled', cr: '   ' }),
    ], NOW_LIVE, LABELS)[0]?.days[0]?.matches[0]?.reason).toBeNull();
  });

  it('第 1 名未裁定不寫冠軍名字；多組各算一位', () => {
    const tied = standingLines(table([
      row({ teamId: 'a', name: '海風隊', points: 10, rank: 1, hasUnresolvedTie: true, tiedWith: ['b'] }),
      row({ teamId: 'b', name: '山貓隊', points: 10, rank: 2, hasUnresolvedTie: true, tiedWith: ['a'] }),
    ], true));
    expect(tied.map((line) => [line.rank, line.tie, line.top])).toEqual([
      [1, true, true],
      [1, true, true],
    ]);
    const pending = table([
      row({ teamId: 'a', name: '海風隊', points: 10, rank: 1, hasUnresolvedTie: true, tiedWith: ['b'] }),
      row({ teamId: 'b', name: '山貓隊', points: 10, rank: 2, hasUnresolvedTie: true, tiedWith: ['a'] }),
    ], true);
    expect(championName(pending)).toEqual({ name: null, pending: true });
    const other = table([
      row({ teamId: 'c', name: '青鳥隊', points: 9, rank: 1 }),
    ], false);
    other.divisionId = 'dv_2';
    other.divisionName = '青年組';
    expect([pending, other].map((doc) => championName(doc))).toEqual([
      { name: null, pending: true },
      { name: '青鳥隊', pending: false },
    ]);
    expect(championName(table([], false))).toEqual({ name: null, pending: false });
  });
});

describe('比賽日分組與場地', () => {
  it('凌晨場歸前一日，時刻寫隔日，標題用比賽日', () => {
    const early = taipeiMs(2027, 1, 10, 1, 30);
    const groups = groupSchedule([
      entry({ id: 'night', k: early, st: 'scheduled' }),
      entry({ id: 'day', k: JAN9_AM, st: 'confirmed', s: [1, 0] }),
    ], NOW_LIVE, LABELS);
    expect(groups[0]?.days.map((day) => day.label)).toEqual(['1月9日　週六（今天）']);
    expect(groups[0]?.days[0]?.matches.map((match) => match.time)).toEqual(['09:00', '隔日 01:30']);
  });

  it('未確認用場地序號，已確認與棄權用 v', () => {
    const venues = [{ name: '主場' }, { name: '副場' }];
    const groups = groupSchedule([
      entry({ id: 'open', k: JAN9_AM, st: 'scheduled', v: '舊名', vi: 1 }),
      entry({ id: 'done', k: JAN9_PM, st: 'confirmed', v: '確認場', vi: 0 }),
      entry({ id: 'wo', k: JAN10, st: 'walkover', v: '棄權場', vi: 1, wo: 'home' }),
      entry({ id: 'miss', k: JAN10, st: 'live', v: '超出', vi: 9, no: 2 }),
    ], NOW_LIVE, LABELS, [], venues);
    const rows = groups[0]?.days.flatMap((day) => day.matches) ?? [];
    expect(rows.find((row) => row.id === 'open')).toMatchObject({ venue: '副場', live: false, corrected: false });
    expect(rows.find((row) => row.id === 'done')?.venue).toBe('確認場');
    expect(rows.find((row) => row.id === 'wo')?.venue).toBe('棄權場');
    expect(rows.find((row) => row.id === 'miss')).toMatchObject({ venue: '超出', live: true });
  });
});

describe('組別名稱', () => {
  it('只有一組不顯示；多組用 divisionName，缺了依積分文件順序', () => {
    const named = table([], false);
    named.divisionName = '公開組';
    const bare = table([], false);
    bare.id = 'dv_2__group__A';
    bare.divisionId = 'dv_2';
    const docs = [named, bare];
    expect(standingHeading(named, 0, false)).toBeNull();
    expect(standingHeading(named, 0, true)).toEqual({ name: '公開組', n: 1 });
    expect(standingHeading(bare, 1, true)).toEqual({ name: null, n: 2 });
    expect(scheduleHeading('dv_1', 0, false, docs)).toBeNull();
    expect(scheduleHeading('dv_1', 1, true, docs)).toEqual({ name: '公開組', n: 1 });
    expect(scheduleHeading('dv_2', 0, true, docs)).toEqual({ name: null, n: 2 });
    expect(scheduleHeading('dv_missing', 1, true, docs)).toEqual({ name: null, n: 2 });
  });
});
