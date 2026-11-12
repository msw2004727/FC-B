// 站內信管理頁（W2A-1／2／3）：讀取預算（進頁 ≤ 54）、權限、頁籤與按鈕、改狀態不重讀、撰寫發送（Callable 用 mock，不送真推播）。
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';

import { createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';
import { appConfirm } from '@/ui/AppConfirm';
import { loadTeams } from '@/features/clubs/data/teams-repo';
import { toast } from '@/ui/Toast';
import { _resetRecentInboxDeliveryForTest } from '@/data/inbox-delivery';

import { fakeSdk, fakeState, limitOf, resetFakeFirestore, totalReads, type FakeDoc, type QueryDesc } from '../fake-firestore.test-helper';
import AdminMessagesPage from './AdminMessagesPage';

const state = vi.hoisted(() => ({
  viewer: null as unknown,
  callFn: vi.fn(),
}));

// 同步工廠（照 TeamManagePage.test）：假 SDK 由 vi.hoisted 先載入。
const fakeModule = await vi.hoisted(async () => import('../fake-firestore.test-helper'));
vi.mock('firebase/firestore', () => fakeModule.fakeSdk);
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: { __db: true } }) }));
vi.mock('@/data/callables', () => ({ callFn: state.callFn }));
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => 'resolved', getCurrentUser: async () => ({ uid: 'U-admin' }) }));
vi.mock('@/features/profile/data/viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/profile/data/viewer')>();
  return { createMinimalViewer: actual.createMinimalViewer, useViewer: () => state.viewer };
});
vi.mock('@/core/back-guard', () => ({ useGoBack: () => vi.fn() }));
vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: vi.fn() }));
vi.mock('@/features/clubs/data/teams-repo', () => ({
  loadTeams: vi.fn(async () => [{ id: 'tm_1', name: 'A隊', active: true, members: 12, region: '台北' }]),
}));
vi.mock('@/features/events/data/user-directory', () => ({
  getUserDirectory: () => [{ uid: 'U9', name: '阿明', displayName: '阿明', pictureUrl: '', role: 'user' }],
  loadUserDirectory: vi.fn(async () => true),
  verifyUserDirectorySelection: vi.fn(async (uids: string[]) => ({
    ok: true,
    users: uids.map((uid) => ({ uid, name: '阿明', displayName: '阿明', pictureUrl: '', role: 'user' })),
    missingUids: [],
    reason: '',
  })),
}));

function makeViewer(role: string, perms: readonly string[], uid: string | null = 'U-admin'): ViewerView {
  return {
    uid,
    displayName: uid ? '站長' : null,
    pictureUrl: null,
    role,
    roleLevel: 5,
    teamIds: new Set<string>(),
    capabilities: [],
    hasPermission: (code: string) => perms.includes(code),
  };
}

const ADMIN = ['admin.messages.entry'];

function adminDoc(i: number, status: string, over: Record<string, unknown> = {}): FakeDoc {
  return {
    id: `d${i}`,
    data: {
      id: `mg_${i}`,
      title: `信件${i}`,
      body: `內容${i}`,
      category: 'system',
      categoryName: '系統',
      target: '全體用戶',
      targetType: 'all',
      senderName: '站長',
      time: '2026/11/01 10:30',
      status,
      ...over,
    },
  };
}

let pages: FakeDoc[][] = [];

function adminReads(): number {
  return fakeState.reads.filter((r) => r.path === 'adminMessages' && r.op === 'getDocs').length;
}

