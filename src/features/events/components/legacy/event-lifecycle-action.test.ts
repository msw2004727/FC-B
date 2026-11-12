import { cleanup } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 模組 mock 必須在 import 前 hoist；先宣告 vi.mock，再 import 目標。

vi.mock('@/ui/Toast', () => ({
  toast: { show: vi.fn() },
}));

vi.mock('@/ui/AppConfirm', () => ({
  appConfirm: vi.fn(),
}));

vi.mock('../../data/event-lifecycle', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../data/event-lifecycle')>();
  return {
    ...actual,
    cancelEvent: vi.fn(),
    reopenEvent: vi.fn(),
    relistEvent: vi.fn(),
    isCourseLinkedLifecycleLocked: vi.fn(() => false),
    isEventStartPassed: vi.fn(() => false),
  };
});

vi.mock('../../data/operate-permissions', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../data/operate-permissions')>();
  return {
    ...actual,
    canCancelOwnActivity: vi.fn(() => true),
    canReopenOrRelistActivity: vi.fn(() => true),
  };
});

import { appConfirm } from '@/ui/AppConfirm';
import { toast } from '@/ui/Toast';
import type { ViewerView } from '@/features/profile/data/viewer';
import { operateContextFromViewer } from '../../data/event-create-context';
import {
  cancelEvent,
  isCourseLinkedLifecycleLocked,
  relistEvent,
  reopenEvent,
} from '../../data/event-lifecycle';
import {
  canCancelOwnActivity,
  canReopenOrRelistActivity,
} from '../../data/operate-permissions';
import type { EventDoc } from '../../data/types';

import {
  runEventLifecycleAction,
  type LifecycleActionDeps,
} from './event-lifecycle-action';

const mockAppConfirm = vi.mocked(appConfirm);
const mockCancelEvent = vi.mocked(cancelEvent);
const mockReopenEvent = vi.mocked(reopenEvent);
const mockRelistEvent = vi.mocked(relistEvent);
const mockIsCourseLinked = vi.mocked(isCourseLinkedLifecycleLocked);
const mockCanCancel = vi.mocked(canCancelOwnActivity);
const mockCanReopenRelist = vi.mocked(canReopenOrRelistActivity);
const mockToastShow = vi.mocked(toast.show);

function makeViewer(): ViewerView {
  return {
    uid: 'u-test',
    role: 'user',
    roleLevel: 1,
    hasPermission: () => false,
  } as unknown as ViewerView;
}

function makeEvent(overrides: Partial<EventDoc> = {}): EventDoc {
  return {
    id: 'evt-default',
    _docId: 'evt-default',
    title: '測試活動',
    ...overrides,
  } as unknown as EventDoc;
}

function makeDeps(
  overrides: Partial<LifecycleActionDeps> = {},
): LifecycleActionDeps {
  return {
    viewer: makeViewer(),
    operateCtx: {} as ReturnType<typeof operateContextFromViewer>,
    busy: new Set<string>(),
    onDone: vi.fn(),
    ...overrides,
  };
}

describe('runEventLifecycleAction', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockIsCourseLinked.mockReturnValue(false);
    mockCanCancel.mockReturnValue(true);
    mockCanReopenRelist.mockReturnValue(true);
    mockAppConfirm.mockResolvedValue(true);
  });

  it('(1) 無權限 → toast「您只能管理自己的活動」、不呼叫 cancelEvent', async () => {
    mockCanCancel.mockReturnValue(false);
    const deps = makeDeps();
    const event = makeEvent();
    const result = await runEventLifecycleAction('cancel', event, deps);

    expect(result).toBe(false);
    expect(mockToastShow).toHaveBeenCalledWith({
      message: '您只能管理自己的活動',
      tone: 'error',
    });
    expect(mockCancelEvent).not.toHaveBeenCalled();
    expect(deps.onDone).not.toHaveBeenCalled();
  });

  it('(2) 確認後取消成功 → cancelEvent 收到 { event, eventDocId, viewer }、onDone 被呼叫、回 true', async () => {
    mockAppConfirm.mockResolvedValue(true);
    const deps = makeDeps();
    const event = makeEvent({ _docId: 'evt-x', id: 'evt-x' });

    const result = await runEventLifecycleAction('cancel', event, deps);

    expect(result).toBe(true);
    expect(mockCancelEvent).toHaveBeenCalledWith({
      event,
      eventDocId: 'evt-x',
      viewer: deps.viewer,
    });
    expect(mockReopenEvent).not.toHaveBeenCalled();
    expect(mockRelistEvent).not.toHaveBeenCalled();
    expect(deps.onDone).toHaveBeenCalledTimes(1);
    expect(mockToastShow).toHaveBeenCalledWith({
      message: '活動已取消',
      tone: 'success',
    });
  });

  it('(3) 同一 docId busy 中再呼叫直接 return false', async () => {
    const deps = makeDeps({ busy: new Set<string>(['evt-busy']) });
    const event = makeEvent({ _docId: 'evt-busy', id: 'evt-busy' });

    const result = await runEventLifecycleAction('cancel', event, deps);

    expect(result).toBe(false);
    expect(mockCancelEvent).not.toHaveBeenCalled();
    expect(mockAppConfirm).not.toHaveBeenCalled();
    expect(deps.onDone).not.toHaveBeenCalled();
  });

  it('(4) 課程連結活動 → 鎖定提示、不呼叫 cancelEvent', async () => {
    mockIsCourseLinked.mockReturnValue(true);
    const deps = makeDeps();
    const result = await runEventLifecycleAction('cancel', makeEvent(), deps);

    expect(result).toBe(false);
    expect(mockToastShow).toHaveBeenCalledWith({
      message:
        '課程轉化的活動請回課堂管理，不能在活動端取消、結束、刪除或重新開放',
      tone: 'error',
    });
    expect(mockCancelEvent).not.toHaveBeenCalled();
    expect(deps.onDone).not.toHaveBeenCalled();
  });
});

