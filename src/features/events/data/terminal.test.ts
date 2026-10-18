import { describe, it, expect } from 'vitest';

import {
  TERMINAL_DELAY_MS,
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
    const moveAt = new Date(2026, 4, 9, 17, 0, 0).getTime() + TERMINAL_DELAY_MS;
    expect(isEventInEndedTab(event, moveAt - 1)).toBe(false);
  });

  it('結束時間 +6 小時當下為 terminal', () => {
    const event = { status: 'ended', date: '2026/05/09 15:00~17:00' };
    const moveAt = new Date(2026, 4, 9, 17, 0, 0).getTime() + TERMINAL_DELAY_MS;
    expect(isEventInEndedTab(event, moveAt)).toBe(true);
  });

  it('結束時間 +6 小時後為 terminal', () => {
    const event = { status: 'ended', date: '2026/05/09 15:00~17:00' };
    const moveAt = new Date(2026, 4, 9, 17, 0, 0).getTime() + TERMINAL_DELAY_MS;
    expect(isEventInEndedTab(event, moveAt + 1)).toBe(true);
  });

  it('無有效日期時照 status：ended / cancelled 為 terminal', () => {
    expect(isEventInEndedTab({ status: 'ended' }, Date.now())).toBe(true);
    expect(isEventInEndedTab({ status: 'cancelled' }, Date.now())).toBe(true);
    expect(isEventInEndedTab({ status: 'open' }, Date.now())).toBe(false);
  });

  it('有有效日期時照日期門檻，不另看 status（逐條照 A）', () => {
    const event = { status: 'open', date: '2026/05/09 15:00~17:00' };
    const moveAt = new Date(2026, 4, 9, 17, 0, 0).getTime() + TERMINAL_DELAY_MS;
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
