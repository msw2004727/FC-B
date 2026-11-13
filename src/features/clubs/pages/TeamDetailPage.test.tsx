import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamDetailPage from './TeamDetailPage';
import { useCreateEventEntry } from '@/features/events/components/event-form/use-create-event-entry';
import { useEventFormPostSave } from '@/features/events/components/event-form/use-event-form-post-save';
import type {
  EventFormModalProps,
  EventFormPreset,
} from '@/features/events/components/EventFormModal';
import { getSportKeySafe } from '@/features/events/data/sports';
import { _resetTeamTabMemoryForTest } from '../components/legacy/team-detail-tab-memory';
import { renderEventRows, TeamDetailV2Panels, type TeamDetailV2PanelsProps } from '../components/legacy/TeamDetailV2Panels';
import type { TeamDetailWeekStripProps } from '../components/legacy/TeamDetailWeekStrip';
import { loadTeam, loadTeamMembers } from '../data/teams-repo';
import { leaveTeam, requestTeamJoin } from '../data/membership';
import { deleteTeamViaCallable } from '../data/teams-admin-write';
import { useViewer, requestViewerRefresh, type ViewerView } from '@/features/profile/data/viewer';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { loadViewerRegistrations } from '@/features/events/data/viewer-registrations';
import type { EventDoc, RegistrationDoc } from '@/features/events/data/types';
import type { ClubViewer, TeamDoc, TeamMember, TeamRosterRow } from '../data/types';
import { clearPendingJoin, loginForClubs, _resetClubsSessionForTest } from './clubs-session';
import { canShowInviteQr, canViewClubDetail } from '../club-policy';
import { canInviteToTeam } from '../components/legacy/TeamDetailV2Header';
import { useTeamImageUpload } from '../components/legacy/use-team-image-upload';
import type { TeamSettingsModalProps } from '../components/legacy/TeamSettingsModal';
import type { TeamFormProps } from '../components/legacy/use-team-form';
import { renderQrToCanvas } from '@/features/profile/data/qr';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import zh from '../locales/zh-TW.json';

const weekToday = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('../components/legacy/TeamDetailWeekStrip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/legacy/TeamDetailWeekStrip')>();
  return {
    ...actual,
    TeamDetailWeekStrip: (props: TeamDetailWeekStripProps) => (
      <actual.TeamDetailWeekStrip {...props}
        today={weekToday.value ? new Date(Date.parse(weekToday.value)) : props.today} />
    ),
  };
});

const authUid = vi.hoisted(() => ({ value: undefined as string | null | undefined }));
const policyMock = vi.hoisted(() => ({
  reset: (): void => undefined,
}));

const routeState = vi.hoisted(() => ({ id: 'club', route: vi.fn() }));
const pickMock = vi.hoisted(() => vi.fn());
// 測試同步更新：新增活動入口與表單改用 stub，保留真實 Panels 的 DOM。
const customMock = vi.hoisted(() => vi.fn());
const eventFormMock = vi.hoisted(() => ({
  latestProps: null as EventFormModalProps | null,
}));
const panelsMock = vi.hoisted(() => ({
  latestProps: null as TeamDetailV2PanelsProps | null,
}));
const membersCardMock = vi.hoisted(() => ({
  onTeamChanged: null as (() => void | Promise<void>) | null,
}));

vi.mock('@/features/events/components/event-form/use-create-event-entry', () => ({
  useCreateEventEntry: vi.fn(),
}));

vi.mock('@/features/events/components/EventFormModal', () => ({
  EventFormModal: (props: EventFormModalProps) => {
    eventFormMock.latestProps = props;
    return <div data-testid="event-form-stub" data-open={String(props.open)} />;
  },
}));

vi.mock('@/features/events/components/event-form/use-event-form-post-save', () => ({
  useEventFormPostSave: vi.fn(() => vi.fn()),
}));

vi.mock('../components/legacy/TeamDetailV2Panels', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../components/legacy/TeamDetailV2Panels')
  >();
  return {
    ...actual,
    TeamDetailV2Panels: (props: TeamDetailV2PanelsProps) => {
      panelsMock.latestProps = props;
      return <actual.TeamDetailV2Panels {...props} />;
    },
  };
});
const settingsModalMock = vi.hoisted(() => ({
  latestProps: null as TeamSettingsModalProps | null,
}));

const teamFormMock = vi.hoisted(() => ({
  latestProps: null as (TeamFormProps & { open: boolean }) | null,
}));

// 本檔保留頁面接線測試；真表單整頁流程在 TeamDetailPage.edit-basic.test.tsx。
vi.mock('../components/legacy/TeamFormModal', () => ({
  TeamFormModal: (props: TeamFormProps & { open: boolean }) => {
    teamFormMock.latestProps = props;
    if (!props.open) return null;
    return (
      <div role="dialog" aria-label="編輯俱樂部基本資料">
        <button type="button" onClick={props.onClose}>
          關閉表單
        </button>
      </div>
    );
  },
}));

vi.mock('../components/legacy/TeamSettingsModal', () => ({
  TeamSettingsModal: (props: TeamSettingsModalProps) => {
    settingsModalMock.latestProps = props;
    return (
      <div role="dialog" aria-label="俱樂部設定">
        <button type="button" onClick={() => props.onClose()}>
          關閉
        </button>
        <button type="button" onClick={() => { void props.onSaved(); }}>
          已儲存
        </button>
        <button type="button" onClick={() => props.onEditBasic()}>
          編輯基本資料
        </button>
        {props.onDeleteTeam ? (
          <button type="button" disabled={props.deleting === true} onClick={() => props.onDeleteTeam?.()}>
            刪除俱樂部
          </button>
        ) : null}
      </div>
    );
  },
}));

vi.mock('../components/legacy/use-team-image-upload', () => ({
  useTeamImageUpload: vi.fn(),
}));

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

vi.mock('../data/teams-admin-write', () => ({
  deleteTeamViaCallable: vi.fn(),
}));

vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: vi.fn(),
  requestViewerRefresh: vi.fn(),
}));

