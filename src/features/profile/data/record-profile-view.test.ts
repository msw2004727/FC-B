import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CALLABLES } from '@/data/contract/callables';

import { recordProfileView, scheduleProfileViewRecord } from './record-profile-view';

const mocks = vi.hoisted(() => ({ callFn: vi.fn() }));
vi.mock('@/data/callables', () => ({ callFn: mocks.callFn }));

const KEY = 'popview:viewer:target';

beforeEach(() => {
  localStorage.clear();
  mocks.callFn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('recordProfileView', () => {
  it('契約：asia-east1、必登入，四處都有登錄', () => {
    expect(CALLABLES.recordProfileView).toMatchObject({ region: 'asia-east1', auth: 'required' });
    const contract = readFileSync(resolve(process.cwd(), 'src/data/contract/callables.ts'), 'utf8');
    const entry = readFileSync(resolve(process.cwd(), 'src/data/callables.ts'), 'utf8');
    const mocksSrc = readFileSync(resolve(process.cwd(), 'src/dev/callable-mocks.ts'), 'utf8');
    expect(contract).toContain('export interface RecordProfileViewRequest');
    expect(contract).toContain('export interface RecordProfileViewResponse');
    expect(contract).toContain("status: 'counted' | 'already' | 'self'");
    expect(contract).toContain('recordProfileView:');
    expect(entry).toContain('RecordProfileViewRequest');
    expect(entry).toContain('recordProfileView:');
    expect(mocksSrc).toContain("registerMock('recordProfileView'");
  });

  it('未登入、空白、看自己不呼叫', async () => {
    await recordProfileView('', 'target');
    await recordProfileView('   ', 'target');
    await recordProfileView('viewer', '');
    await recordProfileView('viewer', 'viewer');
    await recordProfileView(' viewer ', 'viewer');
    expect(mocks.callFn).not.toHaveBeenCalled();
  });

  it('已有本機 key 不呼叫', async () => {
    localStorage.setItem(KEY, '1');
    await recordProfileView('viewer', 'target');
    expect(mocks.callFn).not.toHaveBeenCalled();
  });

  it('呼叫參數只有 { targetUid }', async () => {
    mocks.callFn.mockResolvedValue({ status: 'counted', views: 3 });
    await recordProfileView(' viewer ', ' target ');
    expect(mocks.callFn.mock.calls).toEqual([
      ['recordProfileView', { targetUid: 'target' }],
    ]);
  });

  it('counted／already 寫 key，值只有 1', async () => {
    mocks.callFn.mockResolvedValueOnce({ status: 'counted', views: 9 });
    await recordProfileView('viewer', 'target');
    expect(localStorage.getItem(KEY)).toBe('1');

    localStorage.clear();
    mocks.callFn.mockResolvedValueOnce({ status: 'already' });
    await recordProfileView('viewer', 'target');
    expect(localStorage.getItem(KEY)).toBe('1');
  });

  it('self／其他狀態不寫 key', async () => {
    for (const status of ['self', 'nope', '']) {
      localStorage.clear();
      mocks.callFn.mockResolvedValueOnce({ status });
      await recordProfileView('viewer', 'target');
      expect(localStorage.getItem(KEY)).toBeNull();
    }
    localStorage.clear();
    mocks.callFn.mockResolvedValueOnce(null);
    await recordProfileView('viewer', 'target');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('失敗靜默：不寫 key、不 console', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mocks.callFn.mockRejectedValueOnce(new Error('offline viewer-secret-uid'));
    await expect(recordProfileView('viewer-secret-uid', 'target-secret-uid')).resolves.toBeUndefined();
    expect(localStorage.getItem('popview:viewer-secret-uid:target-secret-uid')).toBeNull();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    const src = readFileSync(resolve(process.cwd(), 'src/features/profile/data/record-profile-view.ts'), 'utf8');
    expect(src).not.toContain('console.');
    expect(src).not.toContain('toast');
  });

  it('localStorage 讀取丟錯仍呼叫；寫入丟錯不外拋', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    mocks.callFn.mockResolvedValue({ status: 'counted' });
    await recordProfileView('viewer', 'target');
    expect(mocks.callFn).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    localStorage.clear();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    mocks.callFn.mockResolvedValue({ status: 'already' });
    await expect(recordProfileView('viewer', 'target')).resolves.toBeUndefined();
    expect(mocks.callFn).toHaveBeenCalledWith('recordProfileView', { targetUid: 'target' });
  });
});

describe('scheduleProfileViewRecord', () => {
  it('沒有 requestIdleCallback 時 1.5 秒後才呼叫，取消後不呼叫', async () => {
    expect(typeof window.requestIdleCallback).not.toBe('function');
    vi.useFakeTimers();
    mocks.callFn.mockResolvedValue({ status: 'counted' });
    const cancel = scheduleProfileViewRecord('viewer', 'target');
    await vi.advanceTimersByTimeAsync(1499);
    expect(mocks.callFn).not.toHaveBeenCalled();
    cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.callFn).not.toHaveBeenCalled();

    scheduleProfileViewRecord('viewer', 'target');
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.callFn).toHaveBeenCalledTimes(1);
    expect(mocks.callFn).toHaveBeenCalledWith('recordProfileView', { targetUid: 'target' });
  });

  it('有 requestIdleCallback 時用它（上限 4 秒），取消後回呼也不呼叫', async () => {
    // 閉包賦值不會讓 tsc 把 let 從 null 收窄回來，改放物件屬性。
    const box: { idle: (() => void) | null } = { idle: null };
    const cancelIdle = vi.fn();
    vi.stubGlobal('requestIdleCallback', (cb: () => void, opts?: { timeout: number }) => {
      box.idle = cb;
      expect(opts).toEqual({ timeout: 4000 });
      return 7;
    });
    vi.stubGlobal('cancelIdleCallback', cancelIdle);
    mocks.callFn.mockResolvedValue({ status: 'already' });

    const cancel = scheduleProfileViewRecord('viewer', 'target');
    expect(mocks.callFn).not.toHaveBeenCalled();
    expect(typeof box.idle).toBe('function');
    cancel();
    expect(cancelIdle).toHaveBeenCalledWith(7);
    box.idle?.();
    await Promise.resolve();
    expect(mocks.callFn).not.toHaveBeenCalled();

    const run = scheduleProfileViewRecord('viewer', 'target');
    box.idle?.();
    await vi.waitFor(() => expect(mocks.callFn).toHaveBeenCalledTimes(1));
    run();
  });
});
