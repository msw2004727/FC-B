import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { getDocs } from 'firebase/firestore';
import { ACTIVE_LIST_REUSE_TTL_MS, getEventsRepo } from './events-repo';
import { _resetUseEventsForTest, useEvents } from './use-events';
import type { UseEventsTerminalMode } from './use-events';
import type { EventDoc } from './types';

// `useEvents` 的 onConfirmedActive（批次 A R-1）：在「這次自己新取得 active」與
// 「共用的請求在 ACTIVE_LIST_REUSE_TTL_MS 內沿用剛確認的那份」兩種情況都呼叫；
// 不呼叫：離線持久快取（activeFromCache 不是 false）、被較新請求取代、失敗、已卸載。
// 使用真實的 events-repo，只換掉 Firestore SDK 的 getDocs。
// repo 是單例、狀態跨案例保留，因此以 Date.now 的 spy 控制 TTL，每個案例自己建立前置狀態。

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

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

const titles = (events: EventDoc[]): string[] => events.map((event) => String(event._docId));

interface ProbeProps {
  mode: UseEventsTerminalMode;
  onFresh?: (events: EventDoc[]) => void;
  onConfirmedActive?: (events: EventDoc[]) => void;
  testId: string;
}

function Probe({ mode, onFresh, onConfirmedActive, testId }: ProbeProps): preact.JSX.Element {
  const { events, error } = useEvents(null, {
    terminalMode: mode,
    onFresh,
    onConfirmedActive,
  });
  return h('div', { 'data-testid': testId }, `${error ? 'E:' : ''}${titles(events).join(',')}`);
}

let fakeNow = 0;
let fakeBase = 1_700_000_000_000;

