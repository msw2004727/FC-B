import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(),
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
}));

vi.mock('./cp-firebase', () => ({
  isCpFirebaseStarted: vi.fn(() => false),
}));

vi.mock('@/core/app-meta', () => ({
  readAppVersion: () => '0.test',
}));

import { getFirebase } from '@/data/firebase';
import { addDoc } from 'firebase/firestore';
import { isCpFirebaseStarted } from './cp-firebase';
import {
  FIRST_LOAD_TIMEOUT_MS,
  _clearFirstLoadLogForTest,
  _resetFirstLoadReportForTest,
  readFirstLoadLog,
  runFirstLoad,
} from './first-load';

const mockGetFirebase = vi.mocked(getFirebase);
const mockAddDoc = vi.mocked(addDoc);
const mockIsCpStarted = vi.mocked(isCpFirebaseStarted);
const fakeDb = { name: 'fake-db' };

async function flushAsync(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
  }
}

function firstDoc(): Record<string, unknown> {
  return mockAddDoc.mock.calls[0]?.[1] as unknown as Record<string, unknown>;
}

const WHITELIST = [
  'authSettled',
  'browser',
  'context',
  'cpInstanceFresh',
  'createdAt',
  'errorCode',
  'errorMessage',
  'ms',
  'noise',
  'outcome',
  'page',
  'round',
  'sinceNavMs',
  'standalone',
  'version',
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  _clearFirstLoadLogForTest();
  _resetFirstLoadReportForTest();

  mockGetFirebase.mockReset();
  mockGetFirebase.mockImplementation(async () => ({
    auth: { currentUser: { uid: 'u1' } },
    db: fakeDb,
  } as never));

  mockAddDoc.mockReset();
  mockAddDoc.mockResolvedValue(undefined as never);

  mockIsCpStarted.mockReset();
  mockIsCpStarted.mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  _clearFirstLoadLogForTest();
  _resetFirstLoadReportForTest();
});

