import type { JSX } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import type { DetailEvent, DetailRegistration } from '../../data/detail-model';
import type { CancelOperationContext } from '../../data/signup';
import type {
  UseCancelRegistrationOptions,
  UseCancelRegistrationResult,
} from './use-cancel-registration';

const {
  toastShow,
  appConfirmMock,
  cancelRegistrationMock,
  loadEventDetailMock,
  isCompanionMock,
} = vi.hoisted(() => ({
  toastShow: vi.fn<(args: { message: string }) => void>(),
  appConfirmMock: vi.fn<(message: string) => Promise<boolean>>(async () => true),
  cancelRegistrationMock: vi.fn<(args: unknown) => Promise<unknown>>(),
  loadEventDetailMock: vi.fn<(id: string) => Promise<{ event: DetailEvent } | null>>(async () => null),
  isCompanionMock: vi.fn<(reg: unknown) => boolean>(),
}));

vi.mock('@/ui/Toast', () => ({
  toast: { show: (args: { message: string }) => toastShow(args) },
  Toast: () => null,
}));

vi.mock('@/ui/AppConfirm', () => ({
  appConfirm: (message: string) => appConfirmMock(message),
}));

vi.mock('../../data/signup', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../data/signup')>();
  return {
    ...original,
    cancelRegistration: (args: unknown) => cancelRegistrationMock(args),
  };
});

vi.mock('../../data/event-detail', () => ({
  loadEventDetail: (id: string) => loadEventDetailMock(id),
}));

// 測試同步更新（T-086a）：hook 改用 effectiveEventStatus，需保留 terminal 其餘真實匯出。
vi.mock('../../data/terminal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/terminal')>()),
  eventStartMs: () => 0,
}));

vi.mock('../../data/detail-model', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../data/detail-model')>();
  return {
    ...original,
    isCompanion: (reg: unknown) => isCompanionMock(reg),
    registrationId: (reg: { id?: string }) => reg.id ?? '',
    registrationOwner: (reg: { userId?: string }) => reg.userId ?? '',
  };
});

import { useCancelRegistration } from './use-cancel-registration';
import { SignupError } from '../../data/signup';

function makeEvent(overrides: Partial<DetailEvent> = {}): DetailEvent {
  return {
    id: 'evt-1',
    title: '測試活動',
    status: 'active',
    ...overrides,
  } as DetailEvent;
}

interface FakeReg {
  id?: string;
  userId?: string;
  userName?: string;
  companionName?: string;
  status?: 'confirmed' | 'waitlisted' | 'cancelled';
}

function makeReg(overrides: FakeReg = {}): DetailRegistration {
  return {
    id: 'r1',
    userId: 'u1',
    status: 'confirmed',
    ...overrides,
  } as unknown as DetailRegistration;
}

function makeCancelContext(
  load: (id: string) => Promise<{ event: DetailEvent }>,
): CancelOperationContext {
  return { load } as unknown as CancelOperationContext;
}

interface Setup {
  options: UseCancelRegistrationOptions;
  getResult(): UseCancelRegistrationResult;
}

function setup(overrides: Partial<UseCancelRegistrationOptions> = {}): Setup {
  const loadMock = vi.fn(async () => ({ event: makeEvent() }));
  const options: UseCancelRegistrationOptions = {
    getViewerUid: () => 'u1',
    isAlive: () => true,
    canRun: () => true,
    login: vi.fn(async () => {}),
    cancelContext: makeCancelContext(loadMock),
    onIntegrityError: vi.fn(),
    onSelfCancelled: vi.fn(async () => {}),
    onBatchCancelled: vi.fn(async () => {}),
    ...overrides,
  };
  const resultRef: { current: UseCancelRegistrationResult | null } = { current: null };
  function Wrapper(): JSX.Element {
    resultRef.current = useCancelRegistration(options);
    return <div />;
  }
  render(<Wrapper />);
  return {
    options,
    getResult(): UseCancelRegistrationResult {
      if (!resultRef.current) throw new Error('hook 尚未初始化');
      return resultRef.current;
    },
  };
}

