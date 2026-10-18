/**
 * 移植自 tests/unit/event-ended-tab-delay.test.js，並補 +6 小時邊界（5:59 / 6:00 / 6:01）。
 */

import { describe, expect, test } from 'vitest';
import { isEventInEndedTab, normalizeListTab, TERMINAL_DELAY_MS } from './terminal';

describe('activity ended tab delay', () => {
  const endedEvent = { status: 'ended', date: '2026/05/09 15:00~17:00' };
  const cancelledEvent = { status: 'cancelled', date: '2026/05/09 15:00~17:00' };
  const endMs = new Date(2026, 4, 9, 17, 0).getTime();

  test('keeps ended events in the active activity tab until six hours after end time', () => {
    // 對照 A 的 22:59 / 23:00 斷言
    expect(isEventInEndedTab(endedEvent, new Date(2026, 4, 9, 22, 59).getTime())).toBe(false);
    expect(isEventInEndedTab(endedEvent, new Date(2026, 4, 9, 23, 0).getTime())).toBe(true);
  });

  test('keeps cancelled events in the active activity tab until six hours after end time', () => {
    expect(isEventInEndedTab(cancelledEvent, new Date(2026, 4, 9, 22, 59).getTime())).toBe(false);
    expect(isEventInEndedTab(cancelledEvent, new Date(2026, 4, 9, 23, 0).getTime())).toBe(true);
  });

  test('+6h boundary: 5:59 → active, 6:00 → terminal, 6:01 → terminal', () => {
    expect(isEventInEndedTab(endedEvent, endMs + TERMINAL_DELAY_MS - 1)).toBe(false);
    expect(isEventInEndedTab(endedEvent, endMs + TERMINAL_DELAY_MS)).toBe(true);
    expect(isEventInEndedTab(endedEvent, endMs + TERMINAL_DELAY_MS + 1)).toBe(true);

    expect(isEventInEndedTab(cancelledEvent, endMs + TERMINAL_DELAY_MS - 1)).toBe(false);
    expect(isEventInEndedTab(cancelledEvent, endMs + TERMINAL_DELAY_MS)).toBe(true);
    expect(isEventInEndedTab(cancelledEvent, endMs + TERMINAL_DELAY_MS + 1)).toBe(true);
  });

  test('non-terminal statuses are never in ended tab', () => {
    expect(isEventInEndedTab({ status: 'open', date: endedEvent.date }, endMs + TERMINAL_DELAY_MS + 1)).toBe(false);
    expect(isEventInEndedTab({ status: 'full', date: endedEvent.date }, endMs + TERMINAL_DELAY_MS + 1)).toBe(false);
    expect(isEventInEndedTab(null, endMs)).toBe(false);
  });

  test('normalizeListTab maps legacy ended tab to normal', () => {
    expect(normalizeListTab('ended')).toBe('normal');
    expect(normalizeListTab('normal')).toBe('normal');
    expect(normalizeListTab('calendar')).toBe('calendar');
    expect(normalizeListTab('female')).toBe('female');
    expect(normalizeListTab(null)).toBe('normal');
    expect(normalizeListTab(undefined)).toBe('normal');
    expect(normalizeListTab('')).toBe('normal');
  });
});
