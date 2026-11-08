import { h } from 'preact';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxMessage } from '../data/inbox-repo';
import type { PmThread } from '../data/pm-repo';

// 測試同步更新：照 A（M-134 / M-136 / M-138 / U-043 / U-044 / U-045）
// i18n 以「A 中文原文為 key，查不到顯示原文」的行為比對 A；此處以簡化實作模擬。
vi.mock('@/i18n/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/i18n')>();
  return {
    ...actual,
    useLegacyT: () =>
      (key: string, _fallback: string, params?: Record<string, unknown>) => {
        if (!params) return key;
        return key.replace(/\{(\w+)\}/g, (_m, k: string) =>
          params[k] !== undefined ? String(params[k]) : `{${k}}`,
        );
      },
  };
});

const mockUseViewer = vi.fn();
vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: () => mockUseViewer(),
}));

vi.mock('preact-iso', () => ({
  useLocation: () => ({ path: '/inbox', route: vi.fn() }),
}));

const mockSubscribeInbox = vi.fn();
const mockMarkRead = vi.fn();
const mockMarkAllRead = vi.fn();
const mockDeleteMessage = vi.fn();
const mockClearAll = vi.fn();

vi.mock('../data/inbox-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/inbox-repo')>();
  return {
    ...actual,
    subscribeInbox: (...args: unknown[]) => mockSubscribeInbox(...args),
    markRead: (...args: unknown[]) => mockMarkRead(...args),
    markAllRead: (...args: unknown[]) => mockMarkAllRead(...args),
    deleteMessage: (...args: unknown[]) => mockDeleteMessage(...args),
    clearAll: (...args: unknown[]) => mockClearAll(...args),
  };
});

const mockSubscribeThreads = vi.fn();
vi.mock('../data/pm-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/pm-repo')>();
  return {
    ...actual,
    subscribeThreads: (...args: unknown[]) => mockSubscribeThreads(...args),
  };
});

const mockEnsureMessageAction = vi.fn();
vi.mock('@/core/action-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/action-registry')>();
  return {
    ...actual,
    ensureMessageAction: (...args: unknown[]) => mockEnsureMessageAction(...args),
  };
});

const mockOpenPmDialog = vi.fn();
vi.mock('../components/pm-dialog-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/pm-dialog-store')>();
  return {
    ...actual,
    openPmDialog: (...args: unknown[]) => mockOpenPmDialog(...args),
  };
});

const mockAppConfirm = vi.fn();
vi.mock('@/ui/AppConfirm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/AppConfirm')>();
  return {
    ...actual,
    appConfirm: (...args: unknown[]) => mockAppConfirm(...args),
  };
});

// 測試同步更新：照 A（項目 1）改用共用 @/ui/Toast，不再自建底部 banner。
const mockToastShow = vi.fn();
vi.mock('@/ui/Toast', () => ({
  toast: {
    show: (...args: unknown[]) => mockToastShow(...args),
    dismiss: vi.fn(),
    clear: vi.fn(),
  },
}));

const mockPushOverlay = vi.fn((_onBack: () => boolean) => () => undefined);
vi.mock('@/core/overlay-back', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/overlay-back')>();
  return {
    ...actual,
    pushOverlay: (onBack: () => boolean) => mockPushOverlay(onBack),
  };
});

import InboxPage from './InboxPage';
import { getInboxStoreState, startInboxStore, stopInboxStore } from '../data/inbox-store';

