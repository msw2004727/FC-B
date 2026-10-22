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

vi.mock('../../data/terminal', () => ({
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
});
