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
import TeamDetailPage from './TeamDetailPage';
import { loadTeam, loadTeamMembers } from '../data/teams-repo';
import { updateTeamBasicDoc } from '../data/teams-create';
import { useViewer, type ViewerView } from '@/features/profile/data/viewer';
import { getEventsRepo } from '@/features/events/data/events-repo';
import { loadViewerRegistrations } from '@/features/events/data/viewer-registrations';
import { verifyUserDirectorySelection } from '@/features/events/data/user-directory';
import { toast } from '@/ui/Toast';
import { callFn } from '@/data/callables';
import { writeOpLog } from '@/data/op-log';
import { deliverInboxMessage } from '@/data/inbox-delivery';
import { _resetTeamTabMemoryForTest } from '../components/legacy/team-detail-tab-memory';
import type { TeamDoc } from '../data/types';
import type { EventDoc } from '@/features/events/data/types';

// jsdom 整頁整合：不 mock Header、Settings、Form、useTeamForm、政策或 submitEditTeam。
// 未在本次環境執行；本檔不能當作已通過的驗收證據。
const routeState = vi.hoisted(() => ({
  id: 'club',
  route: vi.fn(),
}));

vi.mock('preact-iso', () => ({
  useRoute: () => ({ params: { id: routeState.id } }),
  useLocation: () => ({
    url: `/teams/${routeState.id}`,
    route: routeState.route,
  }),
}));

vi.mock('@/data/auth', () => ({
  getLastKnownAuthUid: () => 'captain',
}));

vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: vi.fn(),
  requestViewerRefresh: vi.fn(),
}));

vi.mock('../data/teams-repo', () => ({
  loadTeam: vi.fn(),
  loadTeamMembers: vi.fn(),
  invalidateTeams: vi.fn(),
}));

vi.mock('@/features/events/data/events-repo', () => ({
  getEventsRepo: vi.fn(),
}));

vi.mock('@/features/events/data/viewer-registrations', () => ({
  loadViewerRegistrations: vi.fn(),
}));

vi.mock('../data/teams-create', () => ({
  createTeamDoc: vi.fn(),
  updateTeamBasicDoc: vi.fn(),
}));

vi.mock('@/data/callables', () => ({
  callFn: vi.fn(),
}));

vi.mock('@/data/op-log', () => ({
  writeOpLog: vi.fn(),
}));

vi.mock('@/data/inbox-delivery', () => ({
  deliverInboxMessage: vi.fn(),
}));

vi.mock('@/features/events/data/event-cover-upload', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/features/events/data/event-cover-upload')
  >()),
  uploadImageDataUrl: vi.fn(async () => {
    throw new Error('本案例沒有選圖，不應觸發上傳');
  }),
}));

// 目錄讀取、載入與驗證 mock 均以真實函式型別約束；搜尋沿用真實純函式。
// 未知 UID 必須驗證失敗，避免 mock 掩蓋表單傳入錯誤人員的問題。
vi.mock('@/features/events/data/user-directory', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/features/events/data/user-directory')
  >();
  const captain: import('@/features/events/data/user-directory').DirectoryUser = {
    uid: 'captain',
    name: '經理甲',
    displayName: '經理甲',
    pictureUrl: '',
    role: 'user',
  };
  return {
    ...actual,
    getUserDirectory: vi.fn<typeof actual.getUserDirectory>(() => [captain]),
    loadUserDirectory: vi.fn<typeof actual.loadUserDirectory>(async () => true),
    searchUserDirectory: actual.searchUserDirectory,
    verifyUserDirectorySelection:
      vi.fn<typeof actual.verifyUserDirectorySelection>(async (uids) => {
        const requested = [...new Set(
          uids.map(uid => String(uid || '').trim()).filter(Boolean),
        )];
        const users = requested.includes(captain.uid) ? [captain] : [];
        const missingUids = requested.filter(uid => uid !== captain.uid);
        return {
          ok: missingUids.length === 0,
          users,
          missingUids,
          reason: missingUids.length === 0 ? '' : 'missing-users',
        };
      }),
  };
});

const team: TeamDoc = {
  id: 'club',
  _docId: 'club-document',
  name: '原俱樂部名稱',
  nameEn: 'Original Club',
  bio: '原俱樂部簡介',
  active: true,
  captainUid: 'captain',
  captain: '經理甲',
  leaderUids: [],
  leaders: [],
  coachUids: [],
  coaches: [],
  members: 23,
  creatorUid: 'original-creator',
  ownerUid: 'legacy-owner',
  type: 'none',
  region: '台北市',
  sportTag: 'football',
};

