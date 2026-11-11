// K1a／K2／K5 俱樂部管理頁：權限過濾、分段排序、管理員操作、刪除與讀取預算。
// 使用真的 teams-repo／teams-admin-write，只替換 Firestore SDK，藉此計算實際讀取次數。
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';
import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import { invalidateTeams } from '../data/teams-repo';
import type { TeamDoc } from '../data/types';
import TeamManagePage from './TeamManagePage';

const sdk = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, name: string) => ({ __col: name })),
  collectionGroup: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ __ref: segments.join('/') })),
  updateDoc: vi.fn(async () => undefined),
  setDoc: vi.fn(async () => undefined),
  serverTimestamp: vi.fn(() => ({ __ts: true })),
}));
const state = vi.hoisted(() => ({
  viewer: null as unknown,
  sport: 'all',
  route: vi.fn(),
  callFn: vi.fn(),
  refreshViewer: vi.fn(),
}));

vi.mock('firebase/firestore', () => sdk);
vi.mock('@/data/firebase', () => ({
  getFirebase: async () => ({ db: { __db: true } }),
  getFirebaseCore: async () => ({ db: { __db: true } }),
}));
vi.mock('@/data/callables', () => ({ callFn: state.callFn }));
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => 'resolved' }));
vi.mock('@/features/profile/data/viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/profile/data/viewer')>();
  return {
    createMinimalViewer: actual.createMinimalViewer,
    useViewer: () => state.viewer,
    requestViewerRefresh: state.refreshViewer,
  };
});
vi.mock('@/core/sport-filter', () => ({ useActiveSport: () => [state.sport, vi.fn()] }));
vi.mock('@/core/back-guard', () => ({ useGoBack: () => vi.fn() }));
vi.mock('preact-iso', () => ({
  useLocation: () => ({ url: '/team-manage', path: '/team-manage', query: {}, route: state.route }),
}));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: vi.fn() }));
vi.mock('../components/legacy/TeamFormModal', () => ({
  TeamFormModal: (props: { mode: string; team?: TeamDoc }) => (
    <div data-testid="team-form" data-mode={props.mode} data-team={props.team?.id ?? ''} />
  ),
}));

const TEAMS: TeamDoc[] = [
  { id: 'tm_a', name: 'A隊', captainUid: 'U-cap', active: true, sportTag: 'football' },
  { id: 'tm_b', name: 'B隊', captainUid: 'U-other', coachUids: ['U-cap'], active: true, sportTag: 'basketball' },
  { id: 'tm_c', name: 'C隊', captainUid: 'U-other', active: true, sportTag: 'football' },
  { id: 'tm_d', name: 'D隊', captainUid: 'U-cap', active: false, sportTag: 'football' },
  { id: 'tm_p', name: 'P隊', captainUid: 'U-other', active: true, pinned: true, pinOrder: 150, attentionEffectEnabled: false },
];

function snapshot(teams: readonly TeamDoc[]) {
  return {
    forEach: (cb: (doc: { id: string; data: () => TeamDoc }) => void) => {
      for (const team of teams) cb({ id: String(team.id), data: () => ({ ...team }) });
    },
  };
}

function makeViewer(uid: string | null, perms: readonly string[]): ViewerView {
  return {
    uid,
    displayName: uid ? `名-${uid}` : null,
    pictureUrl: null,
    role: uid ? 'captain' : 'guest',
    roleLevel: 2,
    teamIds: new Set<string>(),
    capabilities: [],
    hasPermission: (code: string) => perms.includes(code),
  };
}

const ADMIN = ['team.manage.entry', 'team.manage_all', 'team.create'];
const CAPTAIN = ['team.manage.entry'];

function cardIds(container: Element): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-team-id]')).map((el) => el.dataset.teamId ?? '');
}

