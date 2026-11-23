import { describe, expect, it } from 'vitest';
import {
  NOSHOW_V2_SINCE_KEY,
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

// 放鴿子 v2：與個人頁／管理名單的 userAttendanceStats.countedNoShowCount 同口徑（FC functions/noshow-v2-core.js）。
describe('放鴿子 v2 口徑（顧問 §3.603 條件①）', () => {
  const D = (day: string, time = '19:00~21:00') => `2026/11/${day} ${time}`;
  // 一場「有計入」的活動：有正取非主辦者的有效簽退（旗標成立），absent 沒簽到也沒簽退。
  function counted(over: Partial<EventRoster> & { day?: string } = {}): EventRoster {
    const event = ev('x', { date: D(over.day ?? '10'), creatorUid: 'host', delegateUids: ['dele'] });
    return {
      event,
      registrations: [
        { eventId: 'pub-x', userId: 'done', status: 'confirmed', participantType: 'self' },
        { eventId: 'pub-x', userId: 'absent', status: 'confirmed', participantType: 'self' },
      ],
      attendance: [
        { eventId: 'pub-x', uid: 'done', type: 'checkin' },
        { eventId: 'pub-x', uid: 'done', type: 'checkout' },
      ],
      ...over,
    };
  }
  const noShow = (rosters: EventRoster[]) => computeRangeStats(rosters, NOW).metrics.noShow;

  it('起算點同 Functions：2026-11-07', () => {
    expect(NOSHOW_V2_SINCE_KEY).toBe('2026/11/07');
  });

  it('起算日前的場次不算；起算日當天起才算', () => {
    expect(noShow([counted({ day: '06' })])).toEqual({ times: 0, people: 0 });
    expect(noShow([counted({ day: '07' })])).toEqual({ times: 1, people: 1 });
    expect(noShow([counted({ day: '01' }), counted({ day: '10' })]).times).toBe(1);
  });

  it('整場沒有有效簽退（主辦沒點名）就不計入', () => {
    const r = counted();
    expect(noShow([{ ...r, attendance: [{ eventId: 'pub-x', uid: 'done', type: 'checkin' }] }]).times).toBe(0);
    expect(noShow([{ ...r, attendance: [...r.attendance.map((a) => ({ ...a, status: 'removed' }))] }]).times).toBe(0);
  });

  it('只有主辦或委託人自己的簽退不讓整場計入；同行者簽退也不算', () => {
    const base = counted();
    const regs = [...base.registrations,
      { eventId: 'pub-x', userId: 'host', status: 'confirmed' },
      { eventId: 'pub-x', userId: 'dele', status: 'confirmed' }];
    const hostOnly = { ...base, registrations: regs, attendance: [
      { eventId: 'pub-x', uid: 'host', type: 'checkout' },
      { eventId: 'pub-x', uid: 'dele', type: 'checkout' },
      { eventId: 'pub-x', uid: 'done', type: 'checkout', companionId: 'c1' },
    ] };
    expect(noShow([hostOnly]).times).toBe(0);
  });

  it('紀錄的 eventId 要對得上 public id 或文件 ID；對不上不算出席、也不讓整場計入', () => {
    const r = counted();
    const noEventId = { ...r, attendance: r.attendance.map(({ eventId: _e, ...rest }) => rest) };
    expect(noShow([noEventId]).times).toBe(0);
    const byDocId = { ...r, attendance: [...r.attendance.map((a) => ({ ...a, eventId: 'doc-x' })),
      { eventId: 'other-event', uid: 'absent', type: 'checkin' }] };
    expect(noShow([byDocId])).toEqual({ times: 1, people: 1 });
  });

  it('只簽退沒簽到不算放鴿子；同行者以主人 uid 的簽到不算本人到場', () => {
    const r = counted();
    const outOnly = { ...r, attendance: [...r.attendance, { eventId: 'pub-x', uid: 'absent', type: 'checkout' }] };
    expect(noShow([outOnly]).times).toBe(0);
    const viaCompanion = { ...r, attendance: [...r.attendance, { eventId: 'pub-x', uid: 'absent', type: 'checkin', companionId: 'c1' }] };
    expect(noShow([viaCompanion]).times).toBe(1);
  });

  it('候補在活動開始後才遞補不計入本人；開始前遞補照算（Timestamp 形狀也可）', () => {
    const r = counted();
    const start = Date.UTC(2026, 10, 10, 11, 0); // 台北 11/10 19:00
    const late = { ...r, registrations: r.registrations.map((g) => g.userId === 'absent'
      ? { ...g, promotedAt: { seconds: (start + 60_000) / 1000 } } : g) };
    expect(noShow([late]).times).toBe(0);
    const early = { ...r, registrations: r.registrations.map((g) => g.userId === 'absent'
      ? { ...g, promotedAt: { toMillis: () => start - 60_000 } } : g) };
    expect(noShow([early]).times).toBe(1);
  });

  it('同行者報名、舊狀態 registered 不算放鴿子；文件狀態不是 ended 不計入', () => {
    const r = counted();
    const regs = [
      { eventId: 'pub-x', userId: 'done', status: 'confirmed' },
      { eventId: 'pub-x', userId: 'absent', status: 'registered' },
      { eventId: 'pub-x', userId: 'done', status: 'confirmed', participantType: 'companion', companionId: 'c9' },
    ];
    expect(noShow([{ ...r, registrations: regs }]).times).toBe(0);
    expect(noShow([{ ...r, event: { ...r.event, status: 'open' } }]).times).toBe(0);
  });

  it('同一人兩場計入場次都沒到：2 人次 1 人', () => {
    const a = counted({ day: '08' });
    const b = counted({ day: '12' });
    const bEvent = { ...b.event, id: 'pub-y', _docId: 'doc-y' } as EventDoc;
    const retag = <T extends { eventId?: unknown }>(list: readonly T[]) => list.map((x) => ({ ...x, eventId: 'pub-y' }));
    const rosterB = { event: bEvent, registrations: retag(b.registrations), attendance: retag(b.attendance) };
    expect(noShow([a, rosterB])).toEqual({ times: 2, people: 1 });
  });
});
