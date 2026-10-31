import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EVENT_DEFAULT_DURATION_MS, eventEndOfDayMs, parseEventDate, parseEventRangeMs, parseEventStartMs,
} from './event-time';

describe('T-054c event-time（行程層四時區共用字面期望）', () => {
  it('E1 一般起訖與薄起點', () => {
    expect(parseEventDate('2026/10/19 11:00~13:00')).toEqual({
      startMs: Date.parse('2026-10-19T11:00:00+08:00'),
      hasTime: true,
      explicitEndMs: Date.parse('2026-10-19T13:00:00+08:00'),
    });
    expect(parseEventStartMs('2026/10/19 11:00~13:00'))
      .toBe(Date.parse('2026-10-19T11:00:00+08:00'));
    expect(parseEventRangeMs('2026/10/19 11:00~13:00')).toEqual({
      startMs: Date.parse('2026-10-19T11:00:00+08:00'),
      endMs: Date.parse('2026-10-19T13:00:00+08:00'),
    });
  });

  it('E2 跨日仍保留當日結束，不自動加一天', () => {
    expect(parseEventDate('2026/10/19 23:00~01:00')).toEqual({
      startMs: Date.parse('2026-10-19T23:00:00+08:00'), hasTime: true,
      explicitEndMs: Date.parse('2026-10-19T01:00:00+08:00'),
    });
    expect(parseEventRangeMs('2026/10/19 23:00~01:00')).toEqual({
      startMs: Date.parse('2026-10-19T23:00:00+08:00'),
      endMs: Date.parse('2026-10-19T01:00:00+08:00'),
    });
  });

  it('E3 台北凌晨的結束仍在同一台北日', () => {
    expect(parseEventDate('2026/10/25 00:30~02:00')).toEqual({
      startMs: Date.parse('2026-10-25T00:30:00+08:00'), hasTime: true,
      explicitEndMs: Date.parse('2026-10-25T02:00:00+08:00'),
    });
  });

  it.each([
    ['2026-10-19T12:00:00+09:00', '2026-10-19T11:00:00+08:00'],
    ['2026-10-19T03:00:00Z', '2026-10-19T11:00:00+08:00'],
    ['2026-10-19T09:00', '2026-10-19T09:00:00+08:00'],
  ])('E4 ISO／datetime-local：%s', (input, expected) => {
    expect(parseEventDate(input)).toEqual({
      startMs: Date.parse(expected), hasTime: true, explicitEndMs: null,
    });
  });

  it('E5 時間戳、Date、毫秒皆保留絕對瞬間', () => {
    for (const input of [
      Date.parse('2026-10-19T11:00:00+08:00'),
      new Date('2026-10-19T11:00:00+08:00'),
      { toMillis: () => Date.parse('2026-10-19T11:00:00+08:00') },
      { toDate: () => new Date('2026-10-19T11:00:00+08:00') },
      { seconds: Date.parse('2026-10-19T11:00:00+08:00') / 1000 },
    ]) {
      expect(parseEventDate(input)).toEqual({
        startMs: Date.parse('2026-10-19T11:00:00+08:00'), hasTime: true, explicitEndMs: null,
      });
      expect(parseEventRangeMs(input)).toEqual({
        startMs: Date.parse('2026-10-19T11:00:00+08:00'),
        endMs: Date.parse('2026-10-19T13:00:00+08:00'),
      });
    }
    expect(parseEventStartMs(0)).toBe(0);
  });

  it.each(['', null, undefined, 'abc', '2026/02/30 10:00~11:00', '2026/13/01', NaN])
    ('E6 刻意與舊版不同：無效輸入不進位或猜測 %j', (input) => {
      expect(parseEventDate(input)).toBeNull();
      expect(parseEventStartMs(input)).toBeNull();
      expect(parseEventRangeMs(input)).toBeNull();
    });

  it.each([
    ['2026/03/08 02:30~04:00', '2026-03-08T02:30:00+08:00', '2026-03-08T04:00:00+08:00'],
    ['2026/11/01 01:30~03:00', '2026-11-01T01:30:00+08:00', '2026-11-01T03:00:00+08:00'],
    ['2026/01/15 11:00~13:00', '2026-01-15T11:00:00+08:00', '2026-01-15T13:00:00+08:00'],
    ['2026/07/15 11:00~13:00', '2026-07-15T11:00:00+08:00', '2026-07-15T13:00:00+08:00'],
  ])('E7 美西夏令不存在／重複時刻與冬夏季：%s', (input, start, end) => {
    expect(parseEventRangeMs(input)).toEqual({ startMs: Date.parse(start), endMs: Date.parse(end) });
  });

  it.each([
    ['2028/02/29 10:00~12:00', '2028-02-29T10:00:00+08:00', '2028-02-29T12:00:00+08:00'],
    ['2026/02/28 23:30~00:30', '2026-02-28T23:30:00+08:00', '2026-02-28T00:30:00+08:00'],
    ['2026/12/31 23:00~01:00', '2026-12-31T23:00:00+08:00', '2026-12-31T01:00:00+08:00'],
  ])('E8 閏日／月底／跨年：%s', (input, start, end) => {
    expect(parseEventRangeMs(input)).toEqual({ startMs: Date.parse(start), endMs: Date.parse(end) });
  });

  it('E9 只有日期／缺結束／無效結束保留各種後備事實', () => {
    expect(EVENT_DEFAULT_DURATION_MS).toBe(7_200_000);
    expect(parseEventDate('2026/10/19')).toEqual({
      startMs: Date.parse('2026-10-19T00:00:00+08:00'), hasTime: false, explicitEndMs: null,
    });
    expect(parseEventRangeMs('2026/10/19')).toEqual({
      startMs: Date.parse('2026-10-19T00:00:00+08:00'),
      endMs: Date.parse('2026-10-19T02:00:00+08:00'),
    });
    expect(eventEndOfDayMs(Date.parse('2026-10-19T00:00:00+08:00')))
      .toBe(Date.parse('2026-10-19T23:59:59+08:00'));
    for (const input of ['2026/10/19 11:00', '2026/10/19 11:00~', '2026/10/19 11:00~xx', '2026/10/19 11:00~25:00']) {
      expect(parseEventDate(input)).toEqual({
        startMs: Date.parse('2026-10-19T11:00:00+08:00'), hasTime: true, explicitEndMs: null,
      });
      expect(parseEventRangeMs(input)).toEqual({
        startMs: Date.parse('2026-10-19T11:00:00+08:00'),
        endMs: Date.parse('2026-10-19T13:00:00+08:00'),
      });
    }
  });

  it('E10 元測試：本地解析突變體只在 UTC+8 等於字面期望', () => {
    // 只有元測試刻意使用本地建構；不切換 process.env.TZ。
    const cases = [
      { local: new Date(2026, 9, 19, 11), expected: Date.parse('2026-10-19T11:00:00+08:00') },
      { local: new Date(2026, 2, 8, 2, 30), expected: Date.parse('2026-03-08T02:30:00+08:00') },
      { local: new Date(2026, 10, 1, 1, 30), expected: Date.parse('2026-11-01T01:30:00+08:00') },
    ];
    for (const entry of cases) {
      if (entry.local.getTimezoneOffset() === -480) expect(entry.local.getTime()).toBe(entry.expected);
      else expect(entry.local.getTime()).not.toBe(entry.expected);
    }
  });

  it('E11 靜態：共用來源不重寫日期正規式、不跨 feature import', () => {
    const source = readFileSync(resolve(__dirname, 'event-time.ts'), 'utf8');
    expect(source).not.toMatch(/new\s+RegExp|\\d|\[0-9\]/);
    const imports = source.match(/from\s+['"][^'"]+['"]/g);
    expect(imports).toEqual(["from './taipei-time'"]);
  });
});