vi.mock('@/features/profile/data/qr', () => ({
  renderQrToCanvas: vi.fn().mockResolvedValue(undefined),
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

// K1：課程頁籤內容另有完整測試（education/components/CourseTab.test.tsx）；這裡只驗頁籤開關與按需載入。
const courseFlag = vi.hoisted(() => ({ on: false }));
vi.mock('@/features/education/flags', () => ({
  SHOW_COURSES: false,
  get COURSES_ENABLED() {
    return courseFlag.on;
  },
}));
vi.mock('@/features/education/components/CourseTab', () => ({
  CourseTab: (props: { team: TeamDoc }) => <div data-testid="course-tab-stub">{String(props.team.name ?? '')}</div>,
}));

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

// 測試同步更新：記錄 viewer 與成員管理完成後的重讀 callback。
vi.mock('../components/legacy/LegacyTeamMembersCard', () => ({
  LegacyTeamMembersCard: ({
    roster,
    viewer,
    onTeamChanged,
    onOpenProfile,
  }: {
    team: TeamDoc;
    roster: readonly TeamRosterRow[];
    viewer: ClubViewer;
    onTeamChanged: () => void | Promise<void>;
    onOpenProfile: (uid: string) => void;
  }) => {
    membersCardMock.onTeamChanged = onTeamChanged;
    return (
      <div
        data-testid="legacy-members-card"
        data-viewer-uid={viewer.uid}
        data-has-on-team-changed={String(typeof onTeamChanged === 'function')}
      >
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
    );
  },
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
  // 測試同步更新：每個案例獨立清除頁籤記憶並重設新增活動 hook。
  _resetTeamTabMemoryForTest();
  customMock.mockClear();
  eventFormMock.latestProps = null;
  panelsMock.latestProps = null;
  weekToday.value = undefined;
  membersCardMock.onTeamChanged = null;
  vi.mocked(useCreateEventEntry).mockReturnValue({
    canCreate: true,
    profileLocked: false,
    buttonProps: { lockedClass: '' },
    onClick: vi.fn(),
    onClickCustom: customMock,
    preset: null,
    formOpen: false,
    closeForm: vi.fn(),
    overlays: null,
  });
  vi.mocked(useEventFormPostSave).mockImplementation(() => vi.fn());
  pickMock.mockClear();
  settingsModalMock.latestProps = null;
  teamFormMock.latestProps = null;
  vi.mocked(useTeamImageUpload).mockReturnValue({
    pick: pickMock,
    busyKind: null,
    overlay: null,
  });
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
  it('remembers the selected tab after remounting the same club', async () => {
    vi.mocked(useViewer).mockReturnValue({
      ...viewer('captain', ['club']),
      role: 'coach',
    });
    const first = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    fireEvent.click(screen.getByRole('tab', { name: '成員' }));
    expect(first.container.querySelector('.td-v2-panel-members.active')).toBeTruthy();

    cleanup();
    const second = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    expect(second.container.querySelector('.td-v2-panel-members.active')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '成員' }).getAttribute('aria-selected')).toBe('true');
  });

  it('starts another club on overview and restores the first club tab on return', async () => {
    vi.mocked(useViewer).mockReturnValue({
      ...viewer('captain', ['club', 'other-club']),
      role: 'coach',
    });
    vi.mocked(loadTeam).mockImplementation((id) => Promise.resolve({
      ...team,
      id,
      name: id === 'club' ? '測試俱樂部' : '另一俱樂部',
    }));
    const view = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    fireEvent.click(screen.getByRole('tab', { name: '成員' }));

    routeState.id = 'other-club';
    view.rerender(<TeamDetailPage />);
    await screen.findByText('另一俱樂部');
    expect(view.container.querySelector('.td-v2-panel-overview.active')).toBeTruthy();

    routeState.id = 'club';
    view.rerender(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    expect(view.container.querySelector('.td-v2-panel-members.active')).toBeTruthy();
  });

  it('falls back to overview when a remembered tab is hidden', async () => {
    vi.mocked(useViewer).mockReturnValue({
      ...viewer('captain', ['club']),
      role: 'coach',
    });
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    fireEvent.click(screen.getByRole('tab', { name: '成員' }));

    cleanup();
    vi.mocked(loadTeam).mockResolvedValue({
      ...team,
      detailVisibility: { members: false },
    });
    const view = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    expect(screen.queryByRole('tab', { name: '成員' })).toBeNull();
    expect(view.container.querySelector('.td-v2-panel-overview.active')).toBeTruthy();
  });

  it('uses trimmed team ids for tab memory', async () => {
    routeState.id = '  club  ';
    vi.mocked(loadTeam).mockResolvedValue({ ...team, id: ' club ' });
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    expect(loadTeam).toHaveBeenCalledWith('club');
    fireEvent.click(screen.getByRole('tab', { name: '成員' }));

    cleanup();
    routeState.id = 'club';
    vi.mocked(loadTeam).mockResolvedValue(team);
    const view = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    expect(view.container.querySelector('.td-v2-panel-members.active')).toBeTruthy();
  });

  it('smoothly scrolls the shell from both header and panel tab controls', async () => {
    const { container } = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    const shell = container.querySelector<HTMLDivElement>('.td-v2-shell');
    if (!shell) throw new Error('缺少詳情外殼');
    const scrollIntoView = vi.fn();
    shell.scrollIntoView = scrollIntoView;

    fireEvent.click(screen.getByRole('tab', { name: '成員' }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: 'start',
      behavior: 'smooth',
    });

    fireEvent.click(screen.getByRole('tab', { name: '總覽' }));
    // 測試同步更新（C1）：快速導覽拿掉，改由數字列的「活動」切頁籤。
    const stat = container.querySelector<HTMLButtonElement>(
      '.td-v2-stats .td-v2-stat[data-tab="events"]',
    );
    if (!stat) throw new Error('缺少數字列的活動捷徑');
    fireEvent.click(stat);
    expect(scrollIntoView).toHaveBeenCalledTimes(3);
    expect(container.querySelector('.td-v2-panel-events.active')).toBeTruthy();
  });

  it('still switches tabs when scrollIntoView throws', async () => {
    const { container } = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    const shell = container.querySelector<HTMLDivElement>('.td-v2-shell');
    if (!shell) throw new Error('缺少詳情外殼');
    shell.scrollIntoView = vi.fn(() => {
      throw new Error('scroll unavailable');
    });

    fireEvent.click(screen.getByRole('tab', { name: '成員' }));
    expect(container.querySelector('.td-v2-panel-members.active')).toBeTruthy();
  });

  it('opens a custom club event with the club preset for a coach captain', async () => {
    vi.mocked(useViewer).mockReturnValue({
      ...viewer('captain', ['club']),
      role: 'coach',
    });
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    fireEvent.click(screen.getByRole('tab', { name: /活動/ }));

    fireEvent.click(screen.getByRole('button', { name: '+ 新增俱樂部活動' }));
    expect(customMock).toHaveBeenCalledTimes(1);
    expect(customMock).toHaveBeenCalledWith({
      teamIds: ['club'],
      teamNames: ['測試俱樂部'],
      sportTag: getSportKeySafe('football'),
    });
  });

  it('hides create entry from a normal member and guards direct handler calls', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    vi.mocked(useViewer).mockReturnValue(viewer('u1', ['club']));
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    fireEvent.click(screen.getByRole('tab', { name: /活動/ }));

    expect(screen.queryByRole('button', { name: '+ 新增俱樂部活動' })).toBeNull();
    const props = panelsMock.latestProps;
    if (!props) throw new Error('缺少 Panels props');
    expect(props.canCreateEvent).toBe(false);
    act(() => props.onCreateEvent());

    expect(customMock).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith({
      message: '只有俱樂部職員可以新增俱樂部活動',
    });
  });

  it('reloads events through the post-save refresh callback', async () => {
    vi.mocked(useViewer).mockReturnValue({
      ...viewer('captain', ['club']),
      role: 'coach',
    });
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(1));
    expect(loadEvents).toHaveBeenNthCalledWith(1, {
      terminalMode: 'none',
      reuseActiveIfFresh: true,
    });

    const call = vi.mocked(useEventFormPostSave).mock.calls.at(-1);
    if (!call) throw new Error('缺少表單儲存後 hook 呼叫');
    const repoCalls = vi.mocked(getEventsRepo).mock.calls.length;
    const loadCalls = loadEvents.mock.calls.length;
    await act(async () => {
      await call[0].refresh();
    });

    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(loadCalls + 1));
    expect(getEventsRepo).toHaveBeenCalledTimes(repoCalls + 1);
    expect(loadEvents).toHaveBeenLastCalledWith({ terminalMode: 'none' });
  });

  it('重試活動時不沿用 30 秒內的 active 快照', async () => {
    loadEvents.mockReset();
    loadEvents.mockRejectedValueOnce(new Error('fail'));
    loadEvents.mockResolvedValue(['events']);
    vi.mocked(useViewer).mockReturnValue({
      ...viewer('captain', ['club']),
      role: 'coach',
    });
    const { container } = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(1));
    expect(loadEvents).toHaveBeenNthCalledWith(1, {
      terminalMode: 'none',
      reuseActiveIfFresh: true,
    });

    fireEvent.click(screen.getByRole('tab', { name: /活動/ }));
    const panel = container.querySelector('.td-v2-panel-events');
    if (!panel) throw new Error('缺少活動面板');
    const retry = await within(panel as HTMLElement).findByRole('button', { name: '重試' });
    fireEvent.click(retry);

    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(2));
    expect(loadEvents).toHaveBeenLastCalledWith({ terminalMode: 'none' });
  });

  it('forwards preset, open, viewer and callbacks to the form and mounts overlays', async () => {
    const manager: ViewerView = {
      ...viewer('captain', ['club']),
      role: 'coach',
    };
    const preset: EventFormPreset = {
      teamIds: ['club'],
      teamNames: ['測試俱樂部'],
      sportTag: getSportKeySafe('football'),
    };
    const closeForm = vi.fn();
    const onSaved = vi.fn<EventFormModalProps['onSaved']>();
    vi.mocked(useViewer).mockReturnValue(manager);
    vi.mocked(useEventFormPostSave).mockReturnValue(onSaved);
    vi.mocked(useCreateEventEntry).mockReturnValue({
      canCreate: true,
      profileLocked: false,
      buttonProps: { lockedClass: '' },
      onClick: vi.fn(),
      onClickCustom: customMock,
      preset,
      formOpen: true,
      closeForm,
      overlays: <div data-testid="create-entry-overlay" />,
    });
    const view = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    await screen.findByTestId('event-form-stub');

    expect(eventFormMock.latestProps?.preset).toBe(preset);
    expect(eventFormMock.latestProps?.open).toBe(true);
    expect(eventFormMock.latestProps?.mode).toBe('create');
    expect(eventFormMock.latestProps?.viewer).toBe(manager);
    expect(eventFormMock.latestProps?.onClose).toBe(closeForm);
    expect(eventFormMock.latestProps?.onSaved).toBe(onSaved);
    expect(screen.getByTestId('event-form-stub').getAttribute('data-open')).toBe('true');
    expect(screen.getByTestId('create-entry-overlay').closest('.td-v2-shell')).toBeTruthy();
    const savedCall = vi.mocked(useEventFormPostSave).mock.calls.at(-1);
    if (!savedCall) throw new Error('缺少表單儲存後 hook 呼叫');
    expect(savedCall[0].viewer).toBe(manager);
    expect(savedCall[0].close).toBe(closeForm);

    vi.mocked(useCreateEventEntry).mockReturnValue({
      canCreate: true,
      profileLocked: false,
      buttonProps: { lockedClass: '' },
      onClick: vi.fn(),
      onClickCustom: customMock,
      preset: null,
      formOpen: false,
      closeForm,
      overlays: null,
    });
    view.rerender(<TeamDetailPage />);
    expect(eventFormMock.latestProps?.preset).toBeNull();
    expect(eventFormMock.latestProps?.open).toBe(false);
    expect(screen.getByTestId('event-form-stub').getAttribute('data-open')).toBe('false');
  });
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
    // 測試同步更新（C1）：一般俱樂部不放招募句（R-UI-026）；EXP 徽章跟 SHOW_EXP=false 不顯示。
    expect(screen.queryByText('一般俱樂部 · 歡迎查看活動與成員')).toBeNull();
    expect(screen.queryByText('3,500')).toBeNull();
    expect(container.querySelector('.td-v2-hero-rank')).toBeNull();
    expect(container.querySelector('.td-v2-hero-status')).toBeNull();
    // 測試同步更新（C1）：數字列只留成員、活動、勝率；快速導覽與開發備註拿掉、頁籤不帶數字徽章。
    expect(
      Array.from(container.querySelectorAll('.td-v2-stats .td-v2-stat-label'))
        .map((el) => el.firstChild?.textContent ?? ''),
    ).toEqual(['成員', '活動', '勝率']);
    expect(container.querySelector('.td-v2-quick')).toBeNull();
    expect(screen.queryByText('所有原有內容都保留在分頁內')).toBeNull();
    expect(container.querySelector('.td-v2-tab-badge')).toBeNull();

    expect(screen.getByText('俱樂部介紹')).toBeTruthy();
    expect(screen.getByText('LINE: @testfc')).toBeTruthy();

    const captainTag = screen.getByRole('button', { name: '隊長甲' });
    expect(captainTag.getAttribute('data-uid')).toBe('captain');
    fireEvent.click(captainTag);
    expect(routeState.route).toHaveBeenCalledWith('/profile/captain');

    const leaderTag = screen.getByRole('button', { name: '領隊乙' });
    expect(leaderTag.getAttribute('data-uid')).toBe('leader1');
  });

  // C1（P-08）：俱樂部資訊補上教練與社群連結（A 有輸出、B 漏掉），兩者都可多筆換行。
  it('shows coaches and social links in the club info card', async () => {
    vi.mocked(loadTeam).mockResolvedValue({
      ...team,
      coachUids: ['coach1', 'coach2', 'coach3'],
      coaches: ['教練甲', '教練乙', '教練丙'],
      contactLinksEnabled: true,
      contactLinks: [
        { url: 'https://line.me/R/ti/g/abc', platform: 'line', label: 'LINE', host: 'line.me' },
        { url: 'https://instagram.com/testfc', platform: 'instagram', label: 'Instagram', host: 'instagram.com' },
        { url: 'javascript:alert(1)', platform: 'link', label: '壞連結', host: '' },
      ],
    });
    const { container } = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    const coachRow = container.querySelector('.td-v2-staff-row[data-staff="coach"]');
    expect(coachRow?.querySelector('.td-v2-staff-label')?.textContent).toBe('教練');
    expect(within(coachRow as HTMLElement).getByRole('button', { name: '教練丙' })).toBeTruthy();

    const social = container.querySelector('[data-detail-field="social-links"]');
    expect(social?.querySelector('.td-v2-contact-label')?.textContent).toBe('社群');
    const links = Array.from(social?.querySelectorAll('a.td-v2-social-btn') ?? []);
    expect(links.map((el) => el.getAttribute('href'))).toEqual([
      'https://line.me/R/ti/g/abc',
      'https://instagram.com/testfc',
    ]);
    // LINE 用文字圖示、Instagram 用圖片圖示，後面接平台名稱。
    expect(links.map((el) => el.textContent)).toEqual(['LINELINE', 'Instagram']);
  });

  it('hides social links when the club turned them off', async () => {
    vi.mocked(loadTeam).mockResolvedValue({
      ...team,
      contactLinksEnabled: false,
      contactLinks: [{ url: 'https://line.me/R/ti/g/abc', platform: 'line', label: 'LINE', host: 'line.me' }],
    });
    const { container } = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    expect(container.querySelector('[data-detail-field="social-links"]')).toBeNull();
    expect(container.querySelector('.td-v2-staff-row[data-staff="coach"]')).toBeNull();
  });

  // 測試同步更新（C1）：課程頁籤先隱藏（課程上線後再開），不再出現「請先使用舊版」。
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
      '活動',
      '成員',
      '戰績',
      '動態',
    ]);
    expect(container.querySelector('.td-v2-panel-courses')).toBeNull();
    expect(screen.queryByText('此功能尚未開放，請先使用舊版')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '戰績' }));
    expect(container.querySelector('.td-v2-panel-record.active')).toBeTruthy();
    expect(screen.getAllByText('60%').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: '動態' }));
    expect(container.querySelector('.td-v2-panel-feed.active')).toBeTruthy();
    expect(screen.getByText('本週正常團練')).toBeTruthy();
  });

  // K1：課程開關（education/flags COURSES_ENABLED）關閉時一般用戶看不到；打開時教學俱樂部才出「課程」頁籤並按需載入。
  it('K1 courses tab: hidden while the course switch is off, lazy panel when on', async () => {
    vi.mocked(loadTeam).mockResolvedValue({ ...team, teachingEnabled: true });
    try {
      courseFlag.on = false;
      const off = render(<TeamDetailPage />);
      await screen.findByText('測試俱樂部');
      expect(screen.queryByRole('tab', { name: '課程' })).toBeNull();
      expect(off.container.querySelector('.td-v2-panel-courses')).toBeNull();
      off.unmount();

      courseFlag.on = true;
      const on = render(<TeamDetailPage />);
      await screen.findByText('測試俱樂部');
      const labels = Array.from(on.container.querySelectorAll('.td-v2-tab-list button')).map((b) => b.textContent);
      expect(labels.slice(0, 2)).toEqual(['總覽', '課程']);
      expect(screen.queryByTestId('course-tab-stub')).toBeNull();
      fireEvent.click(screen.getByRole('tab', { name: '課程' }));
      expect(on.container.querySelector('.td-v2-panel-courses.active')).toBeTruthy();
      expect(await screen.findByTestId('course-tab-stub')).toBeTruthy();
      on.unmount();

      // 自建俱樂部照 A 不開放課程。
      vi.mocked(loadTeam).mockResolvedValue({ ...team, teachingEnabled: true, createdVia: 'user_capability' });
      const userTeam = render(<TeamDetailPage />);
      await screen.findByText('測試俱樂部');
      expect(screen.queryByRole('tab', { name: '課程' })).toBeNull();
      userTeam.unmount();
    } finally {
      courseFlag.on = false;
    }
  });

  // T-090 P2-1：修正前分頁已排除自建俱樂部的課程／賽事，但總覽快速導覽與面板仍依 isTeamDetailSectionVisible 顯示（應失敗）。
  it('hides courses quick link and panels for a user-created club even when teaching is set', async () => {
    vi.mocked(loadTeam).mockResolvedValue({
      ...team,
      createdVia: 'user_capability',
      teachingEnabled: true,
      detailVisibility: { record: false },
    });
    const { container } = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    expect(container.querySelector('.td-v2-quick[data-tab="courses"]')).toBeNull();
    expect(container.querySelector('.td-v2-panel-courses')).toBeNull();
    expect(container.querySelector('.td-v2-panel-record')).toBeNull();
  });

  // T-090d C-11：修正前頁籤已隱藏課程／戰績，但上方統計列仍顯示「課程」「勝率」（應失敗）。
  it('stats row drops 課程 and 勝率 for a user-created club; legacy keeps all four', async () => {
    const statLabels = (root: Element): string[] =>
      Array.from(root.querySelectorAll('.td-v2-stats .td-v2-stat-label'))
        .map((el) => el.firstChild?.textContent ?? '');

    vi.mocked(loadTeam).mockResolvedValue({ ...team, createdVia: 'user_capability' });
    const own = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    expect(statLabels(own.container)).toEqual(['成員', '活動']);
    own.unmount();

    vi.mocked(loadTeam).mockResolvedValue({ ...team });
    const legacy = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    // 測試同步更新（C1）：數字列拿掉課程，順序成員、活動、勝率。
    expect(statLabels(legacy.container)).toEqual(['成員', '活動', '勝率']);
    legacy.unmount();

    // C1：沒有戰績資料就不出戰績頁籤，勝率一起隱藏。
    vi.mocked(loadTeam).mockResolvedValue({ ...team, wins: 0, draws: 0, losses: 0 });
    const noRecord = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    expect(statLabels(noRecord.container)).toEqual(['成員', '活動']);
    expect(screen.queryByRole('tab', { name: '戰績' })).toBeNull();
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

    // 測試同步更新（C1）：沒有貼文的「動態」不出頁籤。
    const tabButtons = container.querySelectorAll('.td-v2-tab-list button');
    expect(Array.from(tabButtons).map((b) => b.textContent)).toEqual(['總覽']);
    expect(screen.queryByText('俱樂部介紹')).toBeNull();
    expect(loadTeamMembers).not.toHaveBeenCalled();
    expect(loadEvents).not.toHaveBeenCalled();
  });

  it('renders 14-day week calendar and navigates on event card click', async () => {
    _setDictLoaderForTest(null);
    await setLocale('zh-TW'); // 人數標籤讀屏句子用 events 字典
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
    // 2026-11-13 站長定案：「N/M 名」文字改成與活動頁同款人數標籤（時間行尾），讀屏唸完整句子
    expect(cards[0]?.textContent).not.toContain('8/16 名');
    const tag = cards[0]?.querySelector('.td-v2-event-main em .tl-cap-tag');
    expect(tag?.className).toBe('tl-cap-tag is-open');
    expect(tag?.querySelector('.tl-cap-n')?.textContent).toBe('8');
    expect(tag?.querySelector('.tl-cap-max')?.textContent).toBe('/16');
    expect(tag?.querySelector('.fcb-sr-only')?.textContent).toBe('已報 8／16 人');
    expect(cards[0]?.querySelector('.td-v2-event-main em')?.firstChild?.textContent).toBe('14:00~16:00');

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

  // 測試同步更新
  it('passes roster, viewer and onTeamChanged to LegacyTeamMembersCard', async () => {
    const manager = viewer('captain', ['club']);
    vi.mocked(useViewer).mockReturnValue(manager);
    vi.mocked(loadTeamMembers).mockResolvedValue([
      { uid: 'captain', displayName: '隊長甲' },
      { uid: 'member', displayName: '成員乙', teamIds: ['club'] },
    ]);
    render(<TeamDetailPage />);
    const title = await screen.findByText('測試俱樂部');
    fireEvent.click(screen.getByRole('tab', { name: '成員' }));

    const card = await screen.findByTestId('legacy-members-card');
    expect(card.getAttribute('data-viewer-uid')).toBe(manager.uid);
    expect(card.getAttribute('data-has-on-team-changed')).toBe('true');
    const onTeamChanged = membersCardMock.onTeamChanged;
    expect(typeof onTeamChanged).toBe('function');
    if (typeof onTeamChanged !== 'function') throw new Error('缺少 onTeamChanged callback');

    fireEvent.click(screen.getByRole('button', { name: '成員乙' }));
    expect(routeState.route).toHaveBeenCalledWith('/profile/member');

    const loadCalls = vi.mocked(loadTeam).mock.calls.length;
    const pendingLoad = deferred<TeamDoc | null>();
    vi.mocked(loadTeam).mockReturnValueOnce(pendingLoad.promise);
    let refresh: void | Promise<void> = undefined;

    await act(async () => {
      refresh = onTeamChanged();
      await Promise.resolve();
    });

    await waitFor(() => expect(loadTeam).toHaveBeenCalledTimes(loadCalls + 1));
    expect(loadTeam).toHaveBeenLastCalledWith('club');
    expect(screen.getByText('測試俱樂部')).toBe(title);
    expect(screen.getByTestId('legacy-members-card')).toBe(card);
    expect(document.querySelector('.ui-page-spinner')).toBeNull();

    await act(async () => {
      pendingLoad.resolve({ ...team, name: '成員管理更新後俱樂部' });
      await refresh;
    });

    expect(await screen.findByText('成員管理更新後俱樂部')).toBe(title);
    expect(screen.getByTestId('legacy-members-card')).toBe(card);
    expect(document.querySelector('.ui-page-spinner')).toBeNull();
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

  // 測試同步更新（C1，P-09）：經理、領隊在確認框之前就被擋，不再先跳確認框。
  it('blocks captain and leader from leaving with legacy toast messages', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    vi.mocked(useViewer).mockReturnValue(viewer('captain', ['club']));
    const view = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    fireEvent.click(screen.getByRole('button', { name: '退出俱樂部' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(appConfirm).not.toHaveBeenCalled();
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
    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(2));
    expect(appConfirm).not.toHaveBeenCalled();
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

  // 測試同步更新（C1）：拿掉「尚未開放」的分享鈕，改成所有人都能按的「複製連結」（網址同邀請 QR）。
  it('lets a non-member copy the club link and respects invite disabled rule', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    // 非成員且非經理/教練：invite 應 disabled
    const view = render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    const inviteBtn = screen.getByRole('button', { name: '邀請 QR' }) as HTMLButtonElement;
    expect(inviteBtn.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '分享俱樂部' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '複製連結' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ message: '已複製連結', tone: 'success' }));
    expect(writeText).toHaveBeenCalledWith('https://miniapp.line.me/2009525300-AuPGQ0sh?team=club');

    fireEvent.click(screen.getByRole('button', { name: '聯繫負責人' }));
    // 測試同步更新：聯繫負責人已接線
    expect(routeState.route).toHaveBeenCalledWith('/profile/captain');
    expect(toastSpy).toHaveBeenCalledTimes(1);

    // 經理身分：顯示頭像/封面編輯按鈕且 invite 啟用
    vi.mocked(useViewer).mockReturnValue(viewer('captain', ['club']));
    view.rerender(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    expect((screen.getByRole('button', { name: '邀請 QR' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: '更換俱樂部封面' }));
    fireEvent.click(screen.getByRole('button', { name: '更換俱樂部頭像' }));
    // 測試同步更新：封面／頭像已接上傳 hook，只有分享仍顯示未開放提示。
    expect(pickMock).toHaveBeenNthCalledWith(1, 'cover');
    expect(pickMock).toHaveBeenNthCalledWith(2, 'avatar');
    expect(pickMock).toHaveBeenCalledTimes(2);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('shows a copy failure toast when the clipboard is unavailable', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    try {
      render(<TeamDetailPage />);
      await screen.findByText('測試俱樂部');
      fireEvent.click(screen.getByRole('button', { name: '複製連結' }));
      await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({
        message: '複製失敗，請手動複製',
        tone: 'error',
      }));
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
      Reflect.deleteProperty(document, 'execCommand');
    }
  });

  it('opens settings for the manager without an unavailable toast and closes it', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    const manager = viewer('captain', ['club']);
    vi.mocked(useViewer).mockReturnValue(manager);
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));

    const dialog = await screen.findByRole('dialog', { name: '俱樂部設定' });
    expect(settingsModalMock.latestProps?.team).toEqual(team);
    expect(settingsModalMock.latestProps?.viewer).toBe(manager);
    expect(toastSpy).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '俱樂部設定' })).toBeNull(),
    );
  });

  // 測試同步更新（C1）：非管理者頂欄不出「⋯」，也就不會再跳「尚未開放」。
  it.each(['u1', 'leader1', 'coach1'])(
    'hides the more button instead of settings for non-manager %s',
    async (uid) => {
      const toastSpy = vi.spyOn(toast, 'show');
      vi.mocked(loadTeam).mockResolvedValue({
        ...team,
        coachUids: ['coach1'],
        coaches: ['教練丙'],
      });
      vi.mocked(useViewer).mockReturnValue(viewer(uid, ['club']));
      render(<TeamDetailPage />);
      await screen.findByText('測試俱樂部');

      expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();
      expect(document.querySelector('.td-v2-topbar .td-v2-icon-spacer')).toBeTruthy();

      expect(screen.queryByRole('dialog', { name: '俱樂部設定' })).toBeNull();
      expect(settingsModalMock.latestProps).toBeNull();
      expect(toastSpy).not.toHaveBeenCalled();
    },
  );

  it('opens settings with team.manage_all permission', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    vi.mocked(useViewer).mockReturnValue({
      ...viewer('admin'),
      hasPermission: (permission) => permission === 'team.manage_all',
    });
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));

    expect(await screen.findByRole('dialog', { name: '俱樂部設定' })).toBeTruthy();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('silently reloads after saving settings and keeps the dialog and title mounted', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer('captain', ['club']));
    const { container } = render(<TeamDetailPage />);
    const title = await screen.findByText('測試俱樂部');
    expect(container.querySelector('.td-v2-title')).toBe(title);
    expect(loadTeam).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const dialog = await screen.findByRole('dialog', { name: '俱樂部設定' });
    const originalTeam = settingsModalMock.latestProps?.team;
    expect(originalTeam).toEqual(team);

    const pendingLoad = deferred<TeamDoc | null>();
    vi.mocked(loadTeam).mockReturnValueOnce(pendingLoad.promise);
    fireEvent.click(within(dialog).getByRole('button', { name: '已儲存' }));

    await waitFor(() => expect(loadTeam).toHaveBeenCalledTimes(2));
    expect(loadTeam).toHaveBeenLastCalledWith('club');
    expect(screen.getByRole('dialog', { name: '俱樂部設定' })).toBe(dialog);
    expect(container.querySelector('.td-v2-title')).toBe(title);
    expect(screen.getByText('測試俱樂部')).toBe(title);
    expect(document.querySelector('.ui-page-spinner')).toBeNull();

    const updatedTeam: TeamDoc = { ...team, name: '設定更新後俱樂部' };
    await act(async () => {
      pendingLoad.resolve(updatedTeam);
      await pendingLoad.promise;
    });

    expect(await screen.findByText('設定更新後俱樂部')).toBe(title);
    expect(container.querySelector('.td-v2-title')).toBe(title);
    expect(screen.getByRole('dialog', { name: '俱樂部設定' })).toBe(dialog);
    expect(document.querySelector('.ui-page-spinner')).toBeNull();
    expect(settingsModalMock.latestProps?.team).toEqual(updatedTeam);
    expect(settingsModalMock.latestProps?.team).not.toBe(originalTeam);
  });

  it('opens basic info editing after closing settings（測試同步更新）', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    const manager = viewer('captain', ['club']);
    vi.mocked(useViewer).mockReturnValue(manager);
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const dialog = await screen.findByRole('dialog', { name: '俱樂部設定' });
    expect(toastSpy).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: '編輯基本資料' }));

    expect(await screen.findByRole('dialog', {
      name: '編輯俱樂部基本資料',
    })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '俱樂部設定' })).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(teamFormMock.latestProps?.open).toBe(true);
    expect(teamFormMock.latestProps?.mode).toBe('edit');
    expect(teamFormMock.latestProps?.team).toEqual(team);
    expect(teamFormMock.latestProps?.viewer).toBe(manager);
    expect(toastSpy).not.toHaveBeenCalled();
    expect(loadTeam).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '關閉表單' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hides image edit buttons from a normal member', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer('u1', ['club']));
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    expect(screen.queryByRole('button', { name: '更換俱樂部封面' })).toBeNull();
    expect(screen.queryByRole('button', { name: '更換俱樂部頭像' })).toBeNull();
    expect(pickMock).not.toHaveBeenCalled();
  });

  it.each(['leader1', 'coach1'])(
    'hides image edit buttons from non-manager staff %s',
    async (uid) => {
      // ASSUMPTION: 教練名冊欄位為 coachUids／coaches，與 leaderUids／leaders 對應。
      vi.mocked(loadTeam).mockResolvedValue({
        ...team,
        coachUids: ['coach1'],
        coaches: ['教練丙'],
      });
      vi.mocked(useViewer).mockReturnValue(viewer(uid, ['club']));
      render(<TeamDetailPage />);
      await screen.findByText('測試俱樂部');

      expect(screen.queryByRole('button', { name: '更換俱樂部封面' })).toBeNull();
      expect(screen.queryByRole('button', { name: '更換俱樂部頭像' })).toBeNull();
      expect(pickMock).not.toHaveBeenCalled();
    },
  );

  it('shows image edit buttons with team.manage_all permission', async () => {
    vi.mocked(useViewer).mockReturnValue({
      ...viewer('admin'),
      hasPermission: (permission) => permission === 'team.manage_all',
    });
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    expect(screen.getByRole('button', { name: '更換俱樂部封面' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '更換俱樂部頭像' })).toBeTruthy();
  });

  it('silently reloads the team after saving an image and updates its name', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer('captain', ['club']));
    const { container } = render(<TeamDetailPage />);
    const title = await screen.findByText('測試俱樂部');
    await waitFor(() => expect(loadTeamMembers).toHaveBeenCalledTimes(1));
    expect(loadTeam).toHaveBeenCalledTimes(1);

    const shell = container.querySelector('.td-v2-shell');
    expect(shell).toBeTruthy();
    expect(shell?.contains(title)).toBe(true);
    const memberCallsBeforeSave = vi.mocked(loadTeamMembers).mock.calls.length;

    const call = vi.mocked(useTeamImageUpload).mock.calls.at(-1);
    if (!call) throw new Error('缺少圖片上傳 hook 呼叫');
    expect(call[0].team?.id).toBe('club');

    const pendingLoad = deferred<TeamDoc | null>();
    vi.mocked(loadTeam).mockReturnValueOnce(pendingLoad.promise);
    let saved: void | Promise<void> = undefined;

    await act(async () => {
      saved = call[0].onSaved('avatar');
      await Promise.resolve();
    });

    expect(loadTeam).toHaveBeenCalledTimes(2);
    expect(loadTeam).toHaveBeenLastCalledWith('club');
    expect(screen.getByText('測試俱樂部')).toBe(title);
    expect(container.querySelector('.td-v2-shell')).toBe(shell);
    expect(shell?.contains(title)).toBe(true);
    expect(loadTeamMembers).toHaveBeenCalledTimes(memberCallsBeforeSave);

    await act(async () => {
      pendingLoad.resolve({ ...team, name: '更新後俱樂部' });
      await saved;
    });

    expect(await screen.findByText('更新後俱樂部')).toBe(title);
    expect(screen.queryByText('測試俱樂部')).toBeNull();
    expect(container.querySelector('.td-v2-shell')).toBe(shell);
    expect(shell?.contains(title)).toBe(true);
    expect(loadTeamMembers).toHaveBeenCalledTimes(memberCallsBeforeSave);
  });

  it('reloads members once when a silent team reload changes coachUids', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer('captain', ['club']));
    vi.mocked(loadTeam).mockResolvedValueOnce({
      ...team,
      coachUids: ['coach1'],
    });
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    await waitFor(() => expect(loadTeamMembers).toHaveBeenCalledTimes(1));
    const memberCallsBeforeSave = vi.mocked(loadTeamMembers).mock.calls.length;

    const call = vi.mocked(useTeamImageUpload).mock.calls.at(-1);
    if (!call) throw new Error('缺少圖片上傳 hook 呼叫');

    const updatedTeam: TeamDoc = { ...team, coachUids: ['coach2'] };
    vi.mocked(loadTeam).mockResolvedValueOnce(updatedTeam);

    await act(async () => {
      await call[0].onSaved('avatar');
    });

    await waitFor(() =>
      expect(loadTeamMembers).toHaveBeenCalledTimes(memberCallsBeforeSave + 1),
    );
    expect(loadTeam).toHaveBeenCalledTimes(2);
    expect(loadTeam).toHaveBeenLastCalledWith('club');
    expect(loadTeamMembers).toHaveBeenLastCalledWith(updatedTeam);
  });

  it('disables both image edit buttons while uploading the cover', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer('captain', ['club']));
    vi.mocked(useTeamImageUpload).mockReturnValue({
      pick: pickMock,
      busyKind: 'cover',
      overlay: null,
    });
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    const cover = screen.getByRole('button', {
      name: '更換俱樂部封面',
    }) as HTMLButtonElement;
    const avatar = screen.getByRole('button', {
      name: '更換俱樂部頭像',
    }) as HTMLButtonElement;
    expect(cover.disabled).toBe(true);
    expect(avatar.disabled).toBe(true);
    expect(cover.getAttribute('aria-busy')).toBe('true');
    expect(avatar.getAttribute('aria-busy')).toBeNull();
  });

  it('opens a local invite QR dialog for the captain without fetching', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    try {
      vi.mocked(useViewer).mockReturnValue(viewer('captain', ['club']));
      render(<TeamDetailPage />);
      await screen.findByText('測試俱樂部');

      fireEvent.click(screen.getByRole('button', { name: '邀請 QR' }));

      const dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).toContain('測試俱樂部 邀請加入');
      expect(dialog.textContent).toContain('?team=');
      await waitFor(() => expect(renderQrToCanvas).toHaveBeenCalled());
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
    }
  });

  it.each(['Escape', 'close'] as const)(
    'closes the invite QR dialog with %s',
    async (method) => {
      vi.mocked(useViewer).mockReturnValue(viewer('captain', ['club']));
      render(<TeamDetailPage />);
      await screen.findByText('測試俱樂部');

      fireEvent.click(screen.getByRole('button', { name: '邀請 QR' }));
      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(renderQrToCanvas).toHaveBeenCalled());

      if (method === 'Escape') {
        fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
      } else {
        fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
      }

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    },
  );

  it('keeps invite disabled and does not open a dialog for a non-member', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer('u1'));
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    const inviteBtn = screen.getByRole('button', { name: '邀請 QR' }) as HTMLButtonElement;
    expect(inviteBtn.disabled).toBe(true);
    fireEvent.click(inviteBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(renderQrToCanvas).not.toHaveBeenCalled();
  });

  it('uses the same invite policy for the header and handler across three inputs', () => {
    const cases: Array<{ team: TeamDoc; viewer: ViewerView; allowed: boolean }> = [
      { team, viewer: viewer('u1'), allowed: false },
      {
        team: { ...team, allowMemberInvite: false },
        viewer: viewer('u1', ['club']),
        allowed: false,
      },
      { team, viewer: viewer('u1', ['club']), allowed: true },
    ];

    for (const entry of cases) {
      const allowed = canShowInviteQr(entry.viewer, entry.team);
      expect(allowed).toBe(entry.allowed);
      expect(canInviteToTeam(entry.team, entry.viewer)).toBe(allowed);
    }
  });

  it('disables invite for a member when allowMemberInvite is false', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer('u1', ['club']));
    vi.mocked(loadTeam).mockResolvedValue({ ...team, allowMemberInvite: false });
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    const inviteBtn = screen.getByRole('button', { name: '邀請 QR' }) as HTMLButtonElement;
    expect(inviteBtn.disabled).toBe(true);
    fireEvent.click(inviteBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(renderQrToCanvas).not.toHaveBeenCalled();
  });

  it('allows a member to open invite QR when allowMemberInvite is unset', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer('u1', ['club']));
    vi.mocked(loadTeam).mockResolvedValue(team);
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    const inviteBtn = screen.getByRole('button', { name: '邀請 QR' }) as HTMLButtonElement;
    expect(inviteBtn.disabled).toBe(false);
    fireEvent.click(inviteBtn);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('測試俱樂部 邀請加入');
    await waitFor(() => expect(renderQrToCanvas).toHaveBeenCalled());
  });

  it('opens the captain profile when contacting the manager without an unavailable toast', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    vi.mocked(loadTeam).mockResolvedValue({ ...team, captainUid: 'U-captain-1' });
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    fireEvent.click(screen.getByRole('button', { name: '聯繫負責人' }));
    expect(routeState.route).toHaveBeenCalledWith('/profile/U-captain-1');
    expect(toastSpy).not.toHaveBeenCalledWith({
      message: '此功能尚未開放，請先使用舊版',
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   '])(
    'shows the missing captain toast without routing when captainUid is %s',
    async (captainUid) => {
      const toastSpy = vi.spyOn(toast, 'show');
      vi.mocked(loadTeam).mockResolvedValue({ ...team, captainUid });
      render(<TeamDetailPage />);
      await screen.findByText('測試俱樂部');

      fireEvent.click(screen.getByRole('button', { name: '聯繫負責人' }));
      expect(toastSpy).toHaveBeenCalledWith({
        message: '此俱樂部尚未設定負責人',
      });
      expect(routeState.route).not.toHaveBeenCalled();
    },
  );

  it('trims captainUid before opening the captain profile', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    vi.mocked(loadTeam).mockResolvedValue({ ...team, captainUid: '  U-captain-1  ' });
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');

    fireEvent.click(screen.getByRole('button', { name: '聯繫負責人' }));
    expect(routeState.route).toHaveBeenCalledWith('/profile/U-captain-1');
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('handles loading, error retry and not-found states with legacy v2 shell', async () => {
    const pendingLoad = deferred<TeamDoc | null>();
    vi.mocked(loadTeam).mockReturnValueOnce(pendingLoad.promise);
    render(<TeamDetailPage />);
    expect(document.querySelector('.ui-page-spinner[role="status"]')).not.toBeNull();

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
    expect(document.querySelector('.ui-page-spinner')).toBeNull();
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

    expect(document.querySelector('.ui-page-spinner[role="status"]')).not.toBeNull();
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

    expect(document.querySelector('.ui-page-spinner[role="status"]')).not.toBeNull();
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

    expect(document.querySelector('.ui-page-spinner[role="status"]')).not.toBeNull();
    expect(loadTeam).not.toHaveBeenCalled();
    expect(loginForClubs).not.toHaveBeenCalled();

    authUid.value = null;
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    view.rerender(<TeamDetailPage />);

    expect(await screen.findByText('請先登入 LINE 帳號')).toBeTruthy();
    expect(screen.getByRole('button', { name: '登入' })).toBeTruthy();
    expect(document.querySelector('.ui-page-spinner')).toBeNull();
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


describe('T-054c V1／V2：俱樂部活動日期與週條', () => {
  it('人數標籤口徑同活動頁：實際正取（不含團隊保留未報），額滿有候補為候補色；不限人數只顯示已報數', async () => {
    _setDictLoaderForTest(null);
    await setLocale('zh-TW');
    const { container } = render(renderEventRows([
      {
        id: 'evFull', date: '2999/06/15 14:00~16:00', status: 'full', max: 27, current: 27, realCurrent: 23, waitlist: 4,
        teamReservationSummaries: [{ teamId: 't', reservedSlots: 8, usedSlots: 4, remainingSlots: 4 }],
      },
      { id: 'evNoMax', date: '2999/06/16 14:00~16:00', status: 'open', max: 0, current: 5 },
    ] as unknown as EventDoc[], 2, vi.fn()));
    const tags = container.querySelectorAll('.td-v2-event-main em .tl-cap-tag');
    expect(tags[0]?.className).toBe('tl-cap-tag is-wait');
    expect(tags[0]?.querySelector('.tl-cap-n')?.textContent).toBe('23');
    expect(tags[1]?.className).toBe('tl-cap-tag is-nomax');
    expect(tags[1]?.querySelector('.tl-cap-max')).toBeNull();
    expect(tags[1]?.querySelector('.fcb-sr-only')?.textContent).toBe('已報 5 人');
  });

  it('V1：台北 00:30 的活動卡顯示 10 月 19 日', () => {
    const { container } = render(renderEventRows([
      { id: 'evtA', date: '2026/10/19 00:30~02:00' },
    ], 1, vi.fn()));
    expect(container.querySelector('.td-v2-event-date em')?.textContent).toBe('10月');
    expect(container.querySelector('.td-v2-event-date strong')?.textContent).toBe('19');
  });

  it('面板載入中顯示圈與骨架，完成後消失', () => {
    const props: TeamDetailV2PanelsProps = {
      team: { id: 'targetA' }, activeTab: 'events', tabKeys: new Set(['overview', 'events', 'members']),
      roster: [], membersStatus: 'loading',
      events: [], eventsStatus: 'loading',
      totalGames: 0, winRate: 0,
      viewer: { uid: 'uidA', teamIds: new Set<string>(), hasPermission: () => false },
      onTeamChanged: vi.fn(), canCreateEvent: false, onCreateEvent: vi.fn(), busy: false,
      onSelectTab: vi.fn(), onSelectEvent: vi.fn(), onOpenProfile: vi.fn(),
      onRetryMembers: vi.fn(), onRetryEvents: vi.fn(), onLogin: vi.fn(),
    };
    const view = render(<TeamDetailV2Panels {...props} />);
    const statuses = view.container.querySelectorAll('.reg-loading[role="status"]');
    expect(statuses).toHaveLength(2);
    statuses.forEach((node) => expect(node.textContent).toBe('載入中…'));
    expect(view.container.querySelectorAll('.reg-loading-skeleton-row')).toHaveLength(4);
    view.rerender(<TeamDetailV2Panels {...props} membersStatus="ready" eventsStatus="ready" />);
    expect(view.container.querySelector('.reg-loading')).toBeNull();
    expect(view.container.querySelector('.reg-loading-skeleton')).toBeNull();
  });

  it('V2：真實 Panels 的 eventDaySet 對到真實週條的台北今天', () => {
    // 只經既有 today prop 注入時刻；日期鍵與週條 DOM 均走正式元件。
    weekToday.value = '2026-10-19T00:30:00+08:00';
    const props: TeamDetailV2PanelsProps = {
      // 測試同步更新（C1）：面板改吃頁面決定的 tabKeys，拿掉快速導覽用的人數／課程數與未開放回呼。
      team: { id: 'targetA' }, activeTab: 'events', tabKeys: new Set(['overview', 'events', 'members']),
      roster: [], membersStatus: 'ready',
      events: [{ id: 'evtA', date: '2026/10/19 00:30~02:00' }], eventsStatus: 'ready',
      totalGames: 0, winRate: 0,
      viewer: { uid: 'uidA', teamIds: new Set<string>(), hasPermission: () => false },
      onTeamChanged: vi.fn(), canCreateEvent: false, onCreateEvent: vi.fn(), busy: false,
      onSelectTab: vi.fn(), onSelectEvent: vi.fn(), onOpenProfile: vi.fn(),
      onRetryMembers: vi.fn(), onRetryEvents: vi.fn(), onLogin: vi.fn(),
    };
    const { container } = render(<TeamDetailV2Panels {...props} />);
    const strip = container.querySelector('.td-v2-week');
    expect(strip?.getAttribute('data-event-days')).toBe('2026-10-19');
    const cell = strip?.querySelector('[data-date="2026-10-19"]');
    expect(cell?.classList.contains('active')).toBe(true);
    expect(cell?.querySelector('span')?.textContent).toBe('MON');
    expect(cell?.querySelector('i')).not.toBeNull();
    expect(strip?.querySelectorAll('.td-v2-day i')).toHaveLength(1);
  });
});

// T-090d：自建俱樂部擁有者在俱樂部設定底部的「刪除俱樂部」鈕。
// 修正前應失敗：設定彈窗沒有 onDeleteTeam，擁有者看不到刪除鈕，也無法經 Callable deleteTeam 刪除。
describe('TeamDetailPage owner delete (T-090d)', () => {
  const ownTeam: TeamDoc = { ...team, captainUid: 'other', createdVia: 'user_capability' };

  async function openSettings(): Promise<HTMLElement> {
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    return screen.findByRole('dialog', { name: '俱樂部設定' });
  }

  it.each([
    ['captainUid', { captainUid: 'u1' }],
    ['creatorUid', { creatorUid: 'u1' }],
    ['ownerUid', { ownerUid: 'u1' }],
  ])('擁有者欄位 %s 相符時顯示刪除鈕', async (_field, patch) => {
    vi.mocked(loadTeam).mockResolvedValue({ ...ownTeam, ...patch });
    const dialog = await openSettings();
    expect(within(dialog).getByRole('button', { name: '刪除俱樂部' })).toBeTruthy();
  });

  it('非擁有者（team.manage_all 管理員）看得到設定但沒有刪除鈕', async () => {
    vi.mocked(loadTeam).mockResolvedValue(ownTeam);
    vi.mocked(useViewer).mockReturnValue({
      ...viewer('admin1'),
      hasPermission: (code: string) => code === 'team.manage_all',
    });
    const dialog = await openSettings();
    expect(within(dialog).queryByRole('button', { name: '刪除俱樂部' })).toBeNull();
    expect(settingsModalMock.latestProps?.onDeleteTeam).toBeUndefined();
  });

  it('legacy 俱樂部的經理沒有刪除鈕（維持管理頁原入口）', async () => {
    vi.mocked(loadTeam).mockResolvedValue({ ...team, captainUid: 'u1' });
    const dialog = await openSettings();
    expect(within(dialog).queryByRole('button', { name: '刪除俱樂部' })).toBeNull();
  });

  it('UID 不 trim：前後有空白的擁有者欄位不顯示刪除鈕', async () => {
    vi.mocked(loadTeam).mockResolvedValue({ ...ownTeam, captainUid: ' u1 ' });
    const dialog = await openSettings();
    expect(within(dialog).queryByRole('button', { name: '刪除俱樂部' })).toBeNull();
  });

  it('未登入：不開設定，也沒有刪除鈕', async () => {
    // 同訪客名單案例：放行詳情閘門，模擬訪客看得到詳情頁。
    authUid.value = null;
    vi.mocked(canViewClubDetail).mockReturnValue(true);
    vi.mocked(loadTeam).mockResolvedValue({ ...ownTeam, captainUid: 'u1' });
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    // 測試同步更新（C1）：不能編輯的人沒有「⋯」。
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();
    expect(screen.queryByRole('button', { name: '刪除俱樂部' })).toBeNull();
    expect(settingsModalMock.latestProps).toBeNull();
  });

  it('確認後呼叫 deleteTeam，成功導回列表並重讀 viewer', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    const target = { ...ownTeam, captainUid: 'u1' };
    vi.mocked(loadTeam).mockResolvedValue(target);
    vi.mocked(deleteTeamViaCallable).mockResolvedValue({ status: 'deleted', roleChangedUids: [] });
    const dialog = await openSettings();
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除俱樂部' }));

    await waitFor(() => expect(routeState.route).toHaveBeenCalledWith('/teams', true));
    expect(appConfirm).toHaveBeenCalledWith('確定要刪除「測試俱樂部」？此操作無法復原。');
    expect(deleteTeamViaCallable).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deleteTeamViaCallable).mock.calls[0]?.[0]).toMatchObject({ id: 'club', captainUid: 'u1' });
    expect(requestViewerRefresh).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ message: '已刪除「測試俱樂部」' }));
  });

  it('取消確認不呼叫 deleteTeam', async () => {
    vi.mocked(loadTeam).mockResolvedValue({ ...ownTeam, captainUid: 'u1' });
    vi.mocked(appConfirm).mockResolvedValue(false);
    const dialog = await openSettings();
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除俱樂部' }));

    await waitFor(() => expect(appConfirm).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(deleteTeamViaCallable).not.toHaveBeenCalled();
    expect(routeState.route).not.toHaveBeenCalled();
    expect(requestViewerRefresh).not.toHaveBeenCalled();
  });

  it('失敗只顯示保底文案、不露原始錯誤，也不導頁', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(loadTeam).mockResolvedValue({ ...ownTeam, captainUid: 'u1' });
    vi.mocked(deleteTeamViaCallable).mockRejectedValue(new Error('TEAM_DELETE_DENIED raw-detail'));
    const dialog = await openSettings();
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除俱樂部' }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: '刪除俱樂部失敗，請稍後再試', tone: 'error' }),
    ));
    expect(toastSpy.mock.calls.some(([arg]) => JSON.stringify(arg).includes('raw-detail'))).toBe(false);
    expect(routeState.route).not.toHaveBeenCalled();
    expect(requestViewerRefresh).not.toHaveBeenCalled();
    await waitFor(() => expect(
      within(dialog).getByRole('button', { name: '刪除俱樂部' }).hasAttribute('disabled'),
    ).toBe(false));
    errorSpy.mockRestore();
  });

  it('partial：提示再按一次，不導頁', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    vi.mocked(loadTeam).mockResolvedValue({ ...ownTeam, captainUid: 'u1' });
    vi.mocked(deleteTeamViaCallable).mockResolvedValue({ status: 'partial', remaining: 2 });
    const dialog = await openSettings();
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除俱樂部' }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: '部分成員資料尚未清除，請再按一次刪除' }),
    ));
    expect(routeState.route).not.toHaveBeenCalled();
  });

  it('防連點：確認框與 Callable 進行中再按都不重複觸發', async () => {
    const confirm = deferred<boolean>();
    const call = deferred<{ status: 'deleted'; roleChangedUids: string[] }>();
    vi.mocked(loadTeam).mockResolvedValue({ ...ownTeam, captainUid: 'u1' });
    vi.mocked(appConfirm).mockReturnValue(confirm.promise);
    vi.mocked(deleteTeamViaCallable).mockReturnValue(call.promise);
    const dialog = await openSettings();
    const button = within(dialog).getByRole('button', { name: '刪除俱樂部' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(appConfirm).toHaveBeenCalledTimes(1);

    await act(async () => { confirm.resolve(true); await confirm.promise; });
    await waitFor(() => expect(deleteTeamViaCallable).toHaveBeenCalledTimes(1));
    expect(settingsModalMock.latestProps?.deleting).toBe(true);
    settingsModalMock.latestProps?.onDeleteTeam?.();
    expect(appConfirm).toHaveBeenCalledTimes(1);

    await act(async () => { call.resolve({ status: 'deleted', roleChangedUids: [] }); await call.promise; });
    await waitFor(() => expect(routeState.route).toHaveBeenCalledWith('/teams', true));
    expect(deleteTeamViaCallable).toHaveBeenCalledTimes(1);
  });
});

