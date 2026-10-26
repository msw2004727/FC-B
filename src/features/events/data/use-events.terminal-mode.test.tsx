import { cleanup, render, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _clearEventsSnapshotForTest } from './events-snapshot-cache';
import type { EventDoc } from './types';

// A4①：首頁用 terminalMode 'none'（不載 ended／cancelled 預覽），活動列表維持 'preview'（R-EVT-002／003）。
const loadEventsStatic = vi.fn<(options?: { terminalMode?: string }) => Promise<string[]>>();
let active: EventDoc[] = [];
let terminal: EventDoc[] = [];

vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => null }));
vi.mock('./events-repo', () => ({
  getEventsRepo: () => ({
    loadEventsStatic,
    getSnapshot: () => ({ active: [...active], terminal: [...terminal] }),
  }),
}));

const { useEvents, _resetUseEventsForTest } = await import('./use-events');
import type { UseEventsOptions } from './use-events';

function ev(id: string, title: string, status = 'open'): EventDoc {
  return { id, title, status, date: '2099/01/01 10:00~12:00' } as EventDoc;
}

function Probe({ options }: { options?: UseEventsOptions }): preact.JSX.Element {
  const { events, loading } = useEvents(null, options);
  return h('div', { 'data-testid': 'p' }, `${loading ? 'L' : '-'}:${events.map((e) => e.title).join(',')}`);
}

/** events-repo 是動態載入的：讓排隊中的載入與 microtask 跑完，再檢查「沒有多發請求」。 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

function deferred(): { promise: Promise<string[]>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<string[]>((res, rej) => {
    resolve = () => res(['events']);
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useEvents terminalMode', () => {
  beforeEach(() => {
    _resetUseEventsForTest();
    _clearEventsSnapshotForTest();
    loadEventsStatic.mockReset();
    active = [ev('a1', '進行中')];
    terminal = [];
  });
  afterEach(() => cleanup());

  it("預設（活動列表等頁）仍要求 terminalMode: 'preview'", async () => {
    loadEventsStatic.mockResolvedValue(['events']);
    const view = render(h(Probe, null));
    await waitFor(() => expect(view.getByTestId('p').textContent).toBe('-:進行中'));
    expect(loadEventsStatic).toHaveBeenCalledTimes(1);
    expect(loadEventsStatic).toHaveBeenCalledWith({ terminalMode: 'preview' });
  });

  it("首頁傳 { terminalMode: 'none' } 時不載 terminal", async () => {
    loadEventsStatic.mockResolvedValue(['events']);
    const view = render(h(Probe, { options: { terminalMode: 'none' } }));
    await waitFor(() => expect(view.getByTestId('p').textContent).toBe('-:進行中'));
    expect(loadEventsStatic).toHaveBeenCalledTimes(1);
    expect(loadEventsStatic).toHaveBeenCalledWith({ terminalMode: 'none' });
  });

  it('none 進行中又有 none：共用同一個請求', async () => {
    const d = deferred();
    loadEventsStatic.mockReturnValue(d.promise);
    render(h(Probe, { options: { terminalMode: 'none' } }));
    render(h(Probe, { options: { terminalMode: 'none' } }));
    await waitFor(() => expect(loadEventsStatic).toHaveBeenCalled());
    await settle();
    expect(loadEventsStatic).toHaveBeenCalledTimes(1);
    d.resolve();
  });

  it('preview 進行中又有 none：共用 preview 的請求（超集）', async () => {
    const d = deferred();
    loadEventsStatic.mockReturnValue(d.promise);
    render(h(Probe, null));
    render(h(Probe, { options: { terminalMode: 'none' } }));
    await waitFor(() => expect(loadEventsStatic).toHaveBeenCalled());
    await settle();
    expect(loadEventsStatic).toHaveBeenCalledTimes(1);
    expect(loadEventsStatic).toHaveBeenCalledWith({ terminalMode: 'preview' });
    d.resolve();
  });

  it('none 進行中，活動列表要 preview：等 none 完成後才補載 terminal，兩者不並行', async () => {
    const first = deferred();
    const second = deferred();
    loadEventsStatic.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    render(h(Probe, { options: { terminalMode: 'none' } }));
    const list = render(h(Probe, null));
    await waitFor(() => expect(loadEventsStatic).toHaveBeenCalled());
    await settle();
    expect(loadEventsStatic).toHaveBeenCalledTimes(1);
    expect(loadEventsStatic).toHaveBeenLastCalledWith({ terminalMode: 'none' });

    first.resolve();
    await waitFor(() => expect(loadEventsStatic).toHaveBeenCalledTimes(2));
    expect(loadEventsStatic).toHaveBeenLastCalledWith({ terminalMode: 'preview' });

    terminal = [ev('t1', '剛結束', 'ended')];
    second.resolve();
    await waitFor(() => expect(list.container.textContent).toBe('-:進行中,剛結束'));
  });

  it('none 失敗後清除進行中請求，下一次可重試（L-08）', async () => {
    const bad = deferred();
    loadEventsStatic.mockReturnValueOnce(bad.promise);
    const first = render(h(Probe, { options: { terminalMode: 'none' } }));
    bad.reject(new Error('offline'));
    await waitFor(() => expect(first.getByTestId('p').textContent).toBe('-:'));
    cleanup();

    loadEventsStatic.mockResolvedValueOnce(['events']);
    const retry = render(h(Probe, { options: { terminalMode: 'none' } }));
    await waitFor(() => expect(retry.getByTestId('p').textContent).toBe('-:進行中'));
    expect(loadEventsStatic).toHaveBeenCalledTimes(2);
  });
});
