import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import type { EventDoc } from '@/features/events/data/types';
import {
  createGuestViewer,
  createMinimalViewer,
  type ViewerView,
} from '@/features/profile/data/viewer';
import { AUTH_HINT_KEY } from '@/data/auth-hint';
import type { NextActivityResult } from '../../data/next-activity';
import { writeNextActivitySnapshot } from '../../data/next-activity-snapshot-write';

// 批次 A §4.4（H-1～H-4）：HomeNextActivity 收到 activeEvents 三態時的行為。
// 用部分替身：保留 parseEventDateRange／registrationStatusMeta 等匯出，只替換 resolveNextActivity 與 loadNextActivityLoad。

const resolveNextActivity = vi.hoisted(() => vi.fn());
const loadNextActivityLoad = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('../../data/next-activity', async () => {
  const actual = await vi.importActual<typeof import('../../data/next-activity')>('../../data/next-activity');
  return { ...actual, resolveNextActivity, loadNextActivityLoad };
});

import { HomeNextActivity } from './HomeNextActivity';

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
  return {
    event,
    registration: { status: 'confirmed' } as NextActivityResult['registration'],
    managedRole: '',
  };
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

const pill = (c: Element): Element | null => c.querySelector('.home-next-head .home-refresh-pill');
const loadingEl = (c: Element): Element | null => c.querySelector('.home-next-loading');

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(AUTH_HINT_KEY, '1');
});

afterEach(() => {
  cleanup();
  resolveNextActivity.mockReset();
  loadNextActivityLoad.mockReset();
  loadNextActivityLoad.mockResolvedValue({});
  for (const fn of Object.values(handlers)) fn.mockReset();
  localStorage.clear();
});

