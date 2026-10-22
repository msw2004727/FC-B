import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentChildren } from 'preact';
import EventDetailPage from './EventDetailPage';
import type { DetailEvent } from '../data/detail-model';
import type { TeamRegistration, TeamSplitConfig } from '../data/team-split';

const mocks = vi.hoisted(() => ({
  loadDetail: vi.fn(),
  loadRegistrations: vi.fn(),
  loadHistory: vi.fn(),
  register: vi.fn(),
  toast: vi.fn(),
  shareRows: [] as unknown[],
  event: {} as DetailEvent & { teamSplit?: TeamSplitConfig },
  viewer: {
    uid: 'owner' as string | null,
    displayName: '主辦',
    role: 'user',
    roleLevel: 0,
    teamIds: new Set<string>(),
    hasPermission: (_code: string) => false,
  },
}));

vi.mock('preact-iso', () => ({
  useLocation: () => ({ path: '/activities/public-event', route: vi.fn() }),
}));
vi.mock('@/core/back-guard', () => ({ useGoBack: () => vi.fn() }));
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: () => mocks.viewer }));
vi.mock('@/data/user-roles', () => ({
  useUserRoles: () => ({}),
  getCachedUserLevel: () => 0,
}));
vi.mock('@/i18n/i18n', async o => ({
  ...(await o<typeof import('@/i18n/i18n')>()),
  lt: (_key: string, fallback: string) => fallback,
  useT: () => (key: string) => key,
}));
vi.mock('@/ui/Toast', () => ({ Toast: () => null, toast: { show: mocks.toast } }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: async () => true }));
vi.mock('../data/event-detail', () => ({
  loadEventDetail: mocks.loadDetail,
  loadEventRegistrations: mocks.loadRegistrations,
}));
vi.mock('../data/viewer-registrations', () => ({
  loadViewerRegistrations: mocks.loadHistory,
}));
vi.mock('../data/visibility', () => ({ isEventVisibleToUser: () => true }));
vi.mock('../data/event-create-context', () => ({
  operateContextFromViewer: (viewer: { uid: string | null }) => ({
    uid: viewer.uid,
    role: viewer.uid ? 'user' : null,
    rolePermissions: [],
    userGrants: null,
    capabilities: ['user.activity.addons_use'],
    customRoles: [],
  }),
}));
vi.mock('../data/team-staff', () => ({
  getEventLimitedTeamIds: () => [],
  loadEventStaffTeamIds: async () => new Set<string>(),
}));
vi.mock('../data/event-view-count', () => ({
  incrementEventViewCount: async () => null,
  mergeViewCount: () => 0,
}));
vi.mock('../data/signup-profile', () => ({
  loadSignupProfile: async () => ({
    gender: '',
    birthday: '',
    exp: 100,
    lineNotifyBound: true,
  }),
}));
vi.mock('../data/signup-context', () => ({
  createDetailSignupContexts: () => ({
    signup: {
      load: async () => ({
        event: mocks.event,
        viewer: mocks.viewer,
        registrations: [],
        profileComplete: true,
        participantCheck: { ok: true },
        earlyBirdWindow: false,
        teamSignupAllowed: true,
      }),
    },
    cancel: { load: vi.fn() },
  }),
  canDetailCompanionSignup: () => true,
  detailCompanionGenderMessage: () => '',
}));
vi.mock('../data/signup', () => ({
  SignupError: class extends Error {},
  precheckSignup: () => ({ ok: true }),
  registerForEvent: mocks.register,
  cancelRegistration: vi.fn(),
}));
vi.mock('../data/signup-state', () => ({
  getSignupButtonState: () => ({ action: 'signup', disabled: false }),
}));
vi.mock('../data/signup-restrictions', () => ({ getEventEarlyBirdCost: () => 0 }));
vi.mock('../components/legacy/EventDetailPrimaryButton', () => ({
  EventDetailPrimaryButton: ({ onClick, disabled }: {
    onClick: () => void;
    disabled: boolean;
  }) => <button disabled={disabled} onClick={onClick}>立即報名</button>,
}));
vi.mock('../components/legacy/EventDetailLoadingShell', () => ({
  EventDetailLoadingShell: ({ children }: { children?: ComponentChildren }) => <>{children}</>,
  EventDetailMissing: () => null,
  EventDetailToolbarActions: ({ registrations }: { registrations: unknown[] }) => {
    mocks.shareRows = registrations;
    return <button>分享活動</button>;
  },
}));
vi.mock('../components/legacy/EventDetailHeaderActions', () => ({
  EventDetailHeaderActions: () => null,
  canEditDetailActivity: () => false,
}));
vi.mock('../components/legacy/EventCommentsSection', () => ({ default: () => null }));
vi.mock('../components/useAttendanceInstantSave', () => ({
  useAttendanceInstantSave: () => ({
    resetInstantSave: vi.fn(),
    flushInstantSaves: async () => {},
    getRowSelection: vi.fn(),
    inFlightKeys: new Set(),
    savedFlashKeys: new Set(),
    failedFlashKeys: new Set(),
    onToggleCheckbox: vi.fn(),
    onChangeNote: vi.fn(),
  }),
}));
vi.mock('../components/AttendanceRosterTable', () => ({ AttendanceRosterTable: () => null }));
vi.mock('../components/UnregRosterTable', () => ({
  UnregRosterTable: () => null,
  buildUnregPeopleList: () => [],
}));
vi.mock('../components/WaitlistRosterTable', () => ({ WaitlistRosterTable: () => null }));
vi.mock('../components/legacy/GuestRosterSections', () => ({ GuestRosterSections: () => null }));
vi.mock('../components/legacy/DetailAttendanceSummary', () => ({
  DetailAttendanceSummary: ({ onOpen }: { onOpen: () => void }) => (
    <button onClick={onOpen}>展開名單</button>
  ),
  DetailAttendanceLoading: () => null,
}));
vi.mock('@/features/checkin/data/attendance', () => ({
  loadEventAttendance: async () => [],
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.uid = 'owner';
  mocks.shareRows = [];
  mocks.event = {
    id: 'public-event',
    creatorUid: 'owner',
    title: '分隊活動',
    status: 'open',
    date: '2099/01/01 18:00~20:00',
    max: 10,
    current: 0,
    teamSplit: {
      enabled: true,
      mode: 'self-select',
      balanceCap: true,
      teams: [
        { key: 'A', color: '#EF4444', name: '紅隊' },
        { key: 'B', color: '#3B82F6', name: '藍隊' },
      ],
    },
  };
  mocks.loadDetail.mockImplementation(async () => ({
    event: mocks.event,
    eventDocId: 'document-event',
  }));
  mocks.loadRegistrations.mockResolvedValue([]);
  mocks.loadHistory.mockResolvedValue([]);
  mocks.register.mockResolvedValue({
    registrations: [{ participantType: 'self', status: 'confirmed', teamKey: 'B' }],
    confirmed: 1,
    waitlisted: 0,
  });
});

afterEach(() => cleanup());

describe('M-092 詳情整合', () => {
  it('登入者預載分隊但不展開名單，分享使用同一份資料', async () => {
    const rows = [{ _docId: 'reg', status: 'confirmed', teamKey: 'A' }];
    mocks.loadRegistrations.mockResolvedValue(rows);
    const { container } = render(<EventDetailPage id="public-event" />);
    await waitFor(() => expect(mocks.shareRows).toEqual(rows));
    expect(mocks.loadRegistrations).toHaveBeenCalledWith('document-event');
    expect(mocks.loadRegistrations).toHaveBeenCalledTimes(1);
    expect(screen.getByText('展開名單')).toBeTruthy();
    expect(container.querySelector('.team-stat-text')?.textContent).toBe('1/5 人');
    const toolbar = container.querySelector('.detail-action-toolbar');
    expect(toolbar?.nextElementSibling?.classList.contains('team-select-zone')).toBe(true);
    expect(toolbar?.nextElementSibling?.nextElementSibling?.classList
      .contains('detail-action-primary')).toBe(true);
  });

  it('訪客不預載 registrations，分隊人數為零', async () => {
    mocks.viewer.uid = null;
    const { container } = render(<EventDetailPage id="public-event" />);
    await screen.findByText('紅隊');
    expect(mocks.loadRegistrations).not.toHaveBeenCalled();
    expect(container.querySelector('.team-stat-text')?.textContent).toBe('0/5 人');
  });

  it('未選隊阻擋本人報名；選隊後帶 public eventId 與 teamKey', async () => {
    render(<EventDetailPage id="public-event" />);
    const signup = await screen.findByText('立即報名');
    await waitFor(() => expect(mocks.loadHistory).toHaveBeenCalled());
    fireEvent.click(signup);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      message: '請先選擇隊伍',
    }));
    expect(mocks.register).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('藍隊'));
    fireEvent.click(signup);
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'public-event',
      teamKey: 'B',
      user: { uid: 'owner', displayName: '主辦' },
    })));
  });

  it('random 正取成功附隊名，候補不附分配訊息', async () => {
    mocks.event = {
      ...mocks.event,
      teamSplit: { ...mocks.event.teamSplit, mode: 'random' },
    };
    const first = render(<EventDetailPage id="public-event" />);
    fireEvent.click(await screen.findByText('立即報名'));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      message: '報名成功！ 你被分配到 藍隊',
    }));
    first.unmount();
    mocks.toast.mockClear();
    mocks.register.mockResolvedValue({
      registrations: [{ participantType: 'self', status: 'waitlisted', teamKey: 'B' }],
      waitlisted: 1,
    });
    render(<EventDetailPage id="public-event" />);
    fireEvent.click(await screen.findByText('立即報名'));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      message: '已加入候補名單',
    }));
  });

  it('舊活動預載較晚返回，不覆蓋新活動分隊人數', async () => {
    const oldRows = deferred<TeamRegistration[]>();
    mocks.loadRegistrations.mockReturnValueOnce(oldRows.promise).mockResolvedValue([]);
    const view = render(<EventDetailPage id="old-event" />);
    await waitFor(() => expect(mocks.loadRegistrations).toHaveBeenCalledTimes(1));
    mocks.event = { ...mocks.event, id: 'new-event' };
    view.rerender(<EventDetailPage id="new-event" />);
    await waitFor(() => expect(mocks.loadRegistrations).toHaveBeenCalledTimes(2));
    await act(async () => {
      oldRows.resolve([{ _docId: 'old-reg', status: 'confirmed', teamKey: 'A' }]);
      await oldRows.promise;
    });
    expect(mocks.shareRows).toEqual([]);
  });
});
