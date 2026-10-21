import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mocks, callFnMock } = vi.hoisted(() => {
  const mocks = {
    collection: vi.fn((_db: unknown, ...segments: string[]) => ({ _path: segments })),
    query: vi.fn((_col: unknown, ..._parts: unknown[]) => ({ _query: true })),
    orderBy: vi.fn((_field: string, _dir: string) => ({ _orderBy: true })),
    limit: vi.fn((_n: number) => ({ _limit: true })),
    onSnapshot: vi.fn(() => vi.fn()),
    doc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(),
    writeBatch: vi.fn(),
  };
  const callFnMock = vi.fn();
  return { mocks, callFnMock };
});

vi.mock('firebase/firestore', () => mocks);
vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(() => Promise.resolve({ db: { _mockDb: true } })),
}));
vi.mock('@/data/callables', () => ({
  callFn: callFnMock,
}));

import {
  PM_MAX_BODY_LENGTH,
  PM_MESSAGE_LIMIT,
  PM_THREAD_LIMIT,
  canSendPMTo,
  editPrivateMessage,
  markConversationRead,
  normalizePmRole,
  recallPrivateMessage,
  sendPrivateMessage,
  subscribeConversation,
  subscribeThreads,
} from './pm-repo';

describe('pm-repo 常數', () => {
  it('照 A pm-permission.js：最大字數 300、訊息與對話上限 50', () => {
    expect(PM_MAX_BODY_LENGTH).toBe(300);
    expect(PM_MESSAGE_LIMIT).toBe(50);
    expect(PM_THREAD_LIMIT).toBe(50);
  });
});

describe('canSendPMTo（照 A pmCanSendTo）', () => {
  it('admin 以上一律可', () => {
    expect(canSendPMTo('admin', 'user')).toBe(true);
    expect(canSendPMTo('super_admin', 'user')).toBe(true);
  });

  it('既有對話一律可', () => {
    expect(canSendPMTo('user', 'captain', true)).toBe(true);
    expect(canSendPMTo('coach', 'captain', true)).toBe(true);
  });

  it('站台設定 allowUserToUserPm=true 時可', () => {
    expect(canSendPMTo('user', 'captain', false, { allowUserToUserPm: true })).toBe(true);
  });

  it('role 層級：送訊者層級 < 收訊者層級 才可', () => {
    expect(canSendPMTo('user', 'coach')).toBe(true);
    expect(canSendPMTo('user', 'captain')).toBe(true);
    expect(canSendPMTo('coach', 'captain')).toBe(true);
    expect(canSendPMTo('captain', 'user')).toBe(false);
    expect(canSendPMTo('captain', 'coach')).toBe(false);
  });

  it('同層級不可（無既有對話、無 user-to-user、非 admin）', () => {
    expect(canSendPMTo('user', 'user')).toBe(false);
    expect(canSendPMTo('coach', 'coach')).toBe(false);
    expect(canSendPMTo('captain', 'captain')).toBe(false);
  });

  it('未定義角色一律正規化為 user', () => {
    expect(normalizePmRole('unknown')).toBe('user');
    expect(normalizePmRole('')).toBe('user');
    expect(normalizePmRole(null)).toBe('user');
  });
});

