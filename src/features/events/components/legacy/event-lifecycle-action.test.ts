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
