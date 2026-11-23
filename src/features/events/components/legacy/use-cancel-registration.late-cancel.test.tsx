import type { JSX } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import type { DetailEvent, DetailRegistration } from '../../data/detail-model';
import type { CancelOperationContext } from '../../data/signup';
import type { LateCancelUserInfo } from '../../data/late-cancel';
import type { UseCancelRegistrationOptions, UseCancelRegistrationResult } from './use-cancel-registration';

const { toastShow, appConfirmMock, cancelRegistrationMock } = vi.hoisted(() => ({
  toastShow: vi.fn<(args: { message: string }) => void>(),
  appConfirmMock: vi.fn<(message: string) => Promise<boolean>>(async () => true),
  cancelRegistrationMock: vi.fn<(args: unknown) => Promise<unknown>>(),
}));

vi.mock('@/ui/Toast', () => ({ toast: { show: (args: { message: string }) => toastShow(args) }, Toast: () => null }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: (message: string) => appConfirmMock(message) }));
vi.mock('../../data/signup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/signup')>()),
  cancelRegistration: (args: unknown) => cancelRegistrationMock(args),
}));
vi.mock('../../data/event-detail', () => ({ loadEventDetail: async () => null }));

import { useCancelRegistration } from './use-cancel-registration';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-12-01T19:00:00+08:00');
// 開始 20:00，距開始 1 小時（預設時限 2 小時內）。
const EVENT = { id: 'evt-1', title: '測試活動', status: 'open', date: '2026/12/01 20:00~22:00' } as DetailEvent;
const SELF = { id: 'r1', _docId: 'r1', userId: 'u1', status: 'confirmed' } as unknown as DetailRegistration;

const NONE: LateCancelUserInfo = { level: null, untilMs: null, releaseAt: 0, recentMs: [], total: 0 };

function setup(user: LateCancelUserInfo | undefined, withLate = true): () => UseCancelRegistrationResult {
  const options: UseCancelRegistrationOptions = {
    getViewerUid: () => 'u1',
    isAlive: () => true,
    canRun: () => true,
    login: vi.fn(async () => {}),
    cancelContext: { load: async () => ({ event: EVENT }) } as unknown as CancelOperationContext,
    onIntegrityError: vi.fn(),
    onSelfCancelled: vi.fn(async () => {}),
    onBatchCancelled: vi.fn(async () => {}),
    ...(withLate ? { getLateCancelUser: async () => user } : {}),
  };
  const ref: { current: UseCancelRegistrationResult | null } = { current: null };
  function Wrapper(): JSX.Element {
    ref.current = useCancelRegistration(options);
    return <div>{ref.current.renderModal({ busy: false, eventTitle: '測試活動', onConfirm: () => {} })}</div>;
  }
  render(<Wrapper />);
  return () => {
    if (!ref.current) throw new Error('hook 尚未初始化');
    return ref.current;
  };
}

