import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamsPage from './TeamsPage';
import { resetClubListFilters } from './clubs-list-session';
import { loginForClubs } from './clubs-session';
import { loadTeams } from '../data/teams-repo';
import { submitCreateTeam } from '../data/team-form-actions';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { toast } from '@/ui/Toast';
import type { TeamDoc } from '../data/types';

// 本檔使用真 TeamFormModal 與 useTeamForm；只替換新增送出與外部資料。
// 未在本次環境執行；交件後須執行本檔及既有列表回歸測試。
const routeMock = vi.hoisted(() => vi.fn());

vi.mock('preact-iso', () => ({
  useLocation: () => ({
    url: '/teams',
    path: '/teams',
    query: {},
    route: routeMock,
  }),
}));

vi.mock('@/data/auth', () => ({
  getLastKnownAuthUid: () => 'creator',
}));

vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: vi.fn(),
  requestViewerRefresh: vi.fn(),
}));

vi.mock('../data/teams-repo', () => ({
  loadTeams: vi.fn(),
  invalidateTeams: vi.fn(),
}));

vi.mock('./clubs-session', () => ({
  loginForClubs: vi.fn(),
}));

vi.mock('../data/team-form-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/team-form-actions')>()),
  submitCreateTeam: vi.fn(),
}));

// 與真實目錄 API 一致：load 回傳 boolean、get 回傳名單、search 同步搜尋。
// 新增 action 雖被替換，表單使用的目錄仍維持真實簽章及驗證結果形狀。
vi.mock('@/features/events/data/user-directory', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/features/events/data/user-directory')
  >();
  const creator: import('@/features/events/data/user-directory').DirectoryUser = {
    uid: 'creator',
    name: '建立者',
    displayName: '建立者',
    pictureUrl: '',
    role: 'user',
  };
  return {
    ...actual,
    getUserDirectory: vi.fn<typeof actual.getUserDirectory>(() => [creator]),
    loadUserDirectory: vi.fn<typeof actual.loadUserDirectory>(async () => true),
    searchUserDirectory: actual.searchUserDirectory,
    verifyUserDirectorySelection:
      vi.fn<typeof actual.verifyUserDirectorySelection>(async (uids) => {
        const requested = [...new Set(
          uids.map(uid => String(uid || '').trim()).filter(Boolean),
        )];
        const users = requested.includes(creator.uid) ? [creator] : [];
        const missingUids = requested.filter(uid => uid !== creator.uid);
        return {
          ok: missingUids.length === 0,
          users,
          missingUids,
          reason: missingUids.length === 0 ? '' : 'missing-users',
        };
      }),
  };
});

vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn() },
}));

const originalTeam: TeamDoc = {
  id: 'existing-club',
  name: '既有俱樂部',
  active: true,
};

const createdTeam: TeamDoc = {
  id: 'created-club',
  name: '新成立俱樂部',
  active: true,
};