// T-090h：自建俱樂部擁有者在俱樂部設定（刪除鈕上方）的「轉移經理」入口。
// 修正前應失敗：設定彈窗沒有 transfer 屬性，擁有者看不到轉移入口。
describe('TeamDetailPage owner transfer (T-090h)', () => {
  const ownTeam: TeamDoc = { ...team, captainUid: 'other', createdVia: 'user_capability' };
  const members: TeamMember[] = [
    { uid: 'u1', teamIds: ['club'], displayName: '小明' },
    { uid: 'm2', teamIds: ['club'], displayName: '成員乙' },
    { uid: 'm3', teamIds: ['club'], displayName: '成員丙' },
    { uid: 'x9', teamIds: ['other-club'], displayName: '外人' },
    // 審查 P3-2：只有舊式 teamId、teamIds 不含本隊 → 伺服器會拒，不列入候選。
    { uid: 'lg', teamId: 'club', displayName: '舊式成員' },
  ];

  async function openSettings(): Promise<HTMLElement> {
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    return screen.findByRole('dialog', { name: '俱樂部設定' });
  }

  it.each([
    ['captainUid', { captainUid: 'u1' }],
    ['creatorUid', { creatorUid: 'u1' }],
    ['ownerUid', { ownerUid: 'u1' }],
  ])('擁有者欄位 %s 相符時提供轉移入口，候選人排除本人與非成員', async (_field, patch) => {
    vi.mocked(loadTeam).mockResolvedValue({ ...ownTeam, ...patch });
    vi.mocked(loadTeamMembers).mockResolvedValue(members);
    await openSettings();
    await waitFor(() => expect(settingsModalMock.latestProps?.transfer?.candidates).toEqual([
      { uid: 'm2', name: '成員乙' },
      { uid: 'm3', name: '成員丙' },
    ]));
    expect(typeof settingsModalMock.latestProps?.transfer?.onTransferred).toBe('function');
  });

  it('legacy 俱樂部的經理沒有轉移入口', async () => {
    vi.mocked(loadTeam).mockResolvedValue({ ...team, captainUid: 'u1' });
    await openSettings();
    expect(settingsModalMock.latestProps?.transfer).toBeUndefined();
  });

  it('非擁有者（team.manage_all 管理員）看得到設定但沒有轉移入口', async () => {
    vi.mocked(loadTeam).mockResolvedValue(ownTeam);
    vi.mocked(useViewer).mockReturnValue({
      ...viewer('admin1'),
      hasPermission: (code: string) => code === 'team.manage_all',
    });
    await openSettings();
    expect(settingsModalMock.latestProps?.transfer).toBeUndefined();
  });

  it('自建俱樂部的教練（非擁有者）沒有轉移入口', async () => {
    vi.mocked(loadTeam).mockResolvedValue({ ...ownTeam, coachUids: ['u1'], coaches: ['小明'] });
    vi.mocked(useViewer).mockReturnValue({ ...viewer('u1', ['club']), role: 'coach', roleLevel: 2 });
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    // 測試同步更新（C1）：不能編輯的教練沒有「⋯」。
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: '俱樂部設定' })).toBeNull();
    expect(settingsModalMock.latestProps?.transfer).toBeUndefined();

    cleanup();
    vi.mocked(useViewer).mockReturnValue({
      ...viewer('u1', ['club']),
      role: 'coach',
      roleLevel: 2,
      hasPermission: (code: string) => code === 'team.manage_all',
    });
    await openSettings();
    expect(settingsModalMock.latestProps?.transfer).toBeUndefined();
  });

  it('成員與資訊區塊都隱藏時，擁有者開設定才讀成員名單', async () => {
    vi.mocked(loadTeam).mockResolvedValue({
      ...ownTeam,
      captainUid: 'u1',
      detailVisibility: { members: false, info: false },
    });
    vi.mocked(loadTeamMembers).mockResolvedValue(members);
    render(<TeamDetailPage />);
    await screen.findByText('測試俱樂部');
    expect(loadTeamMembers).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    await screen.findByRole('dialog', { name: '俱樂部設定' });
    await waitFor(() => expect(loadTeamMembers).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(settingsModalMock.latestProps?.transfer?.candidates).toHaveLength(2));
  });

  it('名單載入中候選人為 null', async () => {
    vi.mocked(loadTeam).mockResolvedValue({ ...ownTeam, captainUid: 'u1' });
    vi.mocked(loadTeamMembers).mockReturnValue(new Promise(() => undefined));
    await openSettings();
    expect(settingsModalMock.latestProps?.transfer?.candidates).toBeNull();
  });

  // 審查 P3-1：修正前 memberAttempt+1 與 membersKey 變動各觸發一次，成員名單讀兩次（應失敗）。
  it('轉移成功後關閉設定、重讀俱樂部與 viewer，成員名單只重讀一次', async () => {
    vi.mocked(loadTeam).mockResolvedValue({ ...ownTeam, captainUid: 'u1' });
    vi.mocked(loadTeamMembers).mockResolvedValue(members);
    await openSettings();
    await waitFor(() => expect(settingsModalMock.latestProps?.transfer?.candidates).toHaveLength(2));
    const loadTeamCalls = vi.mocked(loadTeam).mock.calls.length;
    const memberCalls = vi.mocked(loadTeamMembers).mock.calls.length;

    vi.mocked(loadTeam).mockResolvedValue({ ...ownTeam, captainUid: 'm2', creatorUid: 'm2', ownerUid: 'm2' });
    await act(async () => { await settingsModalMock.latestProps?.transfer?.onTransferred(); });

    expect(screen.queryByRole('dialog', { name: '俱樂部設定' })).toBeNull();
    expect(requestViewerRefresh).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadTeam).mock.calls.length).toBe(loadTeamCalls + 1);
    await waitFor(() => expect(vi.mocked(loadTeamMembers).mock.calls.length).toBe(memberCalls + 1));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(vi.mocked(loadTeamMembers).mock.calls.length).toBe(memberCalls + 1);
  });

  // 審查 P3-4：修正前名單讀取失敗只得到空候選，畫面顯示「沒有可轉移的成員」（應失敗）。
  it('成員名單讀取失敗時標記 loadFailed', async () => {
    vi.mocked(loadTeam).mockResolvedValue({ ...ownTeam, captainUid: 'u1' });
    vi.mocked(loadTeamMembers).mockRejectedValue(new Error('permission-denied'));
    await openSettings();
    await waitFor(() => expect(settingsModalMock.latestProps?.transfer?.loadFailed).toBe(true));
    expect(settingsModalMock.latestProps?.transfer?.candidates).toEqual([]);
  });
});
