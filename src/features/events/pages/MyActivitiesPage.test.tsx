import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
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
let mockActiveEvents: EventDoc[] = [];
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

describe('MyActivitiesPage', () => {
  beforeEach(() => {
    routeMock.mockReset();
    ensureTerminalMock.mockClear();
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
});