// 11-12 站長回報：按下取消活動後沒反應、過一陣子才刷新。觸發按鈕改在確認後立即轉進度環。
describe('runEventLifecycleAction 進度環', () => {
  function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }
  function makeRing(mounted = true) {
    const log: string[] = [];
    let releaseCheck: () => void = () => {};
    const ring = {
      start: vi.fn(() => { log.push('start'); }),
      succeed: vi.fn(() => {
        log.push('succeed');
        return new Promise<boolean>((resolve) => { releaseCheck = () => resolve(mounted); });
      }),
      fail: vi.fn(() => { log.push('fail'); }),
    };
    return { ring, log, releaseCheck: () => releaseCheck() };
  }
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };

  afterEach(() => {
    vi.clearAllMocks();
    mockAppConfirm.mockResolvedValue(true);
  });

  it('確認後、寫入完成前就 start；寫入完成先等 ✓ 停留，才重讀與提示', async () => {
    const write = deferred<void>();
    mockAppConfirm.mockResolvedValue(true);
    mockCancelEvent.mockReturnValueOnce(write.promise);
    const { ring, log, releaseCheck } = makeRing();
    const deps = makeDeps({ ring });

    const running = runEventLifecycleAction('cancel', makeEvent({ _docId: 'evt-r', id: 'evt-r' }), deps);
    await flush();
    // 寫入（含通知迴圈）尚未完成：環已開始、按鈕所在流程仍在 busy 中、尚未重讀。
    expect(ring.start).toHaveBeenCalledTimes(1);
    expect(mockCancelEvent).toHaveBeenCalledTimes(1);
    expect(ring.succeed).not.toHaveBeenCalled();
    expect(deps.busy.has('evt-r')).toBe(true);
    expect(deps.onDone).not.toHaveBeenCalled();

    // 處理中再按一次：busy 擋下，不再跳確認框、不重送。
    expect(await runEventLifecycleAction('cancel', makeEvent({ _docId: 'evt-r', id: 'evt-r' }), deps)).toBe(false);
    expect(mockAppConfirm).toHaveBeenCalledTimes(1);

    write.resolve();
    await flush();
    expect(ring.succeed).toHaveBeenCalledTimes(1);
    expect(deps.onDone).not.toHaveBeenCalled();
    expect(mockToastShow).not.toHaveBeenCalled();

    releaseCheck();
    expect(await running).toBe(true);
    expect(deps.onDone).toHaveBeenCalledTimes(1);
    expect(mockToastShow).toHaveBeenCalledWith({ message: '活動已取消', tone: 'success' });
    expect(log).toEqual(['start', 'succeed', 'fail']);
    expect(deps.busy.has('evt-r')).toBe(false);
  });

  it('等 ✓ 期間按鈕卸載（succeed 回 false）仍照原流程重讀與提示', async () => {
    const { ring, releaseCheck } = makeRing(false);
    const deps = makeDeps({ ring });
    const running = runEventLifecycleAction('reopen', makeEvent(), deps);
    await flush();
    releaseCheck();
    expect(await running).toBe(true);
    expect(mockReopenEvent).toHaveBeenCalledTimes(1);
    expect(deps.onDone).toHaveBeenCalledTimes(1);
    expect(mockToastShow).toHaveBeenCalledWith({ message: '活動已重新開放', tone: 'success' });
  });

  it('確認框按取消：不 start、不寫入', async () => {
    mockAppConfirm.mockResolvedValue(false);
    const { ring } = makeRing();
    const result = await runEventLifecycleAction('cancel', makeEvent(), makeDeps({ ring }));
    expect(result).toBe(false);
    expect(ring.start).not.toHaveBeenCalled();
    expect(ring.succeed).not.toHaveBeenCalled();
    expect(mockCancelEvent).not.toHaveBeenCalled();
  });

  it('第一次寫入失敗 → fail 展開並提示失敗；第二次重按成功 → 重新呼叫寫入並打勾', async () => {
    const { ring, log, releaseCheck } = makeRing();
    const deps = makeDeps({ ring });
    const event = makeEvent({ _docId: 'evt-retry', id: 'evt-retry' });
    mockCancelEvent.mockRejectedValueOnce(new Error('offline'));

    expect(await runEventLifecycleAction('cancel', event, deps)).toBe(false);
    expect(log).toEqual(['start', 'fail', 'fail']);
    expect(ring.succeed).not.toHaveBeenCalled();
    expect(mockToastShow).toHaveBeenCalledWith({ message: '取消失敗，請重試', tone: 'error' });
    expect(deps.onDone).not.toHaveBeenCalled();
    expect(deps.busy.has('evt-retry')).toBe(false);

    mockCancelEvent.mockResolvedValueOnce(undefined);
    const second = runEventLifecycleAction('cancel', event, deps);
    await flush();
    releaseCheck();
    expect(await second).toBe(true);
    expect(mockCancelEvent).toHaveBeenCalledTimes(2);
    expect(ring.start).toHaveBeenCalledTimes(2);
    expect(ring.succeed).toHaveBeenCalledTimes(1);
    expect(deps.onDone).toHaveBeenCalledTimes(1);
  });
});
