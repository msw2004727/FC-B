import { describe, expect, it } from 'vitest';
import { readTimeoutRule } from './timeout-rule';

describe('readTimeoutRule', () => {
  it('缺值用預設：不限次數、停錶、每半場 1 次 60 秒', () => {
    expect(readTimeoutRule(undefined)).toEqual({
      enabled: false, per: 'half', count: 1, seconds: 60, stopsClock: true,
    });
    expect(readTimeoutRule(null)).toEqual(readTimeoutRule(undefined));
    expect(readTimeoutRule('timeout')).toEqual(readTimeoutRule(undefined));
  });

  it('合法欄位會蓋過預設', () => {
    expect(readTimeoutRule({
      enabled: true, per: 'match', count: 0, seconds: 180, stopsClock: false, extraTimeCount: 2, note: '忽略',
    })).toEqual({
      enabled: true, per: 'match', count: 0, seconds: 180, stopsClock: false,
    });
  });

  it('不合法的欄位各自回到預設', () => {
    expect(readTimeoutRule({
      enabled: 'yes', per: 'game', count: 6, seconds: 29, stopsClock: 1,
    })).toEqual({
      enabled: false, per: 'half', count: 1, seconds: 60, stopsClock: true,
    });
    expect(readTimeoutRule({ count: 1.5, seconds: 30, per: 'half' }).count).toBe(1);
    expect(readTimeoutRule({ seconds: 30 }).seconds).toBe(30);
    expect(readTimeoutRule({ count: 5 }).count).toBe(5);
  });
});
