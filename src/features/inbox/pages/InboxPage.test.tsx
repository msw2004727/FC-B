import { h } from 'preact';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import zhTW from '../locales/zh-TW.json';

function lookupKey(key: string, params?: Record<string, unknown>): string {
  const cleanKey = key.startsWith('inbox.') ? key.slice('inbox.'.length) : key;
  const parts = cleanKey.split('.');
  let current: unknown = zhTW;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  if (typeof current !== 'string') return key;
  if (!params) return current;
  return current.replace(/\{(\w+)\}/g, (_, k: string) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`,
  );
}

vi.mock('@/i18n/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/i18n')>();
  return {
    ...actual,
    useT: () => (key: string, params?: Record<string, unknown>) => lookupKey(key, params),
  };
});

const mockUseViewer = vi.fn();
vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: () => mockUseViewer(),
}));

const mockRoute = vi.fn();
vi.mock('preact-iso', () => ({
  useLocation: () => ({ path: '/inbox', route: mockRoute }),
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
const mockSubscribeConversation = vi.fn();
const mockSendPrivateMessage = vi.fn();
const mockEditPrivateMessage = vi.fn();
const mockRecallPrivateMessage = vi.fn();
const mockMarkConversationRead = vi.fn();

vi.mock('../data/pm-repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/pm-repo')>();
  return {
    ...actual,
    subscribeThreads: (...args: unknown[]) => mockSubscribeThreads(...args),
    subscribeConversation: (...args: unknown[]) => mockSubscribeConversation(...args),
    sendPrivateMessage: (...args: unknown[]) => mockSendPrivateMessage(...args),
    editPrivateMessage: (...args: unknown[]) => mockEditPrivateMessage(...args),
    recallPrivateMessage: (...args: unknown[]) => mockRecallPrivateMessage(...args),
    markConversationRead: (...args: unknown[]) => mockMarkConversationRead(...args),
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

import InboxPage from './InboxPage';
import type { InboxMessage } from '../data/inbox-repo';
import type { PmMessage, PmThread } from '../data/pm-repo';

describe('InboxPage', () => {
  let inboxCallback: ((msgs: InboxMessage[]) => void) | null = null;
  let inboxUnsub: ReturnType<typeof vi.fn>;
  let threadsCallback: ((threads: PmThread[]) => void) | null = null;
  let threadsUnsub: ReturnType<typeof vi.fn>;
  let convCallback: ((msgs: PmMessage[]) => void) | null = null;
  let convUnsub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    inboxCallback = null;
    threadsCallback = null;
    convCallback = null;
    inboxUnsub = vi.fn();
    threadsUnsub = vi.fn();
    convUnsub = vi.fn();

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

    mockSubscribeInbox.mockImplementation((_uid: string, onChange: (msgs: InboxMessage[]) => void) => {
      inboxCallback = onChange;
      return inboxUnsub;
    });

    mockSubscribeThreads.mockImplementation((_uid: string, onChange: (threads: PmThread[]) => void) => {
      threadsCallback = onChange;
      return threadsUnsub;
    });

    mockSubscribeConversation.mockImplementation(
      (_uid: string, _cid: string, onChange: (msgs: PmMessage[]) => void) => {
        convCallback = onChange;
        return convUnsub;
      },
    );

    mockMarkRead.mockResolvedValue(undefined);
    mockMarkAllRead.mockResolvedValue(undefined);
    mockDeleteMessage.mockResolvedValue(undefined);
    mockClearAll.mockResolvedValue(2);
    mockEnsureMessageAction.mockResolvedValue(null);
    mockMarkConversationRead.mockResolvedValue({ readCount: 1, hasMore: false });
    mockSendPrivateMessage.mockResolvedValue({ conversationId: 'c1', messageId: 'm1' });
    mockEditPrivateMessage.mockResolvedValue(undefined);
    mockRecallPrivateMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders login prompt when viewer is guest (not logged in)', () => {
    mockUseViewer.mockReturnValue({
      uid: null,
      role: 'guest',
      displayName: null,
      hasPermission: () => false,
      teamIds: new Set<string>(),
      roleLevel: -1,
      pictureUrl: null,
      capabilities: [],
    });

    render(h(InboxPage, {}));
    expect(screen.getByText('請先登入以查看訊息')).toBeTruthy();
    expect(mockSubscribeInbox).not.toHaveBeenCalled();
  });

  it('subscribes to inbox on mount, updates in real-time, and unsubscribes on unmount', async () => {
    const { unmount } = render(h(InboxPage, {}));
    expect(mockSubscribeInbox).toHaveBeenCalledWith(
      'u1',
      expect.any(Function),
      expect.any(Function),
    );

    act(() => {
      inboxCallback?.([
        {
          id: 'm1',
          _docId: 'm1',
          type: 'system',
          typeName: '系統',
          title: '歡迎加入',
          preview: '系統歡迎信預覽',
          body: '系統歡迎信完整內容',
          time: '2026/04/10 10:00',
          read: false,
        },
      ]);
    });

    expect(await screen.findByText('歡迎加入')).toBeTruthy();
    unmount();
    expect(inboxUnsub).toHaveBeenCalledTimes(1);
    expect(threadsUnsub).toHaveBeenCalledTimes(1);
  });

  it('supports markRead on click, markAllRead, single delete with confirmation, and clearAll keeping pending', async () => {
    render(h(InboxPage, {}));
    const sampleMessages: InboxMessage[] = [
      {
        id: 'm1',
        _docId: 'm1',
        type: 'system',
        typeName: '系統',
        title: '第一則未讀',
        preview: '預覽一',
        body: '內容一',
        time: '2026/04/10 12:00',
        read: false,
      },
      {
        id: 'm2',
        _docId: 'm2',
        type: 'activity',
        typeName: '活動',
        title: '待審核申請',
        preview: '預覽二',
        body: '內容二',
        time: '2026/04/10 11:00',
        read: true,
        actionType: 'team_join_request',
        actionStatus: 'pending',
      },
    ];

    act(() => {
      inboxCallback?.(sampleMessages);
    });

    // Click message -> opens detail and calls markRead
    fireEvent.click(await screen.findByText('第一則未讀'));
    expect(mockMarkRead).toHaveBeenCalledWith('u1', sampleMessages[0]);
    expect(await screen.findByText('內容一')).toBeTruthy();

    // Single delete via in-page confirmation modal
    fireEvent.click(screen.getByText('從我的收件匣移除'));
    expect(await screen.findByText('確定要從收件匣移除「第一則未讀」嗎？')).toBeTruthy();
    fireEvent.click(screen.getByText('確認'));
    await waitFor(() => {
      expect(mockDeleteMessage).toHaveBeenCalledWith('u1', sampleMessages[0]);
    });

    // Mark all read
    fireEvent.click(screen.getByText('一鍵全讀'));
    await waitFor(() => {
      expect(mockMarkAllRead).toHaveBeenCalledWith('u1', sampleMessages);
    });

    // Clear all -> opens confirmation modal -> calls clearAll and displays count
    fireEvent.click(screen.getByText('清空訊息'));
    expect(
      await screen.findByText('確定要清空收件匣嗎？待審核的訊息將會保留。'),
    ).toBeTruthy();
    fireEvent.click(screen.getByText('確認'));
    await waitFor(() => {
      expect(mockClearAll).toHaveBeenCalledWith('u1', sampleMessages);
    });
    expect(
      await screen.findByText('已清除 2 則訊息（待審核訊息已保留）'),
    ).toBeTruthy();
  });

  it('hides action buttons when canAct is false', async () => {
    mockEnsureMessageAction.mockResolvedValue({
      canAct: vi.fn().mockResolvedValue(false),
      actions: [
        { key: 'approve', labelKey: 'inbox.action.approve', run: vi.fn() },
      ],
    });

    render(h(InboxPage, {}));
    act(() => {
      inboxCallback?.([
        {
          id: 'req1',
          _docId: 'req1',
          type: 'system',
          title: '入隊申請',
          body: '王小明申請入隊',
          time: '2026/04/10 12:00',
          read: true,
          actionType: 'team_join_request',
          actionStatus: 'pending',
        },
      ]);
    });

    fireEvent.click(await screen.findByText('入隊申請'));
    await waitFor(() => {
      expect(mockEnsureMessageAction).toHaveBeenCalledWith('team_join_request');
    });
    expect(screen.queryByText('同意')).toBeNull();
  });

  it('shows action buttons when canAct is true, runs action, and supports retry on failure', async () => {
    const runApprove = vi
      .fn()
      .mockRejectedValueOnce(new Error('network fail'))
      .mockResolvedValueOnce(undefined);

    mockEnsureMessageAction.mockResolvedValue({
      canAct: vi.fn().mockResolvedValue(true),
      actions: [
        { key: 'approve', labelKey: 'inbox.action.approve', run: runApprove },
      ],
    });

    render(h(InboxPage, {}));
    const msg: InboxMessage = {
      id: 'req2',
      _docId: 'req2',
      type: 'system',
      title: '入隊申請二',
      body: '李小華申請入隊',
      time: '2026/04/10 12:00',
      read: true,
      actionType: 'team_join_request',
      actionStatus: 'pending',
    };

    act(() => {
      inboxCallback?.([msg]);
    });

    fireEvent.click(await screen.findByText('入隊申請二'));
    const approveBtn = await screen.findByText('同意');
    fireEvent.click(approveBtn);

    // First attempt fails -> shows error & retry button
    expect(await screen.findByText('重試操作')).toBeTruthy();
    expect(runApprove).toHaveBeenCalledTimes(1);

    // Retry succeeds
    fireEvent.click(screen.getByText('重試操作'));
    await waitFor(() => {
      expect(runApprove).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('操作已完成')).toBeTruthy();
  });

  it('displays processed status and reviewer name when actionStatus is not pending', async () => {
    render(h(InboxPage, {}));
    act(() => {
      inboxCallback?.([
        {
          id: 'req3',
          _docId: 'req3',
          type: 'system',
          title: '已審核申請',
          body: '陳大文申請入隊',
          time: '2026/04/10 12:00',
          read: true,
          actionType: 'team_join_request',
          actionStatus: 'approved',
          reviewerName: '張隊長',
        },
      ]);
    });

    fireEvent.click(await screen.findByText('已審核申請'));
    expect(await screen.findByText('已同意（張隊長）')).toBeTruthy();
    expect(screen.queryByText('同意')).toBeNull();
  });

  it('handles private messages: character limit, recall only for own messages, and markConversationRead loop', async () => {
    mockMarkConversationRead
      .mockResolvedValueOnce({ readCount: 10, hasMore: true })
      .mockResolvedValueOnce({ readCount: 5, hasMore: false });

    render(h(InboxPage, {}));
    act(() => {
      inboxCallback?.([]);
      threadsCallback?.([
        {
          id: 'conv_1',
          conversationId: 'conv_1',
          peerUid: 'u2',
          peerName: 'Bob',
          lastMessageBody: 'Hello!',
          unreadCount: 2,
        },
      ]);
    });

    // Switch to PM tab
    fireEvent.click(screen.getByRole('tab', { name: '私訊' }));
    expect(await screen.findByText('Hello!')).toBeTruthy();

    // Open thread
    fireEvent.click(screen.getByText('Hello!'));
    await waitFor(() => {
      expect(mockMarkConversationRead).toHaveBeenCalledTimes(2);
    });

    // Push messages: one from peer ('u2') and one from self ('u1')
    act(() => {
      convCallback?.([
        {
          id: 'pm_peer',
          messageId: 'pm_peer',
          fromUid: 'u2',
          toUid: 'u1',
          direction: 'in',
          body: 'Peer message',
          status: 'active',
          read: true,
        },
        {
          id: 'pm_own',
          messageId: 'pm_own',
          fromUid: 'u1',
          toUid: 'u2',
          direction: 'out',
          body: 'My own message',
          status: 'active',
          read: true,
          peerRead: false,
        },
      ]);
    });

    expect(await screen.findByText('Peer message')).toBeTruthy();
    expect(screen.getByText('My own message')).toBeTruthy();

    // Recall button only appears once (for own message, not peer message)
    const recallBtns = screen.getAllByText('撤回');
    expect(recallBtns).toHaveLength(1);
    fireEvent.click(recallBtns[0]!);
    await waitFor(() => {
      expect(mockRecallPrivateMessage).toHaveBeenCalledWith('conv_1', 'pm_own');
    });

    // Compose character limit check (max 300)
    const input = screen.getByLabelText('輸入私訊內容') as HTMLTextAreaElement;
    const sendBtn = screen.getByText('送出').closest('button') as HTMLButtonElement;

    const overText = 'a'.repeat(305);
    fireEvent.input(input, { target: { value: overText } });
    expect(await screen.findByText('已超過字數上限（-5 字）')).toBeTruthy();
    expect(sendBtn.disabled).toBe(true);

    const validText = 'Hello Bob!';
    fireEvent.input(input, { target: { value: validText } });
    expect(await screen.findByText('剩餘 290 字')).toBeTruthy();
    expect(sendBtn.disabled).toBe(false);

    fireEvent.submit(sendBtn.closest('form')!);
    await waitFor(() => {
      expect(mockSendPrivateMessage).toHaveBeenCalledWith('u2', 'Hello Bob!');
    });
  });
});
