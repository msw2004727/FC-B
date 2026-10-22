import { createElement, type FunctionComponent } from 'preact';
import { act, cleanup, render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { EventFormSavedResult } from '../EventFormModal';
import {
  invalidateEventFormPostSave,
  useEventFormPostSave,
  useEventFormSession,
} from './use-event-form-post-save';

const mocks = vi.hoisted(() => ({
  show: vi.fn(),
  confirm: vi.fn<(message: string) => Promise<boolean>>(),
  log: vi.fn<(input: unknown) => Promise<void>>(),
  call: vi.fn(),
  getDoc: vi.fn(),
  doc: vi.fn(),
  firebase: vi.fn(),
  detail: vi.fn(),
  share: vi.fn(),
}));

vi.mock('@/ui/Toast', () => ({ toast: { show: mocks.show } }));
vi.mock('@/ui/AppConfirm', () => ({ appConfirm: mocks.confirm }));
vi.mock('@/data/op-log', () => ({ writeOpLog: mocks.log }));
vi.mock('@/data/callables', () => ({ callFn: mocks.call }));
vi.mock('@/data/firebase', () => ({ getFirebase: mocks.firebase }));
vi.mock('firebase/firestore', () => ({ doc: mocks.doc, getDoc: mocks.getDoc }));
vi.mock('../../data/event-detail', () => ({ loadEventDetail: mocks.detail }));
vi.mock('../../data/event-share', () => ({ shareEvent: mocks.share }));

// ASSUMPTION: 附件未提供 ViewerView 完整欄位；測試只使用本卡讀取的欄位。
const viewer = { uid: 'u1', role: 'coach', displayName: '主辦人' } as ViewerView;
const result: EventFormSavedResult = {
  mode: 'create',
  eventId: 'public-1',
  title: '週末足球',
  count: 1,
};

let save: (value: EventFormSavedResult) => void;
const close = vi.fn();
const refresh = vi.fn<() => void | Promise<void>>();

function Harness({ value = viewer, open = false }: {
  value?: ViewerView;
  open?: boolean;
}) {
  useEventFormSession(open);
  save = useEventFormPostSave({ viewer: value, close, refresh });
  return null;
}
// PM 修正：createElement 對選填 props 元件的型別推斷（weak type），改用明確型別。
const HarnessFC = Harness as FunctionComponent<{ value?: ViewerView; open?: boolean }>;

async function flush(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
    await Promise.resolve();
  });
}

