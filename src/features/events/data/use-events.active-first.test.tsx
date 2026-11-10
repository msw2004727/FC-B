import { cleanup, render, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDocs } from 'firebase/firestore';
import { ACTIVE_LIST_REUSE_TTL_MS, getEventsRepo } from './events-repo';
import { _clearEventsSnapshotForTest } from './events-snapshot-cache';
import type { EventDoc, ViewerContext } from './types';
import { getVisibleEvents } from './visibility';

// SPEED-1-4：列表先畫 active、terminal 後補；首頁結果短 TTL 給列表沿用。
// 用真實 events-repo（只換 Firestore 的 getDocs）。

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ kind: 'collection', path })),
  collectionGroup: vi.fn(),
  query: vi.fn((base: unknown, ...constraints: unknown[]) => ({ base, constraints })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  orderBy: vi.fn((field: string, direction: string) => ({ field, direction })),
  limit: vi.fn((n: number) => ({ n })),
  startAfter: vi.fn((cursor: unknown) => ({ cursor })),
  getDocs: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock('@/data/firebase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/firebase')>()),
  getFirebase: vi.fn(async () => ({ db: {} })),
  getFirebaseCore: vi.fn(async () => ({ db: {} })),
}));

vi.mock('@/data/auth', () => ({ getLastKnownAuthUid: () => null }));

const { useEvents, _resetUseEventsForTest } = await import('./use-events');

const realNow = Date.now;
let extra = 0;

function doc(id: string, data: Record<string, unknown>) {
  return { id, data: () => ({ id, ...data }), ref: { id } };
}

function snap(rows: ReturnType<typeof doc>[]) {
  return { docs: rows, metadata: { fromCache: false } };
}

function statusesOf(call: unknown[]): unknown {
  const queryArg = call[0] as { constraints?: Array<{ field?: string; value?: unknown }> };
  return queryArg?.constraints?.find((item) => item.field === 'status')?.value;
}

function isActiveQuery(call: unknown[]): boolean {
  const value = statusesOf(call);
  return Array.isArray(value) && value.includes('open');
}

const viewer: ViewerContext = {
  uid: 'U1',
  teamIds: new Set<string>(),
  hasPermission: () => false,
  roleLevel: 0,
};
const guest: ViewerContext = { ...viewer, uid: null };

function Probe({
  mode = 'preview',
  onFresh,
}: {
  mode?: 'preview' | 'none';
  onFresh?: (events: EventDoc[]) => void;
}): preact.JSX.Element {
  const { events, loading, error, retry } = useEvents(null, { terminalMode: mode, onFresh });
  return h('button', {
    'data-testid': 'p',
    'data-loading': loading ? '1' : '0',
    'data-error': error ? '1' : '0',
    onClick: retry,
  }, events.map((event) => event.title).join(','));
}

