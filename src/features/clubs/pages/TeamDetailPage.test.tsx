import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamDetailPage from './TeamDetailPage';
import { loadTeam, loadTeamMembers } from '../data/teams-repo';
import { leaveTeam, requestTeamJoin } from '../data/membership';
import { useViewer, requestViewerRefresh, type ViewerView } from '@/features/profile/data/viewer';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { loadViewerRegistrations } from '@/features/events/data/viewer-registrations';
import type { EventDoc, RegistrationDoc } from '@/features/events/data/types';
import type { TeamDoc, TeamMember, TeamRosterRow } from '../data/types';
import { clearPendingJoin, loginForClubs, _resetClubsSessionForTest } from './clubs-session';
import { canViewClubDetail } from '../club-policy';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import zh from '../locales/zh-TW.json';

const authUid = vi.hoisted(() => ({ value: undefined as string | null | undefined }));
const policyMock = vi.hoisted(() => ({
  reset: (): void => undefined,
}));

const routeState = vi.hoisted(() => ({ id: 'club', route: vi.fn() }));

vi.mock('preact-iso', () => ({
  useRoute: () => ({ params: { id: routeState.id } }),
  useLocation: () => ({ route: routeState.route, url: `/teams/${routeState.id}` }),
}));

vi.mock('../data/teams-repo', () => ({
  loadTeam: vi.fn(),
  loadTeamMembers: vi.fn(),
}));

vi.mock('../data/membership', () => ({
  requestTeamJoin: vi.fn(),
  leaveTeam: vi.fn(),
}));

vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: vi.fn(),
  requestViewerRefresh: vi.fn(),
}));

vi.mock('@/features/events/data/events-repo', () => ({ getEventsRepo: vi.fn() }));
vi.mock('@/features/events/data/viewer-registrations', () => ({ loadViewerRegistrations: vi.fn() }));

vi.mock('./clubs-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./clubs-session')>()),
  loginForClubs: vi.fn(),
}));

vi.mock('@/data/auth', () => ({
  getLastKnownAuthUid: () => authUid.value,
}));

vi.mock('../club-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../club-policy')>();
  const spy = vi.fn(actual.canViewClubDetail);
  policyMock.reset = () => {
    spy.mockReset();
    spy.mockImplementation(actual.canViewClubDetail);
  };
  // 測試同步更新：頁面改走 resolveClubDetailAccess。spy 與真政策一致時直接用真函式；
  // spy 被覆蓋時用真函式的 requiresLogin 參數表達「政策放行／拒絕」。
  const resolveClubDetailAccess: typeof actual.resolveClubDetailAccess = (
    viewer,
    authUid,
    requiresLogin,
  ) => {
    const realAllows = actual.canViewClubDetail(viewer, requiresLogin);
    const mockedAllows = spy(viewer, requiresLogin);
    if (mockedAllows === realAllows) {
      return actual.resolveClubDetailAccess(viewer, authUid, requiresLogin);
    }
    return actual.resolveClubDetailAccess(viewer, authUid, !mockedAllows);
  };
  return {
    ...actual,
    canViewClubDetail: spy,
    resolveClubDetailAccess,
  };
});

vi.mock('@/ui/AppConfirm', () => ({
  appConfirm: vi.fn(),
}));

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string, values?: Record<string, unknown>) => {
    let value: unknown = zh;
    for (const part of key.replace(/^clubs\./, '').split('.')) {
      value =
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)[part]
          : undefined;
    }
    const text = typeof value === 'string' ? value : key;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  },
}));

vi.mock('@/ui/UserTag', () => ({
  UserTag: ({
    uid,
    name,
    role,
    onOpenProfile,
  }: {
    uid: string;
    name: string;
    role: string;
    onOpenProfile: (uid: string) => void;
  }) => (
    <button
      type="button"
      class="user-capsule"
      data-uid={uid}
      data-role={role}
      onClick={() => onOpenProfile(uid)}
    >
      {name}
    </button>
  ),
}));

