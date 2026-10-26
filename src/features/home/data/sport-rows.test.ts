import { describe, expect, it } from 'vitest';
import type { EventDoc } from '@/features/events/data/types';
import { computeGuestSportRows, computeSportRows, isPublicActiveHomeEvent } from './sport-rows';

const NOW = new Date('2026/10/27 03:00:00').getTime();

function ev(id: string, extra: Record<string, unknown> = {}): EventDoc {
  return { id, status: 'open', date: '2030/10/20 18:00~20:00', ...extra } as EventDoc;
}

describe('isPublicActiveHomeEvent', () => {
  it('進行中的公開活動算；已結束／取消／私密／俱樂部限定／已開始的不算', () => {
    expect(isPublicActiveHomeEvent(ev('a'), NOW)).toBe(true);
    expect(isPublicActiveHomeEvent(ev('a', { status: 'ended' }), NOW)).toBe(false);
    expect(isPublicActiveHomeEvent(ev('a', { status: 'Cancelled' }), NOW)).toBe(false);
    expect(isPublicActiveHomeEvent(ev('a', { privateEvent: true }), NOW)).toBe(false);
    expect(isPublicActiveHomeEvent(ev('a', { teamOnly: true }), NOW)).toBe(false);
    expect(isPublicActiveHomeEvent(ev('a', { date: '2020/01/01 10:00~12:00' }), NOW)).toBe(false);
    expect(isPublicActiveHomeEvent({ status: 'open' } as EventDoc, NOW)).toBe(false);
  });
});

describe('computeSportRows', () => {
  it('依運動計數：數量多的在前、同數量依 SPORTS 順序；沒有 sportTag 歸足球', () => {
    const rows = computeSportRows(
      [
        ev('1', { sportTag: 'basketball' }),
        ev('2', { sportTag: 'basketball' }),
        ev('3', { sportTag: 'volleyball' }),
        ev('4'),
      ],
      NOW,
    );
    expect(rows.map((r) => [r.key, r.count])).toEqual([
      ['basketball', 2],
      ['football', 1],
      ['volleyball', 1],
    ]);
    expect(rows[0]).toMatchObject({ label: '籃球', symbol: '🏀' });
  });
});

describe('computeGuestSportRows（首屏快照用，訪客視角）', () => {
  it('不含私密與俱樂部限定活動，也不帶任何帳號判斷', () => {
    const rows = computeGuestSportRows(
      [
        ev('1', { sportTag: 'football', creatorUid: 'u1' }),
        ev('2', { sportTag: 'football', privateEvent: true, creatorUid: 'u1' }),
        ev('3', { sportTag: 'football', teamOnly: true, creatorUid: 'u1', creatorTeamId: 't1' }),
        ev('4', { sportTag: 'tennis', status: 'ended' }),
      ],
      NOW,
    );
    expect(rows.map((r) => [r.key, r.count])).toEqual([['football', 1]]);
  });
});
