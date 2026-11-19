import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import type { EventDoc } from '@/features/events/data/types';
import { createGuestViewer, createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';
import { AUTH_HINT_KEY } from '@/data/auth-hint';
import type { NextActivityResult } from '../../data/next-activity';
import { NEXT_ACTIVITY_SNAPSHOT_KEY, readNextActivitySnapshot } from '../../data/next-activity-snapshot';
import { writeNextActivitySnapshot } from '../../data/next-activity-snapshot-write';

const resolveNextActivity = vi.hoisted(() => vi.fn());

vi.mock('../../data/next-activity', async () => {
  const actual = await vi.importActual<typeof import('../../data/next-activity')>('../../data/next-activity');
  return { ...actual, resolveNextActivity };
});

import { HomeNextActivity } from './HomeNextActivity';

// 站長 2026-11-19 定案（方案 B）：先畫上次內容＋「更新中」，新資料到了換掉；「加入行事曆」在確認前不能按。
// L-43：登入狀態還原中（authPending）不得先顯示「還沒有報名活動」。

const handlers = {
  onViewAll: vi.fn(),
  onFindActivity: vi.fn(),
  onCreateEvent: vi.fn(),
  onOpenDetail: vi.fn(),
  onAddToCalendar: vi.fn(),
};

function eventOf(id: string, title: string, date = '2099/06/01 19:00~21:00'): EventDoc {
  return { id, title, date, location: '大安運動中心', image: 'https://cdn.example/c.jpg' };
}

function resultOf(event: EventDoc): NextActivityResult {
  return { event, registration: { status: 'confirmed' } as NextActivityResult['registration'], managedRole: '' };
}

function pendingViewer(): ViewerView {
  return { ...createGuestViewer(), authPending: true };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const card = (c: Element): Element | null => c.querySelector('.home-next-card');
const pill = (c: Element): Element | null => c.querySelector('.home-next-head .home-refresh-pill');
const calendarBtn = (c: Element): HTMLButtonElement | null =>
  c.querySelector<HTMLButtonElement>('[data-home-next-action="calendar"]');

beforeEach(() => {
  localStorage.clear();
  // 已登入過的裝置；快照寫入端只在旗標在時才寫（登出後晚到的寫入不寫回）。
  localStorage.setItem(AUTH_HINT_KEY, '1');
});

afterEach(() => {
  cleanup();
  resolveNextActivity.mockReset();
  for (const fn of Object.values(handlers)) fn.mockReset();
  localStorage.clear();
});

describe('首頁我的下一場：登入還原中', () => {
  it('沒有上次內容：顯示骨架，不顯示「還沒有報名活動」', () => {
    localStorage.setItem(AUTH_HINT_KEY, '1');
    const view = render(<HomeNextActivity viewer={pendingViewer()} {...handlers} />);
    expect(view.container.querySelector('.home-next-loading')).not.toBeNull();
    expect(view.queryByText('你目前還沒有報名活動')).toBeNull();
    expect(card(view.container)?.classList.contains('is-empty')).toBe(false);
  });

  it('有上次內容且「上次已登入」旗標在：立刻畫出上次內容，標題旁「更新中」，行事曆鈕不能按', () => {
    localStorage.setItem(AUTH_HINT_KEY, '1');
    writeNextActivitySnapshot('u1', resultOf(eventOf('e1', '上次的活動')));
    const view = render(<HomeNextActivity viewer={pendingViewer()} {...handlers} />);
    expect(view.getByText('上次的活動')).toBeTruthy();
    expect(pill(view.container)?.textContent).toBe('更新中');
    const btn = calendarBtn(view.container);
    expect(btn?.getAttribute('aria-disabled')).toBe('true');
    expect(btn?.classList.contains('is-pending')).toBe(true);
    fireEvent.click(btn as HTMLButtonElement);
    expect(handlers.onAddToCalendar).not.toHaveBeenCalled();
    fireEvent.click(view.container.querySelector('.home-next-primary') as HTMLButtonElement);
    expect(handlers.onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it('沒有「上次已登入」旗標：不畫上次內容，只顯示骨架', () => {
    writeNextActivitySnapshot('u1', resultOf(eventOf('e1', '上次的活動')));
    localStorage.removeItem(AUTH_HINT_KEY);
    const view = render(<HomeNextActivity viewer={pendingViewer()} {...handlers} />);
    expect(view.queryByText('上次的活動')).toBeNull();
    expect(view.container.querySelector('.home-next-loading')).not.toBeNull();
  });

  it('還原結果是訪客：上次內容撤掉，改成訪客的空狀態', () => {
    localStorage.setItem(AUTH_HINT_KEY, '1');
    writeNextActivitySnapshot('u1', resultOf(eventOf('e1', '上次的活動')));
    const view = render(<HomeNextActivity viewer={pendingViewer()} {...handlers} />);
    expect(view.getByText('上次的活動')).toBeTruthy();
    view.rerender(<HomeNextActivity viewer={createGuestViewer()} {...handlers} />);
    expect(view.queryByText('上次的活動')).toBeNull();
    expect(view.getByText('你目前還沒有報名活動')).toBeTruthy();
  });
});

describe('首頁我的下一場：上次內容的活動在頁面開著期間開始', () => {
  it('下一次重新 render 就不再畫上次內容（改顯示骨架）', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.parse('2099-06-01T10:50:00Z'));
      writeNextActivitySnapshot('u1', resultOf(eventOf('e1', '快開始的活動', '2099/06/01 19:00~21:00')));
      resolveNextActivity.mockReturnValue(new Promise(() => undefined));
      const view = render(<HomeNextActivity viewer={createMinimalViewer('u1')} {...handlers} />);
      expect(view.getByText('快開始的活動')).toBeTruthy();
      vi.setSystemTime(Date.parse('2099-06-01T11:01:00Z'));
      view.rerender(<HomeNextActivity viewer={createMinimalViewer('u1')} {...handlers} />);
      expect(view.queryByText('快開始的活動')).toBeNull();
      expect(view.container.querySelector('.home-next-loading')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('首頁我的下一場：uid 延後出現（L-43）', () => {
  it('同一帳號：讀取中沿用上次內容；新資料到了換掉、「更新中」消失、行事曆可按，快照換成新的', async () => {
    localStorage.setItem(AUTH_HINT_KEY, '1');
    writeNextActivitySnapshot('u1', resultOf(eventOf('e1', '上次的活動')));
    const pending = deferred<NextActivityResult | null>();
    resolveNextActivity.mockReturnValue(pending.promise);

    const view = render(<HomeNextActivity viewer={pendingViewer()} {...handlers} />);
    view.rerender(<HomeNextActivity viewer={createMinimalViewer('u1')} {...handlers} />);
    expect(resolveNextActivity).toHaveBeenCalledWith({}, 'u1');
    expect(view.getByText('上次的活動')).toBeTruthy();
    expect(pill(view.container)).not.toBeNull();

    await act(async () => {
      pending.resolve(resultOf(eventOf('e2', '新的活動')));
    });
    await view.findByText('新的活動');
    expect(view.queryByText('上次的活動')).toBeNull();
    expect(pill(view.container)).toBeNull();
    const btn = calendarBtn(view.container);
    expect(btn?.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(btn as HTMLButtonElement);
    expect(handlers.onAddToCalendar).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(readNextActivitySnapshot()?.result.event.id).toBe('e2'));
    expect(readNextActivitySnapshot()?.owner).toBe('u1');
  });

  it('帳號不符：不沿用別人的上次內容，讀取中顯示骨架', () => {
    localStorage.setItem(AUTH_HINT_KEY, '1');
    writeNextActivitySnapshot('someone-else', resultOf(eventOf('e1', '別人的活動')));
    resolveNextActivity.mockReturnValue(new Promise(() => undefined));
    const view = render(<HomeNextActivity viewer={pendingViewer()} {...handlers} />);
    view.rerender(<HomeNextActivity viewer={createMinimalViewer('u1')} {...handlers} />);
    expect(view.queryByText('別人的活動')).toBeNull();
    expect(view.container.querySelector('.home-next-loading')).not.toBeNull();
  });

  it('確定沒有下一場：刪掉快照，轉成空狀態', async () => {
    writeNextActivitySnapshot('u1', resultOf(eventOf('e1', '上次的活動')));
    resolveNextActivity.mockResolvedValue(null);
    const view = render(<HomeNextActivity viewer={createMinimalViewer('u1')} {...handlers} />);
    await view.findByText('你目前還沒有報名活動');
    await waitFor(() => expect(localStorage.getItem(NEXT_ACTIVITY_SNAPSHOT_KEY)).toBeNull());
  });

  it('讀取失敗：保留上次內容與快照，不顯示「更新中」，行事曆仍不能按；沒有上次內容時照舊顯示空狀態', async () => {
    writeNextActivitySnapshot('u1', resultOf(eventOf('e1', '上次的活動')));
    const pending = deferred<NextActivityResult | null>();
    resolveNextActivity.mockReturnValue(pending.promise);
    const view = render(<HomeNextActivity viewer={createMinimalViewer('u1')} {...handlers} />);
    expect(view.getByText('上次的活動')).toBeTruthy();
    await act(async () => {
      pending.reject(new Error('offline'));
    });
    await waitFor(() => expect(pill(view.container)).toBeNull());
    expect(view.getByText('上次的活動')).toBeTruthy();
    expect(calendarBtn(view.container)?.getAttribute('aria-disabled')).toBe('true');
    expect(readNextActivitySnapshot()?.result.event.id).toBe('e1');
    cleanup();

    localStorage.clear();
    localStorage.setItem(AUTH_HINT_KEY, '1');
    resolveNextActivity.mockRejectedValue(new Error('offline'));
    const bare = render(<HomeNextActivity viewer={createMinimalViewer('u1')} {...handlers} />);
    await bare.findByText('你目前還沒有報名活動');
  });

  it('後發先到：換帳號後，前一個帳號晚到的結果不覆蓋畫面也不寫成新帳號的快照', async () => {
    const first = deferred<NextActivityResult | null>();
    const second = deferred<NextActivityResult | null>();
    resolveNextActivity.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<HomeNextActivity viewer={createMinimalViewer('u1')} {...handlers} />);
    view.rerender(<HomeNextActivity viewer={createMinimalViewer('u2')} {...handlers} />);
    await act(async () => {
      second.resolve(resultOf(eventOf('e2', 'u2 的活動')));
    });
    await view.findByText('u2 的活動');
    await act(async () => {
      first.resolve(resultOf(eventOf('e1', 'u1 的活動')));
    });
    expect(view.queryByText('u1 的活動')).toBeNull();
    await waitFor(() => expect(readNextActivitySnapshot()?.owner).toBe('u2'));
    expect(readNextActivitySnapshot()?.result.event.id).toBe('e2');
  });
});
