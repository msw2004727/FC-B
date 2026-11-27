import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_LOAD_TIMEOUT_MS,
  FirstLoadTimeoutError,
  _clearFirstLoadLogForTest,
  readFirstLoadLog,
  runFirstLoad,
} from './first-load';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  _clearFirstLoadLogForTest();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  _clearFirstLoadLogForTest();
});

describe('runFirstLoad', () => {
  it('第 1 輪時限內成功 → resolve、只呼叫 load 一次、紀錄一筆 ok', async () => {
    const load = vi.fn(async (_round: 1 | 2) => 'value');
    const run = runFirstLoad('detail', load);
    expect(await run.promise).toBe('value');
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[0]).toBe(1);
    const log = readFirstLoadLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ page: 'detail', round: 1, outcome: 'ok' });
    expect(typeof log[0]?.ms).toBe('number');
  });

  it('第 1 輪時限內失敗 → reject 原錯誤、不重讀', async () => {
    const err = { code: 'unavailable' };
    const load = vi.fn(async () => { throw err; });
    const run = runFirstLoad('detail', load);
    await expect(run.promise).rejects.toBe(err);
    expect(load).toHaveBeenCalledTimes(1);
    const log = readFirstLoadLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.outcome).toBe('error');
    expect(log[0]?.round).toBe(1);
  });

  it('第 1 輪逾時 → 第 2 輪成功 → resolve 第 2 輪值；第 1 輪晚到不影響', async () => {
    let resolveFirst: (v: string) => void = () => undefined;
    const first = new Promise<string>((resolve) => { resolveFirst = resolve; });
    const load = vi.fn((round: 1 | 2) => (round === 1 ? first : Promise.resolve('second')));
    const run = runFirstLoad('detail', load);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    expect(await run.promise).toBe('second');
    expect(load).toHaveBeenCalledTimes(2);
    // 第 1 輪晚到：不改變結果、不多記新紀錄。
    resolveFirst('first-late');
    await vi.advanceTimersByTimeAsync(0);
    const log = readFirstLoadLog();
    expect(log.map((entry) => ({ round: entry.round, outcome: entry.outcome }))).toEqual([
      { round: 1, outcome: 'timeout' },
      { round: 2, outcome: 'ok' },
    ]);
  });

  it('第 1 輪逾時、第 2 輪失敗 → reject 第 2 輪錯誤', async () => {
    const secondErr = new Error('round2-fail');
    const load = vi.fn((round: 1 | 2) => (round === 1
      ? new Promise<string>(() => undefined)
      : Promise.reject(secondErr)));
    const run = runFirstLoad('detail', load);
    const settled = expect(run.promise).rejects.toBe(secondErr);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    await settled;
    expect(load).toHaveBeenCalledTimes(2);
    const log = readFirstLoadLog();
    expect(log.map((entry) => ({ round: entry.round, outcome: entry.outcome }))).toEqual([
      { round: 1, outcome: 'timeout' },
      { round: 2, outcome: 'error' },
    ]);
  });

  it('兩輪都逾時 → reject FirstLoadTimeoutError，code 正確，load 只被呼叫 2 次', async () => {
    const load = vi.fn(() => new Promise<string>(() => undefined));
    const run = runFirstLoad('detail', load);
    const outcome = run.promise.then(() => null, (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    const err = await outcome;
    expect(err).toBeInstanceOf(FirstLoadTimeoutError);
    expect((err as { code?: string }).code).toBe('cp/first-load-timeout');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('cancel() 在第 1 輪逾時前 → 不呼叫 load(2)、timer 清空、promise 不 settle', async () => {
    const load = vi.fn(() => new Promise<string>(() => undefined));
    const run = runFirstLoad('detail', load);
    run.cancel();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS * 5);
    expect(load).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    let settled = false;
    run.promise.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    // 可重複呼叫。
    run.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('紀錄只含 page/round/ms/outcome 四個鍵；sessionStorage 最多 20 筆', async () => {
    for (let i = 0; i < 25; i += 1) {
      const run = runFirstLoad('roster', async () => i);
      await run.promise;
    }
    const log = readFirstLoadLog();
    expect(log.length).toBe(20);
    for (const entry of log) {
      expect(Object.keys(entry).sort()).toEqual(['ms', 'outcome', 'page', 'round']);
      expect(entry.page).toBe('roster');
      expect(entry.outcome).toBe('ok');
    }
  });
});
