import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: {} })),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ kind: 'collection', path })),
  collectionGroup: vi.fn((_db: unknown, id: string) => ({ kind: 'collectionGroup', id })),
  query: vi.fn((base: unknown, ...constraints: unknown[]) => ({ base, constraints })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  orderBy: vi.fn((field: string, direction: string) => ({ field, direction })),
  limit: vi.fn((n: number) => ({ n })),
  startAfter: vi.fn((cursor: unknown) => ({ cursor })),
  getDocs: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

import { getDocs, limit, orderBy, startAfter, where } from 'firebase/firestore';
import {
  ACTIVE_EVENTS_LIMIT,
  ACTIVE_EVENT_STATUSES,
  TERMINAL_EVENT_STATUSES,
  TERMINAL_HISTORY_LIMIT,
  TERMINAL_PREVIEW_LIMIT,
  EventsLoadError,
  createEventsRepo,
} from './events-repo';

type FakeDoc = {
  id: string;
  data: () => Record<string, unknown>;
  ref: { id: string };
};
type FakeSnap = { docs: FakeDoc[] };

function makeDoc(id: string, data: Record<string, unknown> = {}): FakeDoc {
  return { id, data: () => data, ref: { id } };
}

function snap(docs: FakeDoc[] = []): FakeSnap {
  return { docs };
}

function defer<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function makeRepo() {
  return createEventsRepo({
    getFirebase: async () => ({ db: {} as never }),
    logger: { warn: vi.fn(), error: vi.fn() },
  });
}

const docs = vi.mocked(getDocs);

beforeEach(() => {
  vi.resetAllMocks();
  docs.mockResolvedValue(snap() as never);
});

describe('active events', () => {
  test('queries active statuses with limit 200 and stores document IDs', async () => {
    docs.mockResolvedValueOnce(snap([
      makeDoc('a1', { id: 'public-a1', status: 'open' }),
      makeDoc('a2', { status: 'full' }),
    ]) as never);
    const repo = makeRepo();
    await expect(repo.loadEventsStatic()).resolves.toEqual(['events']);
    expect(where).toHaveBeenCalledWith('status', 'in', [...ACTIVE_EVENT_STATUSES]);
    expect(limit).toHaveBeenCalledWith(ACTIVE_EVENTS_LIMIT);
    expect(repo.getSnapshot().active.map((event) => event._docId)).toEqual(['a1', 'a2']);
    expect(repo.getSnapshot().active[0]?.id).toBe('public-a1');
  });

  test('none mode skips terminal and rejects active failure, then retries', async () => {
    docs
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(snap([makeDoc('a')]) as never);
    const repo = makeRepo();
    await expect(repo.loadEventsStatic({ terminalMode: 'none' }))
      .rejects.toMatchObject({ activeFailed: true, terminalFailed: false });
    expect(docs).toHaveBeenCalledTimes(1);
    await expect(repo.loadEventsStatic({ terminalMode: 'none' }))
      .resolves.toEqual(['events']);
    expect(docs).toHaveBeenCalledTimes(2);
    expect(repo.getSnapshot().active[0]?._docId).toBe('a');
  });

  test('failed active refresh retains the preceding active snapshot', async () => {
    const repo = makeRepo();
    docs.mockResolvedValueOnce(snap([makeDoc('saved')]) as never);
    await repo.loadEventsStatic({ terminalMode: 'none' });

    docs.mockRejectedValueOnce(new Error('network'));
    await expect(repo.loadEventsStatic({ terminalMode: 'none' })).rejects.toBeInstanceOf(EventsLoadError);
    expect(repo.getSnapshot().active.map((event) => event._docId)).toEqual(['saved']);
  });

  test('Firebase initialization failures are observable and retryable', async () => {
    const getFirebase = vi.fn()
      .mockRejectedValueOnce(new Error('initialization'))
      .mockResolvedValueOnce({ db: {} });
    const repo = createEventsRepo({ getFirebase });
    await expect(repo.loadEventsStatic()).rejects.toBeInstanceOf(EventsLoadError);
    await expect(repo.loadEventsStatic()).resolves.toEqual(['events']);
    expect(getFirebase).toHaveBeenCalledTimes(2);
  });
});

describe('terminal preview and history', () => {
  test('preview uses ordered query with limit 50', async () => {
    await makeRepo().loadEventsStatic({ terminalMode: 'preview' });
    expect(where).toHaveBeenCalledWith('status', 'in', [...TERMINAL_EVENT_STATUSES]);
    expect(orderBy).toHaveBeenCalledWith('date', 'desc');
    expect(limit).toHaveBeenCalledWith(TERMINAL_PREVIEW_LIMIT);
    expect(TERMINAL_PREVIEW_LIMIT).toBe(50);
  });

  test('history uses limit 10', async () => {
    await makeRepo().loadEventsStatic({ terminalMode: 'history' });
    expect(limit).toHaveBeenCalledWith(TERMINAL_HISTORY_LIMIT);
    expect(TERMINAL_HISTORY_LIMIT).toBe(10);
  });

  test('ordered query failure falls back without failing a successful load', async () => {
    docs
      .mockResolvedValueOnce(snap() as never)
      .mockRejectedValueOnce(new Error('index'))
      .mockResolvedValueOnce(snap([makeDoc('fallback')]) as never);
    const repo = makeRepo();
    await expect(repo.loadEventsStatic({ terminalMode: 'history' }))
      .resolves.toEqual(['events']);
    expect(vi.mocked(limit).mock.calls.at(-1)?.[0]).toBe(10);
    expect(repo.getSnapshot().terminal[0]?._docId).toBe('fallback');
  });

  test('both terminal query failures reject while retaining old terminal data', async () => {
    const repo = makeRepo();
    docs
      .mockResolvedValueOnce(snap() as never)
      .mockResolvedValueOnce(snap([makeDoc('saved-terminal')]) as never);
    await repo.loadEventsStatic();

    docs
      .mockResolvedValueOnce(snap([makeDoc('fresh-active')]) as never)
      .mockRejectedValueOnce(new Error('ordered failure'))
      .mockRejectedValueOnce(new Error('fallback failure'));

    await expect(repo.loadEventsStatic())
      .rejects.toMatchObject({ activeFailed: false, terminalFailed: true });
    expect(repo.getSnapshot().terminal[0]?._docId).toBe('saved-terminal');
    expect(repo.getSnapshot().active[0]?._docId).toBe('fresh-active');
  });

  test('all query failures preserve both snapshots', async () => {
    const repo = makeRepo();
    docs
      .mockResolvedValueOnce(snap([makeDoc('saved-active')]) as never)
      .mockResolvedValueOnce(snap([makeDoc('saved-terminal')]) as never);
    await repo.loadEventsStatic();

    docs.mockRejectedValue(new Error('offline'));
    await expect(repo.loadEventsStatic())
      .rejects.toMatchObject({ activeFailed: true, terminalFailed: true });
    expect(repo.getSnapshot().active[0]?._docId).toBe('saved-active');
    expect(repo.getSnapshot().terminal[0]?._docId).toBe('saved-terminal');
  });

  test('preview/history are idempotent unless forced and history is not downgraded', async () => {
    const repo = makeRepo();
    await repo.loadEventsStatic({ terminalMode: 'preview' });
    const previewCalls = docs.mock.calls.length;
    await repo.ensureTerminalEventsLoaded({ mode: 'preview' });
    expect(docs.mock.calls.length).toBe(previewCalls);

    await repo.ensureTerminalEventsLoaded({ mode: 'history', force: true });
    expect(docs.mock.calls.length).toBe(previewCalls + 2);
    const historyCalls = docs.mock.calls.length;
    await repo.ensureTerminalEventsLoaded({ mode: 'history' });
    expect(docs.mock.calls.length).toBe(historyCalls);

    await repo.loadEventsStatic({ terminalMode: 'preview' });
    expect(docs.mock.calls.length).toBe(historyCalls + 1);
  });
});

describe('terminal pagination', () => {
  function fullPreview(): FakeDoc[] {
    return Array.from({ length: TERMINAL_PREVIEW_LIMIT }, (_, i) => makeDoc(`t${i}`));
  }

  test('uses the last cursor and current page size', async () => {
    const preview = fullPreview();
    docs
      .mockResolvedValueOnce(snap() as never)
      .mockResolvedValueOnce(snap(preview) as never);
    const repo = makeRepo();
    await repo.loadEventsStatic();
    expect(await repo.loadMoreTerminalEvents()).toBe(0);
    expect(startAfter).toHaveBeenCalledWith(preview.at(-1));
    expect(vi.mocked(limit).mock.calls.at(-1)?.[0]).toBe(TERMINAL_PREVIEW_LIMIT);
  });

  test('appends documents and stops after a short page', async () => {
    docs
      .mockResolvedValueOnce(snap() as never)
      .mockResolvedValueOnce(snap(fullPreview()) as never)
      .mockResolvedValueOnce(snap([makeDoc('extra')]) as never);
    const repo = makeRepo();
    await repo.loadEventsStatic();
    expect(await repo.loadMoreTerminalEvents()).toBe(1);
    expect(repo.getSnapshot().terminal.at(-1)?._docId).toBe('extra');
    const calls = docs.mock.calls.length;
    expect(await repo.loadMoreTerminalEvents()).toBe(0);
    expect(docs.mock.calls.length).toBe(calls);
  });

  test('a failed page releases the loading lock for retry', async () => {
    docs
      .mockResolvedValueOnce(snap() as never)
      .mockResolvedValueOnce(snap(fullPreview()) as never)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(snap([makeDoc('recovered')]) as never);
    const repo = makeRepo();
    await repo.loadEventsStatic();
    await expect(repo.loadMoreTerminalEvents()).rejects.toBeInstanceOf(EventsLoadError);
    await expect(repo.loadMoreTerminalEvents()).resolves.toBe(1);
    expect(repo.getSnapshot().terminal.at(-1)?._docId).toBe('recovered');
  });
});

describe('request sequence L-02', () => {
  test('stale responses cannot overwrite newer documents or terminal metadata', async () => {
    const oldActive = defer<FakeSnap>();
    const oldTerminal = defer<FakeSnap>();
    const newActive = defer<FakeSnap>();
    const newTerminal = defer<FakeSnap>();
    docs
      .mockImplementationOnce(() => oldActive.promise as never)
      .mockImplementationOnce(() => oldTerminal.promise as never)
      .mockImplementationOnce(() => newActive.promise as never)
      .mockImplementationOnce(() => newTerminal.promise as never);

    const repo = makeRepo();
    const first = repo.loadEventsStatic({ terminalMode: 'history' });
    // 讓第一批實際發出查詢，再發第二批；避免只測到初始化前就被取消。
    await Promise.resolve();
    const second = repo.loadEventsStatic({ terminalMode: 'preview' });
    await Promise.resolve();

    const preview = Array.from({ length: 50 }, (_, index) => makeDoc(`new-${index}`));
    newActive.resolve(snap([makeDoc('new-active')]));
    newTerminal.resolve(snap(preview));
    await second;

    oldActive.resolve(snap([makeDoc('old-active')]));
    oldTerminal.resolve(snap([makeDoc('old-terminal')]));
    await first;

    expect(repo.getSnapshot().active[0]?._docId).toBe('new-active');
    expect(repo.getSnapshot().terminal).toHaveLength(50);
    await repo.loadMoreTerminalEvents();
    expect(startAfter).toHaveBeenCalledWith(preview.at(-1));
    expect(vi.mocked(limit).mock.calls.at(-1)?.[0]).toBe(50);
  });

  test('an obsolete failure does not reject or replace the newer result', async () => {
    const old = defer<FakeSnap>();
    docs.mockImplementationOnce(() => old.promise as never);
    const repo = makeRepo();
    const first = repo.loadEventsStatic({ terminalMode: 'none' });
    await Promise.resolve();

    docs.mockResolvedValueOnce(snap([makeDoc('latest')]) as never);
    await repo.loadEventsStatic({ terminalMode: 'none' });
    old.reject(new Error('obsolete'));
    await expect(first).resolves.toEqual([]);
    expect(repo.getSnapshot().active[0]?._docId).toBe('latest');
  });
});
