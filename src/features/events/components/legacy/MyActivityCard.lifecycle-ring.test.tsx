import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import type { OperateContext } from '../../data/operate-permissions';
import type { EventDoc } from '../../data/types';

// 11-12 站長回報：「我的活動」按取消後沒反應、過一陣子才刷新。
// 卡片的取消／重新開放按鈕接上共用進度環，這裡用真的 runEventLifecycleAction 串起來測。
const { appConfirmMock, cancelEventMock, toastShowMock } = vi.hoisted(() => ({
  appConfirmMock: vi.fn(),
  cancelEventMock: vi.fn(),
  toastShowMock: vi.fn(),
}));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: appConfirmMock }));
vi.mock('@/ui/Toast', () => ({ toast: { show: toastShowMock } }));
vi.mock('../../data/event-lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/event-lifecycle')>()),
  cancelEvent: cancelEventMock,
}));
vi.mock('@/data/user-roles', () => ({
  useUserRoles: () => ({}),
  getCachedUserLevel: () => 0,
}));

const { MyActivityCard } = await import('./MyActivityCard');
const { runEventLifecycleAction } = await import('./event-lifecycle-action');

const ctx: OperateContext = {
  uid: 'u-admin', role: 'super_admin', rolePermissions: [], userGrants: null, capabilities: [], customRoles: [],
};
const event = {
  id: 'ev1', _docId: 'ev1', title: '週末友誼賽', status: 'open', date: '2999/01/01 10:00~12:00', creatorUid: 'u-admin',
} as EventDoc;

function deferred(): { promise: Promise<void>; resolve(): void; reject(e: unknown): void } {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderCard(onDone: () => void) {
  const busy = new Set<string>();
  const view = render(
    <MyActivityCard
      event={event}
      nowMs={Date.now()}
      operateCtx={ctx}
      onEdit={() => {}}
      onLifecycle={(kind, ev, ring) => {
        void runEventLifecycleAction(kind, ev, {
          viewer: { uid: 'u-admin' } as never,
          operateCtx: ctx,
          busy,
          ring,
          onDone,
        });
      }}
      onDelete={() => {}}
      onPin={() => {}}
      onUnavailable={() => {}}
      onNavigate={() => {}}
    />,
  );
  const cancelButton = (): HTMLButtonElement =>
    [...view.container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.startsWith('取消'))!;
  return { ...view, cancelButton };
}

/** 讓確認框 Promise、寫入 Promise 的後續微任務跑完。 */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

describe('MyActivityCard 取消活動：按下確認後立即顯示進度環', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('寫入未完成前就縮成環且不可再按；完成後補滿 ✓ 停留，才重讀與提示', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const write = deferred();
    appConfirmMock.mockResolvedValue(true);
    cancelEventMock.mockReturnValueOnce(write.promise);
    const onDone = vi.fn();
    const { cancelButton, container } = renderCard(onDone);
    expect(cancelButton().textContent).toBe('取消');

    fireEvent.click(cancelButton());
    await settle();
    act(() => { vi.advanceTimersByTime(0); });

    // 寫入 Promise 尚未完成：已經是處理中狀態。
    const btn = cancelButton();
    expect(cancelEventMock).toHaveBeenCalledTimes(1);
    expect(btn.className).toContain('action-ring-btn');
    expect(btn.className).toContain('is-collapsed');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBe('取消中...');
    expect(container.querySelector('.signup-ring-svg')).not.toBeNull();

    // 處理中再按：不再跳確認框、不重送。
    fireEvent.click(btn);
    await settle();
    expect(appConfirmMock).toHaveBeenCalledTimes(1);
    expect(cancelEventMock).toHaveBeenCalledTimes(1);

    await act(async () => { write.resolve(); });
    await settle();
    await act(async () => { vi.advanceTimersByTime(180); });
    expect(container.querySelector('.signup-ring-check')).not.toBeNull();
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(300); });
    await settle();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toastShowMock).toHaveBeenCalledWith({ message: '活動已取消', tone: 'success' });

    act(() => { vi.advanceTimersByTime(260); });
    expect(cancelButton().className).not.toContain('action-ring-btn');
  });

  it('第一次失敗 → 展開回原按鈕、可再按並提示失敗；第二次重按成功', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    appConfirmMock.mockResolvedValue(true);
    const first = deferred();
    cancelEventMock.mockReturnValueOnce(first.promise);
    const onDone = vi.fn();
    const { cancelButton, container } = renderCard(onDone);

    fireEvent.click(cancelButton());
    await settle();
    act(() => { vi.advanceTimersByTime(0); });
    expect(cancelButton().className).toContain('is-collapsed');

    await act(async () => { first.reject(new Error('offline')); });
    await settle();
    expect(container.querySelector('.signup-ring-check')).toBeNull();
    expect(toastShowMock).toHaveBeenCalledWith({ message: '取消失敗，請重試', tone: 'error' });
    act(() => { vi.advanceTimersByTime(260); });
    expect(cancelButton().disabled).toBe(false);
    expect(cancelButton().className).not.toContain('action-ring-btn');
    expect(cancelButton().textContent).toBe('取消');
    expect(onDone).not.toHaveBeenCalled();

    cancelEventMock.mockResolvedValueOnce(undefined);
    fireEvent.click(cancelButton());
    await settle();
    act(() => { vi.advanceTimersByTime(0); });
    await settle();
    expect(cancelEventMock).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(480); });
    await settle();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('確認框按取消：按鈕不變形、不寫入', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    appConfirmMock.mockResolvedValue(false);
    const { cancelButton } = renderCard(vi.fn());
    fireEvent.click(cancelButton());
    await settle();
    act(() => { vi.advanceTimersByTime(0); });
    expect(cancelEventMock).not.toHaveBeenCalled();
    expect(cancelButton().className).not.toContain('action-ring-btn');
    expect(cancelButton().disabled).toBe(false);
  });
});
