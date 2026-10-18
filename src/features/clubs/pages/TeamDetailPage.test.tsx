import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamDetailPage from './TeamDetailPage';
import { loadTeam, loadTeamMembers } from '../data/teams-repo';
import { leaveTeam, requestTeamJoin } from '../data/membership';
import { useViewer, requestViewerRefresh, type ViewerView } from '@/features/profile/data/viewer';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { loadViewerRegistrations } from '@/features/events/data/viewer-registrations';
import type { EventDoc, RegistrationDoc } from '@/features/events/data/types';
import type { TeamDoc, TeamMember } from '../data/types';
import { clearPendingJoin, loginForClubs } from './clubs-session';
import zh from '../locales/zh-TW.json';

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
  ...await importOriginal<typeof import('./clubs-session')>(),
  loginForClubs: vi.fn(),
}));

// 只替換 useT；Text 等元件仍需要真實的 getCurrentLocale 等匯出。
vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  useT: () => (key: string, values?: Record<string, unknown>) => {
    let value: unknown = zh;
    for (const part of key.replace(/^clubs\./, '').split('.')) {
      value = value && typeof value === 'object'
        ? (value as Record<string, unknown>)[part]
        : undefined;
    }
    const text = typeof value === 'string' ? value : key;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  },
}));

// UserTag 是獨立元件；此處驗證頁面傳入 uid/name/role 與點擊路由契約。
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
  }) => <button type="button" data-uid={uid} data-role={role} onClick={() => onOpenProfile(uid)}>{name}</button>,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
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
  active: true,
  captainUid: 'captain',
  members: 23,
  bio: '俱樂部介紹',
};

const loadEvents = vi.fn<() => Promise<string[]>>();
const snapshot = vi.fn<() => { active: EventDoc[]; terminal: EventDoc[] }>();

beforeEach(() => {
  vi.clearAllMocks();
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
  loadEvents.mockResolvedValue(['events']);
  snapshot.mockReturnValue({ active: [], terminal: [] });
  vi.mocked(getEventsRepo).mockReturnValue({
    loadEventsStatic: loadEvents,
    getSnapshot: snapshot,
    ensureTerminalEventsLoaded: vi.fn().mockResolvedValue([]),
    loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
  });
});

afterEach(cleanup);

async function openMembers(): Promise<void> {
  await screen.findByRole('heading', { name: '測試俱樂部', level: 1 });
  fireEvent.click(screen.getByRole('tab', { name: '成員' }));
}

async function startConfirmation(action: '加入俱樂部' | '退出俱樂部'): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: action }));
  return screen.findByRole('dialog');
}

