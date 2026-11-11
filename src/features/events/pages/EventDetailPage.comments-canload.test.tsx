import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventDetailPage from './EventDetailPage';

const mock = vi.hoisted(() => ({
  detail: vi.fn(),
  history: vi.fn(async () => [] as unknown[]),
  loadComments: vi.fn(async () => [] as unknown[]),
  toast: vi.fn(),
  viewer: {
    uid: null as string | null,
    displayName: null as string | null,
    pictureUrl: null as string | null,
    role: 'guest',
    roleLevel: 0,
    teamIds: new Set<string>(),
    capabilities: [] as string[],
    hasPermission: () => false,
  },
}));

vi.mock('preact-iso', () => ({
  useLocation: () => ({ path: '/activities/public-event', route: vi.fn() }),
}));
vi.mock('@/core/back-guard', () => ({ useGoBack: () => vi.fn() }));
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: () => mock.viewer }));
vi.mock('@/data/user-roles', () => ({
  useUserRoles: () => ({}),
  getCachedUserLevel: () => 0,
}));
vi.mock('@/i18n/i18n', async (original) => ({
  ...(await original<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string) => key,
  lt: (_key: string, fallback: string) => fallback,
}));
vi.mock('@/ui/Toast', () => ({ Toast: () => null, toast: { show: mock.toast } }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: async () => false }));
vi.mock('../data/event-detail', () => ({
  loadEventDetail: mock.detail,
  loadEventRegistrations: vi.fn(async () => []),
}));
vi.mock('../data/viewer-registrations', () => ({
  loadViewerRegistrations: mock.history,
}));
vi.mock('../data/event-comments', async (original) => {
  const actual = await original<typeof import('../data/event-comments')>();
  return {
    ...actual,
    loadEventComments: mock.loadComments,
  };
});
vi.mock('../data/event-create-context', () => ({ operateContextFromViewer: () => ({}) }));
vi.mock('../data/operate-permissions', () => ({
  canOperateEventSite: () => false,
  canRemoveConfirmedParticipant: () => false,
  canManageTeamSplit: () => false,
  canViewEventOperationLog: () => false,
}));
vi.mock('../data/signup-state', () => ({
  getSignupButtonState: () => ({ kind: 'signup', labelKey: 'signup', action: 'signup', disabled: false }),
}));
vi.mock('../data/signup-profile', () => ({
  loadSignupProfile: async () => ({ gender: '', birthday: '', exp: 0, lineNotifyBound: false }),
}));
vi.mock('../data/event-view-count', () => ({
  incrementEventViewCount: async () => null,
  mergeViewCount: () => 0,
}));
vi.mock('../data/team-staff', () => ({
  getEventLimitedTeamIds: () => [],
  loadEventStaffTeamIds: async () => new Set<string>(),
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
vi.mock('../components/legacy/GuestRosterSections', () => ({ GuestRosterSections: () => null }));
vi.mock('../components/legacy/EventDetailMainView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/legacy/EventDetailMainView')>()),
  CompanionSelectModal: () => null,
  EventDetailCover: () => null,
  EventDetailInfoSection: () => null,
  EventDetailPrimaryButton: () => null,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function eventDoc(extra: Record<string, unknown> = {}) {
  return {
    eventDocId: 'doc-1',
    event: {
      id: 'public-event',
      title: '活動',
      date: '2099/01/01 10:00~11:00',
      status: 'open',
      current: 0,
      waitlist: 0,
      max: 20,
      participants: [],
      waitlistNames: [],
      privateEvent: true,
      creatorUid: 'someone-else',
      ...extra,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.viewer.uid = null;
  mock.viewer.role = 'guest';
  mock.history.mockResolvedValue([]);
  delete window.__fcbEarlyEvent;
});

afterEach(() => cleanup());

describe('SPEED-2-11b 詳情留言 canLoad', () => {
  it('訪客：私密活動 ready 後才出現登入提示，全程不讀留言', async () => {
    const pending = deferred<ReturnType<typeof eventDoc>>();
    mock.detail.mockReturnValue(pending.promise);
    render(<EventDetailPage id="public-event" />);

    expect(mock.loadComments).not.toHaveBeenCalled();
    expect(screen.queryByText('登入後可查看與留言')).toBeNull();

    pending.resolve(eventDoc());
    expect(await screen.findByText('登入後可查看與留言')).toBeTruthy();
    expect(mock.loadComments).not.toHaveBeenCalled();
    expect(mock.history).not.toHaveBeenCalled();
  });

  it('登入者：本場報名未回前不讀；可見後才讀一次；黑名單沒報名全程不讀', async () => {
    mock.viewer.uid = 'member';
    mock.viewer.role = 'user';
    const pendingDetail = deferred<ReturnType<typeof eventDoc>>();
    const pendingHistory = deferred<unknown[]>();
    mock.detail.mockReturnValue(pendingDetail.promise);
    mock.history.mockReturnValue(pendingHistory.promise);
    const view = render(<EventDetailPage id="public-event" />);

    pendingDetail.resolve(eventDoc());
    await waitFor(() => expect(mock.history).toHaveBeenCalledWith('member', 'doc-1'));
    expect(mock.loadComments).not.toHaveBeenCalled();
    expect(screen.queryByText('留言載入中...')).toBeNull();
    expect(screen.queryByText('尚無留言')).toBeNull();

    pendingHistory.resolve([]);
    expect(await screen.findByText('尚無留言')).toBeTruthy();
    expect(mock.loadComments).toHaveBeenCalledTimes(1);
    expect(mock.loadComments).toHaveBeenCalledWith(expect.objectContaining({
      eventDocId: 'doc-1',
      event: expect.objectContaining({ id: 'public-event', privateEvent: true }),
      viewer: expect.objectContaining({ uid: 'member' }),
    }));

    view.unmount();
    cleanup();
    mock.loadComments.mockClear();
    mock.history.mockClear();
    mock.toast.mockClear();

    mock.detail.mockResolvedValue(eventDoc({ blockedUids: ['member'] }));
    mock.history.mockResolvedValue([]);
    render(<EventDetailPage id="public-event" />);
    await waitFor(() => {
      expect(mock.toast).toHaveBeenCalledWith({ message: '找不到此活動' });
    });
    expect(mock.loadComments).not.toHaveBeenCalled();
  });
});
