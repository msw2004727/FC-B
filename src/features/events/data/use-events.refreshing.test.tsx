import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _clearEventsSnapshotForTest, writeEventsSnapshot } from './events-snapshot-cache';
import type { EventDoc } from './types';

// 站長 2026-11-22 方案一：useEvents 新增 refreshing（這一輪讀取還沒結束）。首頁用它顯示「更新中」；
// 既有欄位 events／loading／error 的語意完全不變（活動列表頁沿用）。

const loadEventsStatic = vi.fn<() => Promise<string[]>>();
let active: EventDoc[] = [];

vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => undefined }));
vi.mock('./events-repo', () => ({
  getEventsRepo: () => ({
    loadEventsStatic,
    getSnapshot: () => ({ active, terminal: [], activeFromCache: false }),
  }),
}));

const { useEvents, _resetUseEventsForTest } = await import('./use-events');

function ev(id: string, title: string): EventDoc {
  return { id, title, status: 'open', date: '2099/06/01 10:00~12:00' };
}

/** 輸出：L＝loading、E＝error、R＝refreshing，再接畫面上的活動標題。 */
function Probe({ mode }: { mode?: 'none' | 'preview' }): preact.JSX.Element {
  const { events, loading, error, refreshing } = useEvents(null, mode ? { terminalMode: mode } : {});
  return h(
    'div',
    { 'data-testid': 'p' },
    `${loading ? 'L' : '-'}${error ? 'E' : '-'}${refreshing ? 'R' : '-'}:${events.map((e) => e.title).join('|')}`,
  );
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useEvents.refreshing：讀取中為真、結束後為假；既有欄位不受影響', () => {
  beforeEach(() => {
    _resetUseEventsForTest();
    _clearEventsSnapshotForTest();
    loadEventsStatic.mockReset();
    active = [];
  });

  afterEach(() => cleanup());

  for (const mode of ['none', 'preview'] as const) {
    it(`${mode}：有上次資料先畫時 loading 仍為假（不變），refreshing 為真；新資料到了 refreshing 變假`, async () => {
      writeEventsSnapshot(null, [ev('old', '上次的場')]);
      const pending = deferred<string[]>();
      loadEventsStatic.mockReturnValue(pending.promise);
      active = [ev('new', '新的場')];

      const view = render(h(Probe, { mode }));
      expect(view.getByTestId('p').textContent).toBe('--R:上次的場');

      await act(async () => {
        pending.resolve(['events']);
      });
      await waitFor(() => expect(view.getByTestId('p').textContent).toBe('---:新的場'));
    });
  }

  it('沒有任何上次資料：loading 與 refreshing 都為真；讀取失敗後 error 為真、兩者都變假', async () => {
    const pending = deferred<string[]>();
    loadEventsStatic.mockReturnValue(pending.promise);

    const view = render(h(Probe, { mode: undefined }));
    expect(view.getByTestId('p').textContent).toBe('L-R:');

    await act(async () => {
      pending.reject(new Error('offline'));
      await pending.promise.catch(() => undefined);
    });
    await waitFor(() => expect(view.getByTestId('p').textContent).toBe('-E-:'));
  });

  it('有上次資料、讀取失敗：照舊不報錯、保留上次資料，refreshing 變假', async () => {
    writeEventsSnapshot(null, [ev('old', '上次的場')]);
    const pending = deferred<string[]>();
    loadEventsStatic.mockReturnValue(pending.promise);

    const view = render(h(Probe, { mode: 'none' }));
    expect(view.getByTestId('p').textContent).toBe('--R:上次的場');

    await act(async () => {
      pending.reject(new Error('offline'));
      await pending.promise.catch(() => undefined);
    });
    await waitFor(() => expect(view.getByTestId('p').textContent).toBe('---:上次的場'));
  });
});
