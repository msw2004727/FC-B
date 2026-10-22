import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventCommentsSection, { resizeEventCommentInput } from './EventCommentsSection';
import { mapComment, type CommentItem } from '../../data/event-comments';

const mock = vi.hoisted(() => ({
  load: vi.fn(),
  submit: vi.fn(),
  reply: vi.fn(),
  like: vi.fn(),
  lock: vi.fn(),
  remove: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  route: vi.fn(),
}));

vi.mock('preact-iso', () => ({ useLocation: () => ({ route: mock.route }) }));
vi.mock('@/ui/Toast', () => ({ toast: { show: mock.toast } }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: mock.confirm }));
vi.mock('../../data/event-comments', async (original) => ({
  ...(await original<typeof import('../../data/event-comments')>()),
  loadEventComments: mock.load,
  submitEventComment: mock.submit,
  submitEventCommentReply: mock.reply,
  writeEventCommentLike: mock.like,
  setEventCommentReplyLocked: mock.lock,
  deleteEventComment: mock.remove,
}));

const props = {
  event: { id: 'public-event', creatorUid: 'host', date: '2099/01/01 10:00~11:00' },
  eventDocId: 'document-event',
  viewer: { uid: 'member', displayName: '小明', roleLevel: 0 },
  canLoad: true,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.load.mockResolvedValue([]);
  mock.submit.mockResolvedValue(undefined);
  mock.reply.mockResolvedValue(undefined);
  mock.like.mockResolvedValue(undefined);
  mock.lock.mockResolvedValue(undefined);
  mock.remove.mockResolvedValue(undefined);
  mock.confirm.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('M-093 留言區', () => {
  it('ready 才查詢，未登入顯示 A 提示', async () => {
    const view = render(<EventCommentsSection {...props} canLoad={false} />);
    expect(screen.getByText('留言將在報名名單完成後載入...')).toBeTruthy();
    expect(mock.load).not.toHaveBeenCalled();
    view.rerender(<EventCommentsSection {...props} />);
    await screen.findByText('尚無留言');
    expect(mock.load).toHaveBeenCalledTimes(1);
    view.rerender(<EventCommentsSection {...props} viewer={{ uid: null, roleLevel: 0 }} />);
    expect(screen.getByText('登入後可查看與留言')).toBeTruthy();
    expect(screen.queryByPlaceholderText('輸入留言，最多 300 字')).toBeNull();
  });

  it('公開／私密送出、防連點、送出後強制重讀', async () => {
    const pending = deferred<void>();
    mock.submit.mockReturnValueOnce(pending.promise);
    render(<EventCommentsSection {...props} />);
    const input = await screen.findByPlaceholderText('輸入留言，最多 300 字');
    fireEvent.input(input, { target: { value: '留言' } });
    const checkbox = screen.getByRole('checkbox');
    act(() => {
      (checkbox as HTMLInputElement).checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const form = input.closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mock.submit).toHaveBeenCalledTimes(1);
    expect(mock.submit).toHaveBeenCalledWith(expect.objectContaining({
      eventDocId: 'document-event',
      event: expect.objectContaining({ id: 'public-event' }),
    }), '留言', true);
    expect(screen.getByText('送出中')).toBeTruthy();
    await act(async () => { pending.resolve(); await pending.promise; });
    await waitFor(() => expect(mock.load).toHaveBeenCalledTimes(2));
    expect(mock.toast).toHaveBeenCalledWith({ message: '留言已送出' });
  });

  it('官方身份不顯示主姓名／頭像，冠冕與標章存在，主身份用 UID 開個人頁', async () => {
    mock.load.mockResolvedValue([
      mapComment('official', {
        authorUid: 'secret-uid',
        authorName: '真名',
        authorPhoto: 'secret-photo',
        identitySnapshot: { identityId: 'secondary', displayName: '官方', avatarUrl: '' },
        body: '官方留言',
      }, 'member'),
      mapComment('main', { authorUid: 'person-uid', authorName: '作者', body: '一般留言' }, 'member'),
    ]);
    const view = render(<EventCommentsSection {...props} />);
    await screen.findByText('官方留言');
    expect(screen.queryByText('真名')).toBeNull();
    expect(view.container.querySelector('img[src="secret-photo"]')).toBeNull();
    expect(view.container.querySelector('.identity-crown')).toBeTruthy();
    expect(screen.getByText('ToosterX官方認證')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '作者' }));
    expect(mock.route).toHaveBeenCalledWith('/profile/person-uid');
    expect(screen.queryByRole('button', { name: '官方' })).toBeNull();
  });

  it('回覆展開及送出；鎖定與已刪除留言不顯示回覆入口', async () => {
    mock.load.mockResolvedValue([
      mapComment('open', { body: '可回覆' }, ''),
      mapComment('locked', { replyLocked: true, body: '鎖定' }, ''),
      mapComment('deleted', { deleted: true }, ''),
    ]);
    render(<EventCommentsSection {...props} />);
    await screen.findByText('可回覆');
    expect(screen.getAllByRole('button', { name: '回覆', exact: true })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '回覆', exact: true }));
    const input = screen.getByPlaceholderText('回覆留言，最多 100 字');
    expect(input.closest('form')?.hidden).toBe(false);
    fireEvent.input(input, { target: { value: '回覆內容' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(mock.reply).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ id: 'open' }), '回覆內容',
    ));
  });

  it('按讚失敗還原，連點只寫一次', async () => {
    const pending = deferred<void>();
    mock.like.mockReturnValue(pending.promise);
    mock.load.mockResolvedValue([mapComment('c', { body: '留言', likeCount: 2 }, '')]);
    render(<EventCommentsSection {...props} />);
    const button = await screen.findByRole('button', { name: '+2' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mock.like).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      pending.reject(new Error('offline'));
      await pending.promise.catch(() => {});
    });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: '+2' })).toBeTruthy();
  });

  it('主辦顯示管理操作；確認期間權限撤銷不刪除', async () => {
    mock.load.mockResolvedValue([mapComment('c', { body: '留言' }, '')]);
    const confirm = deferred<boolean>();
    mock.confirm.mockReturnValue(confirm.promise);
    const view = render(<EventCommentsSection {...props} viewer={{ uid: 'host', roleLevel: 0 }} />);
    fireEvent.click(await screen.findByRole('button', { name: '刪除', exact: true }));
    view.rerender(<EventCommentsSection {...props} viewer={{ uid: 'member', roleLevel: 0 }} />);
    await act(async () => { confirm.resolve(true); await confirm.promise; });
    expect(mock.remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '鎖回覆' })).toBeNull();
  });

  it('活動取消關閉新增輸入', async () => {
    render(<EventCommentsSection {...props} event={{ ...props.event, status: 'cancelled' }} />);
    await screen.findByText('活動已結束，留言輸入已關閉');
    expect(screen.queryByPlaceholderText('輸入留言，最多 300 字')).toBeNull();
  });

  it('失敗後手動重試真的再次呼叫 loader', async () => {
    mock.load.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    render(<EventCommentsSection {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '重新載入留言' }));
    await screen.findByText('尚無留言');
    expect(mock.load).toHaveBeenCalledTimes(2);
  });

  it('9 秒 timeout、3／15 秒重試；過期成功不覆蓋新結果；卸載清計時器', async () => {
    vi.useFakeTimers();
    const old = deferred<CommentItem[]>();
    const second = deferred<CommentItem[]>();
    const third = deferred<CommentItem[]>();
    mock.load.mockReturnValueOnce(old.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const view = render(<EventCommentsSection {...props} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(screen.getByText('留言載入較久')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(mock.load).toHaveBeenCalledTimes(2);
    await act(async () => { old.resolve([mapComment('old', { body: '舊資料' }, '')]); });
    expect(screen.queryByText('舊資料')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(24000); });
    expect(mock.load).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(screen.getByText('留言暫時無法載入')).toBeTruthy();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { third.resolve([]); second.resolve([]); });
    expect(mock.toast).not.toHaveBeenCalled();
  });

  it('timeout 後晚到成功取消背景重試', async () => {
    vi.useFakeTimers();
    const pending = deferred<CommentItem[]>();
    mock.load.mockReturnValueOnce(pending.promise);
    render(<EventCommentsSection {...props} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    await act(async () => { pending.resolve([]); });
    expect(screen.getByText('尚無留言')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(mock.load).toHaveBeenCalledTimes(1);
  });

  it('活動／UID 切換隔離尚未完成的私密載入', async () => {
    const old = deferred<CommentItem[]>();
    mock.load.mockReturnValueOnce(old.promise).mockResolvedValueOnce([]);
    const view = render(<EventCommentsSection {...props} />);
    view.rerender(<EventCommentsSection {...props} viewer={{ uid: 'other', roleLevel: 0 }} />);
    await screen.findByText('尚無留言');
    await act(async () => {
      old.resolve([mapComment('private', { body: '舊使用者私密內容', visibility: 'private' }, '')]);
    });
    expect(screen.queryByText('舊使用者私密內容')).toBeNull();
  });

  it('輸入自動長高受 max-height 限制', () => {
    const input = document.createElement('textarea');
    input.style.maxHeight = '160px';
    Object.defineProperty(input, 'scrollHeight', { value: 240, configurable: true });
    document.body.append(input);
    resizeEventCommentInput(input);
    expect(input.style.height).toBe('160px');
    expect(input.style.overflowY).toBe('auto');
    Object.defineProperty(input, 'scrollHeight', { value: 40 });
    resizeEventCommentInput(input);
    expect(input.style.height).toBe('40px');
    expect(input.style.overflowY).toBe('hidden');
    input.remove();
  });
});
