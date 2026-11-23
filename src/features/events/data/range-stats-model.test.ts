import { describe, expect, it } from 'vitest';
import {
  computeRangeStats,
  customRange,
  eventDateKey,
  isEventInRange,
  periodRange,
  toPieSlices,
  type EventRoster,
} from './range-stats-model';
import type { EventDoc } from './types';

// 2026-11-23（一）12:00 台北
const NOW = Date.UTC(2026, 10, 23, 4, 0, 0);

describe('periodRange（台北日期）', () => {
  it('週＝週一到下週一（不含）', () => {
    expect(periodRange('week', NOW)).toEqual({ startKey: '2026/11/23', endKey: '2026/11/30', days: 7 });
    expect(periodRange('week', NOW, -1)).toEqual({ startKey: '2026/11/16', endKey: '2026/11/23', days: 7 });
  });

  it('週日仍屬於當週（週一起算）', () => {
    const sunday = Date.UTC(2026, 10, 29, 4); // 11/29（日）
    expect(periodRange('week', sunday).startKey).toBe('2026/11/23');
  });

  it('台北 00:30（UTC 前一天 16:30）算台北當天', () => {
    const earlyTaipei = Date.UTC(2026, 10, 30, 16, 30); // 台北 12/1 00:30
    expect(periodRange('month', earlyTaipei).startKey).toBe('2026/12/01');
  });

  it('月、年與跨年位移', () => {
    expect(periodRange('month', NOW)).toEqual({ startKey: '2026/11/01', endKey: '2026/12/01', days: 30 });
    expect(periodRange('month', NOW, -11)).toEqual({ startKey: '2025/12/01', endKey: '2026/01/01', days: 31 });
    expect(periodRange('year', NOW)).toEqual({ startKey: '2026/01/01', endKey: '2027/01/01', days: 365 });
    expect(periodRange('year', NOW, -1).startKey).toBe('2025/01/01');
  });
});

describe('customRange', () => {
  it('兩端都含', () => {
    expect(customRange('2026-08-01', '2026-11-23')).toEqual({ startKey: '2026/08/01', endKey: '2026/11/24', days: 115 });
    expect(customRange('2026-11-23', '2026-11-23')?.days).toBe(1);
  });
  it('起大於訖或格式錯誤回 null', () => {
    expect(customRange('2026-11-24', '2026-11-23')).toBeNull();
    expect(customRange('2026/11/01', '2026-11-23')).toBeNull();
    expect(customRange('', '')).toBeNull();
  });
});

describe('eventDateKey／isEventInRange', () => {
  it('補零並只取日期', () => {
    expect(eventDateKey({ date: '2026/1/5 09:00~11:00' })).toBe('2026/01/05');
    expect(eventDateKey({ date: '2026-01-05' })).toBe('');
    expect(eventDateKey({})).toBe('');
  });
  it('起含訖不含', () => {
    const r = periodRange('month', NOW);
    expect(isEventInRange({ date: '2026/11/01 00:00' }, r)).toBe(true);
    expect(isEventInRange({ date: '2026/11/30 23:59' }, r)).toBe(true);
    expect(isEventInRange({ date: '2026/12/01 00:00' }, r)).toBe(false);
    expect(isEventInRange({ date: '2026/10/31 23:59' }, r)).toBe(false);
  });
});

function ev(id: string, over: Partial<EventDoc> & Record<string, unknown> = {}): EventDoc {
  return { id: `pub-${id}`, _docId: `doc-${id}`, status: 'ended', date: '2026/11/10 19:00~21:00', ...over } as EventDoc;
}

