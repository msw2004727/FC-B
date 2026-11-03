import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGuestViewer,
  createMinimalViewer,
  type ViewerView,
} from '@/features/profile/data/viewer';
import type { EventDoc } from '../data/types';
import MyActivitiesPage from './MyActivitiesPage';

// 測試同步更新（R-QA-005）：列表改用 A 的有效狀態（開始時間已過＝已結束），固定現在時間在測試資料日期之前。
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-01T00:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
});

const routeMock = vi.fn();
let mockViewer: ViewerView = createGuestViewer();
let mockActiveEvents: SwipeEventDoc[] = [];
let mockTerminalEvents: EventDoc[] = [];
const ensureTerminalMock = vi.fn(async () => ['events']);
const loadStaticMock = vi.fn(async () => ['events']);
const loadMoreMock = vi.fn(async () => 0);
const toastShowMock = vi.fn();

const testDict: Record<string, string> = {
  'events.manage.loadError': '無法載入活動，請重試。',
  'events.manage.retry': '重試',
  'events.manage.permissionDenied': '權限不足',
  'events.manage.permissionDeniedBody': '您沒有權限存取活動管理頁面。',
  'events.manage.lifecycle.deleteInLegacy': '新版暫不提供刪除活動，要前往舊版刪除嗎？',
  'ui.userTag.unknown': '用戶',
  'ui.userTag.role.user': '一般用戶',
  'ui.userTag.openProfile': '開啟 {name} 的個人頁',
};

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string, params?: Record<string, unknown>) => {
    let tmpl = testDict[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        tmpl = tmpl.replace(`{${k}}`, String(v));
      }
    }
    return tmpl;
  },
}));

vi.mock('preact-iso', () => ({
  useLocation: () => ({
    url: 'https://toosterx.invalid/my-activities',
    path: '/my-activities',
    query: {},
    route: routeMock,
  }),
}));

vi.mock('@/features/profile/data/viewer', async () => {
  const actual = await vi.importActual<typeof import('@/features/profile/data/viewer')>(
    '@/features/profile/data/viewer',
  );
  return {
    ...actual,
    useViewer: () => mockViewer,
  };
});

vi.mock('@/data/user-roles', () => ({
  useUserRoles: () => ({}),
  getCachedUserLevel: () => undefined,
}));

vi.mock('@/ui/Toast', async () => {
  const actual = await vi.importActual<typeof import('@/ui/Toast')>('@/ui/Toast');
  return {
    ...actual,
    toast: { ...actual.toast, show: (...args: unknown[]) => toastShowMock(...args) },
  };
});

vi.mock('../data/events-repo', () => ({
  getEventsRepo: () => ({
    loadEventsStatic: loadStaticMock,
    ensureTerminalEventsLoaded: ensureTerminalMock,
    loadMoreTerminalEvents: loadMoreMock,
    getSnapshot: () => ({
      active: [...mockActiveEvents],
      terminal: [...mockTerminalEvents],
    }),
  }),
}));

vi.mock('../components/EventFormModal', () => ({
  EventFormModal: ({
    open,
    mode,
    existing,
  }: {
    open: boolean;
    mode: string;
    existing?: EventDoc;
  }) =>
    open ? (
      <div data-testid="event-form-modal">
        modal:{mode}:{existing?.id ?? 'new'}
      </div>
    ) : null,
}));

function coachViewer(extra: string[] = []): ViewerView {
  const perms = ['activity.manage.entry', ...extra];
  return {
    ...createMinimalViewer('u-coach'),
    role: 'coach',
    roleLevel: 1,
    hasPermission: (code) => perms.includes(code),
    permissionSources: {
      rolePermissions: perms,
      userGrants: [],
      customRoles: [],
    },
  };
}

function adminViewer(): ViewerView {
  const perms = ['activity.manage.entry', 'event.edit_all'];
  return {
    ...createMinimalViewer('u-admin'),
    role: 'admin',
    roleLevel: 4,
    hasPermission: (code) => perms.includes(code),
    permissionSources: {
      rolePermissions: perms,
      userGrants: [],
      customRoles: [],
    },
  };
}

type SwipeEventDoc = EventDoc & {
  regOpenTime?: string;
  max?: number;
  current?: number;
};