vi.mock('../components/legacy/LegacyTeamMembersCard', () => ({
  LegacyTeamMembersCard: ({
    roster,
    canManageMembers,
    onOpenProfile,
  }: {
    team: TeamDoc;
    roster: readonly TeamRosterRow[];
    canManageMembers: boolean;
    onOpenProfile: (uid: string) => void;
  }) => (
    <div data-testid="legacy-members-card" data-can-manage={String(canManageMembers)}>
      {roster.map((row) => (
        <button
          key={row.uid}
          type="button"
          data-uid={row.uid}
          onClick={() => onOpenProfile(row.uid)}
        >
          {row.name || row.uid}
        </button>
      ))}
    </div>
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function viewer(uid: string | null = 'u1', teamIds: string[] = []): ViewerView {
  return {
    uid,
    teamIds: new Set(teamIds),
    role: uid ? 'user' : 'guest',
    roleLevel: uid ? 1 : 0,
    displayName: uid ? '小明' : null,
    pictureUrl: null,
    capabilities: [],
    hasPermission: () => false,
  };
}

const team: TeamDoc = {
  id: 'club',
  name: '測試俱樂部',
  nameEn: 'Test FC',
  active: true,
  captainUid: 'captain',
  captain: '隊長甲',
  leaderUids: ['leader1'],
  leaders: ['領隊乙'],
  members: 23,
  bio: '俱樂部介紹',
  region: '台北市',
  sportTag: 'football',
  teamExp: 3500,
  themeColor: '#123456',
  contact: 'LINE: @testfc',
  wins: 3,
  draws: 1,
  losses: 1,
};

const loadEvents = vi.fn<() => Promise<string[]>>();
const snapshot = vi.fn<() => { active: EventDoc[]; terminal: EventDoc[] }>();

beforeEach(() => {
  vi.clearAllMocks();
  policyMock.reset();
  authUid.value = undefined;
  toast.clear();
  routeState.id = 'club';
  clearPendingJoin('club', 'u1');
  clearPendingJoin('club', 'u2');
  vi.mocked(useViewer).mockReturnValue(viewer());
  vi.mocked(loadTeam).mockResolvedValue(team);
  vi.mocked(loadTeamMembers).mockResolvedValue([]);
  vi.mocked(requestTeamJoin).mockResolvedValue({ groupId: 'group' });
  vi.mocked(leaveTeam).mockResolvedValue({ stillStaff: false });
  vi.mocked(loginForClubs).mockResolvedValue();
  vi.mocked(loadViewerRegistrations).mockResolvedValue([]);
  vi.mocked(appConfirm).mockResolvedValue(true);
  loadEvents.mockResolvedValue(['events']);
  snapshot.mockReturnValue({ active: [], terminal: [] });
  vi.mocked(getEventsRepo).mockReturnValue({
    loadEventsStatic: loadEvents,
    getSnapshot: snapshot,
    ensureTerminalEventsLoaded: vi.fn().mockResolvedValue([]),
    loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
  });
});

afterEach(() => {
  toast.clear();
  cleanup();
});

describe('TeamDetailPage (Legacy V2)', () => {
  it('renders legacy v2 shell, hero, stats, tabs and overview content', async () => {
    const { container } = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    const pageEl = container.querySelector('#page-team-detail.page.active.td-v2-active');
    expect(pageEl).toBeTruthy();
    const shell = container.querySelector('#team-detail-body .td-v2-shell[data-team-id="club"]');
    expect(shell).toBeTruthy();
    expect(shell?.getAttribute('style')).toContain('--td-v2-theme: #123456');

    expect(screen.getByText('Test FC')).toBeTruthy();
    expect(screen.getByText('足球')).toBeTruthy();
    expect(screen.getByText('台北市')).toBeTruthy();
    expect(screen.getByText('一般俱樂部 · 歡迎查看活動與成員')).toBeTruthy();
    expect(screen.getByText('3,500')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();

    expect(screen.getByText('俱樂部介紹')).toBeTruthy();
    expect(screen.getByText('LINE: @testfc')).toBeTruthy();

    const captainTag = screen.getByRole('button', { name: '隊長甲' });
    expect(captainTag.getAttribute('data-uid')).toBe('captain');
    fireEvent.click(captainTag);
    expect(routeState.route).toHaveBeenCalledWith('/profile/captain');

    const leaderTag = screen.getByRole('button', { name: '領隊乙' });
    expect(leaderTag.getAttribute('data-uid')).toBe('leader1');
  });

  it('switches tabs and respects section visibility including courses, record and feed', async () => {
    vi.mocked(loadTeam).mockResolvedValue({
      ...team,
      teachingEnabled: true,
      feed: [{ name: '管理員', text: '本週正常團練', time: '2026/05/01' }],
    });
    const { container } = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    const tabButtons = container.querySelectorAll('.td-v2-tab-list button');
    expect(Array.from(tabButtons).map((b) => b.textContent)).toEqual([
      '總覽',
      '課程',
      '活動',
      '成員',
      '戰績',
      '動態',
    ]);

    fireEvent.click(screen.getByRole('tab', { name: '課程' }));
    expect(container.querySelector('.td-v2-panel-courses.active')).toBeTruthy();
    expect(screen.getByText('接受新學員報名')).toBeTruthy();
    expect(screen.getByText('此功能尚未開放，請先使用舊版')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '戰績' }));
    expect(container.querySelector('.td-v2-panel-record.active')).toBeTruthy();
    expect(screen.getAllByText('60%').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: '動態' }));
    expect(container.querySelector('.td-v2-panel-feed.active')).toBeTruthy();
    expect(screen.getByText('本週正常團練')).toBeTruthy();
  });

  it('honours detailVisibility by hiding disabled tabs and sections', async () => {
    vi.mocked(loadTeam).mockResolvedValue({
      ...team,
      detailVisibility: {
        events: false,
        members: false,
        record: false,
        matches: false,
        bio: false,
        info: false,
      },
    });
    const { container } = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    const tabButtons = container.querySelectorAll('.td-v2-tab-list button');
    expect(Array.from(tabButtons).map((b) => b.textContent)).toEqual(['總覽', '動態']);
    expect(screen.queryByText('俱樂部介紹')).toBeNull();
    expect(loadTeamMembers).not.toHaveBeenCalled();
    expect(loadEvents).not.toHaveBeenCalled();
  });

  it('renders 14-day week calendar and navigates on event card click', async () => {
    const futureEvent: EventDoc = {
      id: 'ev1',
      title: '週六友誼賽',
      date: '2999/06/15 14:00~16:00',
      location: '百齡球場',
      status: 'open',
      current: 8,
      max: 16,
      teamOnly: true,
      creatorTeamId: 'club',
    } as EventDoc;

    snapshot.mockReturnValue({ active: [futureEvent], terminal: [] });
    vi.mocked(useViewer).mockReturnValue(viewer('u1', ['club']));

    const { container } = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    fireEvent.click(screen.getByRole('tab', { name: /活動/ }));
    const days = container.querySelectorAll('.td-v2-week .td-v2-day');
    expect(days.length).toBe(14);
    expect(container.querySelector('.td-v2-week .td-v2-day.active')).toBeTruthy();

    await waitFor(() =>
      expect(container.querySelectorAll('.td-v2-panel-events .td-v2-event-card').length).toBe(1),
    );
    const cards = container.querySelectorAll('.td-v2-panel-events .td-v2-event-card');
    expect(cards[0]?.textContent).toContain('週六友誼賽');
    expect(cards[0]?.textContent).toContain('報名中');
    expect(cards[0]?.textContent).toContain('8/16 名');

    fireEvent.click(cards[0]!);
    expect(routeState.route).toHaveBeenCalledWith('/events/ev1');
  });

  it('shows login entry for guest roster and triggers login on guest join', async () => {
    // 測試同步更新：已知訪客預設被詳情閘門擋住。此案例把 canViewClubDetail mock 成 true
    //（模擬常數改 false），訪客才看得到詳情與「登入後查看成員」。
    authUid.value = null;
    vi.mocked(canViewClubDetail).mockReturnValue(true);
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    vi.mocked(loadTeamMembers).mockResolvedValue(null);
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    expect(screen.queryByText('請先登入 LINE 帳號')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '成員' }));
    await screen.findByText('登入後查看成員');
    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    await waitFor(() => expect(loginForClubs).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '加入俱樂部' }));
    await waitFor(() => expect(loginForClubs).toHaveBeenCalledTimes(2));
    expect(requestTeamJoin).not.toHaveBeenCalled();
  });

  it('passes roster and canManageMembers to LegacyTeamMembersCard', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer('captain', ['club']));
    vi.mocked(loadTeamMembers).mockResolvedValue([
      { uid: 'captain', displayName: '隊長甲' },
      { uid: 'member', displayName: '成員乙', teamIds: ['club'] },
    ]);
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    fireEvent.click(screen.getByRole('tab', { name: '成員' }));

    const card = await screen.findByTestId('legacy-members-card');
    expect(card.getAttribute('data-can-manage')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '成員乙' }));
    expect(routeState.route).toHaveBeenCalledWith('/profile/member');
  });

  it('confirms join via appConfirm, shows toast and retains pending state', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    fireEvent.click(screen.getByRole('button', { name: '加入俱樂部' }));
    await waitFor(() =>
      expect(appConfirm).toHaveBeenCalledWith('確定要加入「測試俱樂部」俱樂部？'),
    );
    await waitFor(() => expect(requestTeamJoin).toHaveBeenCalledTimes(1));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: '已送出加入申請！' }),
    );

    const pendingBtn = await screen.findByRole('button', { name: '審核中' });
    fireEvent.click(pendingBtn);
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '您已申請此俱樂部，請等候審核（可於 24 小時後再次申請）',
      }),
    );
  });

  it('blocks captain and leader from leaving with legacy toast messages', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    vi.mocked(useViewer).mockReturnValue(viewer('captain', ['club']));
    const view = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    fireEvent.click(screen.getByRole('button', { name: '退出俱樂部' }));
    await waitFor(() => expect(appConfirm).toHaveBeenCalledTimes(1));
    expect(leaveTeam).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '經理無法退出俱樂部，請先轉移經理職務',
      }),
    );

    vi.mocked(useViewer).mockReturnValue(viewer('leader1', ['club']));
    view.rerender(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    fireEvent.click(screen.getByRole('button', { name: '退出俱樂部' }));
    await waitFor(() => expect(appConfirm).toHaveBeenCalledTimes(2));
    expect(leaveTeam).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '領隊無法退出俱樂部，請先轉移領隊職務',
      }),
    );
  });

  it('confirms leave for normal member and shows legacy success toast', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    vi.mocked(useViewer).mockReturnValue(viewer('u1', ['club']));
    const { container } = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    expect(container.querySelector('.td-v2-cta-bar.has-leave')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '已加入' }));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: '您已加入此俱樂部' }),
    );

    fireEvent.click(screen.getByRole('button', { name: '退出俱樂部' }));
    await waitFor(() =>
      expect(appConfirm).toHaveBeenCalledWith('確定要退出「測試俱樂部」俱樂部？退出後如需重新加入，可能需要再次送出申請。'),
    );
    await waitFor(() => expect(leaveTeam).toHaveBeenCalledTimes(1));
    expect(requestViewerRefresh).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: '已退出「測試俱樂部」' }),
    );
  });

  it('shows unavailable toast for unimplemented actions and respects invite disabled rule', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    // 非成員且非經理/教練：invite 應 disabled
    const view = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    const inviteBtn = screen.getByRole('button', { name: '邀請 QR' }) as HTMLButtonElement;
    expect(inviteBtn.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '分享俱樂部' }));
    expect(toastSpy).toHaveBeenCalledWith({ message: '此功能尚未開放，請先使用舊版' });

    fireEvent.click(screen.getByRole('button', { name: '聯繫負責人' }));
    expect(toastSpy).toHaveBeenCalledTimes(2);

    // 經理身分：顯示頭像/封面編輯按鈕且 invite 啟用
    vi.mocked(useViewer).mockReturnValue(viewer('captain', ['club']));
    view.rerender(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    expect((screen.getByRole('button', { name: '邀請 QR' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: '更換俱樂部封面' }));
    fireEvent.click(screen.getByRole('button', { name: '更換俱樂部頭像' }));
    expect(toastSpy).toHaveBeenCalledTimes(4);
  });

  it('handles loading, error retry and not-found states with legacy v2 shell', async () => {
    const pendingLoad = deferred<TeamDoc | null>();
    vi.mocked(loadTeam).mockReturnValueOnce(pendingLoad.promise);
    render(<TeamDetailPage />);
    expect(screen.getByText('載入中…')).toBeTruthy();

    await act(async () => pendingLoad.reject(new Error('network')));
    await screen.findByText('載入失敗');

    vi.mocked(loadTeam).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    await screen.findByText('找不到此俱樂部');
    fireEvent.click(screen.getByRole('button', { name: '返回俱樂部列表' }));
    expect(routeState.route).toHaveBeenCalledWith('/teams');
  });

  it('discards stale team and member responses when route changes', async () => {
    const oldMembers = deferred<TeamMember[] | null>();
    vi.mocked(loadTeam).mockImplementation((id) =>
      Promise.resolve({ ...team, id, name: id === 'club' ? '舊俱樂部' : '新俱樂部' }),
    );
    vi.mocked(loadTeamMembers).mockImplementation((loaded) =>
      loaded.id === 'club'
        ? oldMembers.promise
        : Promise.resolve([{ uid: 'new-user', displayName: '新成員', teamIds: ['new'] }]),
    );
    const view = render(<TeamDetailPage />);
    await waitFor(() => expect(loadTeamMembers).toHaveBeenCalled());
    routeState.id = 'new';
    view.rerender(<TeamDetailPage />);
    await screen.findByText('新俱樂部');
    fireEvent.click(screen.getByRole('tab', { name: '成員' }));
    await screen.findByRole('button', { name: '新成員' });
    await act(async () =>
      oldMembers.resolve([{ uid: 'old-user', displayName: '舊成員', teamIds: ['club'] }]),
    );
    expect(screen.queryByRole('button', { name: '舊成員' })).toBeNull();
  });

  it('shows the club for a signed-in viewer and does not show the login gate', async () => {
    authUid.value = 'u1';
    vi.mocked(useViewer).mockReturnValue(viewer('u1'));
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    expect(screen.queryByText('請先登入 LINE 帳號')).toBeNull();
    expect(loginForClubs).not.toHaveBeenCalled();
    expect(loadTeam).toHaveBeenCalledWith('club');
  });

  it('shows the login gate for a known guest and does not load the club', async () => {
    authUid.value = null;
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    render(<TeamDetailPage />);

    expect(await screen.findByText('請先登入 LINE 帳號')).toBeTruthy();
    expect(screen.getByRole('button', { name: '返回' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '登入' }).className).toContain('primary-btn');
    expect(screen.queryByText('測試俱樂部')).toBeNull();
    expect(screen.queryByText('載入中…')).toBeNull();
    expect(loadTeam).not.toHaveBeenCalled();
    expect(loadTeamMembers).not.toHaveBeenCalled();
    expect(getEventsRepo).not.toHaveBeenCalled();
    expect(loginForClubs).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    await waitFor(() => expect(loginForClubs).toHaveBeenCalledTimes(1));
    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
    replaceSpy.mockRestore();
  });

  it('gives the login gate button a 44px minimum touch height', async () => {
    authUid.value = null;
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    render(<TeamDetailPage />);

    expect(await screen.findByText('請先登入 LINE 帳號')).toBeTruthy();
    const button = screen.getByRole('button', { name: '登入' });
    expect(button.getAttribute('style')).toContain('min-height: 44px');
  });

  it('loads the same club id only after the uid arrives', async () => {
    // 測試同步更新：分階段。先只把 auth 改成字串，viewer 仍是訪客；再單獨給 viewer uid。
    authUid.value = undefined;
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    const view = render(<TeamDetailPage />);

    expect(screen.getByText('載入中…')).toBeTruthy();
    expect(screen.queryByText('請先登入 LINE 帳號')).toBeNull();
    expect(screen.queryByRole('button', { name: '登入' })).toBeNull();
    expect(loginForClubs).not.toHaveBeenCalled();
    expect(loadTeam).not.toHaveBeenCalled();

    authUid.value = 'u1';
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    view.rerender(<TeamDetailPage />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('載入中…')).toBeTruthy();
    expect(screen.queryByText('請先登入 LINE 帳號')).toBeNull();
    expect(loginForClubs).not.toHaveBeenCalled();
    expect(loadTeam).not.toHaveBeenCalled();

    vi.mocked(useViewer).mockReturnValue(viewer('u1'));
    view.rerender(<TeamDetailPage />);

    await screen.findByText('測試俱樂部');
    expect(loadTeam).toHaveBeenCalledWith('club');
    expect(screen.queryByText('請先登入 LINE 帳號')).toBeNull();
    expect(loginForClubs).not.toHaveBeenCalled();
  });

  it('shows the gate when unknown auth settles to a guest', async () => {
    authUid.value = undefined;
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    const view = render(<TeamDetailPage />);

    expect(screen.getByText('載入中…')).toBeTruthy();
    expect(loadTeam).not.toHaveBeenCalled();
    expect(loginForClubs).not.toHaveBeenCalled();

    authUid.value = null;
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    view.rerender(<TeamDetailPage />);

    expect(await screen.findByText('請先登入 LINE 帳號')).toBeTruthy();
    expect(screen.getByRole('button', { name: '登入' })).toBeTruthy();
    expect(screen.queryByText('載入中…')).toBeNull();
    expect(screen.queryByText('測試俱樂部')).toBeNull();
    expect(loadTeam).not.toHaveBeenCalled();
    expect(loginForClubs).not.toHaveBeenCalled();
  });

  it('loads the club when policy allows even if auth is still unknown', async () => {
    // 測試同步更新：真 resolveClubDetailAccess；canViewClubDetail 固定 true，模擬常數改 false。
    authUid.value = undefined;
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    vi.mocked(canViewClubDetail).mockReturnValue(true);
    const pendingLoad = deferred<TeamDoc | null>();
    vi.mocked(loadTeam).mockReturnValue(pendingLoad.promise);

    render(<TeamDetailPage />);

    await waitFor(() => expect(loadTeam).toHaveBeenCalledWith('club'));
    expect(screen.queryByText('請先登入 LINE 帳號')).toBeNull();
    expect(loginForClubs).not.toHaveBeenCalled();

    await act(async () => pendingLoad.resolve(team));
    await screen.findByText('測試俱樂部');
  });

  it('shows the gate for a whitespace-only uid when auth is null', async () => {
    authUid.value = null;
    vi.mocked(useViewer).mockReturnValue(viewer('   '));
    render(<TeamDetailPage />);

    expect(await screen.findByText('請先登入 LINE 帳號')).toBeTruthy();
    expect(screen.queryByText('測試俱樂部')).toBeNull();
    expect(loadTeam).not.toHaveBeenCalled();
    expect(loadTeamMembers).not.toHaveBeenCalled();
    expect(getEventsRepo).not.toHaveBeenCalled();
    expect(loginForClubs).not.toHaveBeenCalled();
  });

  it('shows that same club after a reload once the viewer has a uid', async () => {
    // 模擬登入完成後以相同 /teams/club 重新載入。
    routeState.id = 'club';
    authUid.value = 'u1';
    vi.mocked(useViewer).mockReturnValue(viewer('u1'));
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    expect(loadTeam).toHaveBeenCalledWith('club');
    expect(screen.queryByText('請先登入 LINE 帳號')).toBeNull();
  });
});

