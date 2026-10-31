import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventDetailPage from './EventDetailPage';
import {
  EventDetailInfoSection,
  type LegacyDetailEvent,
} from '../components/legacy/EventDetailMainView';

const mocks = vi.hoisted(() => ({
  route: vi.fn(),
  goBack: vi.fn(),
  toast: vi.fn(),
  loadDetail: vi.fn(),
  visible: vi.fn(() => true),
  canOperate: vi.fn(() => true),
  viewer: {
    uid: null as string | null,
    displayName: '使用者',
    hasPermission: () => false,
  },
}));

vi.mock('preact-iso', () => ({
  useLocation: () => ({ path: '/events/public-1', route: mocks.route }),
}));
vi.mock('@/core/back-guard', () => ({ useGoBack: () => mocks.goBack }));
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: () => mocks.viewer }));
vi.mock('@/data/user-roles', () => ({
  useUserRoles: () => ({}),
  getCachedUserLevel: () => undefined,
}));
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => undefined }));
vi.mock('@/ui/Toast', () => ({ Toast: () => null, toast: { show: mocks.toast } }));
vi.mock('@/ui/UserTag', () => ({ UserTag: () => null }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: vi.fn(async () => true) }));
vi.mock('@/data/callables-deployed', () => ({ CALLABLES_DEPLOYED: false }));
vi.mock('@/i18n/i18n', async (o) => ({
  ...(await o<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string) => key,
  lt: (_key: string, fallback: string) => fallback,
}));
vi.mock('../data/event-detail', () => ({
  loadEventDetail: mocks.loadDetail,
  loadEventRegistrations: vi.fn(async () => []),
}));
vi.mock('../data/viewer-registrations', () => ({
  loadViewerRegistrations: vi.fn(async () => []),
}));
vi.mock('../data/visibility', () => ({ isEventVisibleToUser: mocks.visible }));
vi.mock('../data/event-create-context', () => ({
  operateContextFromViewer: (value: unknown) => value,
}));
vi.mock('../data/operate-permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/operate-permissions')>()),
  canOperateEventSite: mocks.canOperate,
  canRemoveConfirmedParticipant: () => false,
}));
vi.mock('../data/attendance-settle', () => ({ settleAttendance: vi.fn() }));
vi.mock('../data/event-lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/event-lifecycle')>()), resolveOperator: () => '使用者' }));
vi.mock('@/features/checkin/data/attendance', () => ({
  loadEventAttendance: vi.fn(async () => []),
}));
vi.mock('../data/signup', () => ({
  precheckSignup: () => ({ ok: true }),
  cancelRegistration: vi.fn(),
  SignupError: class extends Error { messageKey = ''; },
}));
vi.mock('../data/signup-selection', () => ({ registerSelection: vi.fn() }));
vi.mock('../data/companions', () => ({ loadSignupCompanions: vi.fn(async () => []) }));
vi.mock('../data/signup-state', () => ({
  getSignupButtonState: () => ({
    kind: 'signup', action: 'signup', labelKey: '立即報名', disabled: false,
  }),
}));
vi.mock('../data/roster-remove', () => ({ managerRemoveRegistration: vi.fn() }));
vi.mock('../data/attendance-roster-model', () => ({
  buildConfirmedRoster: () => ({ count: 0, people: [] }),
}));
vi.mock('../components/AttendanceRosterTable', () => ({ AttendanceRosterTable: () => null }));
vi.mock('../components/UnregRosterTable', () => ({
  UnregRosterTable: () => null,
  buildUnregPeopleList: () => [],
}));
vi.mock('../components/WaitlistRosterTable', () => ({ WaitlistRosterTable: () => null }));
vi.mock('../components/legacy/DetailAttendanceSummary', () => ({
  DetailAttendanceSummary: () => null,
  DetailAttendanceLoading: () => null,
}));
vi.mock('../components/useAttendanceInstantSave', () => ({
  useAttendanceInstantSave: () => ({
    resetInstantSave: vi.fn(),
    flushInstantSaves: vi.fn(async () => undefined),
    getRowSelection: vi.fn(),
    inFlightKeys: new Set<string>(),
    savedFlashKeys: new Set<string>(),
    failedFlashKeys: new Set<string>(),
    onToggleCheckbox: vi.fn(),
    onChangeNote: vi.fn(),
  }),
}));

function detailEvent(overrides: Partial<LegacyDetailEvent> = {}): LegacyDetailEvent {
  // ASSUMPTION: 附件未提供完整 DetailEvent 型別；測試固定欄位只涵蓋本單。
  return {
    id: 'public-1',
    title: '測試活動',
    date: '2099/10/25 10:00~12:00',
    status: 'open',
    location: '球場',
    current: 0,
    max: 10,
    ...overrides,
  } as LegacyDetailEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer.uid = null;
  mocks.visible.mockReturnValue(true);
  mocks.canOperate.mockReturnValue(true);
  mocks.loadDetail.mockResolvedValue({
    event: detailEvent(),
    eventDocId: 'firestore-doc-9',
  });
});

afterEach(() => cleanup());

