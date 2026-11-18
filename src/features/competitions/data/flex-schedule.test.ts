import { describe, expect, it } from 'vitest';
import { taipeiMs } from '../format';
import {
  applyDayShift,
  applySwap,
  clashSentence,
  dateAfterLast,
  hostNoticeCount,
  noticesNewestFirst,
  noticeTextProblem,
  parseConflict,
  shiftDayChoices,
  shiftMovesLater,
  slashDate,
} from './flex-schedule';
import type { CompetitionNotice, MatchDoc } from './types';

function match(partial: Partial<MatchDoc> & Pick<MatchDoc, 'id'>): MatchDoc {
  return {
    divisionId: 'dv_1',
    stageId: 'group',
    groupId: 'A',
    round: 1,
    matchNo: 1,
    label: null,
    matchKey: null,
    kickoffAt: taipeiMs(2027, 1, 9, 9, 0),
    venueIdx: 0,
    venueName: '1號場',
    home: { teamId: 'en_h', name: '海風' },
    away: { teamId: 'en_a', name: '山貓' },
    teamIds: ['en_h', 'en_a'],
    score: { home: 0, away: 0 },
    penaltyScore: null,
    status: 'scheduled',
    rev: 1,
    resetRev: 0,
    lock: { locked: false },
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'pre' },
    finishedAt: null,
    confirmedAt: null,
    walkoverSide: null,
    result: null,
    resultSource: null,
    updatedAt: null,
    cancelReason: null,
    cancelledAt: null,
    ...partial,
  };
}

describe('公告額度與排序', () => {
  it('主辦則數不含系統公告，畫面依時間新到舊', () => {
    const notices: CompetitionNotice[] = [
      { id: 'a', text: '較早', kind: 'host', at: 1, by: null },
      { id: 's', text: '系統', kind: 'system', at: 3, by: null },
      { id: 'b', text: '較晚', kind: 'host', at: 2, by: null },
    ];
    expect(hostNoticeCount(notices)).toBe(2);
    expect(noticesNewestFirst(notices).map((notice) => notice.id)).toEqual(['s', 'b', 'a']);
  });

  it('公告空白是必填，超過 300 個碼位是字數', () => {
    expect(noticeTextProblem('  ')).toBe('FIELD_REQUIRED');
    expect(noticeTextProblem('好')).toBeNull();
    expect(noticeTextProblem('好'.repeat(301))).toBe('FIELD_LENGTH');
  });
});

describe('順延與撞期', () => {
  it('只能往後，撞期帶出場次與對戰', () => {
    expect(shiftMovesLater('2027-01-09', '2027-01-09')).toBe(false);
    expect(shiftMovesLater('2027-01-09', '2027-01-08')).toBe(false);
    expect(shiftMovesLater('2027-01-09', '2027-01-12')).toBe(true);
    expect(slashDate('2027-01-24')).toBe('2027/01/24');
    expect(dateAfterLast('2027-01-11', taipeiMs(2027, 1, 10, 18, 0))).toBe(true);
    expect(dateAfterLast('2027-01-10', taipeiMs(2027, 1, 10, 18, 0))).toBe(false);

    const other = match({
      id: 'mt_2',
      kickoffAt: taipeiMs(2027, 1, 11, 14, 30),
      home: { teamId: 'en_b', name: '北風' },
      away: { teamId: 'en_c', name: '南風' },
      venueName: '2號場',
    });
    expect(parseConflict({ mtId: 'mt_2', type: 'team' })).toEqual({ mtId: 'mt_2', type: 'team' });
    expect(parseConflict({ mtId: 'mt_2', type: 'both' })).toBeNull();
    expect(clashSentence(other, 'team', '同一隊同時段已有比賽', '同一場地同時段已有比賽'))
      .toBe('同一隊同時段已有比賽　1/11 14:30　北風對南風');
    expect(clashSentence(other, 'venue', '同一隊同時段已有比賽', '同一場地同時段已有比賽'))
      .toBe('同一場地同時段已有比賽　1/11 14:30　北風對南風　2號場');
  });

  it('整天順延只搬那一天還沒開打的場次，兩場對調交換時間與場地', () => {
    const rows = [
      match({ id: 'mt_1' }),
      match({ id: 'mt_done', status: 'confirmed', kickoffAt: taipeiMs(2027, 1, 9, 11, 0) }),
      match({ id: 'mt_late', kickoffAt: taipeiMs(2027, 1, 10, 9, 0), venueIdx: 1, venueName: '2號場' }),
    ];
    expect(shiftDayChoices(rows).map((choice) => choice.date)).toEqual(['2027-01-09', '2027-01-10']);
    const shifted = applyDayShift(rows, '2027-01-09', '2027-01-12');
    expect(shifted.find((row) => row.id === 'mt_1')?.kickoffAt).toBe(taipeiMs(2027, 1, 12, 9, 0));
    expect(shifted.find((row) => row.id === 'mt_1')?.rev).toBe(2);
    expect(shifted.find((row) => row.id === 'mt_done')?.kickoffAt).toBe(taipeiMs(2027, 1, 9, 11, 0));
    expect(shifted.find((row) => row.id === 'mt_late')?.kickoffAt).toBe(taipeiMs(2027, 1, 10, 9, 0));

    const swapped = applySwap(rows, 'mt_1', 'mt_late');
    expect(swapped.find((row) => row.id === 'mt_1')).toMatchObject({
      kickoffAt: taipeiMs(2027, 1, 10, 9, 0), venueIdx: 1, venueName: '2號場', rev: 2,
    });
    expect(swapped.find((row) => row.id === 'mt_late')).toMatchObject({
      kickoffAt: taipeiMs(2027, 1, 9, 9, 0), venueIdx: 0, venueName: '1號場', rev: 2,
    });
  });
});