describe('useEvents 先畫 active、短 TTL 沿用（SPEED-1-4）', () => {
  beforeEach(async () => {
    extra += ACTIVE_LIST_REUSE_TTL_MS + 5;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + extra);
    _resetUseEventsForTest();
    _clearEventsSnapshotForTest();
    vi.mocked(getDocs).mockReset();
    // repo 是單例：清掉上一則測試留下的 active／terminal，再把這次清空的時間推過 TTL，
    // 測試本體的第一次讀取才會真的查 active。
    vi.mocked(getDocs).mockResolvedValue(snap([]) as never);
    await getEventsRepo().loadEventsStatic({ terminalMode: 'preview', forceTerminalRefresh: true });
    extra += ACTIVE_LIST_REUSE_TTL_MS;
    vi.mocked(getDocs).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.mocked(Date.now).mockRestore();
  });

  it('active 先畫且依開始時間排序；terminal 後補後排序不變（不是 active 全部排在前面）', async () => {
    let releaseTerminal!: (value: unknown) => void;
    const terminalGate = new Promise((resolve) => { releaseTerminal = resolve; });
    vi.mocked(getDocs).mockImplementation((queryArg: unknown) => {
      if (isActiveQuery([queryArg])) {
        return Promise.resolve(snap([
          doc('late', { title: '三月', status: 'open', date: '2099/03/01 10:00~12:00' }),
          doc('early', { title: '一月', status: 'open', date: '2099/01/01 10:00~12:00' }),
        ])) as never;
      }
      return terminalGate as never;
    });

    const view = render(h(Probe, null));
    await waitFor(() => expect(view.getByTestId('p').textContent).toBe('一月,三月'));
    expect(view.getByTestId('p').getAttribute('data-loading')).toBe('0');
    expect(view.getByTestId('p').getAttribute('data-error')).toBe('0');

    releaseTerminal(snap([
      doc('mid', { title: '二月', status: 'ended', date: '2099/02/01 10:00~12:00' }),
    ]));
    await waitFor(() => expect(view.getByTestId('p').textContent).toBe('一月,二月,三月'));
    expect(view.getByTestId('p').getAttribute('data-error')).toBe('0');
  });

  it('terminal 失敗不整頁報錯：有 active 就畫 active；active 為空也不進錯誤態', async () => {
    vi.mocked(getDocs).mockImplementation((queryArg: unknown) => {
      if (isActiveQuery([queryArg])) {
        return Promise.resolve(snap([
          doc('a', { title: 'S14-進行中', status: 'open', date: '2099/04/01 10:00~12:00' }),
        ])) as never;
      }
      return Promise.reject(new Error('terminal down')) as never;
    });

    const failed = render(h(Probe, null));
    await waitFor(() => expect(failed.getByTestId('p').textContent).toContain('S14-進行中'));
    expect(failed.getByTestId('p').getAttribute('data-error')).toBe('0');
    expect(failed.getByTestId('p').getAttribute('data-loading')).toBe('0');
    cleanup();

    _resetUseEventsForTest();
    vi.mocked(getDocs).mockImplementation((queryArg: unknown) => {
      if (isActiveQuery([queryArg])) return Promise.resolve(snap([])) as never;
      return Promise.reject(new Error('terminal down')) as never;
    });
    const empty = render(h(Probe, null));
    await waitFor(() => expect(empty.getByTestId('p').getAttribute('data-loading')).toBe('0'));
    expect(empty.getByTestId('p').getAttribute('data-error')).toBe('0');
  });

  it('terminal 失敗後手動重新整理仍會再讀（L-08）', async () => {
    let failTerminal = true;
    vi.mocked(getDocs).mockImplementation((queryArg: unknown) => {
      if (isActiveQuery([queryArg])) {
        return Promise.resolve(snap([
          doc('a', { title: 'S14-進行中', status: 'open', date: '2099/04/01 10:00~12:00' }),
        ])) as never;
      }
      if (failTerminal) return Promise.reject(new Error('terminal down')) as never;
      return Promise.resolve(snap([
        doc('t', { title: 'S14-剛結束', status: 'ended', date: '2099/03/01 10:00~12:00' }),
      ])) as never;
    });

    const view = render(h(Probe, null));
    await waitFor(() => expect(view.getByTestId('p').textContent).toContain('S14-進行中'));
    const readsBeforeRetry = vi.mocked(getDocs).mock.calls.length;
    failTerminal = false;
    view.getByTestId('p').click();
    await waitFor(() => expect(view.getByTestId('p').textContent).toBe('S14-剛結束,S14-進行中'));
    expect(vi.mocked(getDocs).mock.calls.length).toBeGreaterThan(readsBeforeRetry);
    expect(vi.mocked(getDocs).mock.calls.slice(readsBeforeRetry).some((call) => isActiveQuery(call))).toBe(true);
  });

  it('首頁結果在 TTL 內給列表沿用（不再讀 active）；到期與手動重新整理會再讀；黑名單欄位保留', async () => {
    const onFresh = vi.fn();
    let activeTitle = '公開活動';
    vi.mocked(getDocs).mockImplementation((queryArg: unknown) => {
      if (isActiveQuery([queryArg])) {
        return Promise.resolve(snap([
          doc('secret', {
            title: activeTitle,
            status: 'open',
            date: '2099/06/01 10:00~12:00',
            blockedUids: ['U1'],
          }),
        ])) as never;
      }
      return Promise.resolve(snap([
        doc('ended-doc', { title: '剛結束', status: 'ended', date: '2099/01/15 10:00~12:00' }),
      ])) as never;
    });

    const home = render(h(Probe, { mode: 'none', onFresh }));
    await waitFor(() => expect(home.getByTestId('p').textContent).toBe('公開活動'));
    expect(onFresh).toHaveBeenCalledTimes(1);
    const activeReadsAfterHome = vi.mocked(getDocs).mock.calls.filter((call) => isActiveQuery(call)).length;
    expect(activeReadsAfterHome).toBe(1);
    cleanup();

    _resetUseEventsForTest();
    let shown: EventDoc[] = [];
    function ListProbe(): preact.JSX.Element {
      const data = useEvents(null, { onFresh });
      shown = data.events;
      return h('button', {
        'data-testid': 'p',
        'data-error': data.error ? '1' : '0',
        onClick: data.retry,
      }, data.events.map((event) => event.title).join(','));
    }
    const list = render(h(ListProbe, null));
    await waitFor(() => expect(list.getByTestId('p').textContent).toBe('剛結束,公開活動'));
    expect(vi.mocked(getDocs).mock.calls.filter((call) => isActiveQuery(call)).length).toBe(activeReadsAfterHome);
    expect(onFresh).toHaveBeenCalledTimes(1);
    expect(list.getByTestId('p').getAttribute('data-error')).toBe('0');

    const blocked = shown.find((event) => event.id === 'secret');
    expect(blocked?.blockedUids).toEqual(['U1']);
    expect(getVisibleEvents(shown, viewer, []).map((event) => event.id)).toEqual(['ended-doc']);
    expect(getVisibleEvents(shown, guest, []).map((event) => event.id).sort()).toEqual(['ended-doc', 'secret']);

    activeTitle = '重新整理後';
    list.getByTestId('p').click();
    await waitFor(() => expect(list.getByTestId('p').textContent).toBe('剛結束,重新整理後'));
    expect(vi.mocked(getDocs).mock.calls.filter((call) => isActiveQuery(call)).length).toBe(activeReadsAfterHome + 1);

    extra += ACTIVE_LIST_REUSE_TTL_MS;
    cleanup();
    _resetUseEventsForTest();
    activeTitle = 'TTL 過期';
    const expired = render(h(Probe, null));
    await waitFor(() => expect(expired.getByTestId('p').textContent).toBe('剛結束,TTL 過期'));
    expect(vi.mocked(getDocs).mock.calls.filter((call) => isActiveQuery(call)).length).toBe(activeReadsAfterHome + 2);
  });
});
