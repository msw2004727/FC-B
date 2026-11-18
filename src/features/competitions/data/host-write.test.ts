import { describe, expect, it } from 'vitest';
import { taipeiMs } from '../format';
import {
  applyWrite,
  allVenueIdx,
  groupHostMatches,
  hostActions,
  hostBadgeKey,
  initialDays,
  isTransportFailure,
  normalizeTime,
  outcomeMatches,
  parseReschedule,
  parseScheduleForm,
  previewFromResult,
  reasonProblem,
  rescheduleDraft,
  stepScore,
  walkoverScore,
} from './host-write';
import type { DivisionDoc, MatchDoc, MatchStatus } from './types';

function match(partial: Partial<MatchDoc> & Pick<MatchDoc, 'id' | 'status'>): MatchDoc {
  return {
    divisionId: 'dv_adult',
    stageId: 'group',
    groupId: 'A',
    round: 1,
    matchNo: 1,
    label: null,
    matchKey: null,
    kickoffAt: taipeiMs(2027, 1, 9, 9, 0),
    venueIdx: 0,
    venueName: '示範球場',
    home: { teamId: 'en_h', name: '海風隊' },
    away: { teamId: 'en_a', name: '山貓隊' },
    teamIds: ['en_h', 'en_a'],
    score: { home: 0, away: 0 },
    penaltyScore: null,
    rev: 3,
    resetRev: 0,
    lock: { locked: false },
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'pre' },
    finishedAt: null,
    confirmedAt: null,
    walkoverSide: null,
    result: null,
    resultSource: null,
    updatedAt: null,
    ...partial,
  };
}

const adult: DivisionDoc = {
  dvId: 'dv_adult',
  name: '成人組',
  playersOnField: 5,
  maxTeams: 8,
  rosterMin: 7,
  rosterMax: 12,
  minAge: null,
  maxAge: null,
  requireRealName: false,
  feePerTeam: 0,
  entryCount: 2,
  approvedCount: 2,
  order: 0,
};

describe('排賽程表單', () => {
  it('預設比賽日是首末場的台北日期，鐘點 09:00–18:00，場地全選', () => {
    expect(initialDays(taipeiMs(2027, 1, 9, 8, 0), taipeiMs(2027, 1, 9, 18, 0))).toEqual([
      { date: '2027-01-09', start: '09:00', end: '18:00' },
    ]);
    expect(initialDays(taipeiMs(2027, 1, 9, 8, 0), taipeiMs(2027, 1, 10, 18, 0))).toEqual([
      { date: '2027-01-09', start: '09:00', end: '18:00' },
      { date: '2027-01-10', start: '09:00', end: '18:00' },
    ]);
    expect(allVenueIdx(2)).toEqual([0, 1]);
  });

  it('分鐘、時間、場地不合法時不送出', () => {
    const base = {
      dvId: 'dv_adult',
      legs: 1 as const,
      matchMinutes: '40',
      bufferMinutes: '10',
      days: [{ date: '2027-01-09', start: '09:00', end: '18:00' }],
      venueIdx: [0],
    };
    expect(parseScheduleForm({ ...base, venueIdx: [] }).ok).toBe(false);
    expect(parseScheduleForm({ ...base, matchMinutes: '' })).toMatchObject({ ok: false, reason: 'FIELD_REQUIRED' });
    expect(parseScheduleForm({ ...base, matchMinutes: '0' })).toMatchObject({ ok: false, reason: 'FIELD_RANGE' });
    expect(parseScheduleForm({ ...base, days: [{ date: '2027-01-09', start: '18:00', end: '09:00' }] })).toMatchObject({ ok: false, reason: 'FIELD_RANGE' });
    expect(parseScheduleForm(base)).toMatchObject({
      ok: true,
      value: { legs: 1, matchMinutes: 40, bufferMinutes: 10, venueIdx: [0] },
    });
    expect(normalizeTime('9:05')).toBe('09:05');
    expect(normalizeTime('24:00')).toBeNull();
  });

  it('預覽天數用 daysUsed.length，排不下不算成功', () => {
    expect(previewFromResult({
      dvId: 'dv_adult', seed: 7, matchCount: 6, unplacedCount: 0,
      daysUsed: ['2027-01-09', '2027-01-10'], perTeam: 3, teamCount: 4, dryRun: true,
    })).toEqual({ kind: 'ok', m: 6, d: 2, p: 3, seed: 7 });
    expect(previewFromResult({
      dvId: 'dv_adult', seed: 7, matchCount: 2, unplacedCount: 4,
      daysUsed: ['2027-01-09'], perTeam: 1, teamCount: 4, dryRun: true,
    })).toEqual({ kind: 'bad', n: 4 });
  });
});

