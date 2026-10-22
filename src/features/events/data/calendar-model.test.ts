import { describe, expect, it } from 'vitest';
import {
  DOM_RECYCLE_THRESHOLD,
  MAX_PAST_MONTHS,
  WEEK_DAY_NAMES,
  addMonthKey,
  buildMonthCells,
  buildSportCounts,
  calendarEventPresentation,
  dateObjToKey,
  formatSportCountSummary,
  getMonthGridShape,
  getSportDef,
  getWindowedMonthKeys,
  groupEventsByDateForMonth,
  minimumMonthKey,
  monthKeyFromDate,
  monthLabel,
  signupStateClass,
  sortCalendarEvents,
  toDateKey,
} from './calendar-model';

describe('calendar-model：照 A（M-071）', () => {
  it('保留 A 常數、日期補零與無效輸入行為', () => {
    expect(MAX_PAST_MONTHS).toBe(3);
    expect(DOM_RECYCLE_THRESHOLD).toBe(5);
    expect(WEEK_DAY_NAMES).toEqual(['一', '二', '三', '四', '五', '六', '日']);
    expect(toDateKey('2026/5/1 19:30~21:00')).toBe('2026-05-01');
    expect(toDateKey(undefined)).toBe('');
    expect(toDateKey('bad')).toBe('');
    expect(toDateKey('x/5/1')).toBe('');
    expect(dateObjToKey(new Date(NaN))).toBe('');
    expect(dateObjToKey(new Date(2026, 4, 1))).toBe('2026-05-01');
  });

  it('月份跨年、標籤、過去三個月邊界', () => {
    const now = new Date(2026, 0, 15);
    expect(monthKeyFromDate(now)).toBe('2026-01');
    expect(addMonthKey('2026-01', -1)).toBe('2025-12');
    expect(addMonthKey('2026-12', 1)).toBe('2027-01');
    expect(monthLabel('2026-01')).toBe('2026年1月');
    expect(minimumMonthKey(now)).toBe('2025-10');
    expect(getWindowedMonthKeys('2025-10', now)).toEqual(['2025-10', '2025-11']);
    expect(getWindowedMonthKeys('2026-01', now)).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  it('週一起始，允許 A 原函式實際產生的四、五、六週', () => {
    expect(getMonthGridShape(2021, 1).weekRows).toBe(4);
    expect(getMonthGridShape(2026, 3).weekRows).toBe(5);
    expect(getMonthGridShape(2026, 2).weekRows).toBe(6);
    const cells = buildMonthCells('2026-04', new Date(2026, 3, 22, 12));
    expect(cells[0]).toMatchObject({ dateKey: '2026-03-30', outside: true, row: 1, col: 1 });
    expect(cells.find((cell) => cell.dateKey === '2026-04-22'))
      .toMatchObject({ today: true, past: false, outside: false });
    expect(cells.find((cell) => cell.dateKey === '2026-04-21')?.past).toBe(true);
    const previous = buildMonthCells('2026-03', new Date(2026, 3, 1));
    expect(previous.find((cell) => cell.dateKey === '2026-04-01')?.today).toBe(false);
  });

  it('依日分組保留已結束與取消活動，排除月份外資料', () => {
    const groups = groupEventsByDateForMonth([
      { id: 'ended', date: '2026/4/22 10:00~11:00', status: 'ended' },
      { id: 'cancelled', date: '2026/4/22 11:00~12:00', status: 'cancelled' },
      { id: 'next', date: '2026/5/1 10:00~11:00' },
      { id: 'invalid', date: 'bad' },
    ], '2026-04');
    expect([...groups.keys()]).toEqual(['2026-04-22']);
    expect(groups.get('2026-04-22')?.map((event) => event.id)).toEqual(['ended', 'cancelled']);
  });

  it('置頂順序優先，其餘依時間排序且不修改原陣列', () => {
    const events = [
      { id: 'late', date: '2026/4/22 20:00~21:00' },
      { id: 'pin2', pinned: true, pinOrder: 2 },
      { id: 'early', date: '2026/4/22 08:00~09:00' },
      { id: 'pin1', pinned: true, pinOrder: 1 },
    ];
    expect(sortCalendarEvents(events).map((event) => event.id))
      .toEqual(['pin1', 'pin2', 'early', 'late']);
    expect(events[0]?.id).toBe('late');
  });

  it('運動統計依 SPORTS 排序，缺少分類歸足球，顏色保留 A 備援', () => {
    const counts = buildSportCounts([
      { sportTag: 'pickleball' }, {}, { sportTag: 'basketball' }, { sportTag: 'football' },
    ]);
    expect(counts).toEqual([
      { sportKey: 'football', count: 2 },
      { sportKey: 'basketball', count: 1 },
      { sportKey: 'pickleball', count: 1 },
    ]);
    expect(formatSportCountSummary(counts)).toBe('足球 x2、籃球 x1、匹克球 x1');
    expect(formatSportCountSummary([])).toBe('');
    expect(getSportDef('football').var).toBe('--sport-football');
    expect(getSportDef('unknown').var).toBe('--sport-other');
    expect(getSportDef('swimming').emoji).toBe('🏊');
  });

  it('報名 class 與活動狀態使用 B effectiveEventStatus', () => {
    expect(signupStateClass({ signedUp: false, onWaitlist: true })).toBe('');
    expect(signupStateClass({ signedUp: true, onWaitlist: false })).toBe('is-signed-up');
    expect(signupStateClass({ signedUp: true, onWaitlist: true })).toBe('is-waitlisted');
    const presentation = calendarEventPresentation({
      id: 'public', title: '活動', date: '2026/4/1 10:00~11:00', sportTag: 'football',
    }, { signedUp: true, onWaitlist: false }, new Date(2026, 3, 22).getTime());
    expect(presentation.status).toBe('ended');
    expect(presentation.label).toBe('已結束活動：活動，足球，10:00');
    expect(presentation.className).toBe('evt-cal-event is-signed-up');
    expect(calendarEventPresentation({
      title: '置頂', pinned: true, status: 'cancelled',
    }, { signedUp: false, onWaitlist: false }, 0).label).toBe('置頂活動：置頂，其他');
  });
});
