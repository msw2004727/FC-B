import { describe, expect, it } from 'vitest';
import { formatFee, formatTaipeiDateTime, fromDatetimeLocalValue, isMinorAt, taipeiMs, toDatetimeLocalValue, venueMapUrl } from './format';

describe('賽事顯示格式', () => {
  it('datetime-local 以台北牆鐘往返', () => {
    const ms = taipeiMs(2026, 12, 1, 9, 0);
    expect(toDatetimeLocalValue(ms)).toBe('2026-12-01T09:00');
    expect(fromDatetimeLocalValue('2026-12-01T09:00')).toBe(ms);
    expect(formatTaipeiDateTime(ms)).toBe('2026/12/01 09:00');
  });

  it('報名費：有金額加千分位，0 顯示免費', () => {
    expect(formatFee(1500, '免費')).toBe('NT$1,500');
    expect(formatFee(0, '免費')).toBe('免費');
    expect(formatFee(-3, '免費')).toBe('免費');
  });

  it('有座標用地圖座標，否則用名稱與地址', () => {
    expect(venueMapUrl({ name: '示範球場', lat: 25.04, lng: 121.56 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=25.04%2C121.56',
    );
    expect(venueMapUrl({ name: '示範球場', address: '示範路 1 號' })).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('示範球場 示範路 1 號')}`,
    );
  });

  it('未滿 18 歲（台北日曆）算未成年', () => {
    const at = taipeiMs(2027, 1, 9, 8, 0);
    expect(isMinorAt('2016-05-20', at)).toBe(true);
    expect(isMinorAt('1990-05-20', at)).toBe(false);
    expect(isMinorAt('bad', at)).toBe(null);
  });

  it('一位數月日、閏日與不存在的日期', () => {
    const before = taipeiMs(2034, 2, 28, 12, 0);
    const onDay = taipeiMs(2034, 3, 1, 0, 0);
    expect(isMinorAt('2016-2-29', before)).toBe(true);
    expect(isMinorAt('2016/02/29', before)).toBe(true);
    expect(isMinorAt('2016-02-29', onDay)).toBe(false);
    expect(isMinorAt('2015-02-29', before)).toBe(null);
    expect(isMinorAt('2016-02-31', before)).toBe(null);
    expect(fromDatetimeLocalValue('2026-02-31T09:00')).toBeNull();
    expect(fromDatetimeLocalValue('2024-02-29T09:00')).toBe(taipeiMs(2024, 2, 29, 9, 0));
  });
});
