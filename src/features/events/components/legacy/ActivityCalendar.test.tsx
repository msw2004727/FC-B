import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { getViewerEventRegState } from '../../data/viewer-reg-state';
import ActivityCalendar, { CalendarEventCell } from './ActivityCalendar';
import type { ActivityCalendarProps } from './ActivityCalendar';

vi.mock('../../data/viewer-reg-state', () => ({
  getViewerEventRegState: vi.fn(),
}));

const defaults: ActivityCalendarProps = {
  events: [
    {
      id: 'public-football', _docId: 'document-football', title: '足球活動',
      date: '2026/4/22 18:00~20:00', sportTag: 'football',
    },
    {
      id: 'public-basketball', title: '籃球活動',
      date: '2026/4/22 20:00~21:00', sportTag: 'basketball', status: 'ended',
    },
  ],
  viewerUid: 'viewer',
  viewerRegistrations: [],
  onSelectEvent: vi.fn(),
  onJumpToDate: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.parse('2026-04-22T12:00:00+08:00')));
  vi.clearAllMocks();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  vi.stubGlobal('scrollTo', vi.fn());
  vi.mocked(getViewerEventRegState).mockImplementation((event, uid) => ({
    signedUp: uid === 'viewer' && event.id === 'public-football',
    onWaitlist: false,
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function flushLayout(): void {
  act(() => { vi.advanceTimersByTime(300); });
}

describe('ActivityCalendar：照 A（M-071）', () => {
  it('渲染 A 結構、運動摘要與 UID 報名日期，包含已結束活動', () => {
    const { container } = render(<ActivityCalendar {...defaults} />);
    flushLayout();
    expect(container.querySelector('.evt-cal-head')).toBeTruthy();
    expect(container.querySelectorAll('.evt-cal-weekhead-cell')).toHaveLength(7);
    expect(container.querySelectorAll('.evt-cal-month')).toHaveLength(3);
    expect(container.querySelector('#evt-cal-label')?.textContent).toBe('2026年4月');
    const day = container.querySelector('[data-month="2026-04"] [data-date="2026-04-22"]');
    expect(day?.getAttribute('data-event-count')).toBe('2');
    expect(day?.getAttribute('data-user-registered')).toBe('1');
    expect(day?.getAttribute('data-today')).toBe('1');
    expect(day?.querySelector('.evt-cal-user-day-check')?.textContent).toBe('✓');
    expect(day?.querySelector('.evt-cal-sport-summary')?.getAttribute('aria-label'))
      .toBe('足球 x1、籃球 x1，跳到直瀑視圖');
    expect(getViewerEventRegState).toHaveBeenCalledWith(
      defaults.events[0], 'viewer', defaults.viewerRegistrations,
    );
  });

  it('點摘要與日期 Enter 都跳同一天，方向鍵及 Escape 保留 A 行為', () => {
    const { container } = render(
      <>
        <button data-atab="calendar">月曆</button>
        <ActivityCalendar {...defaults} />
      </>,
    );
    flushLayout();
    const day = container.querySelector<HTMLElement>(
      '[data-month="2026-04"] [data-date="2026-04-22"]',
    );
    const summary = day?.querySelector<HTMLElement>('.evt-cal-sport-summary');
    if (!day || !summary) throw new Error('日期格未建立');
    fireEvent.click(summary);
    fireEvent.keyDown(day, { key: 'Enter' });
    expect(defaults.onJumpToDate).toHaveBeenNthCalledWith(1, '2026-04-22');
    expect(defaults.onJumpToDate).toHaveBeenNthCalledWith(2, '2026-04-22');
    day.focus();
    fireEvent.keyDown(day, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('data-date')).toBe('2026-04-23');
    fireEvent.keyDown(day, { key: 'Escape' });
    expect(document.activeElement?.getAttribute('data-atab')).toBe('calendar');
  });

  it('換月到過去三個月停止，重新掛載回今天月份', () => {
    const view = render(<ActivityCalendar {...defaults} />);
    flushLayout();
    for (let index = 0; index < 3; index++) {
      fireEvent.click(screen.getByRole('button', { name: '上個月' }));
      flushLayout();
    }
    expect(view.container.querySelector('#evt-cal-label')?.textContent).toBe('2026年1月');
    expect((screen.getByRole('button', { name: '上個月' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '下個月' }));
    flushLayout();
    expect(view.container.querySelector('#evt-cal-label')?.textContent).toBe('2026年2月');
    view.unmount();
    const next = render(<ActivityCalendar {...defaults} />);
    flushLayout();
    expect(next.container.querySelector('#evt-cal-label')?.textContent).toBe('2026年4月');
  });

  it('props 更新重繪摘要但不重設目前月份', () => {
    const view = render(<ActivityCalendar {...defaults} />);
    flushLayout();
    fireEvent.click(screen.getByRole('button', { name: '下個月' }));
    flushLayout();
    view.rerender(<ActivityCalendar {...defaults} events={defaults.events.slice(0, 1)} />);
    expect(view.container.querySelector('#evt-cal-label')?.textContent).toBe('2026年5月');
    expect(view.container.querySelector('[data-jump-date="2026-04-22"]')?.getAttribute('aria-label'))
      .toBe('足球 x1，跳到直瀑視圖');
    view.rerender(<ActivityCalendar {...defaults} viewerUid={null} />);
    expect(view.container.querySelector('[data-user-registered="1"]')).toBeNull();
  });

  it('活動格保留 public ID、狀態與候補 class', () => {
    vi.mocked(getViewerEventRegState).mockReturnValue({ signedUp: true, onWaitlist: true });
    const { container } = render(
      <CalendarEventCell
        event={{ id: 'public', _docId: 'document', title: '活動', status: 'cancelled' }}
        viewerUid="viewer" viewerRegistrations={[]}
      />,
    );
    const event = container.querySelector('.evt-cal-event');
    expect(event?.getAttribute('data-id')).toBe('public');
    expect(event?.getAttribute('data-status')).toBe('cancelled');
    expect(event?.classList.contains('is-waitlisted')).toBe(true);
  });

  it('卸載清除待執行 rAF 與 guard 計時器', () => {
    const view = render(<ActivityCalendar {...defaults} />);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});


describe('T-054c 月曆台北今天接線', () => {
  it.each(['2026-10-19T00:30:00+08:00', '2026-10-19T23:30:00+08:00'])(
    'CM-a UI：%s 的今日格與過去格', (now) => {
      vi.setSystemTime(new Date(Date.parse(now)));
      const { container } = render(<ActivityCalendar {...defaults} events={[]} viewerUid="uidA" />);
      flushLayout();
      const month = container.querySelector('[data-month="2026-10"]');
      expect(month?.querySelector('[data-date="2026-10-19"]')?.getAttribute('data-today')).toBe('1');
      expect(month?.querySelector('[data-date="2026-10-18"]')?.getAttribute('data-today')).toBe('0');
      expect(container.querySelector('#evt-cal-label')?.textContent).toBe('2026年10月');
    },
  );

  it('CM-b UI：台北跨月時從 11 月開始，退三個月至 8 月即停', () => {
    vi.setSystemTime(new Date(Date.parse('2026-11-01T00:30:00+08:00')));
    const { container } = render(<ActivityCalendar {...defaults} events={[]} viewerUid="uidA" />);
    flushLayout();
    expect(container.querySelector('#evt-cal-label')?.textContent).toBe('2026年11月');
    expect(container.querySelector('[data-month="2026-11"] [data-date="2026-11-01"]')?.getAttribute('data-today')).toBe('1');
    for (let index = 0; index < 3; index++) {
      fireEvent.click(screen.getByRole('button', { name: '上個月' }));
      flushLayout();
    }
    expect(container.querySelector('#evt-cal-label')?.textContent).toBe('2026年8月');
    expect((screen.getByRole('button', { name: '上個月' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