describe('3b-2b 頁面串接', () => {
  it('首次等待立即顯示完整骨架', () => {
    mocks.loadDetail.mockReturnValue(new Promise(() => {}));
    const view = render(<EventDetailPage id="public-1" />);
    expect(screen.getByText('活動資訊載入中...')).toBeTruthy();
    expect(view.container.querySelectorAll('.reg-loading-skeleton-row')).toHaveLength(3);
    expect(screen.getByText('活動詳情')).toBeTruthy();
  });

  it('找不到只 toast 與返回，不渲染找不到大標', async () => {
    mocks.loadDetail.mockResolvedValue(null);
    render(<EventDetailPage id="public-1" />);
    await waitFor(() => expect(mocks.goBack).toHaveBeenCalledOnce());
    expect(mocks.toast).toHaveBeenCalledWith({ message: '找不到此活動' });
    expect(screen.queryByRole('heading', { name: '找不到此活動' })).toBeNull();
  });

  it('不可見活動同樣返回', async () => {
    mocks.visible.mockReturnValue(false);
    render(<EventDetailPage id="public-1" />);
    await waitFor(() => expect(mocks.goBack).toHaveBeenCalledOnce());
  });

  it('第一次失敗，按重試後重新載入成功', async () => {
    mocks.loadDetail
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ event: detailEvent(), eventDocId: 'doc-9' });
    render(<EventDetailPage id="public-1" />);
    const retry = await screen.findByText('events.retry');
    expect(screen.getByText('活動詳情')).toBeTruthy();
    fireEvent.click(retry);
    await screen.findByText('測試活動');
    expect(mocks.loadDetail).toHaveBeenCalledTimes(2);
  });

  it('聯繫主辦與俱樂部使用編碼後的 canonical ID', async () => {
    mocks.loadDetail.mockResolvedValue({
      event: detailEvent({
        creatorUid: 'uid/a',
        teamOnly: true,
        creatorTeamId: 'team/a',
        creatorTeamName: '測試俱樂部',
      }),
      eventDocId: 'doc-9',
    });
    render(<EventDetailPage id="public-1" />);
    fireEvent.click(await screen.findByText('聯繫主辦'));
    expect(mocks.route).toHaveBeenCalledWith('/profile/uid%2Fa');
    fireEvent.click(screen.getByText('測試俱樂部'));
    expect(mocks.route).toHaveBeenCalledWith('/teams/team%2Fa');
  });

  it('缺主辦 UID 提示 A 原文；訪客即使 helper 回 true 也不顯示簽到', async () => {
    render(<EventDetailPage id="public-1" />);
    fireEvent.click(await screen.findByText('聯繫主辦'));
    expect(mocks.toast).toHaveBeenCalledWith({ message: '暫時找不到主辦人資料。' });
    expect(screen.queryByText('現場簽到')).toBeNull();
  });

  it('簽到導向 public event.id，不使用 Firestore 文件 ID', async () => {
    mocks.viewer.uid = 'operator';
    render(<EventDetailPage id="public-1" />);
    fireEvent.click(await screen.findByText('現場簽到'));
    expect(mocks.route).toHaveBeenCalledWith('/checkin?eventId=public-1');
  });
});

describe('M-088 資訊列', () => {
  function info(event: LegacyDetailEvent, nowMs: number) {
    return render(
      <EventDetailInfoSection
        event={event}
        confirmedCount={0}
        waitlistCount={0}
        nowMs={nowMs}
        roles={{}}
        onOpenProfile={vi.fn()}
        onContactHost={vi.fn()}
        onOpenTeam={vi.fn()}
      />,
    );
  }

  it.each([
    ['ended', undefined, '已結束'],
    ['cancelled', undefined, '已取消'],
    ['upcoming', '2099/10/20 10:00', '即將開放'],
  ])('狀態 %s 照 A', (status, regOpenTime, expected) => {
    info(detailEvent({ status, regOpenTime }), Date.now());
    const row = document.querySelector('[data-detail-field="countdown"]');
    expect(row?.textContent).toBe('倒數' + expected);
  });

  it.each([
    [Date.parse('2099-10-23T07:00:00+08:00'), '剩餘 2日3時'],
    [Date.parse('2099-10-25T07:30:00+08:00'), '剩餘 2時30分'],
    [Date.parse('2099-10-25T09:45:00+08:00'), '剩餘 15分'],
    [Date.parse('2099-10-25T10:00:00+08:00'), '已結束'],
  ])('時間 %s 顯示 %s', (nowMs, expected) => {
    info(detailEvent(), nowMs);
    expect(document.querySelector('[data-detail-field="countdown"]')?.textContent)
      .toBe('倒數' + expected);
  });

  it('無效日期倒數空白，空地點仍保留地圖連結與圖釘', () => {
    info(detailEvent({ date: 'invalid', location: '' }), Date.now());
    expect(document.querySelector('[data-detail-field="countdown"]')?.textContent)
      .toBe('倒數');
    const link = document.querySelector('[data-detail-field="location"] a');
    expect(link?.textContent).toBe(' 📍');
    expect(link?.getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=');
    expect(screen.queryByText('地点未定')).toBeNull();
  });
});
