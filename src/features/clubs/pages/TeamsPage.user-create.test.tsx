/**
 * T-090：一般用戶（role=user＋user.activity.team_create）在俱樂部頁看得到「新增俱樂部」入口，
 * 表單領隊固定為本人（不提供搜尋他人），失敗重送沿用同一個 requestId，圖片保底提示不重複建立。
 *
 * 修正前應失敗的理由：
 * - 修正前 canCreateTeam 只看 team.create，按鈕不會出現；
 * - 修正前表單沒有 requestId，也沒有領隊固定本人；
 * - 修正前沒有 imagePending 提示。
 * 送出動作（submitCreateTeam）為 mock，表單與 hook 為真實元件。
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamsPage from './TeamsPage';
import { resetClubListFilters } from './clubs-list-session';
import { loadTeams } from '../data/teams-repo';
import { submitCreateTeam } from '../data/team-form-actions';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { toast } from '@/ui/Toast';

vi.mock('preact-iso', () => ({
  useLocation: () => ({ url: '/teams', path: '/teams', query: {}, route: vi.fn() }),
}));
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => 'me' }));
vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: vi.fn(),
  requestViewerRefresh: vi.fn(),
}));
vi.mock('../data/teams-repo', () => ({
  loadTeams: vi.fn(),
  invalidateTeams: vi.fn(),
  loadTeamMembers: vi.fn(),
}));
vi.mock('./clubs-session', () => ({ loginForClubs: vi.fn() }));
vi.mock('../data/team-form-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/team-form-actions')>()),
  submitCreateTeam: vi.fn(),
}));
vi.mock('@/features/events/data/user-directory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/events/data/user-directory')>();
  return {
    ...actual,
    getUserDirectory: vi.fn(() => []),
    loadUserDirectory: vi.fn(async () => true),
    verifyUserDirectorySelection: vi.fn(async () => ({
      ok: true, users: [], missingUids: [], reason: '',
    })),
  };
});
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  t: (key: string) => key,
}));

function userViewer(capabilities: readonly string[]): ViewerView {
  return {
    uid: 'me',
    displayName: '我',
    pictureUrl: null,
    role: 'user',
    roleLevel: 0,
    teamIds: new Set<string>(),
    capabilities,
    hasPermission: () => false,
  } as ViewerView;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetClubListFilters();
  vi.mocked(loadTeams).mockResolvedValue([{ id: 'existing', name: '既有俱樂部', active: true }]);
  vi.mocked(submitCreateTeam).mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openForm(): Promise<HTMLElement> {
  render(<TeamsPage />);
  await screen.findByRole('link', { name: '既有俱樂部' });
  fireEvent.click(screen.getByRole('button', { name: '新增俱樂部' }));
  return screen.findByRole('dialog');
}

function submitButton(dialog: HTMLElement): HTMLButtonElement {
  const button = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
    .find((item) => item.textContent?.trim() === '建立俱樂部');
  if (!button) throw new Error('缺少建立俱樂部按鈕');
  return button;
}

describe('T-090 一般用戶建立俱樂部入口', () => {
  it('有能力碼才看得到新增俱樂部按鈕', async () => {
    vi.mocked(useViewer).mockReturnValue(userViewer([]));
    const view = render(<TeamsPage />);
    await screen.findByRole('link', { name: '既有俱樂部' });
    expect(screen.queryByRole('button', { name: '新增俱樂部' })).toBeNull();
    view.unmount();

    vi.mocked(useViewer).mockReturnValue(userViewer(['user.activity.team_create']));
    render(<TeamsPage />);
    await screen.findAllByRole('link', { name: '既有俱樂部' });
    expect(screen.getByRole('button', { name: '新增俱樂部' })).toBeTruthy();
  });

  it('領隊固定本人：不顯示搜尋他人、不顯示移除鈕', async () => {
    vi.mocked(useViewer).mockReturnValue(userViewer(['user.activity.team_create']));
    const dialog = await openForm();
    const addSection = dialog.querySelector<HTMLElement>('#ct-leader-add-section');
    expect(addSection?.hidden).toBe(true);
    const tags = dialog.querySelector('#ct-leaders-tags');
    expect(tags?.textContent).toContain('我');
    expect(tags?.querySelector('.team-tag-x')).toBeNull();
  });

  it('失敗重送沿用同一個 requestId', async () => {
    vi.mocked(useViewer).mockReturnValue(userViewer(['user.activity.team_create']));
    vi.mocked(submitCreateTeam)
      .mockResolvedValueOnce({ ok: false, reason: 'write-failed', message: 'clubs.userCreate.error.retry' })
      .mockResolvedValueOnce({ ok: true, teamId: 'tm_srv', roleSyncOk: true });
    const dialog = await openForm();

    fireEvent.click(submitButton(dialog));
    await waitFor(() => expect(submitCreateTeam).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'clubs.userCreate.error.retry' }),
    ));
    fireEvent.click(submitButton(dialog));
    await waitFor(() => expect(submitCreateTeam).toHaveBeenCalledTimes(2));

    const first = vi.mocked(submitCreateTeam).mock.calls[0]![0];
    const second = vi.mocked(submitCreateTeam).mock.calls[1]![0];
    expect(first.requestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(second.requestId).toBe(first.requestId);
    expect(first.viewer).toMatchObject({ role: 'user', capabilities: ['user.activity.team_create'] });
  });

  it('圖片未上傳成功：提示可稍後補圖並關閉表單（不留在表單讓人重複建立）', async () => {
    vi.mocked(useViewer).mockReturnValue(userViewer(['user.activity.team_create']));
    vi.mocked(submitCreateTeam).mockResolvedValueOnce({
      ok: true, teamId: 'tm_srv', roleSyncOk: true, imagePending: true,
    });
    const dialog = await openForm();
    fireEvent.click(submitButton(dialog));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'clubs.userCreate.imagePending' }),
    ));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
