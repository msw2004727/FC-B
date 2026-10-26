import { cleanup, render, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _clearEventsSnapshotForTest, readEventsSnapshot, writeEventsSnapshot } from './events-snapshot-cache';
import type { EventDoc } from './types';

const loadEventsStatic = vi.fn<() => Promise<string[]>>();
let repoEvents: EventDoc[] = [];
/** repo 回報的 activeFromCache：false＝確認向伺服器新取得（預設），true＝離線時的持久快取，undefined＝讀不到。 */
let repoFromCache: boolean | undefined = false;

let knownUid: string | null | undefined = null;
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => knownUid }));

vi.mock('./events-repo', () => ({
  getEventsRepo: () => ({
    loadEventsStatic,
    getSnapshot: () => ({ active: [...repoEvents], terminal: [], activeFromCache: repoFromCache }),
  }),
}));

const { useEvents, _resetUseEventsForTest } = await import('./use-events');

function ev(id: string, title: string): EventDoc {
  return { id, title, status: 'open', date: '2099/01/01 10:00~12:00' } as EventDoc;
}

function Probe({ uid = null }: { uid?: string | null }): preact.JSX.Element {
  const { events, loading, error } = useEvents(uid);
  return h('div', { 'data-testid': 'p' }, `${loading ? 'L' : '-'}${error ? 'E' : '-'}:${events.map((e) => e.title).join(',')}`);
}

