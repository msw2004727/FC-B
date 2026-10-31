import { describe, it, expect } from 'vitest';

import {
  TERMINAL_DELAY_MS,
  parseEventDateRange,
  eventStartMs,
  isEventInEndedTab,
  normalizeListTab,
} from './terminal';

describe('isEventInEndedTab', () => {
  it('!event → true（照 A _isEventInActivityEndedTab）', () => {
    expect(isEventInEndedTab(null, Date.now())).toBe(true);
    expect(isEventInEndedTab(undefined, Date.now())).toBe(true);
  });

  it('結束時間 +6 小時前仍非 terminal', () => {
    const event = { status: 'ended', date: '2026/05/09 15:00~17:00' };
    const moveAt = Date.parse('2026-05-09T17:00:00+08:00') + TERMINAL_DELAY_MS;
    expect(isEventInEndedTab(event, moveAt - 1)).toBe(false);
  });

  it('結束時間 +6 小時當下為 terminal', () => {
    const event = { status: 'ended', date: '2026/05/09 15:00~17:00' };
    const moveAt = Date.parse('2026-05-09T17:00:00+08:00') + TERMINAL_DELAY_MS;
    expect(isEventInEndedTab(event, moveAt)).toBe(true);
  });

  it('結束時間 +6 小時後為 terminal', () => {
    const event = { status: 'ended', date: '2026/05/09 15:00~17:00' };
    const moveAt = Date.parse('2026-05-09T17:00:00+08:00') + TERMINAL_DELAY_MS;
    expect(isEventInEndedTab(event, moveAt + 1)).toBe(true);
  });

  it('無有效日期時照 status：ended / cancelled 為 terminal', () => {
    expect(isEventInEndedTab({ status: 'ended' }, Date.now())).toBe(true);
    expect(isEventInEndedTab({ status: 'cancelled' }, Date.now())).toBe(true);
    expect(isEventInEndedTab({ status: 'open' }, Date.now())).toBe(false);
  });

  it('有有效日期時照日期門檻，不另看 status（逐條照 A）', () => {
    const event = { status: 'open', date: '2026/05/09 15:00~17:00' };
    const moveAt = Date.parse('2026-05-09T17:00:00+08:00') + TERMINAL_DELAY_MS;
    expect(isEventInEndedTab(event, moveAt)).toBe(true);
    expect(isEventInEndedTab(event, moveAt - 1)).toBe(false);
  });
});

describe('normalizeListTab', () => {
  it("'ended' 舊值 normalize 為 'normal'", () => {
    expect(normalizeListTab('ended')).toBe('normal');
  });

  it('空值為 normal，其他值原樣回傳', () => {
    expect(normalizeListTab(null)).toBe('normal');
    expect(normalizeListTab(undefined)).toBe('normal');
    expect(normalizeListTab('')).toBe('normal');
    expect(normalizeListTab('upcoming')).toBe('upcoming');
  });
});

describe('T-054c terminal 保留語意', () => {
  it('T1 跨日結束仍是當日，+6h 邊界含等號', () => {
    const event = { date: '2026/05/09 22:00~00:30' };
    expect(isEventInEndedTab(event, Date.parse('2026-05-09T06:29:59.999+08:00'))).toBe(false);
    expect(isEventInEndedTab(event, Date.parse('2026-05-09T06:30:00+08:00'))).toBe(true);
  });

  it('T2 只有日期結束為 23:59:59；無結束或壞結束取起點', () => {
    expect(isEventInEndedTab({ date: '2026/10/19' }, Date.parse('2026-10-20T05:59:58.999+08:00'))).toBe(false);
    expect(isEventInEndedTab({ date: '2026/10/19' }, Date.parse('2026-10-20T05:59:59+08:00'))).toBe(true);
    for (const date of ['2026/10/19 11:00', '2026/10/19 11:00~', '2026/10/19 11:00~xx']) {
      expect(isEventInEndedTab({ date }, Date.parse('2026-10-19T16:59:59.999+08:00'))).toBe(false);
      expect(isEventInEndedTab({ date }, Date.parse('2026-10-19T17:00:00+08:00'))).toBe(true);
    }
  });

  it('T3 範圍型一般起訖與無結束 +2h', () => {
    for (const date of ['2026/10/19 11:00~13:00', '2026/10/19 11:00']) {
      expect(parseEventDateRange(date)).toEqual({
        startMs: Date.parse('2026-10-19T11:00:00+08:00'),
        endMs: Date.parse('2026-10-19T13:00:00+08:00'),
      });
    }
  });

  it('T4 範圍型收時間戳；已結束頁籤保留只收斜線字串', () => {
    for (const date of [Date.parse('2026-10-19T11:00:00+08:00'), { toMillis: () => Date.parse('2026-10-19T11:00:00+08:00') }]) {
      expect(parseEventDateRange(date)).toEqual({
        startMs: Date.parse('2026-10-19T11:00:00+08:00'),
        endMs: Date.parse('2026-10-19T13:00:00+08:00'),
      });
      expect(isEventInEndedTab({ date, status: 'open' }, Date.parse('2026-10-20T11:00:00+08:00'))).toBe(false);
    }
    expect(eventStartMs({ startAt: '2026-10-19T03:00:00Z' })).toBe(Date.parse('2026-10-19T11:00:00+08:00'));
    expect(eventStartMs(null)).toBe(0);
  });

  it('T5a 刻意與舊版不同：不存在的日期不進位，改看 status', () => {
    const date = '2026/02/30 10:00~11:00';
    expect(parseEventDateRange(date)).toBeNull();
    expect(isEventInEndedTab({ date, status: 'ended' }, Date.parse('2026-10-19T11:00:00+08:00'))).toBe(true);
    expect(isEventInEndedTab({ date, status: 'open' }, Date.parse('2026-10-19T11:00:00+08:00'))).toBe(false);
  });

  it.each(['abc', null])('T5 無效日期 %j', (date) => {
    expect(parseEventDateRange(date)).toBeNull();
    expect(isEventInEndedTab({ date, status: 'ended' }, Date.parse('2026-10-19T11:00:00+08:00'))).toBe(true);
    expect(isEventInEndedTab({ date, status: 'open' }, Date.parse('2026-10-19T11:00:00+08:00'))).toBe(false);
  });

  it('刻意與舊版不同：T7 ~ 前後有空白時已結束頁籤照實解析結束（舊版結束＝起點，+6h 於 15:00 移出；新版結束 11:00，+6h 於 17:00 移出）', () => {
    const event = { status: 'open', date: '2026/10/25 09:00 ~ 11:00' };
    expect(isEventInEndedTab(event, Date.parse('2026-10-25T15:00:00+08:00'))).toBe(false);
    expect(isEventInEndedTab(event, Date.parse('2026-10-25T16:59:59.999+08:00'))).toBe(false);
    expect(isEventInEndedTab(event, Date.parse('2026-10-25T17:00:00+08:00'))).toBe(true);
  });

  it.each(['Oct 19, 2026', '2026-02-30'])('T6 刻意與舊版不同：不猜測或進位 %s', (date) => {
    expect(parseEventDateRange(date)).toBeNull();
  });
});
