import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { getDocs } from 'firebase/firestore';
import { getEventsRepo } from './events-repo';
import { _resetUseEventsForTest, useEvents } from './use-events';
import type { EventDoc } from './types';

// `useEvents` 的 onFresh（首屏快照依賴它）配上「真實」的 events-repo（只換掉 Firestore SDK 的 getDocs）：
// 「確認新取得」＝這一次呼叫自己成功（loadEventsStatic 回傳完成回條 ['events']，含成功零筆）且 activeFromCache === false。
// 被較新請求取代（回 []）的呼叫，即使共用 snapshot 還留著上一次的 fromCache=false，也不算；失敗更不算。
// onFresh 只收到這次確認新取得的 active（不夾帶 repo 先前載入的 terminal）。
// repo 是單例、狀態跨案例保留，所以每個案例都在案例內自己建立前置狀態（直接讓 repo 先成功一次），單獨執行也成立。

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ kind: 'collection', path })),
  collectionGroup: vi.fn(),
  query: vi.fn((base: unknown, ...constraints: unknown[]) => ({ base, constraints })),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock('@/data/firebase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/firebase')>()),
  getFirebase: vi.fn(async () => ({ db: {} })),
  getFirebaseCore: vi.fn(async () => ({ db: {} })),
}));

function doc(id: string, status = 'open'): { id: string; data: () => Record<string, unknown>; ref: { id: string } } {
  return { id, data: () => ({ status, title: id }), ref: { id } };
}
const result = (ids: string[], fromCache: boolean, status = 'open'): unknown => ({
  docs: ids.map((id) => doc(id, status)),
  metadata: { fromCache },
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 完成訊號：本次請求結算，並讓出一個巨集任務（setTimeout 會在當下的微任務佇列清空之後才執行）。不代表之後不會再有別的工作排入。 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

const titles = (events: EventDoc[]): string[] => events.map((e) => String(e._docId));

describe('useEvents.onFresh × 真實 events-repo 的回傳契約', () => {
  const onFresh = vi.fn<(events: EventDoc[]) => void>();
  function Probe(): preact.JSX.Element {
    const { events, error } = useEvents(null, { terminalMode: 'none', onFresh });
    return h('div', { 'data-testid': 'p' }, `${error ? 'E:' : ''}${titles(events).join(',')}`);
  }

  beforeEach(() => {
    _resetUseEventsForTest();
    onFresh.mockReset();
    vi.mocked(getDocs).mockReset();
  });
  afterEach(() => cleanup());

  it('成功零筆（fromCache=false）→ 成功路徑：呼叫 onFresh 一次，拿到空陣列', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce(result([], false) as never);
    render(h(Probe, null));
    await waitFor(() => expect(onFresh).toHaveBeenCalledTimes(1));
    expect(onFresh).toHaveBeenLastCalledWith([]);
  });

  it('成功但來自本機快取（fromCache=true）→ 畫面照常顯示資料，不呼叫 onFresh', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce(result(['c1'], true) as never);
    const view = render(h(Probe, null));
    await waitFor(() => expect(view.getByTestId('p').textContent).toBe('c1'));
    await settle();
    expect(onFresh).not.toHaveBeenCalled();
  });

  it('成功（fromCache=false，有資料）→ 呼叫 onFresh 一次，內容就是這一次提交的資料', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce(result(['s1', 's2'], false) as never);
    render(h(Probe, null));
    await waitFor(() => expect(onFresh).toHaveBeenCalledTimes(1));
    expect(titles(onFresh.mock.calls[0]?.[0] ?? [])).toEqual(['s1', 's2']);
  });

  it('repo 先前載入過 terminal（preview），之後 none 模式成功零筆 active：onFresh 只收到空的 active，不夾帶舊的 terminal', async () => {
    // 前置（案例內建立）：preview 載入，active 一筆、terminal 兩筆 ended
    vi.mocked(getDocs)
      .mockResolvedValueOnce(result(['p-active'], false) as never)
      .mockResolvedValueOnce(result(['p-ended-1', 'p-ended-2'], false, 'ended') as never);
    await getEventsRepo().loadEventsStatic({ terminalMode: 'preview' });
    expect(titles(getEventsRepo().getSnapshot().terminal)).toEqual(['p-ended-1', 'p-ended-2']);

    // 首頁（none）這次成功但目前沒有進行中的活動；repo 的 terminal 沿用上一次
    vi.mocked(getDocs).mockResolvedValueOnce(result([], false) as never);
    render(h(Probe, null));
    await waitFor(() => expect(onFresh).toHaveBeenCalledTimes(1));
    expect(onFresh).toHaveBeenLastCalledWith([]);
    expect(titles(getEventsRepo().getSnapshot().terminal)).toEqual(['p-ended-1', 'p-ended-2']);
  });

  it('被較新請求取代：repo 回傳 []、沒提交任何資料——即使共用 snapshot 還留著上一次的 fromCache=false，也不呼叫 onFresh', async () => {
    // 前置（案例內建立）：repo 先成功提交一次資料 s1、s2，activeFromCache === false
    vi.mocked(getDocs).mockResolvedValueOnce(result(['s1', 's2'], false) as never);
    await getEventsRepo().loadEventsStatic({ terminalMode: 'none' });
    expect(getEventsRepo().getSnapshot().activeFromCache).toBe(false);
    // 呼叫次數用相對值（前置那一次已算進去），單獨執行與整檔執行都成立
    const base = vi.mocked(getDocs).mock.calls.length;

    const requestA = deferred<unknown>();
    const requestB = deferred<unknown>();
    vi.mocked(getDocs).mockReturnValueOnce(requestA.promise as never).mockReturnValueOnce(requestB.promise as never);
    const view = render(h(Probe, null));
    await waitFor(() => expect(vi.mocked(getDocs)).toHaveBeenCalledTimes(base + 1));
    // 在畫面這一輪（A）還沒回來時，別處（例如活動列表）又發了一輪（B），取代 A
    const callB = getEventsRepo().loadEventsStatic({ terminalMode: 'none' });
    await waitFor(() => expect(vi.mocked(getDocs)).toHaveBeenCalledTimes(base + 2));

    requestA.resolve(result(['from-a'], false));
    await waitFor(() => expect(view.getByTestId('p').textContent).toBe('s1,s2')); // 沿用上一次提交的資料顯示
    await settle();
    expect(onFresh).not.toHaveBeenCalled();

    requestB.resolve(result(['from-b'], false));
    await callB;
    await settle();
    // 畫面這一輪（A）早已結束，B 是別人呼叫的：不補發
    expect(onFresh).not.toHaveBeenCalled();
  });

  it('失敗：不呼叫 onFresh；沒有任何資料可顯示時畫面進入錯誤狀態', async () => {
    _resetUseEventsForTest();
    vi.mocked(getDocs).mockRejectedValueOnce(new Error('offline'));
    // repo 丟 EventsLoadError：hook 沒有 fresh、也沒有 stale（訪客、沒有本機快照）→ 以錯誤呈現；repo 既有的 state 不影響畫面
    const view = render(h(Probe, null));
    await waitFor(() => expect(view.getByTestId('p').textContent).toBe('E:'));
    await settle();
    expect(onFresh).not.toHaveBeenCalled();
  });
});