describe('pm-repo 訂閱', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onSnapshot.mockReturnValue(vi.fn());
  });

  it('subscribeThreads 建立 users/{uid}/pmThreads orderBy lastMessageAt desc limit 50', async () => {
    const cleanup = subscribeThreads('user1', vi.fn(), vi.fn());
    await vi.waitFor(() => expect(mocks.onSnapshot).toHaveBeenCalled());

    expect(mocks.collection).toHaveBeenCalledWith(expect.anything(), 'users/user1/pmThreads');
    expect(mocks.orderBy).toHaveBeenCalledWith('lastMessageAt', 'desc');
    expect(mocks.limit).toHaveBeenCalledWith(PM_THREAD_LIMIT);
    cleanup();
  });

  it('subscribeThreads 訂閱回傳的 unsubscribe 生效', async () => {
    const inner = vi.fn();
    mocks.onSnapshot.mockReturnValue(inner);
    const cleanup = subscribeThreads('user1', vi.fn(), vi.fn());
    await vi.waitFor(() => expect(mocks.onSnapshot).toHaveBeenCalled());
    cleanup();
    expect(inner).toHaveBeenCalled();
  });

  it('subscribeThreads uid 空時丟錯', () => {
    expect(() => subscribeThreads('', vi.fn(), vi.fn())).toThrow();
  });

  it('subscribeConversation 建立 messages 子集合並 reverse', async () => {
    const onChange = vi.fn();
    const cleanup = subscribeConversation('user1', 'pm_c1', onChange, vi.fn());
    await vi.waitFor(() => expect(mocks.onSnapshot).toHaveBeenCalled());

    expect(mocks.collection).toHaveBeenCalledWith(
      expect.anything(),
      'users/user1/pmThreads/pm_c1/messages',
    );
    expect(mocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mocks.limit).toHaveBeenCalledWith(PM_MESSAGE_LIMIT);

    // 觸發 snapshot callback 確認 reverse（後進來的 m2 較新）
    const cb = (mocks.onSnapshot.mock.calls[0] as unknown[])[1] as (snap: unknown) => void;
    cb({
      docs: [
        { id: 'm2', data: () => ({ body: 'b', createdAt: 'b' }) },
        { id: 'm1', data: () => ({ body: 'a', createdAt: 'a' }) },
      ],
    });
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as Array<{ id: string }>;
    expect(lastCall.map((m) => m.id)).toEqual(['m1', 'm2']);
    cleanup();
  });
});

describe('pm-repo 寫入（Callable）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callFnMock.mockReset();
  });

  it('sendPrivateMessage 呼叫 sendPrivateMessage 且 request 只含 toUid/body', async () => {
    callFnMock.mockResolvedValueOnce({ conversationId: 'pm_c1', messageId: 'msg1' });
    const res = await sendPrivateMessage('Upeer', 'hello');
    expect(callFnMock).toHaveBeenCalledWith('sendPrivateMessage', {
      toUid: 'Upeer',
      body: 'hello',
    });
    expect(res).toEqual({ conversationId: 'pm_c1', messageId: 'msg1' });
  });

  it('sendPrivateMessage 空格或空字串被拒絕', async () => {
    await expect(sendPrivateMessage('Upeer', '   ')).rejects.toThrow();
    expect(callFnMock).not.toHaveBeenCalled();
  });

  it('sendPrivateMessage 超過 PM_MAX_BODY_LENGTH 被拒絕', async () => {
    const tooLong = 'a'.repeat(PM_MAX_BODY_LENGTH + 1);
    await expect(sendPrivateMessage('Upeer', tooLong)).rejects.toThrow();
    expect(callFnMock).not.toHaveBeenCalled();
  });

  it('editPrivateMessage request 含 conversationId/messageId/body', async () => {
    callFnMock.mockResolvedValueOnce({});
    await editPrivateMessage('pm_c1', 'msg1', 'edited');
    expect(callFnMock).toHaveBeenCalledWith('editPrivateMessage', {
      conversationId: 'pm_c1',
      messageId: 'msg1',
      body: 'edited',
    });
  });

  it('editPrivateMessage 空字串或超長被拒絕', async () => {
    await expect(editPrivateMessage('pm_c1', 'msg1', '  ')).rejects.toThrow();
    await expect(
      editPrivateMessage('pm_c1', 'msg1', 'a'.repeat(PM_MAX_BODY_LENGTH + 1)),
    ).rejects.toThrow();
    expect(callFnMock).not.toHaveBeenCalled();
  });

  it('recallPrivateMessage request 只含 conversationId/messageId', async () => {
    callFnMock.mockResolvedValueOnce({});
    await recallPrivateMessage('pm_c1', 'msg1');
    expect(callFnMock).toHaveBeenCalledWith('recallPrivateMessage', {
      conversationId: 'pm_c1',
      messageId: 'msg1',
    });
  });

  it('markConversationRead request 只含 conversationId 並回傳 readCount/hasMore', async () => {
    callFnMock.mockResolvedValueOnce({ readCount: 3, hasMore: true });
    const res = await markConversationRead('pm_c1');
    expect(callFnMock).toHaveBeenCalledWith('markPrivateConversationRead', {
      conversationId: 'pm_c1',
    });
    expect(res).toEqual({ readCount: 3, hasMore: true });
  });

  it('markConversationRead 空字串 conversationId 時丟錯', async () => {
    await expect(markConversationRead('')).rejects.toThrow();
    expect(callFnMock).not.toHaveBeenCalled();
  });
});

