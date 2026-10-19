import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGuestViewer, createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
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

const testDict: Record<string, string> = {
  'events.form.openCreateBtn': '我要開團',
  'events.manage.title': '活動管理',
  'events.manage.back': '返回',
  'events.manage.tabsLabel': '活動管理分頁',
  'events.manage.tab.all': '全部',
  'events.manage.tab.upcoming': '即將開放',
  'events.manage.tab.open': '報名中',
  'events.manage.tab.full': '已額滿',
  'events.manage.tab.ended': '已結束',
  'events.manage.tab.cancelled': '已取消',
  'events.manage.status.open': '報名中',
  'events.manage.status.full': '已額滿',
  'events.manage.status.ended': '已結束',
  'events.manage.status.upcoming': '即將開放',
  'events.manage.status.cancelled': '已取消',
  'events.manage.editBtn': '編輯',
  'events.manage.pinnedBadge': '置頂',
  'events.manage.teamOnlyBadge': '限定',
  'events.manage.externalLinkLabel': '🔗 外部活動連結',
  'events.manage.participants': '{current}/{max} 人',
  'events.manage.participantsWithWaitlist': '{current}/{max} 人 ・ 候補 {waitlist}',
  'events.manage.emptyCategory': '此分類沒有活動',
  'events.manage.loadMoreNote': '已顯示 {displayed} / {total}',
  'events.manage.loadMoreBtn': '查看更多',
  'events.manage.loading': '資料載入中',
  'events.manage.loadError': '無法載入活動，請重試。',
  'events.manage.retry': '重試',
  'events.manage.permissionDenied': '權限不足',
  'events.manage.permissionDeniedBody': '您沒有權限存取活動管理頁面。',
  'ui.userTag.unknown': '用戶',
  'ui.userTag.role.user': '一般用戶',
  'ui.userTag.openProfile': '開啟 {name} 的個人頁',
};

describe('MyActivitiesPage', () => {
  beforeEach(async () => {
    routeMock.mockReset();
    ensureTerminalMock.mockClear();
    loadStaticMock.mockClear();
    loadMoreMock.mockClear();
    mockActiveEvents = [];
    mockTerminalEvents = [];
    _setDictLoaderForTest(async () => testDict);
    await setLocale('zh-TW');
  });

  afterEach(() => {
    cleanup();
    _setDictLoaderForTest(null);
  });

  it('shows permission denied EmptyState when viewer has no manage entry permission', () => {
    mockViewer = createGuestViewer();
    render(<MyActivitiesPage />);
    expect(screen.getByText('權限不足')).toBeTruthy();
    expect(ensureTerminalMock).not.toHaveBeenCalled();
  });

  it('switches tabs and filters events by status matching legacy A', async () => {
    mockViewer = {
      ...createMinimalViewer('u-coach'),
      role: 'coach',
      roleLevel: 1,
      hasPermission: (code) => code === 'activity.manage.entry',
      permissionSources: {
        rolePermissions: ['activity.manage.entry'],
        userGrants: [],
        customRoles: [],
      },
    };
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

    render(<MyActivitiesPage />);

    await waitFor(() => {
      expect(screen.getByText('週六足球開踢')).toBeTruthy();
      expect(screen.getByText('上週籃球賽')).toBeTruthy();
    });

    const endedTab = screen.getByRole('tab', { name: '已結束' });
    fireEvent.click(endedTab);

    await waitFor(() => {
      expect(screen.getByText('上週籃球賽')).toBeTruthy();
      expect(screen.queryByText('週六足球開踢')).toBeNull();
    });

    const fullTab = screen.getByRole('tab', { name: '已額滿' });
    fireEvent.click(fullTab);

    await waitFor(() => {
      expect(screen.getByText('此分類沒有活動')).toBeTruthy();
    });
  });

  it('renders Edit button only when canEditOwnActivityBasic is true and opens EventFormModal on click', async () => {
    // 一般用戶：擁有 user.activity.own_manage_entry 進入頁面，但沒有 user.activity.own_edit_basic 時不可編輯
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

    // 加上 user.activity.own_edit_basic 後應顯示「編輯」按鈕，點擊開啟 EventFormModal
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
    mockViewer = {
      ...createMinimalViewer('u-coach'),
      role: 'coach',
      roleLevel: 1,
    };
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
});