function card(container: Element, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-team-id="${id}"]`);
  if (!el) throw new Error(`missing card ${id}`);
  return el;
}

async function renderLoaded(perms: readonly string[], uid = 'U-cap') {
  state.viewer = makeViewer(uid, perms);
  const utils = render(<TeamManagePage />);
  await waitFor(() => expect(utils.container.querySelector('[aria-busy="true"]')).toBeNull());
  return utils;
}

function updatePayloads(): Record<string, unknown>[] {
  return sdk.updateDoc.mock.calls.map((call) => (call as unknown[])[1] as Record<string, unknown>);
}

beforeEach(() => {
  invalidateTeams();
  state.sport = 'all';
  sdk.getDocs.mockResolvedValue(snapshot(TEAMS));
  sdk.updateDoc.mockResolvedValue(undefined);
  vi.mocked(appConfirm).mockResolvedValue(true);
  state.callFn.mockResolvedValue({ ok: true, alreadyDeleted: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('讀取預算', () => {
  it('進頁只讀 1 次 teams 集合，沒有 getDoc／where／collectionGroup', async () => {
    await renderLoaded(ADMIN, 'U-admin');
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
    expect(sdk.collection).toHaveBeenCalledTimes(1);
    expect(sdk.collection).toHaveBeenCalledWith(expect.anything(), 'teams');
    expect(sdk.getDoc).not.toHaveBeenCalled();
    expect(sdk.where).not.toHaveBeenCalled();
    expect(sdk.collectionGroup).not.toHaveBeenCalled();
  });

  it('同 session 再進頁 0 讀（沿用快取）', async () => {
    await renderLoaded(ADMIN, 'U-admin');
    cleanup();
    await renderLoaded(ADMIN, 'U-admin');
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
  });

  it('置頂後卸載再掛載：getDocs 仍是 1 次，且畫面沿用就地更新後的快取', async () => {
    const first = await renderLoaded(ADMIN, 'U-admin');
    fireEvent.click(within(card(first.container, 'tm_a')).getByRole('button', { name: '置頂' }));
    await waitFor(() => expect(within(card(first.container, 'tm_a')).getByRole('button', { name: '已置頂' })).toBeTruthy());
    cleanup();
    const second = await renderLoaded(ADMIN, 'U-admin');
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
    expect(cardIds(second.container).slice(0, 2)).toEqual(['tm_p', 'tm_a']);
    expect(within(card(second.container, 'tm_a')).getByRole('button', { name: '已置頂' })).toBeTruthy();
  });

  it('完整 viewer 未到位（最小 viewer）：顯示骨架、不閃「權限不足」、0 讀', async () => {
    state.viewer = createMinimalViewer('U-admin');
    const { container } = render(<TeamManagePage />);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('.ui-page-spinner[role="status"]')).not.toBeNull();
    expect(screen.queryByText('權限不足')).toBeNull();
    expect(sdk.getDocs).not.toHaveBeenCalled();
    expect(document.getElementById('team-manage-create-btn')).toBeNull();
  });

  it('沒有 team.manage.entry：顯示權限不足，0 讀', async () => {
    state.viewer = makeViewer('U-user', []);
    render(<TeamManagePage />);
    expect(screen.getByText('權限不足')).toBeTruthy();
    await act(async () => { await Promise.resolve(); });
    expect(sdk.getDocs).not.toHaveBeenCalled();
    expect(document.getElementById('team-manage-create-btn')).toBeNull();
  });

  it('viewer 尚未到位時不出現權限不足、出現轉圈；到位且無權限才出現權限不足；到位且有權限顯示內容', async () => {
    state.viewer = createMinimalViewer('U-admin');
    const view = render(<TeamManagePage />);
    expect(view.container.querySelector('.ui-page-spinner[role="status"]')).not.toBeNull();
    expect(screen.queryByText('權限不足')).toBeNull();
    expect(sdk.getDocs).not.toHaveBeenCalled();

    state.viewer = makeViewer('U-user', []);
    view.rerender(<TeamManagePage />);
    expect(view.container.querySelector('.ui-page-spinner')).toBeNull();
    expect(screen.getByText('權限不足')).toBeTruthy();
    expect(sdk.getDocs).not.toHaveBeenCalled();

    state.viewer = makeViewer('U-admin', ADMIN);
    view.rerender(<TeamManagePage />);
    await waitFor(() => expect(view.container.querySelector('[data-team-id="tm_a"]')).not.toBeNull());
    expect(screen.queryByText('權限不足')).toBeNull();
  });

  it('置頂、上下架、光跡、刪除後都不重讀清單', async () => {
    const { container } = await renderLoaded(ADMIN, 'U-admin');
    fireEvent.click(within(card(container, 'tm_a')).getByRole('button', { name: '置頂' }));
    await waitFor(() => expect(sdk.updateDoc).toHaveBeenCalledTimes(1));
    fireEvent.click(within(card(container, 'tm_c')).getByRole('button', { name: '下架' }));
    await waitFor(() => expect(sdk.updateDoc).toHaveBeenCalledTimes(2));
    fireEvent.click(card(container, 'tm_p').querySelector<HTMLInputElement>('.team-attention-switch input')!);
    await waitFor(() => expect(sdk.updateDoc).toHaveBeenCalledTimes(3));
    fireEvent.click(within(card(container, 'tm_b')).getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(container.querySelector('[data-team-id="tm_b"]')).toBeNull());
    expect(sdk.getDocs).toHaveBeenCalledTimes(1);
    expect(sdk.getDoc).not.toHaveBeenCalled();
  });
});

describe('清單（K1a）', () => {
  it('管理員看全部：上架中在前（置頂優先），已下架分段在後', async () => {
    const { container } = await renderLoaded(ADMIN, 'U-admin');
    expect(cardIds(container)).toEqual(['tm_p', 'tm_a', 'tm_b', 'tm_c', 'tm_d']);
    expect(screen.getByText('已下架俱樂部')).toBeTruthy();
    expect(card(container, 'tm_d').className).toContain('team-inactive');
    expect(within(card(container, 'tm_p')).getByText('置頂')).toBeTruthy();
    expect(document.getElementById('team-manage-create-btn')?.textContent).toBe('＋ 新增俱樂部');
  });

  it('經理只看自己是擁有者或幹部的俱樂部；編輯／刪除只在擁有者卡；沒有管理員按鈕', async () => {
    const { container } = await renderLoaded(CAPTAIN);
    expect(cardIds(container)).toEqual(['tm_a', 'tm_b', 'tm_d']);
    const a = card(container, 'tm_a');
    expect(within(a).getByRole('button', { name: '編輯' })).toBeTruthy();
    expect(within(a).getByRole('button', { name: '刪除' })).toBeTruthy();
    const b = card(container, 'tm_b');
    expect(within(b).queryByRole('button', { name: '編輯' })).toBeNull();
    expect(within(b).queryByRole('button', { name: '刪除' })).toBeNull();
    expect(container.querySelector('.team-pin-btn')).toBeNull();
    expect(container.querySelector('.team-attention-controls')).toBeNull();
    expect(screen.queryByText('上架')).toBeNull();
    // 無 team.create 不顯示新增鈕（照 A _refreshTeamCreateButtons）
    expect(document.getElementById('team-manage-create-btn')).toBeNull();
  });

  it('角色低於教練的擁有者：看得到編輯，看不到刪除（對齊 Callable deleteTeam）', async () => {
    state.viewer = { ...makeViewer('U-cap', CAPTAIN), role: 'user', roleLevel: 0 };
    const { container } = render(<TeamManagePage />);
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    const a = card(container, 'tm_a');
    expect(within(a).getByRole('button', { name: '編輯' })).toBeTruthy();
    expect(within(a).queryByRole('button', { name: '刪除' })).toBeNull();
  });

  it('套用全域運動篩選', async () => {
    state.sport = 'football';
    const { container } = await renderLoaded(ADMIN, 'U-admin');
    expect(cardIds(container)).toEqual(['tm_a', 'tm_c', 'tm_d']);
  });

  it('沒有任何可管理的俱樂部：顯示「尚無俱樂部資料」', async () => {
    await renderLoaded(CAPTAIN, 'U-nobody');
    expect(screen.getByText('尚無俱樂部資料')).toBeTruthy();
  });

  it('點卡進俱樂部詳情；點編輯開既有編輯彈窗', async () => {
    const { container } = await renderLoaded(CAPTAIN);
    fireEvent.click(card(container, 'tm_a'));
    expect(state.route).toHaveBeenCalledWith('/teams/tm_a');
    state.route.mockClear();
    fireEvent.click(within(card(container, 'tm_a')).getByRole('button', { name: '編輯' }));
    expect(state.route).not.toHaveBeenCalled();
    const form = screen.getByTestId('team-form');
    expect(form.dataset.mode).toBe('edit');
    expect(form.dataset.team).toBe('tm_a');
  });
});

describe('管理員專屬（K2）', () => {
  it('置頂：pinOrder＝已載入最大值＋1，寫 operationLogs（actorUid）', async () => {
    const { container } = await renderLoaded(ADMIN, 'U-admin');
    fireEvent.click(within(card(container, 'tm_a')).getByRole('button', { name: '置頂' }));
    await waitFor(() => expect(sdk.setDoc).toHaveBeenCalled());
    expect(updatePayloads()[0]).toEqual({ pinned: true, pinOrder: 151, updatedAt: { __ts: true } });
    const log = (sdk.setDoc.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(log).toMatchObject({ type: 'team_pin', actorUid: 'U-admin', operator: '名-U-admin' });
    expect(within(card(container, 'tm_a')).getByRole('button', { name: '已置頂' })).toBeTruthy();
    expect(toast.show).toHaveBeenCalledWith({ message: '已置頂俱樂部' });
  });

  it('下架失敗：畫面回滾並提示', async () => {
    sdk.updateDoc.mockRejectedValueOnce(new Error('permission-denied'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = await renderLoaded(ADMIN, 'U-admin');
    fireEvent.click(within(card(container, 'tm_c')).getByRole('button', { name: '下架' }));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message: '更新失敗，請稍後再試', tone: 'error' }));
    expect(within(card(container, 'tm_c')).getByText('上架中')).toBeTruthy();
    expect(card(container, 'tm_c').className).not.toContain('team-inactive');
  });

  it('上架成功：移到上架段並寫 active', async () => {
    const { container } = await renderLoaded(ADMIN, 'U-admin');
    fireEvent.click(within(card(container, 'tm_d')).getByRole('button', { name: '上架' }));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message: '已上架「D隊」' }));
    expect(updatePayloads()[0]).toEqual({ active: true, updatedAt: { __ts: true } });
    // 與 A 刻意差異：上下架也寫操作日誌
    await waitFor(() => expect(sdk.setDoc).toHaveBeenCalled());
    const log = (sdk.setDoc.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(log).toMatchObject({ type: 'team_active', actorUid: 'U-admin', content: '上架「D隊」' });
    expect(screen.queryByText('已下架俱樂部')).toBeNull();
  });

  it('光跡：沒有說明小字；開關寫入啟用與正規化顏色', async () => {
    const { container } = await renderLoaded(ADMIN, 'U-admin');
    expect(container.textContent).not.toContain('開啟後俱樂部卡片會顯示流動光跡');
    expect(container.querySelector('.team-attention-hint')).toBeNull();
    const toggle = card(container, 'tm_p').querySelector<HTMLInputElement>('.team-attention-switch input')!;
    fireEvent.click(toggle);
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message: '光跡效果已開啟' }));
    expect(updatePayloads()[0]).toEqual({
      attentionEffectEnabled: true,
      attentionEffectColor: '#fbbf24',
      updatedAt: { __ts: true },
    });
  });

  it('光跡顏色：寫入新顏色', async () => {
    const { container } = await renderLoaded(ADMIN, 'U-admin');
    const color = card(container, 'tm_p').querySelector<HTMLInputElement>('input[type="color"]')!;
    fireEvent.change(color, { target: { value: '#22c55e' } });
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message: '光跡顏色已更新' }));
    expect(updatePayloads()[0]).toEqual({ attentionEffectColor: '#22c55e', updatedAt: { __ts: true } });
  });
});

describe('刪除（K5）', () => {
  it('確認框照 A 文案；確認後呼叫 deleteTeam 並就地移除', async () => {
    const { container } = await renderLoaded(CAPTAIN);
    fireEvent.click(within(card(container, 'tm_a')).getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(container.querySelector('[data-team-id="tm_a"]')).toBeNull());
    expect(appConfirm).toHaveBeenCalledWith('確定要刪除「A隊」？此操作無法復原。');
    expect(state.callFn).toHaveBeenCalledWith('deleteTeam', { teamId: 'tm_a' }, { timeout: 125000 });
    expect(toast.show).toHaveBeenCalledWith({ message: '已刪除「A隊」' });
    expect(sdk.updateDoc).not.toHaveBeenCalled();
  });

  it('刪除結果的 roleChangedUids 含自己 → 重讀自己的 viewer；不含且不是成員 → 不重讀', async () => {
    state.callFn.mockResolvedValueOnce({ ok: true, alreadyDeleted: false, roleChangedUids: ['U-cap'] });
    const { container } = await renderLoaded(CAPTAIN);
    fireEvent.click(within(card(container, 'tm_a')).getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(state.refreshViewer).toHaveBeenCalledTimes(1));
    state.callFn.mockResolvedValueOnce({ ok: true, alreadyDeleted: false, roleChangedUids: ['U-x'] });
    fireEvent.click(within(card(container, 'tm_d')).getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(container.querySelector('[data-team-id="tm_d"]')).toBeNull());
    expect(state.refreshViewer).toHaveBeenCalledTimes(1);
  });

  it('自己是該隊成員 → 刪除後重讀自己的 viewer', async () => {
    state.viewer = { ...makeViewer('U-cap', CAPTAIN), teamIds: new Set(['tm_a']) };
    const { container } = render(<TeamManagePage />);
    await waitFor(() => expect(container.querySelector('[data-team-id="tm_a"]')).not.toBeNull());
    fireEvent.click(within(card(container, 'tm_a')).getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(state.refreshViewer).toHaveBeenCalledTimes(1));
  });

  it('取消確認不呼叫伺服器', async () => {
    vi.mocked(appConfirm).mockResolvedValue(false);
    const { container } = await renderLoaded(CAPTAIN);
    fireEvent.click(within(card(container, 'tm_a')).getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(appConfirm).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(state.callFn).not.toHaveBeenCalled();
    expect(container.querySelector('[data-team-id="tm_a"]')).not.toBeNull();
  });

  it('伺服器回 partial：保留卡片並提示再按一次', async () => {
    state.callFn.mockResolvedValue({ ok: true, alreadyDeleted: false, partial: { remaining: 2, memberIds: [], rerun: true } });
    const { container } = await renderLoaded(CAPTAIN);
    fireEvent.click(within(card(container, 'tm_a')).getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({
      message: '部分成員資料尚未清除，請再按一次刪除',
      tone: 'error',
    }));
    expect(container.querySelector('[data-team-id="tm_a"]')).not.toBeNull();
  });

  it('伺服器拒絕（COACH_PLUS_REQUIRED）：提示權限不足', async () => {
    state.callFn.mockRejectedValue(new Error('COACH_PLUS_REQUIRED'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = await renderLoaded(CAPTAIN);
    fireEvent.click(within(card(container, 'tm_a')).getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message: '權限不足', tone: 'error' }));
    expect(container.querySelector('[data-team-id="tm_a"]')).not.toBeNull();
  });
});
