import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/preact';

import type { PmMessage } from '../data/pm-repo';
import { closePmDialog, openPmDialog } from './pm-dialog-store';
import PmDialogOverlay from './PmDialogOverlay';

const MY_UID = `U${'b'.repeat(32)}`;
const PEER_UID = `U${'a'.repeat(32)}`;
const EXPECTED_CID = `pm_${PEER_UID}_${MY_UID}`;

const pmRepoMock = vi.hoisted(() => ({
  subscribeConversation: vi.fn(),
  markConversationRead: vi.fn(),
  sendPrivateMessage: vi.fn(),
  editPrivateMessage: vi.fn(),
  recallPrivateMessage: vi.fn(),
  PM_MAX_BODY_LENGTH: 300,
}));

vi.mock('../data/pm-repo', () => pmRepoMock);

const routeMock = vi.hoisted(() => vi.fn());
vi.mock('preact-iso', () => ({
  useLocation: () => ({ route: routeMock }),
}));

const viewerMock = vi.hoisted(() => ({ uid: `U${'b'.repeat(32)}` }));
vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: () => viewerMock,
}));

const releaseMock = vi.hoisted(() => vi.fn());
vi.mock('@/core/overlay-back', () => ({
  pushOverlay: vi.fn(() => releaseMock),
}));

let conversationOnChange: ((messages: PmMessage[]) => void) | null = null;
let unsubscribeMock: ReturnType<typeof vi.fn>;

function setConversation(messages: PmMessage[]): void {
  if (!conversationOnChange) throw new Error('conversation listener not ready');
  act(() => {
    conversationOnChange?.(messages);
  });
}

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  conversationOnChange = null;
  unsubscribeMock = vi.fn();
  pmRepoMock.subscribeConversation.mockReset();
  pmRepoMock.markConversationRead.mockReset();
  pmRepoMock.sendPrivateMessage.mockReset();
  pmRepoMock.editPrivateMessage.mockReset();
  pmRepoMock.recallPrivateMessage.mockReset();
  routeMock.mockReset();
  releaseMock.mockReset();

  pmRepoMock.subscribeConversation.mockImplementation(
    (_uid: string, _conversationId: string, onChange: (messages: PmMessage[]) => void) => {
      conversationOnChange = onChange;
      return unsubscribeMock;
    },
  );
  pmRepoMock.markConversationRead.mockResolvedValue({ readCount: 1, hasMore: false });
  pmRepoMock.sendPrivateMessage.mockResolvedValue({
    conversationId: EXPECTED_CID,
    messageId: 'server-message',
  });
  pmRepoMock.editPrivateMessage.mockResolvedValue(undefined);
  pmRepoMock.recallPrivateMessage.mockResolvedValue(undefined);

  openPmDialog({
    uid: PEER_UID,
    name: 'Peer',
    pictureUrl: 'https://example.com/avatar.png',
  });
});

afterEach(() => {
  cleanup();
  closePmDialog();
  vi.useRealTimers();
});

describe('PmDialogOverlay', () => {
  it('開啟時訂閱對話並在需要時標記已讀，關閉時退訂', async () => {
    vi.useFakeTimers();
    render(<PmDialogOverlay />);

    expect(pmRepoMock.subscribeConversation).toHaveBeenCalledWith(
      MY_UID,
      EXPECTED_CID,
      expect.any(Function),
      expect.any(Function),
    );

    setConversation([
      {
        id: 'm1',
        messageId: 'm1',
        fromUid: PEER_UID,
        direction: 'in',
        read: false,
        body: 'hello',
        createdAt: '2024-01-02T03:04:05Z',
      },
    ]);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(pmRepoMock.markConversationRead).toHaveBeenCalledWith(EXPECTED_CID);

    fireEvent.click(screen.getByLabelText('關閉'));
    expect(unsubscribeMock).toHaveBeenCalled();
  });

  it('撤回訊息顯示「訊息已撤回」', () => {
    render(<PmDialogOverlay />);
    setConversation([
      {
        id: 'r1',
        messageId: 'r1',
        fromUid: MY_UID,
        direction: 'out',
        status: 'recalled',
        body: '',
        createdAt: '2024-01-02T03:04:05Z',
      },
    ]);

    expect(screen.getByText('訊息已撤回')).toBeTruthy();
  });

  it('送出時呼叫 sendPrivateMessage 的參數', async () => {
    render(<PmDialogOverlay />);
    setConversation([]);

    const input = screen.getByPlaceholderText('輸入訊息，最多 300 字') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'hello' } });

    const form = screen.getByRole('button', { name: '送出' }).closest('form');
    if (!form) throw new Error('form not found');
    fireEvent.submit(form);

    await waitFor(() => {
      expect(pmRepoMock.sendPrivateMessage).toHaveBeenCalledWith(PEER_UID, 'hello');
    });
    expect(input.value).toBe('');
  });

  it('頭像 onError 退回名字首字', async () => {
    render(<PmDialogOverlay />);

    const avatarButton = screen.getByLabelText('Open user profile');
    const image = avatarButton.querySelector('img');
    if (!image) throw new Error('avatar image not found');

    fireEvent.error(image);

    await waitFor(() => {
      expect(avatarButton.textContent).toBe('P');
    });
  });

  it('Esc 關閉浮層', async () => {
    render(<PmDialogOverlay />);
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