interface TouchPoint {
  clientX: number;
  clientY: number;
}

function dispatchTouch(list: HTMLElement, type: string, dx = 0, dy = 0): Event {
  const point = { clientX: 200 + dx, clientY: 100 + dy };
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    touches: TouchPoint[];
    changedTouches: TouchPoint[];
  };
  event.touches = type === 'touchend' ? [] : [point];
  event.changedTouches = [point];
  fireEvent(list, event);
  return event;
}

function dragList(list: HTMLElement, dx: number, dy = 0, elapsedMs = 100): void {
  dispatchTouch(list, 'touchstart');
  vi.setSystemTime(Date.now() + elapsedMs);
  dispatchTouch(list, 'touchmove', dx, dy);
  dispatchTouch(list, 'touchend', dx, dy);
}

function finishSwipe(list: HTMLElement): void {
  // 分別結束滑出與滑入，不靠任意 sleep；fallback 另有整合案例。
  fireEvent(list, new Event('transitionend', { bubbles: true }));
  fireEvent(list, new Event('transitionend', { bubbles: true }));
}

function swipeList(list: HTMLElement, dx: number): void {
  dragList(list, dx);
  finishSwipe(list);
}

function getTab(container: Element, key: string): HTMLElement {
  const tab = container.querySelector<HTMLElement>(
    `#my-activity-tabs .tab[data-afilter="${key}"]`,
  );
  if (!tab) throw new Error(`Missing activity tab: ${key}`);
  return tab;
}

function activeTabKey(container: Element): string | undefined {
  return container.querySelector<HTMLElement>('#my-activity-tabs .tab.active')?.dataset.afilter;
}

function listTitles(list: HTMLElement): string[] {
  return Array.from(list.querySelectorAll('.msg-manage-title'), (el) => el.textContent ?? '');
}

async function waitForSwipeList(container: Element): Promise<HTMLElement> {
  return waitFor(() => {
    const list = container.querySelector<HTMLElement>('#my-activity-list');
    if (!list) throw new Error('Missing activity list');
    expect(list.dataset.swipeBound).toBe('1');
    // jsdom 沒有版面計算，固定為簡報的手機寬度。
    Object.defineProperty(list, 'offsetWidth', { configurable: true, value: 390 });
    return list;
  });
}

function expectSwipeStylesReset(list: HTMLElement): void {
  expect(list.style.transition).toBe('');
  expect(list.style.transform).toBe('');
  expect(list.style.opacity).toBe('');
  expect(list.style.willChange).toBe('');
}