function makeViewer(
  uid: string | null = 'creator',
  allowed = true,
): ViewerView {
  return {
    uid,
    displayName: uid ? '建立者' : null,
    pictureUrl: null,
    role: uid ? 'user' : 'guest',
    roleLevel: uid ? 1 : 0,
    teamIds: new Set<string>(),
    capabilities: [],
    hasPermission: (code) => allowed && code === 'team.create',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createButton(container: Element): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('#team-page-create-btn');
  if (!button) throw new Error('缺少新增俱樂部按鈕');
  return button;
}

function nameInput(dialog: HTMLElement): HTMLInputElement {
  // ASSUMPTION: 沿用 A 表單的 #team-name；允許 label 帶必填符號。
  const byId = dialog.querySelector<HTMLInputElement>('#team-name');
  if (byId) return byId;

  const byLabel = within(dialog).getByLabelText(/俱樂部名稱/);
  if (!(byLabel instanceof HTMLInputElement)) {
    throw new Error('俱樂部名稱欄位不是 input');
  }
  return byLabel;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetClubListFilters();
  vi.mocked(useViewer).mockReturnValue(makeViewer());
  vi.mocked(loadTeams).mockReset();
  vi.mocked(loadTeams).mockResolvedValue([originalTeam]);
  vi.mocked(loginForClubs).mockReset();
  vi.mocked(loginForClubs).mockResolvedValue(undefined);
  vi.mocked(submitCreateTeam).mockReset();
  vi.mocked(submitCreateTeam).mockResolvedValue({
    ok: true,
    teamId: 'created-club',
    roleSyncOk: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TeamsPage 新增俱樂部接線', () => {
  it('有 team.create 的 viewer 看得到按鈕並開啟真表單', async () => {
    render(<TeamsPage />);
    await screen.findByRole('link', { name: '既有俱樂部' });

    fireEvent.click(screen.getByRole('button', { name: '新增俱樂部' }));

    const dialog = await screen.findByRole('dialog');
    expect(nameInput(dialog).value).toBe('');
    expect(submitCreateTeam).not.toHaveBeenCalled();
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('無權限時隱藏按鈕，直接派送點擊仍由同一政策拒絕', async () => {
    vi.mocked(useViewer).mockReturnValue(makeViewer('creator', false));
    const view = render(<TeamsPage />);
    await screen.findByRole('link', { name: '既有俱樂部' });

    expect(screen.queryByRole('button', { name: '新增俱樂部' })).toBeNull();

    // 刻意直接派送隱藏元素，覆蓋 handler 防線；不是可見 UI 操作。
    fireEvent.click(createButton(view.container));

    expect(toast.show).toHaveBeenCalledWith({
      message: '目前未開啟建立俱樂部權限',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(submitCreateTeam).not.toHaveBeenCalled();
    expect(loginForClubs).not.toHaveBeenCalled();
  });

  it.each([null, '', '   '])(
    '訪客 uid=%s 點擊時先要求登入，不開表單與不導頁',
    async (uid) => {
      // 即使權限查詢回傳 true，canCreateTeam 仍必須拒絕空 uid。
      vi.mocked(useViewer).mockReturnValue(makeViewer(uid, true));
      const pendingLogin = deferred<void>();
      vi.mocked(loginForClubs).mockReturnValueOnce(pendingLogin.promise);
      const view = render(<TeamsPage />);
      await screen.findByRole('link', { name: '既有俱樂部' });

      expect(screen.queryByRole('button', { name: '新增俱樂部' })).toBeNull();
      const button = createButton(view.container);
      fireEvent.click(button);
      fireEvent.click(button);

      expect(toast.show).toHaveBeenCalledTimes(1);
      expect(toast.show).toHaveBeenCalledWith({
        message: '請先登入 LINE 帳號',
      });
      expect(loginForClubs).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(submitCreateTeam).not.toHaveBeenCalled();
      expect(routeMock).not.toHaveBeenCalled();

      await act(async () => {
        pendingLogin.resolve(undefined);
        await pendingLogin.promise;
      });
    },
  );

  it('新增成功後關閉表單並重新載入列表，不導頁', async () => {
    const pendingSave = deferred<Awaited<ReturnType<typeof submitCreateTeam>>>();
    vi.mocked(submitCreateTeam).mockReturnValueOnce(pendingSave.promise);
    vi.mocked(loadTeams)
      .mockReset()
      .mockResolvedValueOnce([originalTeam])
      .mockResolvedValueOnce([originalTeam, createdTeam]);

    render(<TeamsPage />);
    await screen.findByRole('link', { name: '既有俱樂部' });

    fireEvent.click(screen.getByRole('button', { name: '新增俱樂部' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.input(nameInput(dialog), {
      target: { value: '新成立俱樂部' },
    });

    // ASSUMPTION: 新增模式送出文案包含「建立」或「新增」。
    fireEvent.click(within(dialog).getByRole('button', {
      name: /^(建立|新增)(俱樂部)?$/,
    }));

    await waitFor(() => expect(submitCreateTeam).toHaveBeenCalledTimes(1));
    expect(submitCreateTeam).toHaveBeenCalledWith(expect.objectContaining({
      viewer: expect.objectContaining({ uid: 'creator' }),
      values: expect.objectContaining({ name: '新成立俱樂部' }),
    }));
    expect(loadTeams).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBe(dialog);

    await act(async () => {
      pendingSave.resolve({
        ok: true,
        teamId: 'created-club',
        roleSyncOk: true,
      });
      await pendingSave.promise;
    });

    await screen.findByRole('link', { name: '新成立俱樂部' });
    expect(loadTeams).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('新增失敗時保留表單與輸入，不重新載入列表', async () => {
    vi.mocked(submitCreateTeam).mockResolvedValueOnce({
      ok: false,
      reason: 'write-failed',
      message: '建立失敗',
    });

    render(<TeamsPage />);
    await screen.findByRole('link', { name: '既有俱樂部' });
    fireEvent.click(screen.getByRole('button', { name: '新增俱樂部' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.input(nameInput(dialog), {
      target: { value: '保留輸入俱樂部' },
    });
    fireEvent.click(within(dialog).getByRole('button', {
      name: /^(建立|新增)(俱樂部)?$/,
    }));

    await waitFor(() => expect(submitCreateTeam).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.show).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(nameInput(dialog).value).toBe('保留輸入俱樂部');
    expect(loadTeams).toHaveBeenCalledTimes(1);
    expect(routeMock).not.toHaveBeenCalled();
  });
});
