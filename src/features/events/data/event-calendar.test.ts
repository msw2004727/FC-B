import { describe, expect, it, vi } from 'vitest';
import {
  addEventToCalendar,
  buildCalendarDescription,
  buildGoogleCalendarUrl,
  parseEventDateRange,
  toGcalDateStr,
} from './event-calendar';

describe('M-091：照 A Google 行事曆', () => {
  it('日期解析保留 A 分隔符、預設兩小時及未自動跨日語意', () => {
    expect(parseEventDateRange(undefined)).toBeNull();
    expect(parseEventDateRange('invalid')).toBeNull();
    for (const separator of ['~', '～', '-']) {
      const parsed = parseEventDateRange(`2026/10/25 9:05${separator}11:30`);
      expect(parsed?.start).toEqual(new Date(Date.parse('2026-10-25T09:05:00+08:00')));
      expect(parsed?.end).toEqual(new Date(Date.parse('2026-10-25T11:30:00+08:00')));
    }
    expect(parseEventDateRange('2026-10-25 09:05')?.end)
      .toEqual(new Date(Date.parse('2026-10-25T11:05:00+08:00')));
    expect(parseEventDateRange('2026/10/25 23:00~01:00')?.end)
      .toEqual(new Date(Date.parse('2026-10-25T01:00:00+08:00')));
  });

  it('描述與網址逐字照 A', () => {
    const description = buildCalendarDescription({
      type: 'play', current: 3, max: 10, fee: 100, notes: '帶水',
    });
    expect(description).toBe('類型：play\n名額：3/10 人\n費用：$100\n\n注意事項：\n帶水\n\n— SportHub');
    expect(buildCalendarDescription({})).toBe('\n— SportHub');
    expect(toGcalDateStr(new Date(Date.parse('2026-10-25T09:05:00+08:00')))).toBe('20261025T090500');
    expect(buildGoogleCalendarUrl({
      title: 'A B', location: 'X/Y', description: 'a\nb',
      start: new Date(Date.parse('2026-10-25T09:05:00+08:00')),
      end: new Date(Date.parse('2026-10-25T11:05:00+08:00')),
    })).toBe(
      'https://calendar.google.com/calendar/render?action=TEMPLATE&text=A%20B'
      + '&dates=20261025T090500/20261025T110500&location=X%2FY&details=a%0Ab&ctz=Asia/Taipei',
    );
  });

  it('一般瀏覽器外開；LIFF 使用 external:true', async () => {
    const openWindow = vi.fn();
    const showToast = vi.fn();
    const signal = new AbortController().signal;
    const event = { date: '2026/10/25 09:00' };
    await addEventToCalendar(event, {
      signal, showToast, openWindow, loadLiff: async () => null,
    });
    expect(openWindow).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith('正在開啟 Google 行事曆…');
    const liffOpen = vi.fn();
    await addEventToCalendar(event, {
      signal,
      showToast,
      loadLiff: async () => ({ isInClient: () => true, openWindow: liffOpen }),
    });
    expect(liffOpen).toHaveBeenCalledWith({
      url: expect.stringContaining('ctz=Asia/Taipei'),
      external: true,
    });
  });

  it('缺資料、日期錯誤及取消後不開窗', async () => {
    const signal = new AbortController().signal;
    const showToast = vi.fn();
    await addEventToCalendar(null, { signal, showToast });
    expect(showToast).toHaveBeenCalledWith('找不到活動資料');
    await addEventToCalendar({}, { signal, showToast });
    expect(showToast).toHaveBeenCalledWith('無法解析活動時間');

    const controller = new AbortController();
    const openWindow = vi.fn();
    await addEventToCalendar({ date: '2026/10/25 09:00' }, {
      signal: controller.signal,
      showToast,
      openWindow,
      loadLiff: async () => {
        controller.abort();
        return null;
      },
    });
    expect(openWindow).not.toHaveBeenCalled();
  });
});

describe('T-054c P12／R8 配對', () => {
  it('P12 例外：只有日期回 null（保留現行）', () => {
    expect(parseEventDateRange('2026/10/19')).toBeNull();
    expect(parseEventDateRange('2026-10-19')).toBeNull();
  });

  it('CAL1 解析後的 dates 與 ctz 在四時區逐字相同', () => {
    const range = parseEventDateRange('2026/10/19 00:30~02:00');
    expect(range).toEqual({
      start: new Date(Date.parse('2026-10-19T00:30:00+08:00')),
      end: new Date(Date.parse('2026-10-19T02:00:00+08:00')),
    });
    expect(buildGoogleCalendarUrl({ title: '', location: '', description: '', ...range! })).toBe(
      'https://calendar.google.com/calendar/render?action=TEMPLATE&text='
      + '&dates=20261019T003000/20261019T020000&location=&details=&ctz=Asia/Taipei',
    );
  });

  it('CAL2 無結束仍 +2h，可自然越過午夜', () => {
    expect(parseEventDateRange('2026/12/31 23:00')).toEqual({
      start: new Date(Date.parse('2026-12-31T23:00:00+08:00')),
      end: new Date(Date.parse('2027-01-01T01:00:00+08:00')),
    });
  });
});