describe("首頁我的下一場：activeEvents 三態（'pending'／陣列／undefined）", () => {
  it("'pending' 時不呼叫 resolveNextActivity，顯示載入中，且已預載讀取段", () => {
    resolveNextActivity.mockReturnValue(new Promise(() => undefined));
    const view = render(
      <HomeNextActivity viewer={createMinimalViewer('u1')} activeEvents="pending" {...handlers} />,
    );
    expect(resolveNextActivity).not.toHaveBeenCalled();
    expect(loadingEl(view.container)).not.toBeNull();
    expect(loadNextActivityLoad).toHaveBeenCalled();
  });

  it("'pending' 有上次內容時顯示上次內容＋「更新中」，且不呼叫 resolveNextActivity", () => {
    writeNextActivitySnapshot('u1', resultOf(eventOf('e1', '上次的活動')));
    resolveNextActivity.mockReturnValue(new Promise(() => undefined));
    const view = render(
      <HomeNextActivity viewer={createMinimalViewer('u1')} activeEvents="pending" {...handlers} />,
    );
    expect(view.getByText('上次的活動')).toBeTruthy();
    expect(pill(view.container)?.textContent).toBe('更新中');
    expect(resolveNextActivity).not.toHaveBeenCalled();
  });

  it('未傳 activeEvents 時呼叫形狀仍是 resolveNextActivity({}, uid)（H-4）', () => {
    resolveNextActivity.mockReturnValue(new Promise(() => undefined));
    render(<HomeNextActivity viewer={createMinimalViewer('u1')} {...handlers} />);
    expect(resolveNextActivity).toHaveBeenCalledTimes(1);
    expect(resolveNextActivity).toHaveBeenCalledWith({}, 'u1');
  });

  it('activeEvents 明確傳 undefined 時呼叫 resolveNextActivity({}, uid)', () => {
    resolveNextActivity.mockReturnValue(new Promise(() => undefined));
    render(
      <HomeNextActivity viewer={createMinimalViewer('u1')} activeEvents={undefined} {...handlers} />,
    );
    expect(resolveNextActivity).toHaveBeenCalledTimes(1);
    expect(resolveNextActivity).toHaveBeenCalledWith({}, 'u1');
  });

  it('activeEvents 是陣列時呼叫 resolveNextActivity({ activeEvents: list }, uid)', () => {
    resolveNextActivity.mockReturnValue(new Promise(() => undefined));
    const list = [eventOf('e1', '活動')];
    render(
      <HomeNextActivity viewer={createMinimalViewer('u1')} activeEvents={list} {...handlers} />,
    );
    expect(resolveNextActivity).toHaveBeenCalledTimes(1);
    expect(resolveNextActivity).toHaveBeenCalledWith({ activeEvents: list }, 'u1');
  });

  it("'pending' → 陣列 時只呼叫一次且 deps 帶 activeEvents", async () => {
    const pending = deferred<NextActivityResult | null>();
    resolveNextActivity.mockReturnValue(pending.promise);
    const list = [eventOf('e1', '活動')];
    const view = render(
      <HomeNextActivity viewer={createMinimalViewer('u1')} activeEvents="pending" {...handlers} />,
    );
    expect(resolveNextActivity).not.toHaveBeenCalled();
    view.rerender(
      <HomeNextActivity viewer={createMinimalViewer('u1')} activeEvents={list} {...handlers} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolveNextActivity).toHaveBeenCalledTimes(1);
    expect(resolveNextActivity).toHaveBeenCalledWith({ activeEvents: list }, 'u1');
  });

  it("'pending' → undefined 時以 ({}, uid) 呼叫", async () => {
    resolveNextActivity.mockReturnValue(new Promise(() => undefined));
    const view = render(
      <HomeNextActivity viewer={createMinimalViewer('u1')} activeEvents="pending" {...handlers} />,
    );
    expect(resolveNextActivity).not.toHaveBeenCalled();
    view.rerender(
      <HomeNextActivity viewer={createMinimalViewer('u1')} activeEvents={undefined} {...handlers} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolveNextActivity).toHaveBeenCalledTimes(1);
    expect(resolveNextActivity).toHaveBeenCalledWith({}, 'u1');
  });

  it('清單從一份陣列換成另一份時不重跑（同一次開頁內）', async () => {
    resolveNextActivity.mockReturnValue(new Promise(() => undefined));
    const list1 = [eventOf('e1', '活動一')];
    const list2 = [eventOf('e2', '活動二')];
    const view = render(
      <HomeNextActivity viewer={createMinimalViewer('u1')} activeEvents={list1} {...handlers} />,
    );
    expect(resolveNextActivity).toHaveBeenCalledTimes(1);
    expect(resolveNextActivity).toHaveBeenNthCalledWith(1, { activeEvents: list1 }, 'u1');
    view.rerender(
      <HomeNextActivity viewer={createMinimalViewer('u1')} activeEvents={list2} {...handlers} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolveNextActivity).toHaveBeenCalledTimes(1);
    expect(resolveNextActivity).toHaveBeenNthCalledWith(1, { activeEvents: list1 }, 'u1');
  });

  it("uid 延後出現才讀（L-43）：pendingViewer + 'pending' 不呼叫；uid 到位但仍在 pending 也不呼叫；activeReady 後才呼叫", async () => {
    resolveNextActivity.mockReturnValue(new Promise(() => undefined));
    const view = render(
      <HomeNextActivity viewer={pendingViewer()} activeEvents="pending" {...handlers} />,
    );
    expect(resolveNextActivity).not.toHaveBeenCalled();

    view.rerender(
      <HomeNextActivity viewer={createMinimalViewer('u1')} activeEvents="pending" {...handlers} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolveNextActivity).not.toHaveBeenCalled();

    view.rerender(
      <HomeNextActivity viewer={createMinimalViewer('u1')} activeEvents={[]} {...handlers} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolveNextActivity).toHaveBeenCalledTimes(1);
    expect(resolveNextActivity).toHaveBeenCalledWith({ activeEvents: [] }, 'u1');
  });
});