beforeEach(() => {
  document.documentElement.lang = 'zh-TW';
  vi.useFakeTimers();
  vi.clearAllMocks();
  close.mockReset();
  refresh.mockReset();
  mocks.confirm.mockReset().mockResolvedValue(false);
  mocks.log.mockReset().mockResolvedValue(undefined);
  mocks.call.mockReset().mockResolvedValue(undefined);
  mocks.firebase.mockReset().mockResolvedValue({ db: {} });
  mocks.getDoc.mockReset().mockResolvedValue({
    exists: () => true,
    data: () => ({ host_activity: 0 }),
  });
  mocks.detail.mockReset().mockResolvedValue({
    event: { id: 'public-1', title: '週末足球', _docId: 'doc-9' },
    eventDocId: 'doc-9',
  });
  mocks.share.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useEventFormPostSave', () => {
  it.each([
    [1, '活動「週末足球」已建立！'],
    [3, '已建立 3 場「週末足球」活動！'],
  ])('建立 %i 場先關閉、提示、刷新', async (count, message) => {
    render(createElement(HarnessFC, {}));
    act(() => save({ ...result, count }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledWith({ message });
    await flush();
    expect(mocks.log).toHaveBeenCalledWith({
      type: 'event_create',
      typeName: '建立活動',
      content: '建立「週末足球」',
      actorUid: 'u1',
      operator: '主辦人',
    });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('host_activity > 0 使用 A Callable 參數與 public id 分享', async () => {
    vi.setSystemTime(new Date('2026-10-22T00:00:00Z'));
    const now = Date.now();
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ host_activity: 15 }),
    });
    render(createElement(HarnessFC, {}));
    act(() => save(result));
    await flush();
    expect(mocks.doc).toHaveBeenCalledWith({}, 'siteConfig', 'autoExpRules');
    expect(mocks.call).toHaveBeenCalledWith('adjustExp', {
      mode: 'auto',
      targets: ['u1'],
      amount: 15,
      reason: '自動：主辦活動（週末足球）',
      operatorLabel: '系統',
      requestId: `autoexp_u1_host_activity_${now}`,
      ruleKey: 'host_activity',
    });
  });

  it('499ms 不詢問，500ms 詢問，取消不分享', async () => {
    render(createElement(HarnessFC, {}));
    act(() => save(result));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(mocks.confirm).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.confirm).toHaveBeenCalledWith('活動已建立！要分享嗎？');
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it('確定後依 public eventId 讀取並分享，不使用文件 id', async () => {
    mocks.confirm.mockResolvedValue(true);
    render(createElement(HarnessFC, {}));
    act(() => save(result));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await flush();
    expect(mocks.detail).toHaveBeenCalledWith('public-1');
    expect(mocks.share).toHaveBeenCalledWith(
      { id: 'public-1', title: '週末足球', _docId: 'doc-9' },
      expect.objectContaining({
        loggedIn: true,
        signal: expect.any(AbortSignal),
        showToast: expect.any(Function),
      }),
    );
  });

  it('卸載取消計時器', async () => {
    const view = render(createElement(HarnessFC, {}));
    act(() => save(result));
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('開啟其他表單取消舊分享', async () => {
    const view = render(createElement(HarnessFC, { open: false }));
    act(() => save(result));
    view.rerender(createElement(HarnessFC, { open: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('確認框等待期間失效，確定後也不分享', async () => {
    let resolve!: (value: boolean) => void;
    mocks.confirm.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(createElement(HarnessFC, {}));
    act(() => save(result));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    act(() => invalidateEventFormPostSave());
    await act(async () => resolve(true));
    await flush();
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it('讀取活動期間卸載，不繼續分享', async () => {
    mocks.confirm.mockResolvedValue(true);
    let resolve!: (value: unknown) => void;
    mocks.detail.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(createElement(HarnessFC, {}));
    act(() => save(result));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await flush();
    expect(mocks.detail).toHaveBeenCalled();
    view.unmount();
    await act(async () => resolve({
      event: { id: 'public-1' },
      eventDocId: 'doc-9',
    }));
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it('編輯提示、刷新、日誌帶 eventId，不發經驗值也不詢問分享', async () => {
    render(createElement(HarnessFC, {}));
    act(() => save({ ...result, mode: 'edit' }));
    await flush();
    expect(mocks.show).toHaveBeenCalledWith({ message: '活動「週末足球」已更新！' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledWith({
      type: 'event_edit',
      typeName: '編輯活動',
      content: '編輯「週末足球」',
      eventId: 'public-1',
      actorUid: 'u1',
      operator: '主辦人',
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.getDoc).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('刷新、日誌與經驗值失敗各自隔離，仍可詢問分享', async () => {
    refresh.mockRejectedValue(new Error('refresh'));
    mocks.log.mockRejectedValue(new Error('log'));
    mocks.getDoc.mockRejectedValue(new Error('exp'));
    render(createElement(HarnessFC, {}));
    act(() => save(result));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(mocks.show).toHaveBeenCalledWith({ message: '活動「週末足球」已建立！' });
    expect(mocks.log).toHaveBeenCalled();
    expect(mocks.getDoc).toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });

  it('關表單導致元件卸載（詳情頁編輯）：提示、刷新、日誌照常，分享詢問取消（PM 補測）', async () => {
    let view: ReturnType<typeof render> | null = null;
    close.mockImplementationOnce(() => { view?.unmount(); });
    view = render(createElement(HarnessFC, {}));
    act(() => save(result));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(mocks.show).toHaveBeenCalledWith({ message: '活動「週末足球」已建立！' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ type: 'event_create' }));
    expect(mocks.getDoc).toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('未登入不寫日誌、不發經驗值、不詢問分享', async () => {
    render(createElement(HarnessFC, { value: { ...viewer, uid: null } }));
    act(() => save(result));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(mocks.log).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