describe('computeRangeStats 口徑', () => {
  it('人次與不重複人數：同一人兩場算 2 人次 1 人', () => {
    const rosters: EventRoster[] = [
      { event: ev('a'), registrations: [{ userId: 'u1', status: 'confirmed' }], attendance: [] },
      { event: ev('b'), registrations: [{ userId: 'u1', status: 'confirmed' }, { userId: 'u2', status: 'waitlisted' }], attendance: [] },
    ];
    const s = computeRangeStats(rosters, NOW);
    expect(s.metrics.confirmed).toEqual({ times: 2, people: 1 });
    expect(s.metrics.waitlisted).toEqual({ times: 1, people: 1 });
    expect(s.metrics.registered).toEqual({ times: 3, people: 2 });
    expect(s.eventCount).toBe(2);
  });

  it('同一場重複報名文件只算一次；legacy registered＝正取；legacy uid 當身分', () => {
    const s = computeRangeStats([{
      event: ev('a'),
      registrations: [
        { userId: 'u1', status: 'confirmed' },
        { userId: 'u1', status: 'confirmed' },
        { uid: 'u2', status: 'registered' },
      ],
      attendance: [],
    }], NOW);
    expect(s.metrics.confirmed).toEqual({ times: 2, people: 2 });
  });

  it('不以名字當身分：沒有任何 UID 的報名不計', () => {
    const s = computeRangeStats([{
      event: ev('a'),
      registrations: [{ status: 'confirmed', userName: '小明' } as never],
      attendance: [],
    }], NOW);
    expect(s.metrics.registered.times).toBe(0);
  });

  it('同行者以主報名人＋companionId 區分，不和本人合併', () => {
    const s = computeRangeStats([{
      event: ev('a', { status: 'open', date: '2026/12/10 19:00' }),
      registrations: [
        { userId: 'u1', status: 'confirmed', participantType: 'self' },
        { userId: 'u1', status: 'confirmed', participantType: 'companion', companionId: 'c1' },
        { userId: 'u1', status: 'confirmed', participantType: 'companion', companionId: 'c2' },
      ],
      attendance: [],
    }], NOW);
    expect(s.metrics.confirmed).toEqual({ times: 3, people: 3 });
  });

  it('簽到簽退要兩者都有才算一組；已撤銷紀錄不算', () => {
    const s = computeRangeStats([{
      event: ev('a'),
      registrations: [
        { userId: 'both', status: 'confirmed' },
        { userId: 'inOnly', status: 'confirmed' },
        { userId: 'removedOut', status: 'confirmed' },
        { userId: 'u1', status: 'confirmed', participantType: 'companion', companionId: 'c1' },
      ],
      attendance: [
        { uid: 'both', type: 'checkin' }, { uid: 'both', type: 'checkout' },
        { uid: 'inOnly', type: 'checkin' },
        { uid: 'removedOut', type: 'checkin' }, { uid: 'removedOut', type: 'checkout', status: 'removed' },
        { uid: 'u1', type: 'checkin', companionId: 'c1' }, { uid: 'u1', type: 'checkout', companionId: 'c1' },
      ],
    }], NOW);
    expect(s.metrics.checkedPair).toEqual({ times: 2, people: 2 });
    // inOnly 與 removedOut 有簽到，不算放鴿子
    expect(s.metrics.noShow.times).toBe(0);
    expect(s.confirmedOther.times).toBe(2);
  });

  it('放鴿子：只看文件狀態已結束且日期在今天以前；同行者不算；同主人的同行者簽到算本人有到（同後端）', () => {
    const s = computeRangeStats([
      {
        event: ev('past'),
        registrations: [
          { userId: 'absent', status: 'confirmed' },
          { userId: 'absent', status: 'confirmed', participantType: 'companion', companionId: 'c9' },
          { userId: 'viaCompanion', status: 'confirmed' },
          { userId: 'waiting', status: 'waitlisted' },
        ],
        attendance: [{ uid: 'viaCompanion', type: 'checkin', companionId: 'cx' }],
      },
      // 時間已過但文件仍是 open：畫面算已結束，放鴿子仍不計（後端也不算）
      { event: ev('stillOpen', { status: 'open', date: '2026/11/01 10:00' }), registrations: [{ userId: 'x', status: 'confirmed' }], attendance: [] },
      // 今天的活動不計
      { event: ev('today', { date: '2026/11/23 08:00' }), registrations: [{ userId: 'y', status: 'confirmed' }], attendance: [] },
    ], NOW);
    expect(s.metrics.noShow).toEqual({ times: 1, people: 1 });
  });

  it('取消另計，不算已報名', () => {
    const s = computeRangeStats([{
      event: ev('a'),
      registrations: [{ userId: 'u1', status: 'cancelled' }, { userId: 'u2', status: 'removed' }],
      attendance: [],
    }], NOW);
    expect(s.metrics.cancelled).toEqual({ times: 1, people: 1 });
    expect(s.metrics.registered.times).toBe(0);
  });

  it('活動狀態場數用畫面有效狀態', () => {
    const s = computeRangeStats([
      { event: ev('a', { status: 'cancelled' }), registrations: [], attendance: [] },
      { event: ev('b', { status: 'open', date: '2026/12/24 10:00' }), registrations: [], attendance: [] },
      { event: ev('c', { status: 'open', date: '2026/11/01 10:00' }), registrations: [], attendance: [] },
    ], NOW);
    expect(s.eventCountByStatus).toMatchObject({ cancelled: 1, open: 1, ended: 1 });
  });

  it('舊活動 id ≠ _docId：以 _docId 分場，不會兩場併成一場', () => {
    const s = computeRangeStats([
      { event: ev('a', { id: 'same-public', _docId: 'rand-1' }), registrations: [{ userId: 'u1', status: 'confirmed' }], attendance: [] },
      { event: ev('b', { id: 'other', _docId: 'rand-2' }), registrations: [{ userId: 'u1', status: 'confirmed' }], attendance: [] },
    ], NOW);
    expect(s.metrics.confirmed.times).toBe(2);
  });
});

describe('toPieSlices', () => {
  it('百分比一位小數；合計 0 時全 0', () => {
    expect(toPieSlices([{ key: 'a', label: 'A', value: 1 }, { key: 'b', label: 'B', value: 2 }]).map((p) => p.percent))
      .toEqual([33.3, 66.7]);
    expect(toPieSlices([{ key: 'a', label: 'A', value: 0 }]).map((p) => p.percent)).toEqual([0]);
  });
});
