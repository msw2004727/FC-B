import { cleanup, render, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _clearEventsSnapshotForTest, readEventsSnapshot, writeEventsSnapshot } from './events-snapshot-cache';
import type { EventDoc } from './types';

const loadEventsStatic = vi.fn<() => Promise<string[]>>();
let repoEvents: EventDoc[] = [];

let knownUid: string | null | undefined = null;
vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => knownUid }));

vi.mock('./events-repo', () => ({
  getEventsRepo: () => ({
    loadEventsStatic,
    getSnapshot: () => ({ active: [...repoEvents], terminal: [] }),
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

  it('超過大小上限不存', () => {
    const big = Array.from({ length: 2000 }, (_, i) => ({ ...ev(`e${i}`, 'x'.repeat(600)) }));
    writeEventsSnapshot(null, big);
    expect(readEventsSnapshot(null)).toBeNull();
  });
});
