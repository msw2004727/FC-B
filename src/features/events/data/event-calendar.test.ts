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
      expect(parsed?.start).toEqual(new Date(2026, 9, 25, 9, 5, 0));
      expect(parsed?.end).toEqual(new Date(2026, 9, 25, 11, 30, 0));
    }
    expect(parseEventDateRange('2026-10-25 09:05')?.end)
      .toEqual(new Date(2026, 9, 25, 11, 5, 0));
    expect(parseEventDateRange('2026/10/25 23:00~01:00')?.end)
      .toEqual(new Date(2026, 9, 25, 1, 0, 0));
  });

  it('描述與網址逐字照 A', () => {
    const description = buildCalendarDescription({
      type: 'play', current: 3, max: 10, fee: 100, notes: '帶水',
    });
    expect(description).toBe('類型：play\n名額：3/10 人\n費用：$100\n\n注意事項：\n帶水\n\n— SportHub');
    expect(buildCalendarDescription({})).toBe('\n— SportHub');
    expect(toGcalDateStr(new Date(2026, 9, 25, 9, 5, 0))).toBe('20261025T090500');
    expect(buildGoogleCalendarUrl({
      title: 'A B', location: 'X/Y', description: 'a\nb',
      start: new Date(2026, 9, 25, 9, 5, 0),
      end: new Date(2026, 9, 25, 11, 5, 0),
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