describe('場次按鈕與寫入結果', () => {
  it('四種狀態的按鈕，進行中沒有寫入按鈕', () => {
    const cases: Array<[MatchStatus, string[]]> = [
      ['scheduled', ['reschedule', 'score']],
      ['postponed', ['reschedule']],
      ['finished', ['score', 'confirm']],
      ['confirmed', ['reset']],
      ['walkover', ['reset']],
      ['live', []],
      ['halftime', []],
    ];
    for (const [status, actions] of cases) {
      expect(hostActions(status), status).toEqual(actions);
    }
    expect(hostBadgeKey('live')).toBe('live');
    expect(hostBadgeKey('halftime')).toBe('live');
    expect(hostBadgeKey('finished')).toBe('pending');
  });

  it('棄權比分是 0：2，加減分停在 0 與 99', () => {
    expect(walkoverScore('home')).toEqual({ home: 0, away: 2 });
    expect(walkoverScore('away')).toEqual({ home: 2, away: 0 });
    expect(stepScore(0, -1)).toBe(0);
    expect(stepScore(99, 1)).toBe(99);
    expect(reasonProblem('  ')).toBe('FIELD_REQUIRED');
    expect(reasonProblem('測'.repeat(200))).toBeNull();
    expect(reasonProblem('😀'.repeat(201))).toBe('FIELD_LENGTH');
  });

  it('待定改期送出 null，有開賽時間才要場地', () => {
    const open = match({ id: 'mt_1', status: 'scheduled', venueIdx: null });
    expect(rescheduleDraft(open, 2).tbd).toBe(false);
    expect(rescheduleDraft(open, 2).venueIdx).toBe('0');
    expect(rescheduleDraft(match({ id: 'mt_2', status: 'postponed', kickoffAt: null }), 1).tbd).toBe(true);
    expect(parseReschedule({
      tbd: true, date: '2027-01-09', time: '09:00', venueIdx: '0', venueCount: 1,
    })).toEqual({ ok: true, kickoffAt: null, venueIdx: null });
    expect(parseReschedule({
      tbd: false, date: '', time: '', venueIdx: '0', venueCount: 1,
    })).toMatchObject({ ok: false, reason: 'FIELD_REQUIRED' });
    expect(parseReschedule({
      tbd: false, date: '2027-01-11', time: '14:30', venueIdx: '1', venueCount: 2,
    })).toEqual({ ok: true, kickoffAt: taipeiMs(2027, 1, 11, 14, 30), venueIdx: 1 });
  });

  it('重送遇到 REV_CONFLICT：內容相同才算成功', () => {
    const recorded = match({
      id: 'mt_1', status: 'confirmed', score: { home: 2, away: 0 }, rev: 8,
    });
    expect(outcomeMatches({ kind: 'record', score: { home: 2, away: 0 }, confirm: true }, recorded)).toBe(true);
    expect(outcomeMatches({ kind: 'record', score: { home: 2, away: 0 }, confirm: false }, recorded)).toBe(false);
    expect(outcomeMatches({ kind: 'record', score: { home: 1, away: 0 }, confirm: true }, recorded)).toBe(false);
    expect(outcomeMatches({ kind: 'confirm', score: { home: 2, away: 1 } }, match({
      id: 'mt_1', status: 'confirmed', score: { home: 2, away: 1 },
    }))).toBe(true);
    expect(outcomeMatches({ kind: 'confirm', score: { home: 2, away: 1 } }, match({
      id: 'mt_1', status: 'confirmed', score: { home: 9, away: 9 },
    }))).toBe(false);
    expect(outcomeMatches({ kind: 'walkover', forfeitSide: 'home', reason: '未到' }, match({
      id: 'mt_1', status: 'walkover', walkoverSide: 'home', score: { home: 0, away: 2 },
    }))).toBe(true);
    const reset = applyWrite(match({ id: 'mt_1', status: 'confirmed', score: { home: 3, away: 1 } }), {
      kind: 'reset', reason: '登錯',
    });
    expect(reset.rev).toBe(4);
    expect(outcomeMatches({ kind: 'reset', reason: '登錯' }, reset)).toBe(true);
    const moved = applyWrite(match({ id: 'mt_1', status: 'scheduled' }), {
      kind: 'reschedule', kickoffAt: null, venueIdx: null,
    });
    expect(moved.status).toBe('postponed');
    expect(outcomeMatches({ kind: 'reschedule', kickoffAt: null, venueIdx: null }, moved)).toBe(true);
    expect(outcomeMatches({ kind: 'reschedule', kickoffAt: null, venueIdx: 0 }, moved)).toBe(false);
  });

  it('網路失敗才可原樣重送', () => {
    expect(isTransportFailure('UNKNOWN')).toBe(true);
    expect(isTransportFailure('')).toBe(true);
    expect(isTransportFailure('MATCH_STATE')).toBe(false);
    expect(isTransportFailure('REV_CONFLICT')).toBe(false);
  });

  it('主辦清單把今天標出來，時間未定排最後', () => {
    const now = taipeiMs(2027, 1, 9, 12, 0);
    const groups = groupHostMatches([
      match({ id: 'late', status: 'scheduled', kickoffAt: taipeiMs(2027, 1, 10, 9, 0), matchNo: 2 }),
      match({ id: 'tbd', status: 'postponed', kickoffAt: null, matchNo: 3 }),
      match({ id: 'today', status: 'scheduled', kickoffAt: taipeiMs(2027, 1, 9, 9, 0), matchNo: 1 }),
    ], [adult], now, { today: '（今天）', tbd: '時間待定', weekdays: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'] });
    const days = groups[0]?.days ?? [];
    expect(groups[0]?.heading).toBeNull();
    expect(days.map((day) => day.label)).toEqual(['1月9日　週六（今天）', '1月10日　週日', '時間待定']);
    expect(days[0]?.matches.map((row) => row.id)).toEqual(['today']);
  });
});