describe('join pending persistence (M-117)', () => {
  const key = 'club-join-pending:u1:club';

  beforeEach(() => {
    localStorage.clear();
    _resetClubsSessionForTest();
    authUid.value = 'u1';
    vi.mocked(useViewer).mockReturnValue(viewer('u1'));
  });

  it('重新整理後顯示審核中，點擊提示剩餘時間且不重送', async () => {
    localStorage.setItem(key, JSON.stringify({ sentAt: Date.now() }));
    _resetClubsSessionForTest();
    const toastSpy = vi.spyOn(toast, 'show');
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    fireEvent.click(await screen.findByRole('button', { name: '審核中' }));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '您已申請此俱樂部，請等候審核（可於 24 小時後再次申請）',
      }),
    );
    expect(requestTeamJoin).not.toHaveBeenCalled();
  });

  it('過期後顯示加入俱樂部並移除本機紀錄', async () => {
    localStorage.setItem(key, JSON.stringify({ sentAt: Date.now() - 25 * 60 * 60 * 1000 }));
    _resetClubsSessionForTest();
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    expect(await screen.findByRole('button', { name: '加入俱樂部' })).toBeTruthy();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('另一個 uid 不會沿用原使用者的審核中紀錄', async () => {
    localStorage.setItem(key, JSON.stringify({ sentAt: Date.now() }));
    _resetClubsSessionForTest();
    authUid.value = 'u2';
    vi.mocked(useViewer).mockReturnValue(viewer('u2'));
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    expect(await screen.findByRole('button', { name: '加入俱樂部' })).toBeTruthy();
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(requestTeamJoin).not.toHaveBeenCalled();
  });

  it('確認加入成功後保存本機紀錄', async () => {
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    fireEvent.click(screen.getByRole('button', { name: '加入俱樂部' }));
    await waitFor(() =>
      expect(appConfirm).toHaveBeenCalledWith('確定要加入「測試俱樂部」俱樂部？'),
    );
    await waitFor(() => expect(requestTeamJoin).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: '審核中' })).toBeTruthy();
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toEqual({
      sentAt: expect.any(Number),
    });
  });

  it('setItem 丟例外時加入仍成功並以記憶體顯示審核中', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      render(<TeamDetailPage />);
      await screen.findByText('測試俱樂部');

      fireEvent.click(screen.getByRole('button', { name: '加入俱樂部' }));
      await waitFor(() =>
        expect(appConfirm).toHaveBeenCalledWith('確定要加入「測試俱樂部」俱樂部？'),
      );
      await waitFor(() => expect(requestTeamJoin).toHaveBeenCalledTimes(1));
      const pendingBtn = await screen.findByRole('button', { name: '審核中' });
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: '已送出加入申請！' }),
      );
      expect(setItemSpy).toHaveBeenCalledWith(key, expect.any(String));
      expect(localStorage.getItem(key)).toBeNull();

      fireEvent.click(pendingBtn);
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '您已申請此俱樂部，請等候審核（可於 24 小時後再次申請）',
        }),
      );
      expect(requestTeamJoin).toHaveBeenCalledTimes(1);
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it('已成為成員時清除本機申請紀錄', async () => {
    localStorage.setItem(key, JSON.stringify({ sentAt: Date.now() }));
    _resetClubsSessionForTest();
    vi.mocked(useViewer).mockReturnValue(viewer('u1', ['club']));
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
    expect(requestTeamJoin).not.toHaveBeenCalled();
  });
});