describe('useCancelRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appConfirmMock.mockImplementation(async () => true);
    loadEventDetailMock.mockImplementation(async () => null);
    isCompanionMock.mockImplementation(
      (reg: unknown) => !!(reg as { companionName?: string }).companionName,
    );
    cancelRegistrationMock.mockReset();
    toastShow.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('(1) 只有本人一筆 → appConfirm 後 cancelRegistration（kind self）並呼叫 onSelfCancelled', async () => {
    const event = makeEvent();
    const owned: DetailRegistration[] = [makeReg({
      id: 'r1', userId: 'u1', userName: '我', status: 'confirmed',
    })];
    isCompanionMock.mockReturnValue(false);
    cancelRegistrationMock.mockResolvedValueOnce({ deduplicated: false });
    loadEventDetailMock.mockResolvedValueOnce({ event: makeEvent() });
    const onSelfCancelled = vi.fn(async () => {});
    const { getResult } = setup({ onSelfCancelled });

    await act(async () => {
      await getResult().beginCancel({ event, publicId: 'evt-1', owned });
    });

    expect(appConfirmMock).toHaveBeenCalledWith('確定要取消報名？');
    expect(cancelRegistrationMock).toHaveBeenCalledTimes(1);
    expect(cancelRegistrationMock).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'evt-1',
      userId: 'u1',
      registrationIds: ['r1'],
      kind: 'self',
    }));
    expect(toastShow).toHaveBeenCalledWith({ message: '已取消報名' });
    expect(onSelfCancelled).toHaveBeenCalledTimes(1);
    const firstCall = (onSelfCancelled.mock.calls[0] as unknown[] | undefined)?.[0] as
      { deduplicated: boolean; updatedEvent: DetailEvent | null };
    expect(firstCall.deduplicated).toBe(false);
    expect(firstCall.updatedEvent).not.toBeNull();
  });

  it('(2) 有同行者 → 不呼叫 Callable、modal.targets 本人在前', async () => {
    const event = makeEvent();
    const owned: DetailRegistration[] = [
      makeReg({ id: 'r1', userId: 'u1', userName: '我', status: 'confirmed' }),
      makeReg({ id: 'r2', userId: 'u1', companionName: '小明', status: 'confirmed' }),
    ];
    isCompanionMock.mockImplementation((reg: unknown) =>
      !!(reg as { companionName?: string }).companionName);
    const { getResult } = setup();

    await act(async () => {
      await getResult().beginCancel({ event, publicId: 'evt-1', owned });
    });

    expect(cancelRegistrationMock).not.toHaveBeenCalled();
    const modal = getResult().modal;
    expect(modal).not.toBeNull();
    expect(modal?.targets).toHaveLength(2);
    expect(modal?.targets[0]).toMatchObject({ registrationId: 'r1', isSelf: true });
    expect(modal?.targets[1]).toMatchObject({ registrationId: 'r2', isSelf: false });
    // 照詳情頁原碼：selectAll = selfKeys.size === 1（本人只有一筆）。
    expect(modal?.selectAll).toBe(true);
  });

  it('(3) confirmCancel 空 ids → toast「請選擇要取消的報名」', async () => {
    const event = makeEvent();
    const { getResult } = setup();

    await act(async () => {
      await getResult().confirmCancel({ event, publicId: 'evt-1', owned: [] }, []);
    });

    expect(toastShow).toHaveBeenCalledWith({ message: '請選擇要取消的報名' });
    expect(cancelRegistrationMock).not.toHaveBeenCalled();
  });

  it('(4) ALREADY_CANCELLED → toast「已取消 N 筆報名」並呼叫 onBatchCancelled', async () => {
    const event = makeEvent();
    const owned: DetailRegistration[] = [
      makeReg({ id: 'r1', userId: 'u1', userName: '我', status: 'confirmed' }),
    ];
    isCompanionMock.mockReturnValue(false);
    const already = Object.create(SignupError.prototype) as {
      originalCode: string;
      message: string;
    };
    already.originalCode = 'ALREADY_CANCELLED';
    already.message = '已取消';
    cancelRegistrationMock.mockRejectedValueOnce(already);
    const onBatchCancelled = vi.fn(async () => {});
    const { getResult } = setup({ onBatchCancelled });

    await act(async () => {
      await getResult().confirmCancel({ event, publicId: 'evt-1', owned }, ['r1']);
    });

    expect(toastShow).toHaveBeenCalledWith({ message: '已取消 1 筆報名' });
    expect(onBatchCancelled).toHaveBeenCalledTimes(1);
    expect(getResult().modal).toBeNull();
  });

  function timeoutError(): SignupError {
    return new SignupError({
      code: 'deadline-exceeded',
      originalCode: 'CALLABLE_TIMEOUT',
      messageKey: 'event.cancel.error.unknown',
      message: '連線逾時，請檢查網路後重新整理再試',
    });
  }

  it('(T-086a) 確認視窗前不讀活動：cancelContext.load 0 次', async () => {
    const event = makeEvent({ id: 'evtA' });
    const owned = [makeReg({ id: 'targetA', userId: 'uidA' })];
    isCompanionMock.mockReturnValue(false);
    cancelRegistrationMock.mockResolvedValueOnce({ deduplicated: false, event: { current: 0 } });
    const load = vi.fn(async () => ({ event: makeEvent({ id: 'evtA' }) }));
    const { getResult } = setup({
      getViewerUid: () => 'uidA',
      cancelContext: makeCancelContext(load),
    });

    await act(async () => {
      await getResult().beginCancel({ event, publicId: 'evtA', owned });
    });

    expect(appConfirmMock).toHaveBeenCalledWith('確定要取消報名？');
    expect(load).not.toHaveBeenCalled();
    expect(loadEventDetailMock).not.toHaveBeenCalled();
    expect(cancelRegistrationMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['狀態已結束', { status: 'ended' }],
    ['狀態已取消', { status: 'cancelled' }],
    ['開始時間已過', { status: 'open', date: '2000/01/01 10:00~12:00' }],
  ] as const)('(T-086a) 快照顯示%s → 提早 toast、不開確認、不送 Callable', async (_name, overrides) => {
    const event = makeEvent({ id: 'evtA', ...overrides });
    const owned = [makeReg({ id: 'targetA', userId: 'uidA' })];
    isCompanionMock.mockReturnValue(false);
    const load = vi.fn(async () => ({ event }));
    const { getResult } = setup({
      getViewerUid: () => 'uidA',
      cancelContext: makeCancelContext(load),
    });

    await act(async () => {
      await getResult().beginCancel({ event, publicId: 'evtA', owned });
    });

    expect(toastShow).toHaveBeenCalledWith({ message: '活動已開始，無法再取消報名' });
    expect(appConfirmMock).not.toHaveBeenCalled();
    expect(cancelRegistrationMock).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('(T-086a) 快照顯示不可取消但最新活動可取消 → 重讀後照常開確認，不誤擋', async () => {
    const stale = makeEvent({ id: 'evtA', status: 'ended' });
    const owned = [makeReg({ id: 'targetA', userId: 'uidA' })];
    isCompanionMock.mockReturnValue(false);
    appConfirmMock.mockResolvedValueOnce(false);
    const load = vi.fn(async () => ({ event: makeEvent({ id: 'evtA', status: 'open' }) }));
    const { getResult } = setup({
      getViewerUid: () => 'uidA',
      cancelContext: makeCancelContext(load),
    });

    await act(async () => {
      await getResult().beginCancel({ event: stale, publicId: 'evtA', owned });
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(appConfirmMock).toHaveBeenCalledTimes(1);
    expect(toastShow).not.toHaveBeenCalledWith({ message: '活動已開始，無法再取消報名' });
  });

  it('(T-086a) deduplicated：不顯示成功、以結果未知通知呼叫端', async () => {
    const event = makeEvent({ id: 'evtA' });
    const owned = [makeReg({ id: 'targetA', userId: 'uidA' })];
    isCompanionMock.mockReturnValue(false);
    cancelRegistrationMock.mockResolvedValueOnce({ deduplicated: true, event: { current: 0 } });
    const onSelfCancelled = vi.fn(async () => {});
    const { getResult } = setup({ getViewerUid: () => 'uidA', onSelfCancelled });

    await act(async () => {
      await getResult().beginCancel({ event, publicId: 'evtA', owned });
    });

    expect(toastShow).toHaveBeenCalledWith({ message: '取消處理中，請稍候' });
    expect(toastShow).not.toHaveBeenCalledWith({ message: '已取消報名' });
    expect(onSelfCancelled).toHaveBeenCalledTimes(1);
    expect(onSelfCancelled).toHaveBeenCalledWith({ deduplicated: true, updatedEvent: null });
  });

  it('(T-086a) 本人取消逾時：顯示既有逾時訊息後以結果未知重讀，不重送', async () => {
    const event = makeEvent({ id: 'evtA' });
    const owned = [makeReg({ id: 'targetA', userId: 'uidA' })];
    isCompanionMock.mockReturnValue(false);
    cancelRegistrationMock.mockRejectedValueOnce(timeoutError());
    const order: string[] = [];
    toastShow.mockImplementation(() => { order.push('toast'); });
    const onSelfCancelled = vi.fn(async () => { order.push('refresh'); });
    const { getResult } = setup({ getViewerUid: () => 'uidA', onSelfCancelled });

    await act(async () => {
      await getResult().beginCancel({ event, publicId: 'evtA', owned });
    });

    expect(toastShow).toHaveBeenCalledWith({
      message: '取消失敗：連線逾時，請檢查網路後重新整理再試',
    });
    expect(onSelfCancelled).toHaveBeenCalledWith({ deduplicated: true, updatedEvent: null });
    expect(order).toEqual(['toast', 'refresh']);
    expect(cancelRegistrationMock).toHaveBeenCalledTimes(1);
  });

  it('(T-086a) 批次取消：成功與 deduplicated 分別告知呼叫端；逾時以結果未知重讀', async () => {
    const event = makeEvent({ id: 'evtA' });
    const owned = [makeReg({ id: 'targetA', userId: 'uidA' })];
    isCompanionMock.mockReturnValue(false);
    const onBatchCancelled = vi.fn(async () => {});
    const { getResult } = setup({ getViewerUid: () => 'uidA', onBatchCancelled });

    cancelRegistrationMock.mockResolvedValueOnce({ deduplicated: false });
    await act(async () => {
      await getResult().confirmCancel({ event, publicId: 'evtA', owned }, ['targetA']);
    });
    expect(onBatchCancelled).toHaveBeenLastCalledWith({ deduplicated: false });

    cancelRegistrationMock.mockResolvedValueOnce({ deduplicated: true });
    await act(async () => {
      await getResult().confirmCancel({ event, publicId: 'evtA', owned }, ['targetA']);
    });
    expect(toastShow).toHaveBeenLastCalledWith({ message: '取消處理中，請稍候' });
    expect(onBatchCancelled).toHaveBeenLastCalledWith({ deduplicated: true });

    cancelRegistrationMock.mockRejectedValueOnce(timeoutError());
    await act(async () => {
      await getResult().confirmCancel({ event, publicId: 'evtA', owned }, ['targetA']);
    });
    expect(toastShow).toHaveBeenLastCalledWith({
      message: '取消失敗：連線逾時，請檢查網路後重新整理再試',
    });
    expect(onBatchCancelled).toHaveBeenLastCalledWith({ deduplicated: true });
    expect(onBatchCancelled).toHaveBeenCalledTimes(3);
    expect(cancelRegistrationMock).toHaveBeenCalledTimes(3);
  });

  function serverError(originalCode: string, message: string): SignupError {
    return new SignupError({
      code: 'failed-precondition',
      originalCode,
      messageKey: 'event.cancel.error.unknown',
      message,
    });
  }

  // T-087c：T-087a 伺服器對同行者取消（A10）也套取消時限；修正前 REQUEST_ID_CONFLICT 會落到逾時文案。
  it.each([
    ['EVENT_ENDED', '活動已開始，無法再取消報名'],
    ['EVENT_STARTED', '活動已於開始時間結束，無法取消報名'],
    ['REQUEST_ID_CONFLICT', '請重新整理後再試'],
  ] as const)('(T-087c) 同行者取消被伺服器拒絕 %s → 顯示對應文案、不當成逾時重讀', async (code, text) => {
    const event = makeEvent({ id: 'evtA' });
    const owned = [
      makeReg({ id: 'selfA', userId: 'uidA', userName: '我' }),
      makeReg({ id: 'compA', userId: 'uidA', companionName: '小明' }),
    ];
    cancelRegistrationMock.mockRejectedValueOnce(serverError(code, text));
    const onBatchCancelled = vi.fn(async () => {});
    const { getResult } = setup({ getViewerUid: () => 'uidA', onBatchCancelled });

    await act(async () => {
      await getResult().confirmCancel({ event, publicId: 'evtA', owned }, ['compA']);
    });

    expect(cancelRegistrationMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'companion' }));
    expect(toastShow).toHaveBeenCalledWith({ message: `取消失敗：${text}` });
    expect(onBatchCancelled).not.toHaveBeenCalled();
  });

  it('(T-087c) 本人取消被伺服器以 EVENT_STARTED 拒絕 → 原錯誤（含伺服器文案）交給呼叫端顯示', async () => {
    const event = makeEvent({ id: 'evtA' });
    const owned = [makeReg({ id: 'targetA', userId: 'uidA' })];
    isCompanionMock.mockReturnValue(false);
    const rejection = serverError('EVENT_STARTED', '活動已於開始時間結束，無法取消報名');
    cancelRegistrationMock.mockRejectedValueOnce(rejection);
    const onSelfCancelled = vi.fn(async () => {});
    const { getResult } = setup({ getViewerUid: () => 'uidA', onSelfCancelled });

    let caught: unknown;
    await act(async () => {
      try {
        await getResult().beginCancel({ event, publicId: 'evtA', owned });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBe(rejection);
    expect(onSelfCancelled).not.toHaveBeenCalled();
  });
});