function card(container: Element, docId: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-msg-id="${docId}"]`);
  if (!el) throw new Error(`missing card ${docId}`);
  return el;
}

async function renderPage(perms: readonly string[] = ADMIN, role = 'admin') {
  state.viewer = makeViewer(role, perms);
  const utils = render(<AdminMessagesPage />);
  await waitFor(() => expect(utils.container.querySelector('[role="status"]')).toBeNull());
  return utils;
}

async function typeInto(id: string, value: string): Promise<void> {
  const el = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    el.value = value;
    fireEvent.input(el);
  });
}

// 載入真正的繁中字典（照 ActivitiesPage.test）。
beforeAll(async () => {
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
});

beforeEach(() => {
  resetFakeFirestore();
  _resetRecentInboxDeliveryForTest();
  pages = [[
    adminDoc(1, 'sent'),
    adminDoc(2, 'sent', { target: '阿明', targetUid: 'U9', targetName: '阿明', targetType: 'individual' }),
    adminDoc(3, 'scheduled', { scheduledAt: '2026-11-08T09:00' }),
    adminDoc(4, 'cancelled', { scheduledAt: '2026-11-03T12:00' }),
    adminDoc(5, 'processing', { scheduledAt: '2026-11-02T09:00', processingAt: { toMillis: () => Date.now() - 60_000 } }),
    adminDoc(6, 'recalled'),
  ]];
  let pageIndex = 0;
  fakeState.docsHandler = (q: QueryDesc) => {
    if (q.path === 'adminMessages') return pages[pageIndex++] ?? [];
    return [];
  };
  fakeState.countHandler = (q) => {
    const where = q.constraints.find((c) => c.type === 'where')?.args ?? [];
    if (where[1] === 'in') return 2;
    return where[2] === 'sent' ? 5 : where[2] === 'recalled' ? 1 : 0;
  };
  vi.mocked(appConfirm).mockResolvedValue(true);
  state.callFn.mockReset();
  state.callFn.mockResolvedValue({ success: true, delivered: 1 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('讀取預算（進頁 ≤ 54）', () => {
  it('進頁：adminMessages 1 次 limit 50＋4 個 count，合計 ≤ 54；不碰 users、不用 collectionGroup', async () => {
    pages = [Array.from({ length: 50 }, (_, i) => adminDoc(i, 'sent'))];
    await renderPage();
    await waitFor(() => expect(fakeSdk.getCountFromServer).toHaveBeenCalledTimes(4));
    expect(adminReads()).toBe(1);
    expect(limitOf(fakeState.reads.find((r) => r.op === 'getDocs')?.q)).toBe(50);
    expect(totalReads()).toBeLessThanOrEqual(54);
    expect(fakeState.reads.every((r) => r.path === 'adminMessages')).toBe(true);
    expect(fakeSdk.collectionGroup).not.toHaveBeenCalled();
    expect(state.callFn).not.toHaveBeenCalled();
  });

  it('沒有 admin.messages.entry：權限不足、0 讀', async () => {
    state.viewer = makeViewer('coach', []);
    render(<AdminMessagesPage />);
    expect(screen.getByText('權限不足')).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
    expect(totalReads()).toBe(0);
  });

  it('完整 viewer 未到位：不閃權限不足、0 讀', async () => {
    state.viewer = createMinimalViewer('U-admin');
    render(<AdminMessagesPage />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('.ui-page-spinner[role="status"]')).not.toBeNull();
    expect(screen.queryByText('權限不足')).toBeNull();
    expect(totalReads()).toBe(0);
  });

  it('viewer 尚未到位時不出現權限不足、出現轉圈；到位且無權限才出現權限不足；到位且有權限顯示內容', async () => {
    state.viewer = createMinimalViewer('U-admin');
    const view = render(<AdminMessagesPage />);
    expect(document.querySelector('.ui-page-spinner[role="status"]')).not.toBeNull();
    expect(screen.queryByText('權限不足')).toBeNull();
    expect(totalReads()).toBe(0);

    state.viewer = makeViewer('coach', []);
    view.rerender(<AdminMessagesPage />);
    expect(document.querySelector('.ui-page-spinner')).toBeNull();
    expect(screen.getByText('權限不足')).toBeTruthy();
    expect(totalReads()).toBe(0);

    state.viewer = makeViewer('admin', ADMIN);
    view.rerender(<AdminMessagesPage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '站內信管理' })).toBeTruthy());
    expect(screen.queryByText('權限不足')).toBeNull();
  });

  it('載入更多：第二頁帶游標、每次 ≤ 50', async () => {
    pages = [Array.from({ length: 50 }, (_, i) => adminDoc(i, 'sent')), [adminDoc(99, 'sent')]];
    const { container } = await renderPage();
    fireEvent.click(screen.getByRole('button', { name: '載入更多' }));
    await waitFor(() => expect(container.querySelector('[data-msg-id="d99"]')).not.toBeNull());
    const second = fakeState.reads.filter((r) => r.path === 'adminMessages' && r.op === 'getDocs')[1]?.q;
    expect(second?.constraints.some((c) => c.type === 'startAfter')).toBe(true);
    expect(limitOf(second)).toBe(50);
    expect(screen.queryByRole('button', { name: '載入更多' })).toBeNull();
  });
});

describe('名單載入', () => {
  it('載入中有圈與骨架和「載入中...」，完成後換成信件，失敗沿用錯誤列', async () => {
    const original = fakeSdk.getDocs.getMockImplementation();
    if (!original) throw new Error('getDocs 沒有原始實作');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fakeSdk.getDocs.mockImplementation(async (target: unknown) => {
      await gate;
      return original(target);
    });
    try {
      state.viewer = makeViewer('admin', ADMIN);
      const view = render(<AdminMessagesPage />);
      const status = screen.getByRole('status');
      expect(status.classList.contains('reg-loading')).toBe(true);
      expect(status.textContent).toBe('載入中...');
      expect(view.container.querySelectorAll('#msg-manage-list .reg-loading-skeleton-row')).toHaveLength(3);
      expect(view.container.querySelector('[data-msg-id]')).toBeNull();

      release();
      await waitFor(() => expect(view.container.querySelector('[data-msg-id="d1"]')).not.toBeNull());
      expect(view.container.querySelector('.reg-loading')).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
      view.unmount();
    } finally {
      fakeSdk.getDocs.mockImplementation(original);
    }

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fakeSdk.getDocs.mockRejectedValueOnce(new Error('boom'));
    try {
      state.viewer = makeViewer('admin', ADMIN);
      render(<AdminMessagesPage />);
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('載入失敗，請重試');
      expect(document.querySelector('.reg-loading')).toBeNull();
      expect(screen.getByRole('button', { name: '重試' })).toBeTruthy();
    } finally {
      errorSpy.mockRestore();
      fakeSdk.getDocs.mockImplementation(original);
    }
  });
});

describe('畫面（照 A renderMsgManage）', () => {
  it('頁首、計數列、四頁籤；已發送頁籤的卡片與按鈕', async () => {
    const { container } = await renderPage();
    expect(screen.getByRole('heading', { name: '站內信管理' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '編輯腳本' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '＋ 發送' })).toBeTruthy();
    await waitFor(() =>
      expect(document.getElementById('msg-sent-count')?.textContent).toBe('已發送 5 封 ・ 排程 2 封 ・ 已回收 1 封 ・ 已刪除 0 封'),
    );
    expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual(['已發送', '已排程', '已回收', '已刪除']);
    const c2 = card(container, 'd2');
    expect(c2.textContent).toContain('[系統] 對象：阿明（U9） ・ 2026/11/01 10:30');
    expect(c2.textContent).toContain('發送人：站長');
    expect(within(c2).getAllByRole('button').map((b) => b.textContent)).toEqual(['查看', '回收', '刪除']);
    expect(within(c2).getByText('已發送').className).toContain('status-active');
  });

  it('已排程頁籤含排程中、處理中、已取消，按鈕與排程時間照 A', async () => {
    const { container } = await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: '已排程' }));
    expect(Array.from(container.querySelectorAll('[data-msg-id]')).map((el) => el.getAttribute('data-msg-id'))).toEqual(['d3', 'd4', 'd5']);
    expect(within(card(container, 'd3')).getAllByRole('button').map((b) => b.textContent)).toEqual(['查看', '取消排程', '刪除']);
    expect(card(container, 'd3').textContent).toContain('預約發送：2026/11/08 09:00');
    expect(within(card(container, 'd4')).getAllByRole('button').map((b) => b.textContent)).toEqual(['查看', '恢復排程', '刪除']);
    expect(card(container, 'd4').textContent).toContain('原排程：2026/11/03 12:00');
    expect(within(card(container, 'd5')).getAllByRole('button').map((b) => b.textContent)).toEqual(['查看']);
  });

  it('處理中超過 10 分鐘（卡住）：可取消排程或恢復排程；恢復寫 scheduled', async () => {
    pages = [[adminDoc(7, 'processing', { scheduledAt: '2026-11-02T09:00', processingAt: { toMillis: () => Date.now() - 11 * 60_000 } })]];
    const { container } = await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: '已排程' }));
    expect(within(card(container, 'd7')).getAllByRole('button').map((b) => b.textContent)).toEqual(['查看', '取消排程', '恢復排程']);
    fireEvent.click(within(card(container, 'd7')).getByRole('button', { name: '恢復排程' }));
    await waitFor(() => expect(fakeState.writes).toEqual([{ op: 'update', path: 'adminMessages/d7', data: { status: 'scheduled' } }]));
  });

  it('只有 compose／delete 子碼、沒有入口碼：進不了頁（照 A 入口）', async () => {
    state.viewer = makeViewer('admin', ['admin.messages.compose', 'admin.messages.delete']);
    render(<AdminMessagesPage />);
    expect(screen.getByText('權限不足')).toBeTruthy();
  });

  it('查看：詳情彈窗', async () => {
    const { container } = await renderPage();
    fireEvent.click(within(card(container, 'd2')).getByRole('button', { name: '查看' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('對象：阿明（U9）');
    expect(dialog.textContent).toContain('狀態：已發送');
  });
});

describe('改狀態：不重讀清單、0 讀 1 寫', () => {
  it('回收：確認框不宣稱移除收件人副本；寫 recalled、計數就地更新、不讀不刪信箱', async () => {
    const { container } = await renderPage();
    await waitFor(() => expect(document.getElementById('msg-sent-count')?.textContent).toContain('已發送 5 封'));
    const before = adminReads();
    fireEvent.click(within(card(container, 'd1')).getByRole('button', { name: '回收' }));
    await waitFor(() => expect(container.querySelector('[data-msg-id="d1"]')).toBeNull());
    const message = vi.mocked(appConfirm).mock.calls[0]?.[0] ?? '';
    expect(message).toBe('確定要回收此信件？收件人信箱中的信件不會移除。');
    expect(message).not.toContain('將被移除');
    expect(fakeState.writes[0]).toEqual({ op: 'update', path: 'adminMessages/d1', data: { status: 'recalled' } });
    expect(adminReads()).toBe(before);
    // 測試同步更新：回收不再查／刪自己信箱副本（伺服器寫進信箱的文件不含 adminMsgId，正式環境永遠是空操作）。
    expect(fakeState.reads.some((r) => r.path.startsWith('users/'))).toBe(false);
    expect(fakeState.writes).toHaveLength(1);
    expect(document.getElementById('msg-sent-count')?.textContent).toBe('已發送 4 封 ・ 排程 2 封 ・ 已回收 2 封 ・ 已刪除 0 封');
    expect(toast.show).toHaveBeenCalledWith({ message: '已回收信件', tone: 'success' });
  });

  it('取消回收確認：不寫', async () => {
    vi.mocked(appConfirm).mockResolvedValue(false);
    const { container } = await renderPage();
    fireEvent.click(within(card(container, 'd1')).getByRole('button', { name: '回收' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fakeState.writes).toEqual([]);
  });

  it('刪除、取消排程、恢復排程（恢復不需確認，照 A）', async () => {
    const { container } = await renderPage();
    fireEvent.click(within(card(container, 'd1')).getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(fakeState.writes).toHaveLength(1));
    expect(fakeState.writes[0]?.data).toEqual({ status: 'deleted' });

    fireEvent.click(screen.getByRole('tab', { name: '已排程' }));
    fireEvent.click(within(card(container, 'd3')).getByRole('button', { name: '取消排程' }));
    await waitFor(() => expect(fakeState.writes).toHaveLength(2));
    expect(fakeState.writes[1]?.data).toEqual({ status: 'cancelled' });

    const confirms = vi.mocked(appConfirm).mock.calls.length;
    fireEvent.click(within(card(container, 'd4')).getByRole('button', { name: '恢復排程' }));
    await waitFor(() => expect(fakeState.writes).toHaveLength(3));
    expect(fakeState.writes[2]?.data).toEqual({ status: 'scheduled' });
    expect(vi.mocked(appConfirm).mock.calls.length).toBe(confirms);
    expect(adminReads()).toBe(1);
  });

  it('寫入失敗：提示、畫面不變', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fakeSdk.updateDoc.mockRejectedValueOnce(new Error('permission-denied'));
    const { container } = await renderPage();
    fireEvent.click(within(card(container, 'd1')).getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message: '操作失敗，請稍後再試', tone: 'error' }));
    expect(container.querySelector('[data-msg-id="d1"]')).not.toBeNull();
  });
});

describe('撰寫與發送（Callable 用 mock，不送真推播）', () => {
  it('全體用戶立即發送：寫紀錄 → deliverToInbox；不推 LINE、不讀 users', async () => {
    const { container } = await renderPage();
    fireEvent.click(screen.getByRole('button', { name: '＋ 發送' }));
    await screen.findByRole('dialog');
    await typeInto('msg-title', '場地公告');
    await typeInto('msg-body', '本週六場地維護');
    fireEvent.click(screen.getByRole('button', { name: '發送' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const set = fakeState.writes.find((w) => w.op === 'set');
    expect(set?.path).toMatch(/^adminMessages\/mg_/);
    expect(set?.data).toMatchObject({ title: '場地公告', body: '本週六場地維護', target: '全體用戶', targetType: 'all', status: 'sent', senderName: '站長' });
    const names = state.callFn.mock.calls.map((c) => c[0]);
    expect(names).toEqual(['deliverToInbox']);
    const req = state.callFn.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(req['targetType']).toBe('all');
    expect((req['message'] as Record<string, unknown>)['adminMsgId']).toMatch(/^mg_/);
    expect(fakeState.reads.some((r) => r.path === 'users')).toBe(false);
    expect(toast.show).toHaveBeenCalledWith({ message: '信件已發送', tone: 'success' });
    const docId = String(set?.path).split('/')[1];
    expect(container.querySelector(`[data-msg-id="${docId}"]`)).not.toBeNull();
  });

  it('指定用戶：搜尋選取 → 送出前再驗證 → 推 LINE 給該 UID（0 讀）', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: '＋ 發送' }));
    await screen.findByRole('dialog');
    const target = document.getElementById('msg-target') as HTMLSelectElement;
    await act(async () => {
      target.value = 'individual';
      target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await typeInto('msg-individual-target', '阿');
    const item = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('#msg-user-dropdown .ce-delegate-item');
      if (!el) throw new Error('no item');
      return el;
    });
    fireEvent.mouseDown(item);
    await waitFor(() => expect(document.getElementById('msg-target-result')?.textContent).toContain('已選取：阿明（U9）'));
    await typeInto('msg-title', '個人通知');
    await typeInto('msg-body', '您的報名資料已更新');
    fireEvent.click(screen.getByRole('button', { name: '發送' }));
    await waitFor(() => expect(state.callFn.mock.calls.some((c) => c[0] === 'enqueuePrivilegedLineNotification')).toBe(true));
    const line = state.callFn.mock.calls.find((c) => c[0] === 'enqueuePrivilegedLineNotification')?.[1];
    expect(line).toEqual({ uid: 'U9', category: 'system', title: '個人通知', body: '您的報名資料已更新', source: 'target:individual' });
    const inbox = state.callFn.mock.calls.find((c) => c[0] === 'deliverToInbox')?.[1] as Record<string, unknown>;
    expect(inbox['targetUid']).toBe('U9');
    expect(fakeState.reads.some((r) => r.path === 'users')).toBe(false);
  });

  it('排程：只寫紀錄（scheduled），不投遞，切到已排程頁籤', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: '＋ 發送' }));
    await screen.findByRole('dialog');
    await typeInto('msg-title', '排程信');
    await typeInto('msg-body', '下週集訓');
    await typeInto('msg-schedule', '2026-11-08T09:00');
    fireEvent.click(screen.getByRole('button', { name: '發送' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fakeState.writes.find((w) => w.op === 'set')?.data).toMatchObject({ status: 'scheduled', scheduledAt: '2026-11-08T09:00' });
    expect(state.callFn).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: '已排程' }).getAttribute('aria-selected')).toBe('true');
    expect(toast.show).toHaveBeenCalledWith({ message: '信件已排程', tone: 'success' });
  });

  it('沒填標題：提示且不寫', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: '＋ 發送' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '發送' }));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message: '請輸入信件標題', tone: 'error' }));
    expect(fakeState.writes).toEqual([]);
  });

  it('投遞失敗：只提示錯誤、留在彈窗；不推 LINE、不當成功（紀錄已寫，照 A 先寫紀錄）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.callFn.mockImplementation(async (name: string) => {
      if (name === 'deliverToInbox') throw new Error('internal');
      return { queued: true };
    });
    const { container } = await renderPage();
    fireEvent.click(screen.getByRole('button', { name: '＋ 發送' }));
    await screen.findByRole('dialog');
    const target = document.getElementById('msg-target') as HTMLSelectElement;
    await act(async () => {
      target.value = 'individual';
      target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await typeInto('msg-individual-target', '阿');
    const item = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('#msg-user-dropdown .ce-delegate-item');
      if (!el) throw new Error('no item');
      return el;
    });
    fireEvent.mouseDown(item);
    await waitFor(() => expect(document.getElementById('msg-target-result')?.textContent).toContain('已選取'));
    await typeInto('msg-title', '公告');
    await typeInto('msg-body', '內容');
    fireEvent.click(screen.getByRole('button', { name: '發送' }));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message: '站內信投遞失敗，請稍後再試', tone: 'error' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fakeState.writes.some((w) => w.op === 'set')).toBe(true);
    expect(state.callFn.mock.calls.some((c) => c[0] === 'enqueuePrivilegedLineNotification')).toBe(false);
    expect(vi.mocked(toast.show).mock.calls.some((c) => typeof c[0] !== 'string' && c[0].tone === 'success')).toBe(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: '發送' }).hasAttribute('disabled')).toBe(false);
    expect(container.querySelectorAll('[data-msg-id]').length).toBe(2);
  });

  it('非 admin 角色（有 admin.messages.entry）：對象只有俱樂部與指定用戶；不顯示原始 UID', async () => {
    await renderPage(ADMIN, 'coach');
    fireEvent.click(screen.getByRole('button', { name: '＋ 發送' }));
    await screen.findByRole('dialog');
    const target = document.getElementById('msg-target') as HTMLSelectElement;
    expect(Array.from(target.options).map((o) => o.value)).toEqual(['team', 'individual']);
    expect(target.value).toBe('team');
    await act(async () => {
      target.value = 'individual';
      target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await typeInto('msg-individual-target', '阿');
    const item = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('#msg-user-dropdown .ce-delegate-item');
      if (!el) throw new Error('no item');
      return el;
    });
    expect(item.textContent).not.toContain('U9');
    fireEvent.mouseDown(item);
    await waitFor(() => expect(document.getElementById('msg-target-result')?.textContent).toContain('已選取：阿明'));
    expect(document.getElementById('msg-target-result')?.textContent).not.toContain('U9');
  });

  it('admin：下拉與結果顯示原始 UID（canViewRawUid）', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: '＋ 發送' }));
    await screen.findByRole('dialog');
    const target = document.getElementById('msg-target') as HTMLSelectElement;
    expect(target.options).toHaveLength(8);
    await act(async () => {
      target.value = 'individual';
      target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await typeInto('msg-individual-target', '阿');
    const item = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('#msg-user-dropdown .ce-delegate-item');
      if (!el) throw new Error('no item');
      return el;
    });
    expect(item.textContent).toContain('U9');
  });

  it('指定用戶：名單載入與選取驗證拒絕時不留未處理拒絕，選取改顯示驗證失敗（L-07）', async () => {
    const { loadUserDirectory, verifyUserDirectorySelection } = await import('@/features/events/data/user-directory');
    vi.mocked(loadUserDirectory).mockRejectedValueOnce(new Error('firebase init failed'));
    vi.mocked(verifyUserDirectorySelection).mockRejectedValueOnce(new Error('firebase init failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reasons: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { reasons.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      await renderPage();
      fireEvent.click(screen.getByRole('button', { name: '＋ 發送' }));
      await screen.findByRole('dialog');
      const target = document.getElementById('msg-target') as HTMLSelectElement;
      await act(async () => {
        target.value = 'individual';
        target.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await typeInto('msg-individual-target', '阿');
      const item = await waitFor(() => {
        const el = document.querySelector<HTMLElement>('#msg-user-dropdown .ce-delegate-item');
        if (!el) throw new Error('no item');
        return el;
      });
      fireEvent.mouseDown(item);
      await waitFor(() => expect(vi.mocked(toast.show)).toHaveBeenCalledWith({ message: '用戶驗證失敗，請檢查網路後再試', tone: 'error' }));
      await new Promise((resolvePromise) => { setTimeout(resolvePromise, 0); });
      expect(reasons).toEqual([]);
      expect(warn.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining([
        '[MessageAdmin] user directory load failed:',
        '[MessageAdmin] user select verify failed:',
      ]));
      expect(document.getElementById('msg-target-result')?.textContent).toBe('');
    } finally {
      process.off('unhandledRejection', onUnhandled);
      warn.mockRestore();
    }
  });

  it('俱樂部搜尋：連續打字只載入一次俱樂部清單', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: '＋ 發送' }));
    await screen.findByRole('dialog');
    const target = document.getElementById('msg-target') as HTMLSelectElement;
    await act(async () => {
      target.value = 'team';
      target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await typeInto('msg-team-target', 'A');
    await typeInto('msg-team-target', 'A隊');
    await waitFor(() => expect(document.querySelector('#msg-team-dropdown .ce-delegate-item')).not.toBeNull());
    expect(vi.mocked(loadTeams)).toHaveBeenCalledTimes(1);
  });
});