describe('useEvents stale-first（照 A 先畫上次資料）', () => {
  beforeEach(() => {
    _resetUseEventsForTest();
    _clearEventsSnapshotForTest();
    loadEventsStatic.mockReset();
    repoEvents = [];
    repoFromCache = false;
    knownUid = null;
  });
  afterEach(() => cleanup());

  it('有本機快照時第一次畫面就顯示快照，不顯示載入中；伺服器回來後更新並寫回快照', async () => {
    writeEventsSnapshot(null, [ev('a', '舊資料')]);
    let resolve!: (v: string[]) => void;
    loadEventsStatic.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const view = render(h(Probe, null));
    expect(view.getByTestId('p').textContent).toBe('--:舊資料');

    // events-repo 是動態載入的，等它真的開始查詢才回應
    await waitFor(() => expect(loadEventsStatic).toHaveBeenCalled());
    repoEvents = [ev('b', '新資料')];
    resolve(['events']);
    await waitFor(() => expect(view.getByTestId('p').textContent).toBe('--:新資料'));
    expect(readEventsSnapshot(null)?.map((e) => e.title)).toEqual(['新資料']);
  });

  it('沒有快照時顯示載入中', () => {
    loadEventsStatic.mockImplementation(() => new Promise(() => undefined));
    const view = render(h(Probe, null));
    expect(view.getByTestId('p').textContent).toBe('L-:');
  });

  it('已有資料時更新失敗不顯示錯誤；沒有資料時才顯示錯誤', async () => {
    writeEventsSnapshot(null, [ev('a', '舊資料')]);
    loadEventsStatic.mockRejectedValueOnce(new Error('offline'));
    const view = render(h(Probe, null));
    await waitFor(() => expect(view.getByTestId('p').textContent).toBe('--:舊資料'));
    cleanup();

    _resetUseEventsForTest();
    _clearEventsSnapshotForTest();
    loadEventsStatic.mockRejectedValueOnce(new Error('offline'));
    const empty = render(h(Probe, null));
    await waitFor(() => expect(empty.getByTestId('p').textContent).toBe('-E:'));
  });

  it('快照超過 30 分鐘視為過期', () => {
    writeEventsSnapshot(null, [ev('a', '舊資料')], Date.now() - 31 * 60 * 1000);
    expect(readEventsSnapshot(null)).toBeNull();
  });

  it('別的帳號存的快照不使用；登入狀態未確定或 viewer 尚未載入成本人時也不使用', () => {
    loadEventsStatic.mockImplementation(() => new Promise(() => undefined));
    writeEventsSnapshot('U_A', [ev('a', 'A 的資料')]);

    knownUid = 'U_B';
    const other = render(h(Probe, { uid: 'U_B' }));
    expect(other.getByTestId('p').textContent).toBe('L-:');
    cleanup();

    knownUid = undefined;
    const unknown = render(h(Probe, { uid: 'U_A' }));
    expect(unknown.getByTestId('p').textContent).toBe('L-:');
    cleanup();

    knownUid = 'U_A';
    const guestFirst = render(h(Probe, { uid: null }));
    expect(guestFirst.getByTestId('p').textContent).toBe('L-:');
    guestFirst.rerender(h(Probe, { uid: 'U_A' }));
    expect(guestFirst.getByTestId('p').textContent).toBe('--:A 的資料');
  });

  it('onFresh 只在「確認向伺服器新取得」時呼叫（拿剛讀回的資料），顯示本機快照那份上次資料時不呼叫；它丟錯不影響列表', async () => {
    writeEventsSnapshot(null, [ev('a', '舊資料')]);
    let resolve!: (v: string[]) => void;
    loadEventsStatic.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const onFresh = vi.fn((_events: EventDoc[]) => {
      throw new Error('snapshot write failed');
    });
    function FreshProbe(): preact.JSX.Element {
      const { events } = useEvents(null, { onFresh });
      return h('div', { 'data-testid': 'p' }, events.map((e) => e.title).join(','));
    }

    const view = render(h(FreshProbe, null));
    expect(view.getByTestId('p').textContent).toBe('舊資料');
    expect(onFresh).not.toHaveBeenCalled();

    await waitFor(() => expect(loadEventsStatic).toHaveBeenCalled());
    repoEvents = [ev('b', '新資料')];
    resolve(['events']);
    await waitFor(() => expect(view.getByTestId('p').textContent).toBe('新資料'));
    expect(onFresh).toHaveBeenCalledTimes(1);
    expect(onFresh.mock.calls[0]?.[0]?.map((e) => e.title)).toEqual(['新資料']);
  });

  it('onFresh：空結果也算（確認目前沒有活動）；離線時的持久快取（fromCache=true）或讀不到旗標（undefined）都不呼叫，列表仍照常顯示', async () => {
    const onFresh = vi.fn();
    function FreshProbe(): preact.JSX.Element {
      const { events } = useEvents(null, { onFresh });
      return h('div', { 'data-testid': 'p' }, events.map((e) => e.title).join(','));
    }

    // 確認新取得、而且是空的
    loadEventsStatic.mockResolvedValue(['events']);
    repoEvents = [];
    const confirmedEmpty = render(h(FreshProbe, null));
    await waitFor(() => expect(onFresh).toHaveBeenCalledTimes(1));
    expect(onFresh).toHaveBeenLastCalledWith([]);
    expect(confirmedEmpty.getByTestId('p').textContent).toBe('');
    cleanup();

    for (const flag of [true, undefined] as const) {
      onFresh.mockClear();
      _resetUseEventsForTest();
      repoFromCache = flag;
      repoEvents = [ev('c', '快取資料')];
      const view = render(h(FreshProbe, null));
      await waitFor(() => expect(view.getByTestId('p').textContent).toBe('快取資料'));
      expect(onFresh).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('onFresh：畫面卸載後才回來的結果不呼叫；重試時只有現在這一輪呼叫、不重複呼叫', async () => {
    const onFresh = vi.fn();
    const pending: Array<(v: string[]) => void> = [];
    loadEventsStatic.mockImplementation(() => new Promise((r) => { pending.push(r); }));
    function FreshProbe(): preact.JSX.Element {
      const { events, retry } = useEvents(null, { onFresh });
      return h('button', { 'data-testid': 'p', onClick: retry }, events.map((e) => e.title).join(','));
    }

    // 卸載後才回來。完成訊號：另一個畫面（witness）共用同一個進行中的請求，它顯示出結果時，
    // 先登記的第一個畫面的處理一定已經跑過（同一個 Promise 的 then 依登記順序執行）。
    function Witness(): preact.JSX.Element {
      const { events } = useEvents(null);
      return h('div', { 'data-testid': 'witness' }, events.map((e) => e.title).join(','));
    }
    const first = render(h(FreshProbe, null));
    await waitFor(() => expect(pending).toHaveLength(1));
    first.unmount();
    cleanup();
    const witness = render(h(Witness, null));
    repoEvents = [ev('late', '卸載後才回來')];
    pending[0]?.(['events']);
    await waitFor(() => expect(witness.getByTestId('witness').textContent).toBe('卸載後才回來'));
    expect(onFresh).not.toHaveBeenCalled();
    cleanup();

    // 重試（新一輪）時舊一輪還沒回來：兩輪共用同一個進行中的請求，結果回來時只有「現在這一輪」呼叫 onFresh，不會呼叫兩次
    _resetUseEventsForTest();
    pending.length = 0;
    const second = render(h(FreshProbe, null));
    await waitFor(() => expect(pending).toHaveLength(1));
    second.getByTestId('p').click();
    repoEvents = [ev('new', '新一輪')];
    pending[0]?.(['events']);
    await waitFor(() => expect(onFresh).toHaveBeenCalledTimes(1));
    expect(onFresh.mock.calls[0]?.[0]?.map((e: EventDoc) => e.title)).toEqual(['新一輪']);
    // 舊一輪的處理先於新一輪登記，所以看到新一輪呼叫時，舊一輪若要呼叫早就呼叫過了：仍然只有一次
    expect(onFresh).toHaveBeenCalledTimes(1);
  });

  it('onFresh：被較新請求取代的呼叫（repo 回傳 []）不算新取得——即使共用的 snapshot 還留著上一次 fromCache=false 的旗標', async () => {
    const onFresh = vi.fn();
    function FreshProbe(): preact.JSX.Element {
      const { events } = useEvents(null, { onFresh });
      return h('div', { 'data-testid': 'p' }, events.map((e) => e.title).join(','));
    }
    // repo 上一次成功時留下的資料與旗標（fromCache=false）；這次呼叫被較新的請求取代，repo 回傳 []，沒有提交新資料
    repoEvents = [ev('prev', '上一次的資料')];
    repoFromCache = false;
    loadEventsStatic.mockResolvedValue([]);

    const view = render(h(FreshProbe, null));
    await waitFor(() => expect(view.getByTestId('p').textContent).toBe('上一次的資料'));
    expect(onFresh).not.toHaveBeenCalled();
  });

  it('超過大小上限不存', () => {
    const big = Array.from({ length: 2000 }, (_, i) => ({ ...ev(`e${i}`, 'x'.repeat(600)) }));
    writeEventsSnapshot(null, big);
    expect(readEventsSnapshot(null)).toBeNull();
  });
});