describe('useEvents.onConfirmedActive × 真實 events-repo 的回傳契約', () => {
  beforeEach(() => {
    fakeBase += 600_000;
    fakeNow = fakeBase;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);
    _resetUseEventsForTest();
    window.localStorage.clear();
    vi.mocked(getDocs).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('A：首頁卸載後 30 秒內再掛載，onFresh 與 onConfirmedActive 各 2 次', async () => {
    vi.mocked(getDocs)
      .mockResolvedValueOnce(result(['a1'], false) as never)
      .mockResolvedValueOnce(result(['a2'], false) as never);

    const fresh = vi.fn<(events: EventDoc[]) => void>();
    const confirmed = vi.fn<(events: EventDoc[]) => void>();
    const first = render(h(Probe, { mode: 'none', onFresh: fresh, onConfirmedActive: confirmed, testId: 'home' }));

    await waitFor(() => expect(fresh).toHaveBeenCalledTimes(1));
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(titles(confirmed.mock.calls[0]?.[0] ?? [])).toEqual(['a1']);
    first.unmount();
    await settle();

    render(h(Probe, { mode: 'none', onFresh: fresh, onConfirmedActive: confirmed, testId: 'home' }));

    await waitFor(() => expect(fresh).toHaveBeenCalledTimes(2));
    expect(confirmed).toHaveBeenCalledTimes(2);
    expect(titles(confirmed.mock.calls[1]?.[0] ?? [])).toEqual(['a2']);
  });

  it('B：列表 30 秒內沿用 active、讀取中回首頁，第二次 onFresh 0 次、onConfirmedActive 1 次', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce(result(['a1'], false) as never);
    const firstFresh = vi.fn<(events: EventDoc[]) => void>();
    const firstConfirmed = vi.fn<(events: EventDoc[]) => void>();
    const first = render(h(Probe, { mode: 'none', onFresh: firstFresh, onConfirmedActive: firstConfirmed, testId: 'first' }));

    await waitFor(() => expect(firstFresh).toHaveBeenCalledTimes(1));
    expect(titles(firstFresh.mock.calls[0]?.[0] ?? [])).toEqual(['a1']);
    expect(titles(firstConfirmed.mock.calls[0]?.[0] ?? [])).toEqual(['a1']);
    first.unmount();
    await settle();

    const terminalPending = deferred<unknown>();
    vi.mocked(getDocs).mockReturnValueOnce(terminalPending.promise as never);
    const listFresh = vi.fn<(events: EventDoc[]) => void>();
    const listConfirmed = vi.fn<(events: EventDoc[]) => void>();
    render(h(Probe, { mode: 'preview', onFresh: listFresh, onConfirmedActive: listConfirmed, testId: 'list' }));
    await waitFor(() => expect(vi.mocked(getDocs)).toHaveBeenCalledTimes(2));

    const homeFresh = vi.fn<(events: EventDoc[]) => void>();
    const homeConfirmed = vi.fn<(events: EventDoc[]) => void>();
    render(h(Probe, { mode: 'none', onFresh: homeFresh, onConfirmedActive: homeConfirmed, testId: 'home' }));
    await settle();
    expect(homeFresh).not.toHaveBeenCalled();
    expect(homeConfirmed).not.toHaveBeenCalled();

    terminalPending.resolve(result(['ended1'], false, 'ended'));

    await waitFor(() => expect(homeConfirmed).toHaveBeenCalledTimes(1));
    expect(homeFresh).not.toHaveBeenCalled();
    expect(titles(homeConfirmed.mock.calls[0]?.[0] ?? [])).toEqual(['a1']);
  });

  it('C：列表自己查 active、進行中切回首頁，onFresh 與 onConfirmedActive 各 1 次', async () => {
    const activePending = deferred<unknown>();
    const terminalPending = deferred<unknown>();
    vi.mocked(getDocs)
      .mockReturnValueOnce(activePending.promise as never)
      .mockReturnValueOnce(terminalPending.promise as never);

    const listFresh = vi.fn<(events: EventDoc[]) => void>();
    const listConfirmed = vi.fn<(events: EventDoc[]) => void>();
    render(h(Probe, { mode: 'preview', onFresh: listFresh, onConfirmedActive: listConfirmed, testId: 'list' }));
    await waitFor(() => expect(vi.mocked(getDocs)).toHaveBeenCalledTimes(2));

    const homeFresh = vi.fn<(events: EventDoc[]) => void>();
    const homeConfirmed = vi.fn<(events: EventDoc[]) => void>();
    render(h(Probe, { mode: 'none', onFresh: homeFresh, onConfirmedActive: homeConfirmed, testId: 'home' }));
    await settle();
    expect(homeFresh).not.toHaveBeenCalled();

    activePending.resolve(result(['c1', 'c2'], false));
    terminalPending.resolve(result(['ended1'], false, 'ended'));

    await waitFor(() => expect(homeFresh).toHaveBeenCalledTimes(1));
    expect(homeConfirmed).toHaveBeenCalledTimes(1);
    expect(titles(homeFresh.mock.calls[0]?.[0] ?? [])).toEqual(['c1', 'c2']);
    expect(titles(homeConfirmed.mock.calls[0]?.[0] ?? [])).toEqual(['c1', 'c2']);
  });

  it('離線快取 fromCache=true：畫面照常顯示，onFresh 與 onConfirmedActive 都不呼叫', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce(result(['c1'], true) as never);
    const fresh = vi.fn<(events: EventDoc[]) => void>();
    const confirmed = vi.fn<(events: EventDoc[]) => void>();
    const view = render(h(Probe, { mode: 'none', onFresh: fresh, onConfirmedActive: confirmed, testId: 'home' }));

    await waitFor(() => expect(view.getByTestId('home').textContent).toBe('c1'));
    await settle();
    expect(fresh).not.toHaveBeenCalled();
    expect(confirmed).not.toHaveBeenCalled();
  });

  it('被較新請求取代：onFresh 與 onConfirmedActive 都不呼叫', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce(result(['s1', 's2'], false) as never);
    await getEventsRepo().loadEventsStatic({ terminalMode: 'none' });
    const base = vi.mocked(getDocs).mock.calls.length;

    const requestA = deferred<unknown>();
    const requestB = deferred<unknown>();
    vi.mocked(getDocs)
      .mockReturnValueOnce(requestA.promise as never)
      .mockReturnValueOnce(requestB.promise as never);

    const fresh = vi.fn<(events: EventDoc[]) => void>();
    const confirmed = vi.fn<(events: EventDoc[]) => void>();
    const view = render(h(Probe, { mode: 'none', onFresh: fresh, onConfirmedActive: confirmed, testId: 'home' }));
    await waitFor(() => expect(vi.mocked(getDocs)).toHaveBeenCalledTimes(base + 1));

    const callB = getEventsRepo().loadEventsStatic({ terminalMode: 'none' });
    await waitFor(() => expect(vi.mocked(getDocs)).toHaveBeenCalledTimes(base + 2));

    requestA.resolve(result(['from-a'], false));
    await waitFor(() => expect(view.getByTestId('home').textContent).toBe('s1,s2'));
    await settle();
    expect(fresh).not.toHaveBeenCalled();
    expect(confirmed).not.toHaveBeenCalled();

    requestB.resolve(result(['from-b'], false));
    await callB;
    await settle();
    expect(fresh).not.toHaveBeenCalled();
    expect(confirmed).not.toHaveBeenCalled();
  });

  it('active 讀取失敗：onFresh 與 onConfirmedActive 都不呼叫，畫面進入錯誤狀態', async () => {
    vi.mocked(getDocs).mockRejectedValueOnce(new Error('offline'));
    const fresh = vi.fn<(events: EventDoc[]) => void>();
    const confirmed = vi.fn<(events: EventDoc[]) => void>();
    const view = render(h(Probe, { mode: 'none', onFresh: fresh, onConfirmedActive: confirmed, testId: 'home' }));

    await waitFor(() => expect(view.getByTestId('home').textContent).toBe('E:'));
    await settle();
    expect(fresh).not.toHaveBeenCalled();
    expect(confirmed).not.toHaveBeenCalled();
  });

  it('只有 terminal 失敗：畫面沿用已提交的 active，onFresh 與 onConfirmedActive 都不呼叫', async () => {
    vi.mocked(getDocs)
      .mockResolvedValueOnce(result(['a1'], false) as never)
      .mockRejectedValueOnce(new Error('terminal ordered offline'))
      .mockRejectedValueOnce(new Error('terminal fallback offline'));

    const fresh = vi.fn<(events: EventDoc[]) => void>();
    const confirmed = vi.fn<(events: EventDoc[]) => void>();
    const view = render(h(Probe, { mode: 'preview', onFresh: fresh, onConfirmedActive: confirmed, testId: 'list' }));

    await waitFor(() => expect(view.getByTestId('list').textContent).toBe('a1'));
    await waitFor(() => expect(vi.mocked(getDocs)).toHaveBeenCalledTimes(3));
    await settle();
    expect(fresh).not.toHaveBeenCalled();
    expect(confirmed).not.toHaveBeenCalled();
  });

  it('超過 ACTIVE_LIST_REUSE_TTL_MS 後列表重查 active：onFresh 與 onConfirmedActive 各 1 次', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce(result(['old'], false) as never);
    await getEventsRepo().loadEventsStatic({ terminalMode: 'none' });

    fakeNow += ACTIVE_LIST_REUSE_TTL_MS + 1;
    vi.mocked(getDocs)
      .mockResolvedValueOnce(result(['fresh'], false) as never)
      .mockResolvedValueOnce(result(['ended'], false, 'ended') as never);

    const fresh = vi.fn<(events: EventDoc[]) => void>();
    const confirmed = vi.fn<(events: EventDoc[]) => void>();
    render(h(Probe, { mode: 'preview', onFresh: fresh, onConfirmedActive: confirmed, testId: 'list' }));

    await waitFor(() => expect(fresh).toHaveBeenCalledTimes(1));
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(titles(fresh.mock.calls[0]?.[0] ?? [])).toEqual(['fresh']);
    expect(titles(confirmed.mock.calls[0]?.[0] ?? [])).toEqual(['fresh']);
  });
});
