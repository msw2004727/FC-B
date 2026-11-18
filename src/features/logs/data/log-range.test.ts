import { describe, expect, it } from 'vitest';

import {
  PAGE_SIZE_OPTIONS,
  formatRangeLabel,
  isLatestRange,
  rangeContaining,
  shiftRange,
} from './log-range';

const NOW_MS = Date.parse('2026-11-19T04:00:00Z');
const WEEK_START = Date.parse('2026-11-15T16:00:00Z');
const WEEK_END = Date.parse('2026-11-22T16:00:00Z');
const DAY_START = Date.parse('2026-11-18T16:00:00Z');
const DAY_END = Date.parse('2026-11-19T16:00:00Z');
const MONTH_START = Date.parse('2026-10-31T16:00:00Z');
const MONTH_END = Date.parse('2026-11-30T16:00:00Z');

describe('日誌中心時間區間', () => {
  describe('rangeContaining', () => {
    it('日：以台北時間切日界', () => {
      const range = rangeContaining('day', NOW_MS);
      expect(range.startMs).toBe(DAY_START);
      expect(range.endMs).toBe(DAY_END);
    });

    it('週：週一為一週開始', () => {
      const range = rangeContaining('week', NOW_MS);
      expect(range.startMs).toBe(WEEK_START);
      expect(range.endMs).toBe(WEEK_END);
    });

    it('月：以台北時間切月界', () => {
      const range = rangeContaining('month', NOW_MS);
      expect(range.startMs).toBe(MONTH_START);
      expect(range.endMs).toBe(MONTH_END);
    });

    it('UTC 16:00 前後屬於不同台北日', () => {
      const before = rangeContaining('day', Date.parse('2026-11-18T15:59:59.999Z'));
      const after = rangeContaining('day', Date.parse('2026-11-18T16:00:00Z'));
      expect(before.startMs).toBe(Date.parse('2026-11-17T16:00:00Z'));
      expect(after.startMs).toBe(Date.parse('2026-11-18T16:00:00Z'));
      expect(before.startMs).not.toBe(after.startMs);
    });

    it('跨月：2026-12-31 的日與月區間', () => {
      const anchor = Date.parse('2026-12-31T04:00:00Z');
      const day = rangeContaining('day', anchor);
      expect(day.startMs).toBe(Date.parse('2026-12-30T16:00:00Z'));
      expect(day.endMs).toBe(Date.parse('2026-12-31T16:00:00Z'));
      const month = rangeContaining('month', anchor);
      expect(month.startMs).toBe(Date.parse('2026-11-30T16:00:00Z'));
      expect(month.endMs).toBe(Date.parse('2026-12-31T16:00:00Z'));
    });

    it('跨年：2027-01-01 的日、週、月區間', () => {
      const anchor = Date.parse('2027-01-01T04:00:00Z');
      const day = rangeContaining('day', anchor);
      expect(day.startMs).toBe(Date.parse('2026-12-31T16:00:00Z'));
      expect(day.endMs).toBe(Date.parse('2027-01-01T16:00:00Z'));

      const week = rangeContaining('week', anchor);
      expect(week.startMs).toBe(Date.parse('2026-12-27T16:00:00Z'));
      expect(week.endMs).toBe(Date.parse('2027-01-03T16:00:00Z'));

      const month = rangeContaining('month', anchor);
      expect(month.startMs).toBe(Date.parse('2026-12-31T16:00:00Z'));
      expect(month.endMs).toBe(Date.parse('2027-01-31T16:00:00Z'));
    });
  });

  describe('shiftRange', () => {
    it('日前後各一天', () => {
      const base = rangeContaining('day', NOW_MS);
      expect(shiftRange(base, -1)).toEqual({
        unit: 'day',
        startMs: Date.parse('2026-11-17T16:00:00Z'),
        endMs: Date.parse('2026-11-18T16:00:00Z'),
      });
      expect(shiftRange(base, 1)).toEqual({
        unit: 'day',
        startMs: Date.parse('2026-11-19T16:00:00Z'),
        endMs: Date.parse('2026-11-20T16:00:00Z'),
      });
    });

    it('週前後各一週', () => {
      const base = rangeContaining('week', NOW_MS);
      expect(shiftRange(base, -1)).toEqual({
        unit: 'week',
        startMs: Date.parse('2026-11-08T16:00:00Z'),
        endMs: WEEK_START,
      });
      expect(shiftRange(base, 1)).toEqual({
        unit: 'week',
        startMs: WEEK_END,
        endMs: Date.parse('2026-11-29T16:00:00Z'),
      });
    });

    it('月前後各一個月，跨年也正確', () => {
      const base = rangeContaining('month', NOW_MS);
      expect(shiftRange(base, -1).startMs).toBe(Date.parse('2026-09-30T16:00:00Z'));
      expect(shiftRange(base, 1).startMs).toBe(MONTH_END);

      const dec = rangeContaining('month', Date.parse('2026-12-15T04:00:00Z'));
      expect(shiftRange(dec, 1).startMs).toBe(Date.parse('2026-12-31T16:00:00Z'));
    });
  });

  describe('isLatestRange', () => {
    it('本週為最新一段', () => {
      expect(isLatestRange(rangeContaining('week', NOW_MS), NOW_MS)).toBe(true);
    });

    it('上一週不是最新一段', () => {
      const prev = shiftRange(rangeContaining('week', NOW_MS), -1);
      expect(isLatestRange(prev, NOW_MS)).toBe(false);
    });

    it('當日為最新一段', () => {
      expect(isLatestRange(rangeContaining('day', NOW_MS), NOW_MS)).toBe(true);
    });
  });

  describe('formatRangeLabel', () => {
    it('日格式', () => {
      expect(formatRangeLabel(rangeContaining('day', NOW_MS))).toBe('2026/11/19');
    });

    it('月格式', () => {
      expect(formatRangeLabel(rangeContaining('month', NOW_MS))).toBe('2026/11');
    });

    it('週格式（未跨年）', () => {
      expect(formatRangeLabel(rangeContaining('week', NOW_MS))).toBe('11/16–11/22');
    });

    it('週跨年時兩端帶年份', () => {
      const range = rangeContaining('week', Date.parse('2026-12-31T04:00:00Z'));
      expect(formatRangeLabel(range)).toBe('2026/12/28–2027/01/03');
    });
  });

  it('每頁筆數選項固定為 10、20、30、無限', () => {
    expect(PAGE_SIZE_OPTIONS).toEqual([10, 20, 30, 'infinite']);
  });
});