describe('MyActivitiesPage', () => {
  beforeEach(() => {
    routeMock.mockReset();
    ensureTerminalMock.mockReset().mockResolvedValue(['events']);
    loadStaticMock.mockClear();
    loadMoreMock.mockClear();
    toastShowMock.mockClear();
    mockActiveEvents = [];
    mockTerminalEvents = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('shows permission denied EmptyState when viewer has no manage entry permission', () => {
    mockViewer = createGuestViewer();
    render(<MyActivitiesPage />);
    expect(screen.getByText('權限不足')).toBeTruthy();
    expect(ensureTerminalMock).not.toHaveBeenCalled();
  });

  it('renders legacy A main ids, classes, and structure', async () => {
    mockViewer = coachViewer();
    mockActiveEvents = [
      {
        id: 'ev-open',
        title: '結構測試活動',
        status: 'open',
        creatorUid: 'u-coach',
        creator: '教練A',
        location: '大安森林公園',
        date: '2026/05/10 14:00~16:00',
      },
    ];
    const { container } = render(<MyActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByText('結構測試活動')).toBeTruthy();
    });

    expect(container.querySelector('.legacy-ui #page-my-activities.page.active')).toBeTruthy();
    expect(container.querySelector('#my-activity-tabs.tab-bar')).toBeTruthy();
    expect(container.querySelector('#my-activity-list.card-list')).toBeTruthy();
    expect(container.querySelector('#my-activity-creator-wrap')).toBeTruthy();
    expect(container.querySelector('#my-activity-create-btn')).toBeTruthy();
    expect(container.querySelector('#my-activity-detail-modal')).toBeTruthy();
    expect(container.querySelector('.msg-manage-card .msg-manage-title')).toBeTruthy();
    expect(container.querySelector('.banner-manage-status.status-open')?.textContent).toBe('報名中');
  });

  it('switches tabs and filters events by status matching legacy A', async () => {
    mockViewer = coachViewer();
    mockActiveEvents = [
      {
        id: 'ev-open',
        title: '週六足球開踢',
        status: 'open',
        creatorUid: 'u-coach',
        creator: '教練A',
        location: '大安森林公園',
        date: '2026/05/10 14:00~16:00',
      },
    ];
    mockTerminalEvents = [
      {
        id: 'ev-ended',
        title: '上週籃球賽',
        status: 'ended',
        creatorUid: 'u-coach',
        creator: '教練A',
        location: '信義運動中心',
        date: '2026/05/01 14:00~16:00',
      },
    ];

    const { container } = render(<MyActivitiesPage />);

    await waitFor(() => {
      expect(screen.getByText('週六足球開踢')).toBeTruthy();
      expect(screen.getByText('上週籃球賽')).toBeTruthy();
    });

    const endedTab = container.querySelector('#my-activity-tabs .tab[data-afilter="ended"]') as HTMLElement;
    fireEvent.click(endedTab);

    await waitFor(() => {
      expect(endedTab.classList.contains('active')).toBe(true);
      expect(screen.getByText('上週籃球賽')).toBeTruthy();
      expect(screen.queryByText('週六足球開踢')).toBeNull();
    });

    const fullTab = container.querySelector('#my-activity-tabs .tab[data-afilter="full"]') as HTMLElement;
    fireEvent.click(fullTab);

    await waitFor(() => {
      expect(screen.getByText('此分類沒有活動')).toBeTruthy();
    });
  });

  it('renders Edit button only when canEditOwnActivityBasic is true and opens EventFormModal on click', async () => {
    mockViewer = {
      ...createMinimalViewer('u-user'),
      role: 'user',
      roleLevel: 0,
      capabilities: ['user.activity.own_manage_entry'],
    };
    mockActiveEvents = [
      {
        id: 'ev-1',
        title: '一般用戶的活動',
        status: 'open',
        creatorUid: 'u-user',
        location: '市民球場',
        date: '2026/05/12 10:00~12:00',
      },
    ];

    const { unmount } = render(<MyActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByText('一般用戶的活動')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: '編輯' })).toBeNull();
    unmount();

    mockViewer = {
      ...createMinimalViewer('u-user'),
      role: 'user',
      roleLevel: 0,
      capabilities: ['user.activity.own_manage_entry', 'user.activity.own_edit_basic'],
    };
    render(<MyActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '編輯' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(screen.getByTestId('event-form-modal').textContent).toBe('modal:edit:ev-1');
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('navigates to /events/:id when clicking card body (not buttons)', async () => {
    mockViewer = coachViewer();
    mockActiveEvents = [
      {
        id: 'ev-detail-123',
        title: '點擊卡片進詳情',
        status: 'open',
        creatorUid: 'u-coach',
        location: '百齡球場',
        date: '2026/05/20 18:00~20:00',
      },
    ];

    render(<MyActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByText('點擊卡片進詳情')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('點擊卡片進詳情'));
    expect(routeMock).toHaveBeenCalledWith('/events/ev-detail-123');
  });

  it('opens activity stats modal and displays accurate counts', async () => {
    mockViewer = coachViewer();
    mockActiveEvents = [
      {
        id: 'ev-1',
        title: '報名中1',
        status: 'open',
        creatorUid: 'u-coach',
        date: '2026/05/10 14:00~16:00',
      },
      {
        id: 'ev-2',
        title: '即將開放1',
        status: 'upcoming',
        regOpenTime: '2026-05-05T10:00:00',
        creatorUid: 'u-coach',
        date: '2026/05/12 14:00~16:00',
      } as EventDoc,
    ];
    mockTerminalEvents = [
      {
        id: 'ev-3',
        title: '已取消1',
        status: 'cancelled',
        creatorUid: 'u-coach',
        date: '2026/05/08 14:00~16:00',
      },
    ];

    render(<MyActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByText('報名中1')).toBeTruthy();
    });

    const statsBtn = screen.getByTitle('活動統計');
    fireEvent.click(statsBtn);

    expect(await screen.findByText('統計範圍：我管理的活動')).toBeTruthy();
    expect(screen.getByText('總活動')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    await waitFor(() => {
      expect(screen.queryByText('統計範圍：我管理的活動')).toBeNull();
    });
  });

  it('filters by creator using UID when admin selects from creator dropdown and clears filter', async () => {
    mockViewer = adminViewer();
    mockActiveEvents = [
      {
        id: 'ev-a',
        title: '教練甲的活動',
        status: 'open',
        creatorUid: 'uid-alpha',
        creator: '教練甲',
        date: '2026/05/10 14:00~16:00',
      },
      {
        id: 'ev-b',
        title: '教練乙的活動',
        status: 'open',
        creatorUid: 'uid-beta',
        creator: '教練乙',
        date: '2026/05/11 14:00~16:00',
      },
    ];

    const { container } = render(<MyActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByText('教練甲的活動')).toBeTruthy();
      expect(screen.getByText('教練乙的活動')).toBeTruthy();
    });

    const wrap = container.querySelector('#my-activity-creator-wrap') as HTMLElement;
    expect(wrap.style.display).not.toBe('none');

    const input = container.querySelector('#my-activity-creator-input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '教練甲' } });

    const ddItem = await waitFor(() => {
      const el = container.querySelector('#my-activity-creator-dropdown.open .ce-delegate-item');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(ddItem.textContent).toContain('教練甲');
    expect(ddItem.textContent).toContain('1 場');

    fireEvent.click(ddItem);

    await waitFor(() => {
      expect(screen.getByText('教練甲的活動')).toBeTruthy();
      expect(screen.queryByText('教練乙的活動')).toBeNull();
    });

    const clearBtn = container.querySelector('#my-activity-creator-clear') as HTMLElement;
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(screen.getByText('教練甲的活動')).toBeTruthy();
      expect(screen.getByText('教練乙的活動')).toBeTruthy();
    });
  });

  it('shows pin and external event buttons and triggers unavailable toast on click', async () => {
    mockViewer = adminViewer();
    mockActiveEvents = [
      {
        id: 'ev-ext',
        title: '外部測試活動',
        type: 'external',
        externalUrl: 'https://example.com',
        status: 'open',
        creatorUid: 'u-admin',
        creator: '管理員',
        date: '2026/05/10 14:00~16:00',
      },
    ];

    render(<MyActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByText('外部測試活動')).toBeTruthy();
      expect(screen.getByText('🔗 外部活動連結')).toBeTruthy();
    });

    const pinBtn = screen.getByRole('button', { name: '置頂' });
    const editBtn = screen.getByRole('button', { name: '編輯' });
    const shareBtn = screen.getByRole('button', { name: '分享' });

    fireEvent.click(pinBtn);
    expect(toastShowMock).toHaveBeenCalledWith({ message: '此功能尚未開放，請先使用舊版' });

    toastShowMock.mockClear();
    fireEvent.click(editBtn);
    expect(toastShowMock).toHaveBeenCalledWith({ message: '此功能尚未開放，請先使用舊版' });

    toastShowMock.mockClear();
    fireEvent.click(shareBtn);
    expect(toastShowMock).toHaveBeenCalledWith({ message: '此功能尚未開放，請先使用舊版' });
  });

  it('paginates events and loads more when clicking 查看更多', async () => {
    mockViewer = coachViewer();
    mockActiveEvents = Array.from({ length: 12 }, (_, idx) => ({
      id: `ev-${idx + 1}`,
      title: `分頁活動_${idx + 1}`,
      status: 'open',
      creatorUid: 'u-coach',
      date: `2026/05/${String(10 + idx).padStart(2, '0')} 14:00~16:00`,
    }));

    render(<MyActivitiesPage />);
    await waitFor(() => {
      expect(screen.getByText('分頁活動_1')).toBeTruthy();
    });
    expect(screen.getByText('已顯示 10 / 12')).toBeTruthy();
    expect(screen.queryByText('分頁活動_12')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '查看更多' }));
    await waitFor(() => {
      expect(screen.getByText('分頁活動_12')).toBeTruthy();
    });
  });

  describe('T-075a swipe integration (real useSwipeTabs)', () => {
    beforeEach(() => {
      mockViewer = coachViewer();
      mockActiveEvents = [
        {
          id: 'swipe-upcoming', title: '滑動待開放', status: 'upcoming',
          regOpenTime: '2026-05-05T10:00:00', creatorUid: 'u-coach',
          date: '2026/05/10 14:00~16:00',
        },
        {
          id: 'swipe-open', title: '滑動報名中', status: 'open',
          creatorUid: 'u-coach', date: '2026/05/11 14:00~16:00',
        },
        {
          id: 'swipe-full', title: '滑動已額滿', status: 'full', max: 10, current: 10,
          creatorUid: 'u-coach', date: '2026/05/12 14:00~16:00',
        },
      ] satisfies SwipeEventDoc[];
      mockTerminalEvents = [
        {
          id: 'swipe-ended', title: '滑動已結束', status: 'ended',
          creatorUid: 'u-coach', date: '2026/04/30 14:00~16:00',
        },
        {
          id: 'swipe-cancelled', title: '滑動已取消', status: 'cancelled',
          creatorUid: 'u-coach', date: '2026/05/13 14:00~16:00',
        },
      ];
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('swipes both ways through all six tabs with the same lists as clicking, without reloading cached history', async () => {
      const { container } = render(<MyActivitiesPage />);
      await screen.findByText('滑動已結束');
      const list = await waitForSwipeList(container);
      const tabs = ['all', 'upcoming', 'open', 'full', 'ended', 'cancelled'] as const;
      const expected = {
        all: ['滑動待開放', '滑動報名中', '滑動已額滿', '滑動已結束', '滑動已取消'],
        upcoming: ['滑動待開放'], open: ['滑動報名中'], full: ['滑動已額滿'],
        ended: ['滑動已結束'], cancelled: ['滑動已取消'],
      };
      for (const tab of tabs) {
        fireEvent.click(getTab(container, tab));
        expect(activeTabKey(container)).toBe(tab);
        expect(listTitles(list)).toEqual(expected[tab]);
      }
      fireEvent.click(getTab(container, 'all'));
      ensureTerminalMock.mockClear();
      loadStaticMock.mockClear();

      for (const tab of tabs.slice(1)) {
        swipeList(list, -50);
        expect(activeTabKey(container)).toBe(tab);
        expect(listTitles(list)).toEqual(expected[tab]);
        expectSwipeStylesReset(list);
      }
      for (const tab of tabs.slice(0, -1).reverse()) {
        swipeList(list, 50);
        expect(activeTabKey(container)).toBe(tab);
        expect(listTitles(list)).toEqual(expected[tab]);
        expectSwipeStylesReset(list);
      }
      expect(container.querySelector('#my-activity-list')).toBe(list);
      expect(ensureTerminalMock).not.toHaveBeenCalled();
      expect(loadStaticMock).not.toHaveBeenCalled();
    });

    it('supports actual swipes after permission arrives on the same page instance', async () => {
      mockViewer = createGuestViewer();
      const { container, rerender } = render(<MyActivitiesPage />);
      expect(screen.getByText('權限不足')).toBeTruthy();
      expect(container.querySelector('#my-activity-list')).toBeNull();
      expect(ensureTerminalMock).not.toHaveBeenCalled();
      expect(loadStaticMock).not.toHaveBeenCalled();

      mockViewer = coachViewer();
      rerender(<MyActivitiesPage />);
      await screen.findByText('滑動報名中');
      const list = await waitForSwipeList(container);
      swipeList(list, -50);
      expect(activeTabKey(container)).toBe('upcoming');
      expect(listTitles(list)).toEqual(['滑動待開放']);
      swipeList(list, 50);
      expect(activeTabKey(container)).toBe('all');
      expect(listTitles(list)).toContain('滑動報名中');
    });

    it('cleans up on permission loss and binds the new list on permission restoration', async () => {
      const { container, rerender, unmount } = render(<MyActivitiesPage />);
      await screen.findByText('滑動報名中');
      const oldList = await waitForSwipeList(container);
      swipeList(oldList, -50);
      expect(activeTabKey(container)).toBe('upcoming');

      mockViewer = createGuestViewer();
      rerender(<MyActivitiesPage />);
      expect(container.querySelector('#my-activity-list')).toBeNull();
      expect(oldList.dataset.swipeBound).toBeUndefined();
      // 卸載後舊節點的事件不能再改動父層頁籤狀態。
      swipeList(oldList, -50);
      expectSwipeStylesReset(oldList);

      mockViewer = coachViewer();
      rerender(<MyActivitiesPage />);
      const newList = await waitForSwipeList(container);
      expect(newList).not.toBe(oldList);
      expect(activeTabKey(container)).toBe('upcoming');
      swipeList(newList, -50);
      expect(activeTabKey(container)).toBe('open');
      expect(listTitles(newList)).toEqual(['滑動報名中']);
      unmount();
      expect(newList.dataset.swipeBound).toBeUndefined();
      expectSwipeStylesReset(newList);
    });

    it.each([
      { tab: 'all', dx: 130, percent: 10 },
      { tab: 'cancelled', dx: -130, percent: -10 },
    ])('damps an outward drag on $tab and stays on that tab', async ({ tab, dx, percent }) => {
      const { container } = render(<MyActivitiesPage />);
      await screen.findByText('滑動報名中');
      const list = await waitForSwipeList(container);
      fireEvent.click(getTab(container, tab));
      const before = listTitles(list);
      dispatchTouch(list, 'touchstart');
      const move = dispatchTouch(list, 'touchmove', dx);
      expect(move.defaultPrevented).toBe(true);
      expect(parseFloat(list.style.transform.slice('translateX('.length))).toBeCloseTo(percent);
      dispatchTouch(list, 'touchend', dx);
      finishSwipe(list);
      expect(activeTabKey(container)).toBe(tab);
      expect(listTitles(list)).toEqual(before);
      expectSwipeStylesReset(list);
    });

    it('keeps vertical scrolling native even when the gesture later moves horizontally', async () => {
      const { container } = render(<MyActivitiesPage />);
      const list = await waitForSwipeList(container);
      dispatchTouch(list, 'touchstart');
      const vertical = dispatchTouch(list, 'touchmove', -5, 50);
      const diagonal = dispatchTouch(list, 'touchmove', -80, 60);
      expect(vertical.defaultPrevented).toBe(false);
      expect(diagonal.defaultPrevented).toBe(false);
      expect(list.style.transform).toBe('');
      dispatchTouch(list, 'touchend', -80, 60);
      expect(activeTabKey(container)).toBe('all');
      expectSwipeStylesReset(list);
    });

    it.each([
      { dx: -19, elapsedMs: 1, expected: 'all' },
      { dx: -39, elapsedMs: 200, expected: 'all' },
      { dx: -40, elapsedMs: 200, expected: 'upcoming' },
      { dx: -20, elapsedMs: 50, expected: 'upcoming' },
      { dx: -30, elapsedMs: 100, expected: 'all' },
    ])('uses A thresholds for dx=$dx over $elapsedMs ms', async ({ dx, elapsedMs, expected }) => {
      const { container } = render(<MyActivitiesPage />);
      const list = await waitForSwipeList(container);
      dragList(list, dx, 0, elapsedMs);
      finishSwipe(list);
      expect(activeTabKey(container)).toBe(expected);
      expectSwipeStylesReset(list);
    });

    it('ignores overlapping swipes and recovers via the transition fallback without faded content', async () => {
      const { container } = render(<MyActivitiesPage />);
      await screen.findByText('滑動報名中');
      const list = await waitForSwipeList(container);
      dragList(list, -60);
      dragList(list, -60);
      expect(activeTabKey(container)).toBe('all');
      // 不派 transitionend，實際走共用 hook 的 350ms fallback（滑出＋滑入）。
      await waitFor(() => {
        expect(activeTabKey(container)).toBe('upcoming');
        expectSwipeStylesReset(list);
      });
      expect(listTitles(list)).toEqual(['滑動待開放']);
      swipeList(list, -60);
      expect(activeTabKey(container)).toBe('open');
      expect(listTitles(list)).toEqual(['滑動報名中']);
      expectSwipeStylesReset(list);
    });

    it.each(['click', 'swipe'])('loads missing ended history through the existing effect on %s', async (method) => {
      // 初始 all 載入失敗後 historyLoadedRef 仍為 false，進 ended 必須再次載入。
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      ensureTerminalMock.mockRejectedValue(new Error('history unavailable'));
      mockTerminalEvents = [];
      const { container } = render(<MyActivitiesPage />);
      await screen.findByText('滑動已額滿');
      await waitFor(() => expect(warn).toHaveBeenCalled());
      const list = await waitForSwipeList(container);
      fireEvent.click(getTab(container, 'full'));

      let resolveHistory!: (keys: string[]) => void;
      const history = new Promise<string[]>((resolve) => { resolveHistory = resolve; });
      ensureTerminalMock.mockReset().mockReturnValue(history);
      if (method === 'click') fireEvent.click(getTab(container, 'ended'));
      else swipeList(list, -50);
      expect(activeTabKey(container)).toBe('ended');
      await waitFor(() => expect(ensureTerminalMock).toHaveBeenCalledTimes(1));
      expect(ensureTerminalMock).toHaveBeenCalledWith({ mode: 'history' });
      expect(listTitles(list)).toEqual([]);

      mockTerminalEvents = [{
        id: 'history-ended', title: '補載歷史活動', status: 'ended',
        creatorUid: 'u-coach', date: '2026/04/29 14:00~16:00',
      }];
      await act(async () => { resolveHistory(['events']); });
      await waitFor(() => expect(listTitles(list)).toEqual(['補載歷史活動']));
      expect(loadStaticMock).not.toHaveBeenCalled();
    });

    it('preserves the creator filter and per-tab visible counts across swipes', async () => {
      mockViewer = adminViewer();
      mockTerminalEvents = [];
      mockActiveEvents = [
        ...Array.from({ length: 12 }, (_, i): EventDoc => ({
          id: `page-${i + 1}`, title: `主辦甲分頁_${i + 1}`, status: 'open',
          creatorUid: 'uid-alpha', creator: '主辦甲',
          date: `2026/05/${String(10 + i).padStart(2, '0')} 14:00~16:00`,
        })),
        {
          id: 'alpha-upcoming', title: '主辦甲待開放', status: 'upcoming',
          creatorUid: 'uid-alpha', creator: '主辦甲', regOpenTime: '2026-05-05T10:00:00',
          date: '2026/06/01 14:00~16:00',
        },
        {
          id: 'beta-open', title: '主辦乙報名中', status: 'open',
          creatorUid: 'uid-beta', creator: '主辦乙', date: '2026/05/09 14:00~16:00',
        },
      ] satisfies SwipeEventDoc[];
      const { container } = render(<MyActivitiesPage />);
      await screen.findByText('主辦乙報名中');
      const list = await waitForSwipeList(container);
      const input = screen.getByPlaceholderText('篩選主辦人...');
      fireEvent.input(input, { target: { value: '主辦甲' } });
      const option = container.querySelector<HTMLElement>('#my-activity-creator-dropdown .ce-delegate-item');
      if (!option) throw new Error('Missing creator option');
      fireEvent.click(option);
      fireEvent.click(getTab(container, 'open'));
      expect(listTitles(list)).toHaveLength(10);
      fireEvent.click(screen.getByRole('button', { name: '查看更多' }));
      expect(listTitles(list)).toHaveLength(12);
      expect(listTitles(list)).not.toContain('主辦乙報名中');

      swipeList(list, 50);
      expect(activeTabKey(container)).toBe('upcoming');
      expect(listTitles(list)).toEqual(['主辦甲待開放']);
      swipeList(list, 50);
      expect(activeTabKey(container)).toBe('all');
      expect(listTitles(list)).toHaveLength(10);
      swipeList(list, -50);
      swipeList(list, -50);
      expect(activeTabKey(container)).toBe('open');
      expect(listTitles(list)).toHaveLength(12);
      expect(listTitles(list)).toContain('主辦甲分頁_12');
      expect(listTitles(list)).not.toContain('主辦乙報名中');
      expect(loadMoreMock).not.toHaveBeenCalled();
    });
  });
});
