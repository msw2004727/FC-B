import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventDetailPage, { PROVISIONAL_DETAIL_TIMEOUT_MS } from './EventDetailPage';
import { EVENTS_SNAPSHOT_FORMAT, EVENTS_SNAPSHOT_STORAGE_KEY } from '../data/events-snapshot-cache';

// 回訪詳情：列表快取先畫（只顯示），伺服器活動文件與本場報名到齊才放開按鈕（顧問 §3.230）。

const mock = vi.hoisted(() => ({
  detail: vi.fn(),
  history: vi.fn(async () => [] as unknown[]),
  loadComments: vi.fn(async () => [] as unknown[]),
  toast: vi.fn(),
  signIn: vi.fn(async () => undefined),
  syncOverride: null as null | Record<string, unknown>,
  lastKnown: undefined as string | null | undefined,
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
  useLocation: () => ({ path: '/events/public-event', route: vi.fn() }),
}));
vi.mock('@/core/back-guard', () => ({ useGoBack: () => vi.fn() }));
vi.mock('@/features/profile/data/viewer', () => ({ useViewer: () => ({ ...mock.viewer }) }));
vi.mock('@/data/auth', async (original) => ({
  ...(await original<typeof import('@/data/auth')>()),
  getLastKnownAuthUid: () => mock.lastKnown,
  signIn: mock.signIn,
}));
vi.mock('../data/signup-state', async (original) => {
  const actual = await original<typeof import('../data/signup-state')>();
  return {
    ...actual,
    syncIssueButtonState: () => ({ ...actual.syncIssueButtonState(), ...(mock.syncOverride ?? {}) }),
  };
});
vi.mock('@/data/user-roles', () => ({
  // 測試同步更新（臨時取消時限）：詳情頁名單標籤讀 users 臨取欄位。
  getCachedUserLateCancel: () => undefined,
  loadUserRoles: async () => ({}),
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
vi.mock('../data/event-comments', async (original) => ({
  ...(await original<typeof import('../data/event-comments')>()),
  loadEventComments: mock.loadComments,
}));
vi.mock('../data/event-create-context', () => ({ operateContextFromViewer: () => ({}) }));
vi.mock('../data/operate-permissions', () => ({
  canOperateEventSite: () => false,
  canDeleteActivity: () => false,
  canCancelOwnActivity: () => false,
  canRemoveConfirmedParticipant: () => false,
  canManageTeamSplit: () => false,
  canViewEventOperationLog: () => false,
}));
vi.mock('../data/signup-profile', () => ({
  loadSignupProfile: async () => ({ gender: '男', birthday: '1990-01-01', exp: 0, lineNotifyBound: true }),
}));
vi.mock('../data/event-view-count', () => ({
  incrementEventViewCount: vi.fn(async () => null),
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
vi.mock('../components/legacy/GuestRosterSections', () => ({
  GuestRosterSections: () => <div data-testid="guest-roster" />,
}));
vi.mock('../components/legacy/EventDetailMainView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/legacy/EventDetailMainView')>()),
  CompanionSelectModal: () => null,
  EventDetailCover: () => null,
  EventDetailInfoSection: ({ event }: { event: { current?: number } }) => (
    <div data-testid="info">{`current:${String(event.current)}`}</div>
  ),
}));
vi.mock('../components/legacy/EventDetailPrimaryButton', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/legacy/EventDetailPrimaryButton')>()),
  EventDetailPrimaryButton: ({ state, disabled, onClick }: {
    state: { label: string };
    disabled: boolean;
    onClick: () => void;
  }) => (
    <button type="button" data-testid="primary" disabled={disabled} onClick={onClick}>{state.label}</button>
  ),
}));

const LOADING_TEXT = '活動資訊載入中...';
const SYNCING = '報名狀態同步中';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function baseEvent(extra: Record<string, unknown> = {}) {
  return {
    id: 'public-event',
    title: '週六友誼賽',
    date: '2099/01/01 10:00~11:00',
    location: '河濱球場',
    status: 'open',
    current: 3,
    waitlist: 0,
    max: 20,
    participants: [],
    waitlistNames: [],
    creatorUid: 'host',
    ...extra,
  };
}

function serverDetail(extra: Record<string, unknown> = {}) {
  return { eventDocId: 'doc-1', event: { ...baseEvent(extra), _docId: 'doc-1' } };
}

function writeListCache(owner: string, extra: Record<string, unknown> = {}): void {
  localStorage.setItem(EVENTS_SNAPSHOT_STORAGE_KEY, JSON.stringify({
    v: EVENTS_SNAPSHOT_FORMAT,
    owner,
    savedAt: Date.now(),
    events: [{ ...baseEvent(extra), _docId: 'doc-1' }],
  }));
}