function viewer(uid = 'captain'): ViewerView {
  return {
    uid,
    displayName: '經理甲',
    pictureUrl: null,
    role: 'user',
    roleLevel: 1,
    teamIds: new Set(['club']),
    capabilities: [],
    hasPermission: () => false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function getNameInput(dialog: HTMLElement): HTMLInputElement {
  // ASSUMPTION: 完整表單沿用 A 的 #team-name。
  const byId = dialog.querySelector<HTMLInputElement>('#team-name');
  if (byId) return byId;
  const byLabel = within(dialog).getByLabelText(/俱樂部名稱/);
  if (!(byLabel instanceof HTMLInputElement)) {
    throw new Error('缺少俱樂部名稱 input');
  }
  return byLabel;
}

function getBioInput(dialog: HTMLElement): HTMLTextAreaElement {
  // ASSUMPTION: 完整表單沿用 A 的 #team-bio。
  const byId = dialog.querySelector<HTMLTextAreaElement>('#team-bio');
  if (byId) return byId;
  const byLabel = within(dialog).getByLabelText(/俱樂部簡介/);
  if (!(byLabel instanceof HTMLTextAreaElement)) {
    throw new Error('缺少俱樂部簡介 textarea');
  }
  return byLabel;
}

async function openBasicForm(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
  const settings = await screen.findByRole('dialog');
  const edit = within(settings).getByRole('button', {
    name: '編輯基本資料',
  });
  fireEvent.click(edit);

  await waitFor(() => {
    expect(settings.isConnected).toBe(false);
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(getNameInput(dialogs[0]!)).toBeTruthy();
  });

  return screen.getByRole('dialog');
}

const loadEvents = vi.fn<() => Promise<string[]>>();
const snapshot = vi.fn<() => {
  active: EventDoc[];
  terminal: EventDoc[];
}>();

beforeEach(() => {
  vi.clearAllMocks();
  _resetTeamTabMemoryForTest();
  toast.clear();
  routeState.id = 'club';

  vi.mocked(useViewer).mockReturnValue(viewer());
  vi.mocked(loadTeam).mockReset();
  vi.mocked(loadTeam).mockResolvedValue({ ...team });
  vi.mocked(loadTeamMembers).mockResolvedValue([]);
  vi.mocked(loadViewerRegistrations).mockResolvedValue([]);

  loadEvents.mockResolvedValue(['events']);
  snapshot.mockReturnValue({ active: [], terminal: [] });
  vi.mocked(getEventsRepo).mockReturnValue({
    loadEventsStatic: loadEvents,
    getSnapshot: snapshot,
    ensureTerminalEventsLoaded: vi.fn().mockResolvedValue([]),
    loadMoreTerminalEvents: vi.fn().mockResolvedValue(0),
  });

  vi.mocked(updateTeamBasicDoc).mockReset();
  vi.mocked(updateTeamBasicDoc).mockResolvedValue(undefined);

  // 本案例不轉移經理。若純基本資料編輯出現確認，仍沿用真 AppConfirm UI；
  // 沒有替換表單或 action 的判斷。
  vi.mocked(callFn).mockReset();
  vi.mocked(callFn).mockResolvedValue({ ok: true });
  vi.mocked(writeOpLog).mockReset();
  vi.mocked(writeOpLog).mockResolvedValue(undefined);
  vi.mocked(deliverInboxMessage).mockReset();
  // ASSUMPTION: PM 回報的 Record<string, unknown> | null 回傳型別
  // 對應 deliverInboxMessage；本案例沒有職位變動，不應寄出通知。
  vi.mocked(deliverInboxMessage).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  toast.clear();
  vi.restoreAllMocks();
});

describe('TeamDetailPage 編輯基本資料：真表單 jsdom 整頁流程', () => {
  it('預填隊伍資料，儲存新名稱與簡介，重新載入後更新原詳情標題', async () => {
    const pendingWrite = deferred<void>();
    const pendingReload = deferred<TeamDoc | null>();
    vi.mocked(updateTeamBasicDoc).mockReturnValueOnce(pendingWrite.promise);
    vi.mocked(loadTeam)
      .mockReset()
      .mockResolvedValueOnce({ ...team })
      .mockReturnValueOnce(pendingReload.promise);

    const view = render(<TeamDetailPage />);
    const title = await screen.findByText('原俱樂部名稱');
    expect(view.container.querySelector('.td-v2-title')).toBe(title);

    const dialog = await openBasicForm();
    const name = getNameInput(dialog);
    const bio = getBioInput(dialog);
    expect(name.value).toBe('原俱樂部名稱');
    expect(bio.value).toBe('原俱樂部簡介');

    fireEvent.input(name, { target: { value: '更新後俱樂部' } });
    fireEvent.input(bio, { target: { value: '更新後俱樂部簡介' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /儲存/ }));

    await waitFor(() => expect(updateTeamBasicDoc).toHaveBeenCalledTimes(1));
    expect(verifyUserDirectorySelection).toHaveBeenCalledTimes(1);
    expect(verifyUserDirectorySelection).toHaveBeenCalledWith(['captain']);
    const call = vi.mocked(updateTeamBasicDoc).mock.calls[0];
    if (!call) throw new Error('缺少基本資料寫入呼叫');
    const [target, patch] = call;

    expect(target).toEqual(expect.objectContaining({
      id: 'club',
      _docId: 'club-document',
    }));
    expect(patch).toEqual(expect.objectContaining({
      name: '更新後俱樂部',
      bio: '更新後俱樂部簡介',
    }));
    expect(Object.prototype.hasOwnProperty.call(patch, 'members')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(patch, 'creatorUid')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(patch, 'ownerUid')).toBe(false);

    expect(loadTeam).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(view.container.querySelector('.td-v2-title')).toBe(title);
    expect(title.textContent).toBe('原俱樂部名稱');

    await act(async () => {
      pendingWrite.resolve(undefined);
      await pendingWrite.promise;
    });

    await waitFor(() => expect(loadTeam).toHaveBeenCalledTimes(2));
    expect(loadTeam).toHaveBeenLastCalledWith('club');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // reload 尚未完成時保留原詳情，不跳回 loading shell。
    expect(view.container.querySelector('.td-v2-title')).toBe(title);
    expect(title.textContent).toBe('原俱樂部名稱');
    expect(screen.queryByText('載入中…')).toBeNull();

    await act(async () => {
      pendingReload.resolve({
        ...team,
        name: '更新後俱樂部',
        bio: '更新後俱樂部簡介',
      });
      await pendingReload.promise;
    });

    await waitFor(() => expect(title.textContent).toBe('更新後俱樂部'));
    expect(view.container.querySelector('.td-v2-title')).toBe(title);
    expect(screen.getByText('更新後俱樂部簡介')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(updateTeamBasicDoc).toHaveBeenCalledTimes(1);
    expect(loadTeam).toHaveBeenCalledTimes(2);
    expect(deliverInboxMessage).not.toHaveBeenCalled();
    expect(routeState.route).not.toHaveBeenCalled();
  });

  it.each(['member', 'leader', 'coach'])(
    '非經理 %s 的更多維持分享行為，不出現基本資料編輯',
    async (uid) => {
      const toastSpy = vi.spyOn(toast, 'show');
      vi.mocked(useViewer).mockReturnValue(viewer(uid));
      vi.mocked(loadTeam).mockResolvedValue({
        ...team,
        leaderUids: ['leader'],
        leaders: ['領隊'],
        coachUids: ['coach'],
        coaches: ['教練'],
      });

      render(<TeamDetailPage />);
      await screen.findByText('原俱樂部名稱');
      fireEvent.click(screen.getByRole('button', { name: '更多操作' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('button', { name: '編輯基本資料' })).toBeNull();
      expect(updateTeamBasicDoc).not.toHaveBeenCalled();

      // 附件現況的分享尚未實作；保留它既有的提示，不在本卡增加分享邏輯。
      expect(toastSpy).toHaveBeenCalledWith({
        message: '此功能尚未開放，請先使用舊版',
      });
    },
  );

  it('同名但 uid 不同的 viewer 不能取得經理編輯入口', async () => {
    vi.mocked(useViewer).mockReturnValue({
      ...viewer('another-user'),
      displayName: '經理甲',
    });

    render(<TeamDetailPage />);
    await screen.findByText('原俱樂部名稱');
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: '編輯基本資料' })).toBeNull();
    expect(updateTeamBasicDoc).not.toHaveBeenCalled();
  });

  it('設定開啟後經理 uid 被更新，點編輯仍重新檢查政策', async () => {
    const toastSpy = vi.spyOn(toast, 'show');
    const currentViewer = viewer();
    vi.mocked(useViewer).mockReturnValue(currentViewer);

    render(<TeamDetailPage />);
    await screen.findByText('原俱樂部名稱');
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const settings = await screen.findByRole('dialog');

    // 保持 viewer 物件與已綁定 handler，不觸發頁面重新掛載，
    // 模擬顯示後權限條件已改變，驗證 handler 不是只信任先前的顯示結果。
    currentViewer.uid = 'another-user';
    fireEvent.click(within(settings).getByRole('button', {
      name: '編輯基本資料',
    }));

    expect(toastSpy).toHaveBeenCalledWith({
      message: '您沒有編輯此俱樂部的權限',
    });
    expect(screen.getByRole('dialog')).toBe(settings);
    expect(settings.querySelector('#team-name')).toBeNull();
    expect(updateTeamBasicDoc).not.toHaveBeenCalled();
  });

  it('關閉基本資料表單後不復活設定彈窗，也不寫入或重讀', async () => {
    render(<TeamDetailPage />);
    await screen.findByText('原俱樂部名稱');
    const dialog = await openBasicForm();

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: '編輯基本資料' })).toBeNull();
    expect(updateTeamBasicDoc).not.toHaveBeenCalled();
    expect(loadTeam).toHaveBeenCalledTimes(1);

    // 再開更多應重新建立設定彈窗，沒有殘留表單。
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    const settings = await screen.findByRole('dialog');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(settings).getByRole('button', {
      name: '編輯基本資料',
    })).toBeTruthy();
  });
});
