/**
 * 移植自 tests/unit/activity-terminal-events-loading.test.js 的可移植行為案例。
 *
 * 略過清單（並說明原因）：
 *   - 'front activity page removes ended tab but keeps fallback normalization'（僅讀原始碼字串）
 *   - 'FirebaseService keeps a small terminal preview ...'（比對原始碼字串及 _myActivityPageSize 等字串）
 *   - 任何 `readProjectFile(...)` 字串 contains 檢查：B 以 mock Firestore 驗證實際查詢參數 / 分頁 / 序號，
 *     不以原始碼字串代替行為。
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({
    db: { kind: 'fake-db' },
    app: {},
    auth: {},
    functions: {},
  })),
}));

vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn((_db: unknown, path: string) => ({ kind: 'collection', path })),
    collectionGroup: vi.fn((_db: unknown, id: string) => ({ kind: 'collectionGroup', id })),
    query: vi.fn((base: unknown, ...constraints: unknown[]) => ({ kind: 'query', base, constraints })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value })),
    orderBy: vi.fn((field: string, direction: 'asc' | 'desc') => ({ kind: 'orderBy', field, direction })),
    limit: vi.fn((n: number) => ({ kind: 'limit', n })),
    startAfter: vi.fn((cursor: unknown) => ({ kind: 'startAfter', cursor })),
    getDocs: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
  };
});

import {
  getDocs,
  limit,
  orderBy,
  startAfter,
  where,
} from 'firebase/firestore';
import {
  ACTIVE_EVENTS_LIMIT,
  ACTIVE_EVENT_STATUSES,
  TERMINAL_EVENT_STATUSES,
  TERMINAL_HISTORY_LIMIT,
  TERMINAL_PREVIEW_LIMIT,
  createEventsRepo,
} from './events-repo';

type FakeDoc = { id: string; data: () => Record<string, unknown>; ref: { id: string } };
type FakeSnap = { docs: FakeDoc[] };

function makeDoc(id: string, data: Record<string, unknown> = {}): FakeDoc {
  return { id, data: () => data, ref: { id } };
}

function makeSnap(docs: FakeDoc[]): FakeSnap {
  return { docs };
}

const mockedGetDocs = vi.mocked(getDocs);
const mockedWhere = vi.mocked(where);
const mockedLimit = vi.mocked(limit);
const mockedOrderBy = vi.mocked(orderBy);
const mockedStartAfter = vi.mocked(startAfter);

function makeRepo() {
  return createEventsRepo({
    getFirebase: async () => ({ db: {} as never }),
    logger: { warn: () => {}, error: () => {} },
  });
}

function defer<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createEventsRepo — active events', () => {
  beforeEach(() => vi.clearAllMocks());

  test('loadEventsStatic queries active events with status in [open,full,upcoming] and limit 200', async () => {
    mockedGetDocs
      .mockResolvedValueOnce(makeSnap([]) as never)
      .mockResolvedValueOnce(makeSnap([]) as never);

    const repo = makeRepo();
    await repo.loadEventsStatic();

    expect(mockedWhere).toHaveBeenCalledWith('status', 'in', [...ACTIVE_EVENT_STATUSES]);
    expect(mockedLimit).toHaveBeenCalledWith(ACTIVE_EVENTS_LIMIT);
  });

  test('loadEventsStatic stores active docs from snapshot', async () => {
    mockedGetDocs
      .mockResolvedValueOnce(makeSnap([makeDoc('a1', { status: 'open' }), makeDoc('a2', { status: 'full' })]) as never)
      .mockResolvedValueOnce(makeSnap([]) as never);

    const repo = makeRepo();
    await repo.loadEventsStatic();
    const snap = repo.getSnapshot();
    expect(snap.active.map((e) => e._docId)).toEqual(['a1', 'a2']);
  });
});

describe('createEventsRepo — terminal events (preview / history)', () => {
  beforeEach(() => vi.clearAllMocks());

  test('preview mode queries terminal events with orderBy(date,desc) and limit 50', async () => {
    mockedGetDocs
      .mockResolvedValueOnce(makeSnap([]) as never) // active
      .mockResolvedValueOnce(makeSnap([]) as never); // terminal

    const repo = makeRepo();
    await repo.loadEventsStatic({ terminalMode: 'preview' });

    expect(mockedWhere).toHaveBeenCalledWith('status', 'in', [...TERMINAL_EVENT_STATUSES]);
    expect(mockedOrderBy).toHaveBeenCalledWith('date', 'desc');
    expect(mockedLimit).toHaveBeenCalledWith(TERMINAL_PREVIEW_LIMIT);
    expect(TERMINAL_PREVIEW_LIMIT).toBe(50);
  });

  test('history mode queries terminal events with limit 10', async () => {
    mockedGetDocs
      .mockResolvedValueOnce(makeSnap([]) as never)
      .mockResolvedValueOnce(makeSnap([]) as never);

    const repo = makeRepo();
    await repo.loadEventsStatic({ terminalMode: 'history' });

    expect(mockedLimit).toHaveBeenCalledWith(TERMINAL_HISTORY_LIMIT);
    expect(TERMINAL_HISTORY_LIMIT).toBe(10);
  });

  test('terminal event ordered-result failure falls back to un-ordered query with min(limit,100)', async () => {
    // active ok；terminal ordered 失敗；terminal fallback 成功
    mockedGetDocs
      .mockResolvedValueOnce(makeSnap([]) as never) // active
      .mockRejectedValueOnce(new Error('index missing') as never) // terminal:recent
      .mockResolvedValueOnce(makeSnap([]) as never); // terminal:fallback

    const repo = makeRepo();
    await repo.loadEventsStatic({ terminalMode: 'history' });

    const limits = mockedLimit.mock.calls.map((c) => c[0]);
    // 最後一次 limit 應為 min(10, 100) = 10
    expect(limits[limits.length - 1]).toBe(10);
  });

  test('ensureTerminalEventsLoaded preview/history are idempotent unless forced', async () => {
    mockedGetDocs
      .mockResolvedValueOnce(makeSnap([]) as never)
      .mockResolvedValueOnce(makeSnap([]) as never);

    const repo = makeRepo();
    await repo.loadEventsStatic({ terminalMode: 'preview' });
    const before = mockedGetDocs.mock.calls.length;

    await repo.ensureTerminalEventsLoaded({ mode: 'preview' });
    expect(mockedGetDocs.mock.calls.length).toBe(before);

    await repo.ensureTerminalEventsLoaded({ mode: 'history', force: true });
    expect(mockedGetDocs.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('createEventsRepo — loadMoreTerminalEvents', () => {
  beforeEach(() => vi.clearAllMocks());

  test('uses startAfter cursor and current page size', async () => {
    const previewDocs = Array.from({ length: TERMINAL_PREVIEW_LIMIT }, (_, i) =>
      makeDoc(`t${i}`, { status: 'ended' }),
    );
    mockedGetDocs
      .mockResolvedValueOnce(makeSnap([]) as never) // active
      .mockResolvedValueOnce(makeSnap(previewDocs) as never) // terminal preview
      .mockResolvedValueOnce(makeSnap([]) as never); // loadMore

    const repo = makeRepo();
    await repo.loadEventsStatic({ terminalMode: 'preview' });
    const count = await repo.loadMoreTerminalEvents();

    expect(count).toBe(0);
    expect(mockedStartAfter).toHaveBeenCalledTimes(1);
    const lastDoc = previewDocs[previewDocs.length - 1];
    expect(mockedStartAfter).toHaveBeenCalledWith(lastDoc);
    const limits = mockedLimit.mock.calls.map((c) => c[0]);
    expect(limits[limits.length - 1]).toBe(TERMINAL_PREVIEW_LIMIT);
  });

  test('appends docs and marks terminalAllLoaded when page not full', async () => {
    const previewDocs = Array.from({ length: TERMINAL_PREVIEW_LIMIT }, (_, i) =>
      makeDoc(`t${i}`, { status: 'ended' }),
    );
    const moreDocs = [makeDoc('t-extra-1', { status: 'ended' })];
    mockedGetDocs
      .mockResolvedValueOnce(makeSnap([]) as never)
      .mockResolvedValueOnce(makeSnap(previewDocs) as never)
      .mockResolvedValueOnce(makeSnap(moreDocs) as never);

    const repo = makeRepo();
    await repo.loadEventsStatic({ terminalMode: 'preview' });
    const count = await repo.loadMoreTerminalEvents();

    expect(count).toBe(1);
    const snap = repo.getSnapshot();
    expect(snap.terminal.map((e) => e._docId)).toContain('t-extra-1');
  });
});

describe('createEventsRepo — request sequence (L-02)', () => {
  beforeEach(() => vi.clearAllMocks());

  test('stale loadEventsStatic responses are discarded', async () => {
    const d1Active = defer<FakeSnap>();
    const d1Terminal = defer<FakeSnap>();
    const d2Active = defer<FakeSnap>();
    const d2Terminal = defer<FakeSnap>();

    let call = 0;
    mockedGetDocs.mockImplementation((() => {
      call += 1;
      if (call === 1) return d1Active.promise as never;
      if (call === 2) return d1Terminal.promise as never;
      if (call === 3) return d2Active.promise as never;
      if (call === 4) return d2Terminal.promise as never;
      return Promise.resolve(makeSnap([])) as never;
    }) as never);

    const repo = makeRepo();
    const p1 = repo.loadEventsStatic();
    const p2 = repo.loadEventsStatic();

    // p2 先完成
    d2Active.resolve(makeSnap([makeDoc('new-a', { status: 'open' })]));
    d2Terminal.resolve(makeSnap([]));
    await p2;
    // p1 後完成，應被丟棄
    d1Active.resolve(makeSnap([makeDoc('old-a', { status: 'open' })]));
    d1Terminal.resolve(makeSnap([]));
    await p1;

    expect(repo.getSnapshot().active.map((e) => e._docId)).toEqual(['new-a']);
  });
});