describe('runFirstLoad 上報 errorLogs', () => {
  it('第 1 輪時限內成功 → 不上報', async () => {
    const run = runFirstLoad('detail', async () => 'value');
    expect(await run.promise).toBe('value');
    await flushAsync();
    expect(mockAddDoc).toHaveBeenCalledTimes(0);
  });

  it('第 1 輪時限內失敗 → 不上報', async () => {
    const err = new Error('fail');
    const run = runFirstLoad('detail', async () => { throw err; });
    await expect(run.promise).rejects.toBe(err);
    await flushAsync();
    expect(mockAddDoc).toHaveBeenCalledTimes(0);
  });

  it('第 1 輪逾時、第 2 輪成功 → 2 筆（round1 timeout／round2 ok、集合 errorLogs）', async () => {
    const load = vi.fn((round: 1 | 2) => (round === 1
      ? new Promise<string>(() => undefined)
      : Promise.resolve('second')));
    const run = runFirstLoad('detail', load);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    expect(await run.promise).toBe('second');
    await flushAsync();
    expect(mockAddDoc).toHaveBeenCalledTimes(2);
    const docs = mockAddDoc.mock.calls.map((c) => c[1] as unknown as Record<string, unknown>);
    expect(docs[0]?.round).toBe(1);
    expect(docs[0]?.outcome).toBe('timeout');
    expect(docs[1]?.round).toBe(2);
    expect(docs[1]?.outcome).toBe('ok');
    const ref = mockAddDoc.mock.calls[0]?.[0] as unknown as { path: string };
    expect(ref.path).toBe('errorLogs');
  });

  it('文件的鍵恰好等於白名單（15 個）', async () => {
    const load = vi.fn((round: 1 | 2) => (round === 1
      ? new Promise<string>(() => undefined)
      : Promise.resolve('second')));
    const run = runFirstLoad('detail', load);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    await run.promise;
    await flushAsync();
    const doc = firstDoc();
    expect(Object.keys(doc).sort()).toEqual(WHITELIST);
    expect(doc.context).toBe('cp-first-load');
    expect(doc.createdAt).toBe('SERVER_TS');
    expect(doc.version).toBe('0.test');
    expect(doc).not.toHaveProperty('uid');
    expect(doc).not.toHaveProperty('url');
    expect(doc).not.toHaveProperty('userAgent');
    expect(doc).not.toHaveProperty('pathname');
  });

  it('節流：同一 page 最多 2 筆；roster 另計', async () => {
    for (let i = 0; i < 2; i += 1) {
      const run = runFirstLoad('detail', () => new Promise<string>(() => undefined));
      const settled = run.promise.then(() => null, () => null);
      await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS * 2);
      await settled;
    }
    await flushAsync();
    expect(mockAddDoc).toHaveBeenCalledTimes(2);

    for (let i = 0; i < 2; i += 1) {
      const run = runFirstLoad('roster', () => new Promise<string>(() => undefined));
      const settled = run.promise.then(() => null, () => null);
      await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS * 2);
      await settled;
    }
    await flushAsync();
    expect(mockAddDoc).toHaveBeenCalledTimes(4);
  });

  it('cancel 在第 1 輪逾時前 → 0 筆', async () => {
    const run = runFirstLoad('detail', () => new Promise<string>(() => undefined));
    run.cancel();
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS * 5);
    await flushAsync();
    expect(mockAddDoc).toHaveBeenCalledTimes(0);
  });

  it('cancel 在第 1 輪逾時後、第 2 輪結束前 → 只有 1 筆', async () => {
    let resolveSecond: (v: string) => void = () => undefined;
    const second = new Promise<string>((r) => { resolveSecond = r; });
    const load = vi.fn((round: 1 | 2) => (round === 1
      ? new Promise<string>(() => undefined)
      : second));
    const run = runFirstLoad('detail', load);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    await flushAsync();
    expect(mockAddDoc).toHaveBeenCalledTimes(1);
    run.cancel();
    resolveSecond('second');
    await vi.advanceTimersByTimeAsync(0);
    await flushAsync();
    expect(mockAddDoc).toHaveBeenCalledTimes(1);
  });

  it('currentUser 為 null → 0 筆，但第 2 輪照常 resolve', async () => {
    mockGetFirebase.mockImplementation(async () => ({
      auth: { currentUser: null },
      db: fakeDb,
    } as never));
    const load = vi.fn((round: 1 | 2) => (round === 1
      ? new Promise<string>(() => undefined)
      : Promise.resolve('second')));
    const run = runFirstLoad('detail', load);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    expect(await run.promise).toBe('second');
    await flushAsync();
    expect(mockAddDoc).toHaveBeenCalledTimes(0);
  });

  it('addDoc reject → 不影響：promise 照常 resolve', async () => {
    mockAddDoc.mockRejectedValue(new Error('reject'));
    const load = vi.fn((round: 1 | 2) => (round === 1
      ? new Promise<string>(() => undefined)
      : Promise.resolve('second')));
    const run = runFirstLoad('detail', load);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    expect(await run.promise).toBe('second');
    await flushAsync();
    expect(mockAddDoc).toHaveBeenCalledTimes(2);
  });

  it('authSettled: false → 文件 false', async () => {
    const load = (round: 1 | 2) => (round === 1
      ? new Promise<string>(() => undefined)
      : Promise.resolve('second'));
    const run = runFirstLoad('detail', load, undefined, { authSettled: false });
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    await run.promise;
    await flushAsync();
    expect(firstDoc().authSettled).toBe(false);
  });

  it('authSettled 未傳 → 文件 null', async () => {
    const load = (round: 1 | 2) => (round === 1
      ? new Promise<string>(() => undefined)
      : Promise.resolve('second'));
    const run = runFirstLoad('detail', load);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    await run.promise;
    await flushAsync();
    expect(firstDoc().authSettled).toBeNull();
  });

  it('cpInstanceFresh 在呼叫當下取值（之後改 mock 不影響）', async () => {
    mockIsCpStarted.mockReturnValueOnce(false);
    const load = (round: 1 | 2) => (round === 1
      ? new Promise<string>(() => undefined)
      : Promise.resolve('second'));
    const run = runFirstLoad('detail', load);
    mockIsCpStarted.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    await run.promise;
    await flushAsync();
    expect(firstDoc().cpInstanceFresh).toBe(true);
  });

  it('isCpFirebaseStarted true → cpInstanceFresh false', async () => {
    mockIsCpStarted.mockReturnValueOnce(true);
    const load = (round: 1 | 2) => (round === 1
      ? new Promise<string>(() => undefined)
      : Promise.resolve('second'));
    const run = runFirstLoad('detail', load);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    await run.promise;
    await flushAsync();
    expect(firstDoc().cpInstanceFresh).toBe(false);
  });

  it('兩輪都逾時 → 2 筆（round1 timeout／round2 timeout）', async () => {
    const run = runFirstLoad('roster', () => new Promise<string>(() => undefined));
    const outcome = run.promise.then(() => null, (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    await outcome;
    await flushAsync();
    const docs = mockAddDoc.mock.calls.map((c) => c[1] as unknown as Record<string, unknown>);
    expect(docs.map((d) => [d.page, d.round, d.outcome])).toEqual([['roster', 1, 'timeout'], ['roster', 2, 'timeout']]);
  });

  it('getFirebase 失敗 → 0 筆，第 2 輪照常、promise 照常 resolve', async () => {
    mockGetFirebase.mockImplementation(async () => { throw new Error('boom'); });
    const load = vi.fn((round: 1 | 2) => (round === 1
      ? new Promise<string>(() => undefined)
      : Promise.resolve('second')));
    const run = runFirstLoad('detail', load);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    expect(await run.promise).toBe('second');
    await flushAsync();
    expect(load).toHaveBeenCalledTimes(2);
    expect(mockAddDoc).toHaveBeenCalledTimes(0);
  });

  it('browser 只輸出類別', async () => {
    const cases: Array<[string, string]> = [
      ['Mozilla/5.0 Line/13.0.0', 'line'],
      ['Mozilla/5.0 (iPhone) AppleWebKit CriOS/100.0', 'chrome'],
      ['Mozilla/5.0 (Linux) AppleWebKit Chrome/120.0 Safari/537.36', 'chrome'],
      ['Mozilla/5.0 (iPhone) AppleWebKit Version/15 Safari/604.1', 'safari'],
      ['Mozilla/5.0 (Windows) AppleWebKit Chrome/120.0 Safari/537.36 Edg/120.0', 'other'],
      ['UnknownBrowser/1.0', 'other'],
    ];
    for (const [ua, expected] of cases) {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
      _resetFirstLoadReportForTest();
      mockAddDoc.mockClear();
      const load = (round: 1 | 2) => (round === 1
        ? new Promise<string>(() => undefined)
        : Promise.resolve('second'));
      const run = runFirstLoad('detail', load);
      await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
      await run.promise;
      await flushAsync();
      expect(firstDoc().browser).toBe(expected);
    }
  });

  it('既有 readFirstLoadLog 仍只有 page/round/ms/outcome 四個鍵', async () => {
    const load = (round: 1 | 2) => (round === 1
      ? new Promise<string>(() => undefined)
      : Promise.resolve('second'));
    const run = runFirstLoad('detail', load);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    await run.promise;
    await flushAsync();
    const log = readFirstLoadLog();
    expect(log.length).toBeGreaterThan(0);
    for (const entry of log) {
      expect(Object.keys(entry).sort()).toEqual(['ms', 'outcome', 'page', 'round']);
    }
  });
});