describe('useCancelRegistration：臨時取消確認框（預覽 ②③④）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    cancelRegistrationMock.mockResolvedValue({ success: true, event: {}, lateCancelMarked: true });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('時限內：寫後果與候補資訊、按鈕「保留名額／仍要取消」；成功回 lateCancelMarked 時 toast 一次', async () => {
    const get = setup(NONE);
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = get().beginCancel({ event: EVENT, publicId: 'evt-1', owned: [SELF], waitlistCount: 2 }); });
    await waitFor(() => expect(document.getElementById('late-cancel-confirm')).not.toBeNull());
    const box = document.getElementById('late-cancel-confirm') as HTMLElement;
    expect(box.querySelector('.app-confirm-warning')?.textContent).toBe('距開始不到 2 小時');
    expect(box.querySelector('.app-confirm-msg')?.textContent)
      .toBe('現在取消會記一次臨時取消名字標籤 7 天或出席 3 場後恢復\n同一場只記一次\n名額會讓給候補第 1 位');
    // 站長 11-23：天數／場數用特殊色（.lc-unit），數字與單位在同一個標記裡。
    expect([...box.querySelectorAll('.lc-unit')].map(el => el.textContent)).toEqual(['7 天', '3 場']);
    expect([...box.querySelectorAll('button')].map(b => b.textContent)).toEqual(['保留名額', '仍要取消']);
    expect(appConfirmMock).not.toHaveBeenCalled();
    fireEvent.click(box.querySelectorAll('button')[1] as HTMLButtonElement);
    await act(async () => { await pending; });
    expect(cancelRegistrationMock).toHaveBeenCalledTimes(1);
    expect(toastShow).toHaveBeenCalledWith({ message: '已取消報名，已記一次臨時取消' });
    expect(document.getElementById('late-cancel-confirm')).toBeNull();
  });

  it('90 天內第 3 次：寫會變紅標；按「保留名額」不送出', async () => {
    const get = setup({ level: 'black', untilMs: NOW + 24 * HOUR, releaseAt: 3, recentMs: [NOW - HOUR, NOW - 2 * HOUR], total: 2 });
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = get().beginCancel({ event: EVENT, publicId: 'evt-1', owned: [SELF] }); });
    await waitFor(() => expect(document.getElementById('late-cancel-confirm')).not.toBeNull());
    const box = document.getElementById('late-cancel-confirm') as HTMLElement;
    expect(box.querySelector('.app-confirm-warning')?.textContent).toBe('這是你 90 天內第 3 次臨時取消');
    expect(box.querySelector('.app-confirm-msg')?.textContent).toBe('取消後標籤會變紅紅標要管理員解除');
    fireEvent.click(box.querySelectorAll('button')[0] as HTMLButtonElement);
    await act(async () => { await pending; });
    expect(cancelRegistrationMock).not.toHaveBeenCalled();
  });

  it('時限外：只多候補資訊（返回／確定取消）', async () => {
    vi.setSystemTime(NOW - 24 * HOUR);
    const get = setup(NONE);
    act(() => { void get().beginCancel({ event: EVENT, publicId: 'evt-1', owned: [SELF], waitlistCount: 0 }); });
    await waitFor(() => expect(document.getElementById('late-cancel-confirm')).not.toBeNull());
    const box = document.getElementById('late-cancel-confirm') as HTMLElement;
    expect(box.querySelector('.app-confirm-warning')).toBeNull();
    expect(box.querySelector('.app-confirm-msg')?.textContent).toBe('確定要取消報名？目前無人候補，名額將空出');
    expect([...box.querySelectorAll('button')].map(b => b.textContent)).toEqual(['返回', '確定取消']);
  });

  // 審查 P1-2／P2-1：個人頁也傳 getLateCancelUser；讀不到操作者資料（undefined）時寫中性後果，不寫恢復條件。
  it('讀不到操作者臨取資料：仍出警告框，只寫「同一場只記一次」，不寫 7 天恢復', async () => {
    const get = setup(undefined);
    act(() => { void get().beginCancel({ event: EVENT, publicId: 'evt-1', owned: [SELF], waitlistCount: 0 }); });
    await waitFor(() => expect(document.getElementById('late-cancel-confirm')).not.toBeNull());
    const box = document.getElementById('late-cancel-confirm') as HTMLElement;
    expect(box.querySelector('.app-confirm-warning')?.textContent).toBe('距開始不到 2 小時');
    expect(box.querySelector('.app-confirm-msg')?.textContent)
      .toBe('現在取消會記一次臨時取消同一場只記一次\n目前無人候補，名額將空出');
    expect(box.textContent).not.toContain('7 天');
    expect(appConfirmMock).not.toHaveBeenCalled();
  });

  it('呼叫端不給 getLateCancelUser、或活動選「不設定」：沿用原本確認框', async () => {
    appConfirmMock.mockResolvedValue(false);
    let get = setup(NONE, false);
    await act(async () => { await get().beginCancel({ event: EVENT, publicId: 'evt-1', owned: [SELF] }); });
    expect(appConfirmMock).toHaveBeenCalledWith('確定要取消報名？');
    cleanup();
    get = setup(NONE);
    const off = { ...EVENT, lateCancelHours: 0 } as DetailEvent;
    await act(async () => { await get().beginCancel({ event: off, publicId: 'evt-1', owned: [SELF] }); });
    expect(appConfirmMock).toHaveBeenCalledTimes(2);
    expect(document.getElementById('late-cancel-confirm')).toBeNull();
  });

  it('課程報名（courseLinkState／coursePriority 等，照後端 isCourseLinkedRegistrationData）不寫後果', async () => {
    const get = setup(NONE);
    const course = { ...SELF, courseLinkState: 'priority_overlay' } as unknown as DetailRegistration;
    act(() => { void get().beginCancel({ event: EVENT, publicId: 'evt-1', owned: [course] }); });
    await waitFor(() => expect(document.getElementById('late-cancel-confirm')).not.toBeNull());
    expect(document.querySelector('#late-cancel-confirm .app-confirm-warning')).toBeNull();
  });

  it('同行者彈窗：只勾同行者也提示會記你一次', async () => {
    const mate = { id: 'r2', _docId: 'r2', userId: 'u1', companionId: 'c1', companionName: '小安', status: 'confirmed' } as unknown as DetailRegistration;
    const get = setup(NONE);
    await act(async () => { await get().beginCancel({ event: EVENT, publicId: 'evt-1', owned: [SELF, mate], waitlistCount: 3 }); });
    await waitFor(() => expect(document.getElementById('companion-cancel-overlay')).not.toBeNull());
    // 預設全選（本人＋同行者）→ 取消本人勾選，只剩同行者。
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[name="cc-reg"]')];
    fireEvent.click(boxes[0] as HTMLInputElement);
    expect(document.getElementById('companion-cancel-late-warn')?.textContent).toBe('距開始不到 2 小時');
    expect(document.getElementById('companion-cancel-late-msg')?.textContent)
      .toBe('同行者取消也會記你一次臨時取消同一場只記一次・名額讓給候補第 1 位');
    expect(document.querySelector('.modal-actions')?.textContent).toContain('保留名額');
    expect(document.querySelector('.modal-actions')?.textContent).toContain('仍要取消');
  });
});
