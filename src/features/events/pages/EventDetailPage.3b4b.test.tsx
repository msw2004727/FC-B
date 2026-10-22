import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventDetailPage from './EventDetailPage';

const mock = vi.hoisted(() => ({
  detail: vi.fn(),
  section: vi.fn(),
  viewer: {
    uid: null as string | null,
    displayName: null,
    pictureUrl: null,
    role: 'guest',
    roleLevel: 0,
    teamIds: new Set<string>(),
    capabilities: [],
    hasPermission: () => false,
  },
}));

// ASSUMPTION: 未附既有 EventDetailPage.test.tsx；本檔依附件頁面依賴建立獨立最小 mock。
vi.mock('preact-iso', () => ({
  useLocation: () => ({ path: '/activities/public-event', route: vi.fn() }),
}));
vi.mock('@/core/back-guard', () => ({ useGoBack: () => vi.fn() }));
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: () => mock.viewer }));
vi.mock('@/data/user-roles', () => ({
  useUserRoles: () => ({}),
  getCachedUserLevel: () => 0,
}));
vi.mock('@/i18n/i18n', async (o) => ({
  ...(await o<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string) => key,
  lt: (_key: string, fallback: string) => fallback,
}));
vi.mock('../data/event-detail', () => ({
  loadEventDetail: mock.detail,
  loadEventRegistrations: vi.fn().mockResolvedValue([]),
}));
vi.mock('../data/visibility', () => ({ isEventVisibleToUser: () => true }));
vi.mock('../data/event-create-context', () => ({ operateContextFromViewer: () => ({}) }));
vi.mock('../data/operate-permissions', () => ({
  canOperateEventSite: () => false,
  canRemoveConfirmedParticipant: () => false,
}));
vi.mock('../data/signup-state', () => ({
  getSignupButtonState: () => ({ kind: 'signup', labelKey: 'signup', action: 'signup', disabled: false }),
}));
vi.mock('../components/useAttendanceInstantSave', () => ({
  useAttendanceInstantSave: () => ({
    resetInstantSave: vi.fn(),
    flushInstantSaves: vi.fn(),
    getRowSelection: vi.fn(),
    inFlightKeys: new Set(),
    savedFlashKeys: new Set(),
    failedFlashKeys: new Set(),
    onToggleCheckbox: vi.fn(),
    onChangeNote: vi.fn(),
  }),
}));
vi.mock('../data/attendance-roster-model', () => ({
  buildConfirmedRoster: () => ({ count: 0, people: [] }),
}));
vi.mock('../components/AttendanceRosterTable', () => ({ AttendanceRosterTable: () => null }));
vi.mock('../components/WaitlistRosterTable', () => ({ WaitlistRosterTable: () => null }));
vi.mock('../components/UnregRosterTable', () => ({
  UnregRosterTable: () => null,
  buildUnregPeopleList: () => [],
}));
vi.mock('../components/legacy/DetailAttendanceSummary', () => ({
  DetailAttendanceSummary: () => null,
  DetailAttendanceLoading: () => null,
}));
vi.mock('../components/legacy/EventDetailMainView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/legacy/EventDetailMainView')>()),
  CompanionSelectModal: () => null,
  EventDetailCover: () => null,
  EventDetailInfoSection: () => null,
  EventDetailPrimaryButton: () => null,
}));
vi.mock('../components/legacy/EventCommentsSection', () => ({
  default: (props: unknown) => {
    mock.section(props);
    return <div data-testid="comments-section">留言區測試替身</div>;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe('M-093 詳情頁接線', () => {
  it('詳情未 ready 不掛載留言；ready 傳 public ID、文件 ID、viewer 與 canLoad', async () => {
    let resolve!: (value: unknown) => void;
    mock.detail.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const view = render(<EventDetailPage id="public-event" />);
    expect(mock.section).not.toHaveBeenCalled();
    resolve({
      eventDocId: 'actual-document-id',
      event: {
        id: 'public-event', title: '活動', date: '2099/01/01 10:00~11:00',
        status: 'open', current: 0, waitlist: 0, max: 20,
        participants: [], waitlistNames: [],
      },
    });
    await screen.findByTestId('comments-section');
    expect(mock.section).toHaveBeenLastCalledWith(expect.objectContaining({
      event: expect.objectContaining({ id: 'public-event' }),
      eventDocId: 'actual-document-id',
      viewer: mock.viewer,
      canLoad: true,
    }));
    expect(view.container.querySelector('#detail-comments-container')).toBeTruthy();
    // 測試同步更新：照 A（M-093），原佔位提示已移除。
    expect(screen.queryByText('留言功能（點擊查看）')).toBeNull();
  });
});