describe('InboxPage', () => {
  let inboxCallback: ((msgs: InboxMessage[]) => void) | null = null;
  let threadsCallback: ((threads: PmThread[]) => void) | null = null;
  let inboxUnsub: ReturnType<typeof vi.fn>;
  let threadsUnsub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    inboxCallback = null;
    threadsCallback = null;
    inboxUnsub = vi.fn();
    threadsUnsub = vi.fn();

    document.documentElement.lang = 'zh-TW';

    mockUseViewer.mockReturnValue({
      uid: 'u1',
      role: 'user',
      displayName: 'Alice',
      hasPermission: () => true,
      teamIds: new Set<string>(),
      roleLevel: 0,
      pictureUrl: null,
      capabilities: [],
    });

    mockSubscribeInbox.mockImplementation(
      (_uid: string, onChange: (msgs: InboxMessage[]) => void) => {
        inboxCallback = onChange;
        return inboxUnsub;
      },
    );
    mockSubscribeThreads.mockImplementation(
      (_uid: string, onChange: (threads: PmThread[]) => void) => {
        threadsCallback = onChange;
        return threadsUnsub;
      },
    );

    mockMarkRead.mockResolvedValue(undefined);
    mockMarkAllRead.mockResolvedValue(undefined);
    mockDeleteMessage.mockResolvedValue(undefined);
    mockClearAll.mockResolvedValue(0);
    mockEnsureMessageAction.mockResolvedValue(null);
    mockAppConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    // 共用訂閱是全站單例：每案結束退訂清空，避免下一案沿用。
    stopInboxStore();
    vi.useRealTimers();
  });

  function renderPage(options: {
    messages?: InboxMessage[];
    threads?: PmThread[];
  } = {}): void {
    render(<InboxPage />);
    if (inboxCallback) {
      act(() => {
        inboxCallback!(options.messages ?? []);
      });
    }
    if (threadsCallback) {
      act(() => {
        threadsCallback!(options.threads ?? []);
      });
    }
  }

  it('切到私訊頁籤時隱藏工具列與搜尋列（照 A M-134）', async () => {
    renderPage({ messages: [] });

    const toolbar = document.getElementById('msg-toolbar-row');
    const filterRow = document.getElementById('msg-filter-row');
    expect(toolbar?.style.display).toBe('flex');
    expect(filterRow?.style.display).toBe('flex');

    const pmTab = document.querySelector<HTMLElement>(
      '#msg-inbox-tabs .tab[data-msgtype="pm-conversation"]',
    );
    expect(pmTab).toBeTruthy();
    if (!pmTab) return;
    fireEvent.click(pmTab);

    await waitFor(() => {
      expect(toolbar?.style.display).toBe('none');
      expect(filterRow?.style.display).toBe('none');
    });
  });

  it('私訊對話卡整張點擊呼叫 openPmDialog（照 A M-136）', async () => {
    renderPage({
      messages: [],
      threads: [
        {
          id: 'c1',
          conversationId: 'c1',
          peerUid: 'peer1',
          peerName: 'Bob',
          peerAvatar: 'https://example.com/a.png',
          lastMessageBody: 'hi',
          unreadCount: 1,
        },
      ],
    });

    const pmTab = document.querySelector<HTMLElement>(
      '#msg-inbox-tabs .tab[data-msgtype="pm-conversation"]',
    );
    if (!pmTab) throw new Error('pm tab missing');
    fireEvent.click(pmTab);

    await waitFor(() => {
      expect(document.querySelector('.pm-thread-card')).toBeTruthy();
    });

    const card = document.querySelector<HTMLElement>('.pm-thread-card');
    if (!card) throw new Error('pm thread card missing');
    fireEvent.click(card);

    expect(mockOpenPmDialog).toHaveBeenCalledTimes(1);
    expect(mockOpenPmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'peer1', name: 'Bob' }),
    );
  });

  it('私訊最後一則撤回時預覽顯示「訊息已撤回」（照 A M-136）', async () => {
    renderPage({
      messages: [],
      threads: [
        {
          id: 'c1',
          conversationId: 'c1',
          peerUid: 'peer1',
          peerName: 'Bob',
          lastMessageBody: '原始內容',
          lastMessageStatus: 'recalled',
          unreadCount: 0,
        },
      ],
    });

    const pmTab = document.querySelector<HTMLElement>(
      '#msg-inbox-tabs .tab[data-msgtype="pm-conversation"]',
    );
    if (!pmTab) throw new Error('pm tab missing');
    fireEvent.click(pmTab);

    await waitFor(() => {
      const preview = document.querySelector('.pm-thread-preview');
      expect(preview?.textContent).toBe('訊息已撤回');
      expect(preview?.textContent).not.toContain('原始內容');
    });
  });

  it('無內文訊息點擊只 markRead、不開詳情彈窗（照 A M-136 message-render.js）', async () => {
    renderPage({
      messages: [
        {
          id: 'm1',
          _docId: 'm1',
          type: 'system',
          typeName: '系統',
          title: '通知標題',
          preview: '預覽',
          time: '2025/01/01 10:00',
          read: false,
        },
      ],
    });

    const card = document.querySelector<HTMLElement>('.msg-card');
    if (!card) throw new Error('msg card missing');
    fireEvent.click(card);

    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalled();
    });
    expect(document.getElementById('msg-inbox-detail-modal')).toBeNull();
  });

  it('清空訊息先 appConfirm 且文字含實際可清空數量（照 A M-138）', async () => {
    renderPage({
      messages: [
        {
          id: 'm1',
          _docId: 'm1',
          type: 'system',
          title: 'A',
          time: '2025/01/01 00:00',
          read: true,
        },
        {
          id: 'm2',
          _docId: 'm2',
          type: 'system',
          title: 'B',
          time: '2025/01/02 00:00',
          read: true,
          actionType: 'team_join_request',
          actionStatus: 'pending',
        },
        {
          id: 'm3',
          _docId: 'm3',
          type: 'system',
          title: 'C',
          time: '2025/01/03 00:00',
          read: true,
        },
      ],
    });

    const clearBtn = screen.getByText('清空訊息').closest('button');
    if (!clearBtn) throw new Error('clear button missing');
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    await waitFor(() => {
      expect(mockAppConfirm).toHaveBeenCalledTimes(1);
    });
    const firstArg = mockAppConfirm.mock.calls[0]?.[0] as string;
    expect(firstArg).toContain('確定要清空');
    expect(firstArg).toContain('2');
    expect(firstArg).toContain('此操作無法恢復');
    expect(mockClearAll).toHaveBeenCalledTimes(1);
    // 測試同步更新：照 A（項目 3）只刪 deletable，待審核訊息（m2）不被刪。
    const passedMsgs = mockClearAll.mock.calls[0]?.[1] as InboxMessage[];
    const passedIds = passedMsgs.map((m) => m.id).sort();
    expect(passedIds).toEqual(['m1', 'm3']);
  });

  it('一鍵全讀失敗時還原畫面並顯示失敗提示（照 A U-044）', async () => {
    mockMarkAllRead.mockRejectedValueOnce(new Error('boom'));
    renderPage({
      messages: [
        {
          id: 'm1',
          _docId: 'm1',
          type: 'system',
          typeName: '系統',
          title: 'A',
          time: '2025/01/01 00:00',
          read: false,
        },
        {
          id: 'm2',
          _docId: 'm2',
          type: 'system',
          typeName: '系統',
          title: 'B',
          time: '2025/01/02 00:00',
          read: false,
        },
      ],
    });

    const btn = screen.getByText('一鍵全讀').closest('button');
    if (!btn) throw new Error('mark all read button missing');
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
    });
    // 還原：兩張卡仍是 msg-unread
    const cards = document.querySelectorAll<HTMLElement>('.msg-card');
    expect(cards.length).toBe(2);
    cards.forEach((c) => {
      expect(c.classList.contains('msg-unread')).toBe(true);
    });
    // 測試同步更新：照 A（項目 1）改用共用 toast.show 斷言
    await waitFor(() => {
      expect(mockToastShow).toHaveBeenCalledWith({ message: '標記失敗，請重試' });
    });
  });

  it('審核同意成功後顯示 A 原文「已同意加入申請」（照 A 項目 2 message-actions-team.js）', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    mockEnsureMessageAction.mockResolvedValue({
      canAct: vi.fn().mockResolvedValue(true),
      actions: [{ key: 'approve', run }],
    });

    renderPage({
      messages: [
        {
          id: 'm1',
          _docId: 'm1',
          type: 'system',
          typeName: '系統',
          title: '俱樂部申請',
          body: '申請內容',
          time: '2025/01/01 10:00',
          read: true,
          actionType: 'team_join_request',
          actionStatus: 'pending',
        },
      ],
    });

    const card = document.querySelector<HTMLElement>('.msg-card');
    if (!card) throw new Error('msg card missing');
    fireEvent.click(card);

    await waitFor(() => {
      expect(document.getElementById('msg-inbox-detail-modal')).toBeTruthy();
    });

    const approveBtn = await screen.findByText('同意');
    await act(async () => {
      fireEvent.click(approveBtn);
    });

    await waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
      expect(mockToastShow).toHaveBeenCalledWith({ message: '已同意加入申請' });
    });
  });

  it('搜尋輸入 180ms 去抖後才篩選（照 A U-043）', async () => {
    renderPage({
      messages: [
        {
          id: 'm1',
          _docId: 'm1',
          type: 'system',
          title: 'Alpha',
          preview: 'aaa',
          time: '2025/01/01 00:00',
          read: true,
        },
        {
          id: 'm2',
          _docId: 'm2',
          type: 'system',
          title: 'Beta',
          preview: 'bbb',
          time: '2025/01/02 00:00',
          read: true,
        },
        {
          id: 'm3',
          _docId: 'm3',
          type: 'system',
          title: 'Gamma',
          preview: 'ccc',
          time: '2025/01/03 00:00',
          read: true,
        },
      ],
    });

    expect(document.querySelectorAll('.msg-card').length).toBe(3);

    vi.useFakeTimers();
    try {
      const searchInput = document.getElementById('msg-search-keyword') as HTMLInputElement | null;
      if (!searchInput) throw new Error('search input missing');

      fireEvent.input(searchInput, { target: { value: 'xyz' } });

      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      // 100ms 內尚未去抖 → 仍 3 張
      expect(document.querySelectorAll('.msg-card').length).toBe(3);

      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      // 累計 200ms ≥ 180ms → 篩選套用（無符合 → 0 張）
      expect(document.querySelectorAll('.msg-card').length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('詳情彈窗 Esc 關閉且焦點返回觸發的訊息卡（照 A U-045）', async () => {
    renderPage({
      messages: [
        {
          id: 'm1',
          _docId: 'm1',
          type: 'system',
          typeName: '系統',
          title: '有內文',
          body: '這是內文',
          time: '2025/01/01 10:00',
          read: true,
        },
      ],
    });

    const card = document.querySelector<HTMLElement>('.msg-card');
    if (!card) throw new Error('msg card missing');
    card.focus();
    expect(document.activeElement).toBe(card);

    fireEvent.click(card);

    await waitFor(() => {
      expect(document.getElementById('msg-inbox-detail-modal')).toBeTruthy();
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(document.getElementById('msg-inbox-detail-modal')).toBeNull();
    });
    expect(document.activeElement).toBe(card);
  });

  it('只有 createdAt 的系統通知排最前、顯示台北時間，日期篩選也保留它（伺服器 writeInboxNotification）', async () => {
    // 台北 2026/11/08 00:30（UTC 前一天 16:30），用來確認是台北日期不是 UTC 日期
    const createdMs = Date.UTC(2026, 10, 7, 16, 30);
    renderPage({
      messages: [
        {
          id: 'old',
          _docId: 'old',
          type: 'system',
          typeName: '系統',
          title: '舊訊息',
          time: '2026/11/07 20:00',
          read: true,
        },
        {
          id: 'sys',
          _docId: 'sys',
          type: 'activity',
          typeName: '活動',
          title: '系統通知',
          createdAt: { toMillis: () => createdMs },
          read: false,
        },
      ],
    });

    const titles = () =>
      Array.from(document.querySelectorAll<HTMLElement>('.msg-card .msg-title')).map((el) => el.textContent);
    expect(titles()).toEqual(['系統通知', '舊訊息']);
    const times = Array.from(document.querySelectorAll<HTMLElement>('.msg-card .msg-time')).map(
      (el) => el.textContent,
    );
    expect(times).toEqual(['2026/11/08 00:30', '2026/11/07 20:00']);

    const dateInput = document.getElementById('msg-filter-date') as HTMLInputElement | null;
    if (!dateInput) throw new Error('date input missing');
    await act(async () => {
      dateInput.value = '2026-11-08';
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => {
      expect(titles()).toEqual(['系統通知']);
    });
  });

  it('App 層已啟動共用訂閱時頁面不另訂閱；離開頁面不退訂', () => {
    startInboxStore('u1');
    expect(mockSubscribeInbox).toHaveBeenCalledTimes(1);
    expect(mockSubscribeThreads).toHaveBeenCalledTimes(1);

    const view = render(<InboxPage />);
    act(() => {
      inboxCallback!([
        { id: 'm1', _docId: 'm1', type: 'system', title: '共用資料', time: '2025/01/01 10:00', read: false },
      ]);
    });
    expect(document.querySelector('.msg-card .msg-title')?.textContent).toBe('共用資料');
    expect(mockSubscribeInbox).toHaveBeenCalledTimes(1);
    expect(mockSubscribeThreads).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(inboxUnsub).not.toHaveBeenCalled();
    expect(getInboxStoreState().uid).toBe('u1');
  });

  it('uid 延後出現才載入（L-43）；共用訂閱屬於其他 uid 時不顯示其資料', () => {
    mockUseViewer.mockReturnValue({
      uid: null,
      role: 'user',
      displayName: null,
      hasPermission: () => false,
      teamIds: new Set<string>(),
      roleLevel: 0,
      pictureUrl: null,
      capabilities: [],
    });
    const view = render(<InboxPage />);
    expect(mockSubscribeInbox).not.toHaveBeenCalled();

    // 共用訂閱目前是別的 uid（換帳號過渡期）：頁面不搶、不顯示別人的資料
    startInboxStore('other');
    act(() => {
      inboxCallback!([{ id: 'x', _docId: 'x', type: 'system', title: '別人的', time: '2025/01/01 10:00' }]);
    });

    mockUseViewer.mockReturnValue({
      uid: 'u1',
      role: 'user',
      displayName: 'Alice',
      hasPermission: () => true,
      teamIds: new Set<string>(),
      roleLevel: 0,
      pictureUrl: null,
      capabilities: [],
    });
    view.rerender(<InboxPage />);
    expect(getInboxStoreState().uid).toBe('other');
    expect(document.querySelector('.msg-card')).toBeNull();

    // App 層換成 u1 後顯示 u1 的資料
    act(() => {
      startInboxStore('u1');
    });
    act(() => {
      inboxCallback!([{ id: 'm1', _docId: 'm1', type: 'system', title: '我的', time: '2025/01/01 10:00' }]);
    });
    expect(document.querySelector('.msg-card .msg-title')?.textContent).toBe('我的');
  });

  it('共用訂閱停在錯誤時，進頁會自動重訂一次（收件匣與私訊各自）', () => {
    startInboxStore('u1');
    const firstInboxError = mockSubscribeInbox.mock.calls[0]?.[2] as (err: unknown) => void;
    const firstThreadsError = mockSubscribeThreads.mock.calls[0]?.[2] as (err: unknown) => void;
    act(() => {
      firstInboxError(new Error('token expired'));
      firstThreadsError(new Error('token expired'));
    });
    expect(getInboxStoreState().messagesStatus).toBe('error');

    render(<InboxPage />);
    expect(mockSubscribeInbox).toHaveBeenCalledTimes(2);
    expect(mockSubscribeThreads).toHaveBeenCalledTimes(2);
    expect(inboxUnsub).toHaveBeenCalled();
    act(() => {
      inboxCallback!([{ id: 'm1', _docId: 'm1', type: 'system', title: '恢復了', time: '2025/01/01 10:00' }]);
    });
    expect(document.querySelector('.msg-card .msg-title')?.textContent).toBe('恢復了');
  });

  it('樂觀已讀之後，只有私訊列表更新的快照不會讓訊息閃回未讀', async () => {
    renderPage({
      messages: [
        { id: 'm1', _docId: 'm1', type: 'system', typeName: '系統', title: '未讀', time: '2025/01/01 10:00', read: false },
      ],
    });
    const card = document.querySelector<HTMLElement>('.msg-card');
    if (!card) throw new Error('msg card missing');
    expect(card.classList.contains('msg-unread')).toBe(true);
    fireEvent.click(card);
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalled());
    expect(document.querySelector('.msg-card')?.classList.contains('msg-unread')).toBe(false);

    act(() => {
      threadsCallback!([{ id: 'c1', conversationId: 'c1', peerUid: 'p1', unreadCount: 1 }]);
    });
    expect(document.querySelector('.msg-card')?.classList.contains('msg-unread')).toBe(false);
  });
});