describe('TeamDetailPage', () => {
  it('shows a login entry for the guest roster and guest join', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer(null));
    vi.mocked(loadTeamMembers).mockResolvedValue(null);
    render(<TeamDetailPage />);
    await openMembers();
    await screen.findByText('登入後查看成員');
    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    await waitFor(() => expect(loginForClubs).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole('button', { name: '加入俱樂部' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '加入俱樂部' }));
    await waitFor(() => expect(loginForClubs).toHaveBeenCalledTimes(2));
    expect(requestTeamJoin).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('builds the roster and passes uid/name/role to UserTag', async () => {
    vi.mocked(loadTeamMembers).mockResolvedValue([
      { uid: 'captain', displayName: '隊長甲' },
      { uid: 'member', displayName: '成員乙', teamIds: ['club'] },
    ]);
    render(<TeamDetailPage />);
    await openMembers();
    const captain = await screen.findByRole('button', { name: '隊長甲' });
    expect(captain.getAttribute('data-uid')).toBe('captain');
    expect(captain.getAttribute('data-role')).toBe('captain');
    expect(screen.getByRole('button', { name: '成員乙' }).getAttribute('data-role')).toBe('user');
    fireEvent.click(captain);
    expect(routeState.route).toHaveBeenCalledWith('/profile/captain');
    expect(loadTeamMembers).toHaveBeenCalledWith(expect.objectContaining({ id: 'club' }));
  });

  it('confirms join, prevents duplicate writes and retains pending after remount', async () => {
    const request = deferred<{ groupId: string }>();
    vi.mocked(requestTeamJoin).mockReturnValue(request.promise);
    const view = render(<TeamDetailPage />);
    const dialog = await startConfirmation('加入俱樂部');
    expect(dialog.textContent).toContain('確定要加入「測試俱樂部」俱樂部？');
    const confirm = within(dialog).getByRole('button', { name: '確認' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(requestTeamJoin).toHaveBeenCalledTimes(1);
    expect(requestTeamJoin).toHaveBeenCalledWith({
      team: expect.objectContaining({ id: 'club' }),
      applicant: { uid: 'u1', displayName: '小明' },
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await act(async () => request.resolve({ groupId: 'group' }));
    await screen.findByText('已送出加入申請！');
    fireEvent.click(screen.getByRole('button', { name: '審核中' }));
    await screen.findByText('申請審核中');
    expect(requestTeamJoin).toHaveBeenCalledTimes(1);
    expect(leaveTeam).not.toHaveBeenCalled();

    view.unmount();
    render(<TeamDetailPage />);
    await screen.findByRole('button', { name: '審核中' });
  });

  it('does not leak optimistic pending to another account', async () => {
    const view = render(<TeamDetailPage />);
    const dialog = await startConfirmation('加入俱樂部');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));
    await screen.findByRole('button', { name: '審核中' });
    vi.mocked(useViewer).mockReturnValue(viewer('u2'));
    view.rerender(<TeamDetailPage />);
    await screen.findByRole('button', { name: '加入俱樂部' });
    expect(screen.queryByRole('button', { name: '審核中' })).toBeNull();
  });

  it('confirms leave and refreshes viewer after success', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer('u1', ['club']));
    const view = render(<TeamDetailPage />);
    const dialog = await startConfirmation('退出俱樂部');
    expect(dialog.textContent).toContain(
      '確定要退出「測試俱樂部」俱樂部？退出後如需重新加入，可能需要再次送出申請。',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));
    await screen.findByText('已退出俱樂部');
    expect(leaveTeam).toHaveBeenCalledWith({
      team: expect.objectContaining({ id: 'club' }),
      self: { uid: 'u1', displayName: '小明' },
    });
    expect(requestTeamJoin).not.toHaveBeenCalled();
    expect(requestViewerRefresh).toHaveBeenCalledTimes(1);

    vi.mocked(useViewer).mockReturnValue(viewer('u1'));
    view.rerender(<TeamDetailPage />);
    await screen.findByRole('button', { name: '加入俱樂部' });
    // 人數仍使用 teams.members，不依 roster 或退出結果自行減一。
    expect(screen.getAllByText('23').length).toBeGreaterThan(0);
  });

  it('shows the stillStaff message', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer('u1', ['club']));
    vi.mocked(leaveTeam).mockResolvedValue({ stillStaff: true });
    render(<TeamDetailPage />);
    const dialog = await startConfirmation('退出俱樂部');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));
    await screen.findByText('你的幹部身分需由隊長移除');
    expect(requestViewerRefresh).toHaveBeenCalledTimes(1);
  });

  it.each(['join', 'leave'] as const)('retries a failed %s operation', async (action) => {
    if (action === 'leave') {
      vi.mocked(useViewer).mockReturnValue(viewer('u1', ['club']));
      vi.mocked(leaveTeam).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ stillStaff: false });
    } else {
      vi.mocked(requestTeamJoin).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ groupId: 'group' });
    }
    render(<TeamDetailPage />);
    const dialog = await startConfirmation(action === 'join' ? '加入俱樂部' : '退出俱樂部');
    fireEvent.click(within(dialog).getByRole('button', { name: '確認' }));
    await within(dialog).findByRole('alert');
    expect(requestViewerRefresh).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '重試' }));
    await screen.findByText(action === 'join' ? '已送出加入申請！' : '已退出俱樂部');
    expect(action === 'join' ? requestTeamJoin : leaveTeam).toHaveBeenCalledTimes(2);
  });

  it('cancelling confirmation performs no write', async () => {
    render(<TeamDetailPage />);
    const dialog = await startConfirmation('加入俱樂部');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(requestTeamJoin).not.toHaveBeenCalled();
    expect(leaveTeam).not.toHaveBeenCalled();
  });

  it('shows not-found and does not load dependent resources', async () => {
    vi.mocked(loadTeam).mockResolvedValue(null);
    render(<TeamDetailPage />);
    await screen.findByText('找不到此俱樂部');
    expect(loadTeamMembers).not.toHaveBeenCalled();
    expect(loadEvents).not.toHaveBeenCalled();
  });

  it('only lists visible future events belonging to this club', async () => {
    const event = (id: string, fields: Partial<EventDoc> = {}): EventDoc => ({
      id,
      title: id,
      date: '2999/01/01 12:00~13:00',
      status: 'open',
      // 照 A _isTeamEventForTeam：只有俱樂部限定（teamOnly）活動才列在俱樂部頁
      teamOnly: true,
      creatorTeamId: 'club',
      ...fields,
    } as EventDoc);

    snapshot.mockReturnValue({
      active: [
        event('visible'),
        event('other-team', { creatorTeamId: 'other' }),
        event('past', { date: '2000/01/01 12:00~13:00' }),
        event('private', { privateEvent: true }),
        event('blocked', { blockedUids: ['u1'] }),
        event('public', { teamOnly: false }),
        event('registered', { blockedUids: ['u1'] }),
        event('ended', { status: 'ended' }),
      ],
      terminal: [],
    });
    vi.mocked(loadViewerRegistrations).mockResolvedValue([
      { eventId: 'registered', userId: 'u1', status: 'cancelled' } as RegistrationDoc,
    ]);
    // 俱樂部限定活動只有成員看得到（R-EVT 可見性），這裡以成員身分驗證列表過濾
    vi.mocked(useViewer).mockReturnValue(viewer('u1', ['club']));
    render(<TeamDetailPage />);
    fireEvent.click(await screen.findByRole('tab', { name: '活動' }));
    const panel = screen.getByRole('tabpanel', { name: '活動' });
    await within(panel).findByRole('link', { name: /visible/ });
    expect(within(panel).getAllByRole('link').map((link) => link.getAttribute('href')))
      .toEqual(['/events/registered', '/events/visible'].sort((a, b) => {
        // 相同日期時 getTeamFutureEvents 保留輸入順序。
        return a === '/events/visible' ? -1 : b === '/events/visible' ? 1 : 0;
      }));
    for (const title of ['other-team', 'past', 'private', 'blocked', 'public', 'ended']) {
      expect(within(panel).queryByRole('link', { name: new RegExp(title) })).toBeNull();
    }
    expect(loadEvents).toHaveBeenCalledWith({ terminalMode: 'none' });
    expect(loadViewerRegistrations).toHaveBeenCalledWith('u1');
  });

  it('shows an events retry when viewer registrations fail', async () => {
    vi.mocked(loadViewerRegistrations)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([]);
    render(<TeamDetailPage />);
    fireEvent.click(await screen.findByRole('tab', { name: '活動' }));
    const panel = screen.getByRole('tabpanel', { name: '活動' });
    await within(panel).findByRole('alert');
    fireEvent.click(within(panel).getByRole('button', { name: '重試' }));
    await within(panel).findByText('目前沒有即將開始的俱樂部活動');
    expect(loadViewerRegistrations).toHaveBeenCalledTimes(2);
  });

  it('honours section visibility without loading hidden resources', async () => {
    vi.mocked(loadTeam).mockResolvedValue({
      ...team,
      detailVisibility: { members: false, events: false, info: false, bio: false },
    });
    render(<TeamDetailPage />);
    await screen.findByRole('heading', { name: '測試俱樂部' });
    expect(screen.queryByRole('tab', { name: '成員' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '活動' })).toBeNull();
    expect(screen.queryByText('俱樂部介紹')).toBeNull();
    expect(loadTeamMembers).not.toHaveBeenCalled();
    expect(loadEvents).not.toHaveBeenCalled();
  });

  it('keeps management disabled and handles the captain link', async () => {
    vi.mocked(useViewer).mockReturnValue(viewer('captain', ['club']));
    render(<TeamDetailPage />);
    const manage = await screen.findByRole('button', { name: '管理' });
    expect((manage as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('待俱樂部管理功能')).toBeTruthy();
    expect(screen.getByRole('link', { name: '聯繫隊長' }).getAttribute('href')).toBe('/profile/captain');
    expect(screen.queryByRole('button', { name: '分享' })).toBeNull();
    expect(screen.queryByRole('button', { name: '邀請 QR' })).toBeNull();
  });

  it('disables contact when captainUid is absent', async () => {
    vi.mocked(loadTeam).mockResolvedValue({ ...team, captainUid: undefined });
    render(<TeamDetailPage />);
    const contact = await screen.findByRole('button', { name: '聯繫隊長' });
    expect((contact as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not allow an older :id load to replace the new route', async () => {
    const old = deferred<TeamDoc | null>();
    vi.mocked(loadTeam).mockImplementation((id) =>
      id === 'club' ? old.promise : Promise.resolve({ ...team, id, name: '新俱樂部' }),
    );
    const view = render(<TeamDetailPage />);
    await waitFor(() => expect(loadTeam).toHaveBeenCalledWith('club'));
    routeState.id = 'new';
    view.rerender(<TeamDetailPage />);
    await screen.findByRole('heading', { name: '新俱樂部', level: 1 });
    await act(async () => old.resolve(team));
    expect(screen.getByRole('heading', { name: '新俱樂部', level: 1 })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '測試俱樂部', level: 1 })).toBeNull();
    expect(loadTeamMembers).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'club' }));
  });

  it('discards a previous route roster that resolves late', async () => {
    const oldMembers = deferred<TeamMember[] | null>();
    vi.mocked(loadTeam).mockImplementation((id) => Promise.resolve({ ...team, id, name: id }));
    vi.mocked(loadTeamMembers).mockImplementation((loaded) =>
      loaded.id === 'club'
        ? oldMembers.promise
        : Promise.resolve([{ uid: 'new-user', displayName: '新成員', teamIds: ['new'] }]),
    );
    const view = render(<TeamDetailPage />);
    await waitFor(() => expect(loadTeamMembers).toHaveBeenCalled());
    routeState.id = 'new';
    view.rerender(<TeamDetailPage />);
    fireEvent.click(await screen.findByRole('tab', { name: '成員' }));
    await screen.findByRole('button', { name: '新成員' });
    await act(async () => oldMembers.resolve([
      { uid: 'old-user', displayName: '舊成員', teamIds: ['club'] },
    ]));
    expect(screen.queryByRole('button', { name: '舊成員' })).toBeNull();
    expect(screen.getByRole('button', { name: '新成員' })).toBeTruthy();
  });
});
