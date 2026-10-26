import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emit } from '@/core/events';
import {
  _resetFirebaseForTest,
  armFirebaseAuthHold,
  whenFirebaseAuthAllowed,
} from '@/data/firebase';
import { _clearEventsSnapshotForTest, readEventsSnapshot } from './events-snapshot-cache';
import type { EventDoc } from './types';

// T-041：首頁的公開讀取不等 Auth，網路資料可能比「登入帳號確認」更早回來。
// - 畫面照常用網路資料（公開資料）；
// - 寫入記憶體快取與本機快照要等登入帳號確定、且與畫面使用者相同（Fable 2026-10-19 的跨帳號守門不放寬）；
// - 讀取會登記給 Auth 暫緩機制，處理完才放行 Auth。

const loadEventsStatic = vi.fn<(options?: { terminalMode?: string }) => Promise<string[]>>();
let repoEvents: EventDoc[] = [];
let knownUid: string | null | undefined;

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

function Probe({ uid }: { uid: string | null }): preact.JSX.Element {
  const { events } = useEvents(uid, { terminalMode: 'none' });
  return h('div', { 'data-testid': 'p' }, events.map((e) => e.title).join(','));
}

beforeEach(() => {
  _resetUseEventsForTest();
  _clearEventsSnapshotForTest();
  _resetFirebaseForTest();
  loadEventsStatic.mockReset();
  loadEventsStatic.mockResolvedValue(['events']);
  repoEvents = [ev('a', '公開活動')];
  knownUid = undefined; // 登入狀態尚未確定
});

afterEach(() => {
  cleanup();
  _resetFirebaseForTest();
});

describe('網路資料早於登入確認回來', () => {
  it('畫面照常顯示網路資料，但登入帳號確定前不寫快照', async () => {
    const view = render(h(Probe, { uid: null }));
    await waitFor(() => expect(view.container.textContent).toBe('公開活動'));
    expect(readEventsSnapshot(null)).toBeNull();
    expect(readEventsSnapshot('U1')).toBeNull();
  });

  it('確認是訪客後補寫：快照掛在 guest 底下', async () => {
    const view = render(h(Probe, { uid: null }));
    await waitFor(() => expect(view.container.textContent).toBe('公開活動'));

    knownUid = null;
    await act(async () => {
      emit('auth:changed', { uid: null });
    });
    expect(readEventsSnapshot(null)?.map((e) => e.title)).toEqual(['公開活動']);
  });

  it('登入者：auth 先確定、viewer 還是訪客時不寫；viewer 換成同一帳號後才補寫', async () => {
    const view = render(h(Probe, { uid: null }));
    await waitFor(() => expect(view.container.textContent).toBe('公開活動'));

    knownUid = 'U1';
    await act(async () => {
      emit('auth:changed', { uid: 'U1' });
    });
    // viewer 還沒載成 U1：不能把快照掛在 U1 或訪客底下
    expect(readEventsSnapshot('U1')).toBeNull();
    expect(readEventsSnapshot(null)).toBeNull();

    view.rerender(h(Probe, { uid: 'U1' }));
    await waitFor(() => expect(readEventsSnapshot('U1')?.map((e) => e.title)).toEqual(['公開活動']));
    expect(readEventsSnapshot(null)).toBeNull();
  });

  it('跨帳號守門不放寬：確認的帳號與畫面使用者不同時，永遠不寫', async () => {
    const view = render(h(Probe, { uid: 'U1' }));
    await waitFor(() => expect(view.container.textContent).toBe('公開活動'));

    knownUid = 'U2';
    await act(async () => {
      emit('auth:changed', { uid: 'U2' });
    });
    expect(readEventsSnapshot('U1')).toBeNull();
    expect(readEventsSnapshot('U2')).toBeNull();
  });

  it('資料回來時登入帳號已確定且相同：照舊立即寫快照（行為不變）', async () => {
    knownUid = 'U1';
    const view = render(h(Probe, { uid: 'U1' }));
    await waitFor(() => expect(view.container.textContent).toBe('公開活動'));
    expect(readEventsSnapshot('U1')?.map((e) => e.title)).toEqual(['公開活動']);
  });
});

describe('登記給 Auth 暫緩機制', () => {
  it('活動讀取處理完（成功）後才放行 Auth', async () => {
    armFirebaseAuthHold({ settleMs: 5, capMs: 60_000 });
    let finish!: (v: string[]) => void;
    loadEventsStatic.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let allowed = false;
    void whenFirebaseAuthAllowed().then(() => { allowed = true; });

    render(h(Probe, { uid: null }));
    await waitFor(() => expect(loadEventsStatic).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(allowed).toBe(false);

    finish(['events']);
    await waitFor(() => expect(allowed).toBe(true));
  });

  it('活動讀取失敗也放行 Auth（不會卡住登入還原）', async () => {
    armFirebaseAuthHold({ settleMs: 5, capMs: 60_000 });
    loadEventsStatic.mockRejectedValue(new Error('offline'));
    let allowed = false;
    void whenFirebaseAuthAllowed().then(() => { allowed = true; });

    render(h(Probe, { uid: null }));
    await waitFor(() => expect(allowed).toBe(true));
  });
});