function signIn(uid: string): void {
  mock.viewer.uid = uid;
  mock.viewer.role = 'user';
  mock.viewer.roleLevel = 1;
  mock.lastKnown = uid;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mock.viewer.uid = null;
  mock.viewer.role = 'guest';
  mock.viewer.roleLevel = 0;
  mock.lastKnown = undefined;
  mock.syncOverride = null;
  mock.history.mockResolvedValue([]);
  delete window.__fcbEarlyEvent;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('活動詳情回訪：列表快取先畫', () => {
  it('伺服器還沒回：不卡在「活動資訊載入中」，先顯示內容、按鈕同步中且按了無效；讀取次數與並行', async () => {
    signIn('member');
    writeListCache('uid:member');
    const pending = deferred<ReturnType<typeof serverDetail>>();
    mock.detail.mockReturnValue(pending.promise);

    render(<EventDetailPage id="public-event" />);

    expect(await screen.findByTestId('info')).toBeTruthy();
    expect(screen.queryByText(LOADING_TEXT)).toBeNull();
    expect(screen.getByText('週六友誼賽')).toBeTruthy();
    const primary = screen.getByTestId('primary') as HTMLButtonElement;
    expect(primary.textContent).toBe(SYNCING);
    expect(primary.disabled).toBe(true);
    fireEvent.click(primary);
    // 名單、留言、夥伴與管理入口都還沒出現；本場報名與活動文件並行讀
    expect(screen.queryByText('幫夥伴報名')).toBeNull();
    expect(screen.queryByTestId('guest-roster')).toBeNull();
    expect(mock.loadComments).not.toHaveBeenCalled();
    expect(mock.history).toHaveBeenCalledTimes(1);
    expect(mock.history).toHaveBeenCalledWith('member', 'doc-1');
    expect(mock.detail).toHaveBeenCalledTimes(1);
    expect(mock.toast).not.toHaveBeenCalled();

    await act(async () => { pending.resolve(serverDetail({ current: 7 })); });
    await waitFor(() => expect(screen.getByTestId('info').textContent).toBe('current:7'));
    await waitFor(() => expect(screen.getByTestId('primary').textContent).not.toBe(SYNCING));
    expect(screen.getByText('幫夥伴報名')).toBeTruthy();
    // 讀取次數與沒快取時相同：活動一次、本場報名一次
    expect(mock.detail).toHaveBeenCalledTimes(1);
    expect(mock.history).toHaveBeenCalledTimes(1);
  });

  it('先畫時可報名，伺服器回已結束：按鈕換成伺服器的狀態', async () => {
    signIn('member');
    writeListCache('uid:member');
    const pending = deferred<ReturnType<typeof serverDetail>>();
    mock.detail.mockReturnValue(pending.promise);
    render(<EventDetailPage id="public-event" />);
    expect(await screen.findByTestId('primary')).toBeTruthy();
    expect(screen.getByTestId('primary').textContent).toBe(SYNCING);
    await act(async () => { pending.resolve(serverDetail({ status: 'ended' })); });
    await waitFor(() => expect(screen.getByTestId('primary').textContent).toBe('已結束'));
    expect((screen.getByTestId('primary') as HTMLButtonElement).disabled).toBe(true);
  });

  it('沒有列表快取：照舊畫載入外殼，等伺服器', async () => {
    signIn('member');
    const pending = deferred<ReturnType<typeof serverDetail>>();
    mock.detail.mockReturnValue(pending.promise);
    render(<EventDetailPage id="public-event" />);
    expect(screen.getByText(LOADING_TEXT)).toBeTruthy();
    expect(screen.queryByTestId('primary')).toBeNull();
    await act(async () => { pending.resolve(serverDetail()); });
    expect(await screen.findByTestId('primary')).toBeTruthy();
    expect(mock.history).toHaveBeenCalledTimes(1);
  });

  it('伺服器說找不到：立刻換成找不到畫面，不留快取內容', async () => {
    signIn('member');
    writeListCache('uid:member');
    const pending = deferred<ReturnType<typeof serverDetail> | null>();
    mock.detail.mockReturnValue(pending.promise);
    render(<EventDetailPage id="public-event" />);
    expect(await screen.findByTestId('info')).toBeTruthy();
    await act(async () => { pending.resolve(null); });
    await waitFor(() => expect(screen.queryByTestId('info')).toBeNull());
    expect(screen.queryByTestId('primary')).toBeNull();
  });

  it('伺服器說已把本人列入黑名單（無報名）：換成找不到畫面', async () => {
    signIn('member');
    writeListCache('uid:member');
    const pending = deferred<ReturnType<typeof serverDetail>>();
    mock.detail.mockReturnValue(pending.promise);
    render(<EventDetailPage id="public-event" />);
    expect(await screen.findByTestId('info')).toBeTruthy();
    await act(async () => { pending.resolve(serverDetail({ blockedUids: ['member'] })); });
    await waitFor(() => expect(screen.queryByTestId('info')).toBeNull());
    expect(screen.queryByTestId('primary')).toBeNull();
    expect(mock.loadComments).not.toHaveBeenCalled();
  });

  it('伺服器讀取失敗：換成既有錯誤畫面，不留快取內容', async () => {
    signIn('member');
    writeListCache('uid:member');
    const pending = deferred<ReturnType<typeof serverDetail>>();
    mock.detail.mockReturnValue(pending.promise);
    render(<EventDetailPage id="public-event" />);
    expect(await screen.findByTestId('info')).toBeTruthy();
    await act(async () => { pending.reject(new Error('network')); });
    expect(await screen.findByText('events.detailPage.loadError')).toBeTruthy();
    expect(screen.queryByTestId('info')).toBeNull();
  });

  it('黑名單裡的使用者：不拿快取先畫，照舊畫載入外殼', async () => {
    signIn('member');
    writeListCache('uid:member', { blockedUids: ['member'] });
    mock.detail.mockReturnValue(new Promise(() => undefined));
    render(<EventDetailPage id="public-event" />);
    expect(screen.getByText(LOADING_TEXT)).toBeTruthy();
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('primary')).toBeNull();
    expect(screen.getByText(LOADING_TEXT)).toBeTruthy();
  });

  it('別的帳號的列表快取、或登入狀態未確定：不先畫', async () => {
    signIn('member');
    writeListCache('uid:someone-else');
    mock.detail.mockReturnValue(new Promise(() => undefined));
    const first = render(<EventDetailPage id="public-event" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('primary')).toBeNull();
    first.unmount();

    writeListCache('uid:member');
    mock.lastKnown = undefined;
    render(<EventDetailPage id="public-event" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('primary')).toBeNull();
    expect(screen.getByText(LOADING_TEXT)).toBeTruthy();
  });

  it('先畫期間換帳號：這一幀改畫載入外殼，不顯示前一個帳號的內容', async () => {
    signIn('member');
    writeListCache('uid:member');
    mock.detail.mockReturnValue(new Promise(() => undefined));
    const view = render(<EventDetailPage id="public-event" />);
    expect(await screen.findByTestId('primary')).toBeTruthy();

    signIn('other');
    view.rerender(<EventDetailPage id="public-event" />);
    expect(screen.queryByTestId('primary')).toBeNull();
    expect(screen.getByText(LOADING_TEXT)).toBeTruthy();
  });

  it('快速返回再進：第二次掛載仍先畫，前一次晚到的結果不影響', async () => {
    signIn('member');
    writeListCache('uid:member');
    const first = deferred<ReturnType<typeof serverDetail>>();
    const second = deferred<ReturnType<typeof serverDetail>>();
    mock.detail.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const view = render(<EventDetailPage id="public-event" />);
    expect(await screen.findByTestId('primary')).toBeTruthy();
    view.unmount();

    render(<EventDetailPage id="public-event" />);
    expect(await screen.findByTestId('primary')).toBeTruthy();
    expect(screen.queryByText(LOADING_TEXT)).toBeNull();
    expect(screen.getByTestId('primary').textContent).toBe(SYNCING);

    await act(async () => { first.resolve(serverDetail({ current: 99 })); });
    expect(screen.getByTestId('info').textContent).toBe('current:3');
    expect(screen.getByTestId('primary').textContent).toBe(SYNCING);

    await act(async () => { second.resolve(serverDetail({ current: 5 })); });
    await waitFor(() => expect(screen.getByTestId('info').textContent).toBe('current:5'));
    await waitFor(() => expect(screen.getByTestId('primary').textContent).not.toBe(SYNCING));
  });

  it('逾時：約 8 秒沒回來出現既有重試，按鈕維持同步中；晚到的結果照常收尾', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    signIn('member');
    writeListCache('uid:member');
    const pending = deferred<ReturnType<typeof serverDetail>>();
    mock.detail.mockReturnValue(pending.promise);
    render(<EventDetailPage id="public-event" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('primary').textContent).toBe(SYNCING);
    expect(screen.queryByText('events.detailPage.historyError')).toBeNull();

    await act(async () => { vi.advanceTimersByTime(PROVISIONAL_DETAIL_TIMEOUT_MS - 1); });
    expect(screen.queryByText('events.detailPage.historyError')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(screen.getByText('events.detailPage.historyError')).toBeTruthy();
    const primary = screen.getByTestId('primary') as HTMLButtonElement;
    expect(primary.textContent).toBe(SYNCING);
    expect(primary.disabled).toBe(true);

    await act(async () => { pending.resolve(serverDetail({ current: 4 })); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('info').textContent).toBe('current:4');
    expect(screen.queryByText('events.detailPage.historyError')).toBeNull();
    expect(screen.getByTestId('primary').textContent).not.toBe(SYNCING);
  });

  it('逾時後按重試：不再先畫、改畫載入外殼，活動與本場報名各重讀一次', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    signIn('member');
    writeListCache('uid:member');
    const first = deferred<ReturnType<typeof serverDetail>>();
    const second = deferred<ReturnType<typeof serverDetail>>();
    mock.detail.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<EventDetailPage id="public-event" />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(PROVISIONAL_DETAIL_TIMEOUT_MS); });
    expect(mock.history).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.click(screen.getByText('events.retry')); });
    expect(screen.getByText(LOADING_TEXT)).toBeTruthy();
    expect(screen.queryByTestId('primary')).toBeNull();
    expect(mock.detail).toHaveBeenCalledTimes(2);

    await act(async () => { second.resolve(serverDetail({ current: 6 })); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('info').textContent).toBe('current:6');
    expect(mock.history).toHaveBeenCalledTimes(2);
  });

  it('訪客先畫期間登入：這一幀改畫載入外殼，之後以登入者重讀', async () => {
    mock.lastKnown = null;
    writeListCache('guest');
    const guestRead = deferred<ReturnType<typeof serverDetail>>();
    mock.detail.mockReturnValue(guestRead.promise);
    const view = render(<EventDetailPage id="public-event" />);
    expect(await screen.findByTestId('primary')).toBeTruthy();

    signIn('member');
    view.rerender(<EventDetailPage id="public-event" />);
    expect(screen.queryByTestId('primary')).toBeNull();
    expect(screen.getByText(LOADING_TEXT)).toBeTruthy();

    await act(async () => { guestRead.resolve(serverDetail({ current: 8 })); });
    await waitFor(() => expect(screen.getByTestId('info').textContent).toBe('current:8'));
    await waitFor(() => expect(screen.getByTestId('primary').textContent).not.toBe(SYNCING));
    expect(mock.history).toHaveBeenCalledWith('member', 'doc-1');
  });

  it('訪客：先畫時按鈕也是同步中（不出現登入報名），伺服器回來才換', async () => {
    mock.lastKnown = null;
    writeListCache('guest');
    const pending = deferred<ReturnType<typeof serverDetail>>();
    mock.detail.mockReturnValue(pending.promise);
    render(<EventDetailPage id="public-event" />);
    expect(await screen.findByTestId('primary')).toBeTruthy();
    expect(screen.getByTestId('primary').textContent).toBe(SYNCING);
    expect(screen.queryByTestId('guest-roster')).toBeNull();
    expect(mock.history).not.toHaveBeenCalled();

    await act(async () => { pending.resolve(serverDetail()); });
    await waitFor(() => expect(screen.getByTestId('primary').textContent).not.toBe(SYNCING));
    expect(screen.getByTestId('guest-roster')).toBeTruthy();
    expect(mock.history).not.toHaveBeenCalled();
  });

  it('先畫期間主按鈕處理函式直接返回：即使按鈕狀態被改成可按（登入），按下也不動作（顧問 §3.231 P3）', async () => {
    mock.lastKnown = null;
    writeListCache('guest');
    mock.syncOverride = { action: 'login', disabled: false, label: '測試可按' };
    mock.detail.mockReturnValue(new Promise(() => undefined));
    render(<EventDetailPage id="public-event" />);
    const primary = await screen.findByTestId('primary') as HTMLButtonElement;
    expect(primary.textContent).toBe('測試可按');
    expect(primary.disabled).toBe(false);
    fireEvent.click(primary);
    // login() 內有動態 import，給足時間讓它若被呼叫就會走到 signIn。
    await act(async () => { await new Promise((done) => setTimeout(done, 100)); });
    expect(mock.signIn).not.toHaveBeenCalled();
  });
});
