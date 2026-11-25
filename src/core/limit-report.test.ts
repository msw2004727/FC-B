import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./error-report', () => ({ reportClientError: vi.fn() }));

import { reportClientError } from './error-report';
import { LIMIT_REPORT_KEY, reportLimitOncePerDay } from './limit-report';

// 台北 2026-11-25 10:00、23:59、隔天 00:01
const DAY1 = Date.UTC(2026, 10, 25, 2, 0);
const DAY1_LATE = Date.UTC(2026, 10, 25, 15, 59);
const DAY2 = Date.UTC(2026, 10, 25, 16, 1);

const sent = (): string[][] => vi.mocked(reportClientError).mock.calls.map(([c, e]) => [c, (e as Error).message]);

beforeEach(() => {
  localStorage.clear();
  vi.mocked(reportClientError).mockClear();
  vi.restoreAllMocks();
});

describe('reportLimitOncePerDay', () => {
  it('同一則同一個台北日只送一次；隔天再送一次', () => {
    reportLimitOncePerDay('comment-badge-limit', 'comments exceed 60', DAY1);
    reportLimitOncePerDay('comment-badge-limit', 'comments exceed 60', DAY1);
    reportLimitOncePerDay('comment-badge-limit', 'comments exceed 60', DAY1_LATE);
    expect(sent()).toEqual([['comment-badge-limit', 'comments exceed 60']]);
    reportLimitOncePerDay('comment-badge-limit', 'comments exceed 60', DAY2);
    expect(sent()).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(LIMIT_REPORT_KEY) ?? '{}')).toEqual({ day: '2026/11/26', ids: ['comment-badge-limit|comments exceed 60'] });
  });

  it('不同情境或不同訊息各自算', () => {
    reportLimitOncePerDay('comment-badge-limit', 'comments exceed 60', DAY1);
    reportLimitOncePerDay('comment-badge-limit', 'comments exceed 30', DAY1);
    reportLimitOncePerDay('event-comments-limit', 'comments exceed 60', DAY1);
    reportLimitOncePerDay('event-comments-limit', 'comments exceed 60', DAY1);
    expect(sent()).toEqual([
      ['comment-badge-limit', 'comments exceed 60'],
      ['comment-badge-limit', 'comments exceed 30'],
      ['event-comments-limit', 'comments exceed 60'],
    ]);
  });

  it('儲存的資料壞掉：照送並覆寫成正確格式，之後同日不再送', () => {
    for (const bad of ['{not json', '42', '"x"', JSON.stringify({ day: '2026/11/25', ids: 'x' }), JSON.stringify({ day: '2026/11/25', ids: [1, null] })]) {
      localStorage.setItem(LIMIT_REPORT_KEY, bad);
      vi.mocked(reportClientError).mockClear();
      reportLimitOncePerDay('admin-scheduled-limit', 'scheduled messages exceed 20', DAY1);
      reportLimitOncePerDay('admin-scheduled-limit', 'scheduled messages exceed 20', DAY1);
      expect(sent(), bad).toHaveLength(1);
    }
  });

  it('localStorage 讀寫丟錯：照送（退回頁內去重），不往外拋', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(() => reportLimitOncePerDay('comment-badge-limit', 'comments exceed 80', DAY1)).not.toThrow();
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(() => reportLimitOncePerDay('comment-badge-limit', 'comments exceed 30', DAY1)).not.toThrow();
    expect(sent()).toEqual([['comment-badge-limit', 'comments exceed 80'], ['comment-badge-limit', 'comments exceed 30']]);
  });
});
