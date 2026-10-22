import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/preact';
import {
  commitTeamAssignments,
  runTeamSplitBatch,
  type TeamBatchDependencies,
} from './team-split-writes';

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  update: vi.fn(),
  doc: vi.fn(),
  batch: vi.fn(),
  timestamp: { kind: 'serverTimestamp' },
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: async () => ({ db: 'database' }),
}));
vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  writeBatch: mocks.batch,
  serverTimestamp: () => mocks.timestamp,
}));
vi.mock('@/i18n/i18n', async o => ({
  ...(await o<typeof import('@/i18n/i18n')>()),
  lt: (_key: string, fallback: string) => fallback,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function dependencies(overrides: Partial<TeamBatchDependencies> = {}): TeamBatchDependencies {
  return {
    eventDocId: 'document-id',
    action: 'fill',
    teams: [{ key: 'A', color: '#EF4444' }, { key: 'B', color: '#3B82F6' }],
    canManage: () => true,
    isCurrent: () => true,
    loadRegistrations: async () => [{ _docId: 'reg-doc', status: 'confirmed', teamKey: null }],
    confirm: async () => true,
    notify: vi.fn(),
    publish: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.commit.mockResolvedValue(undefined);
  mocks.doc.mockImplementation((...parts: unknown[]) => parts);
  mocks.batch.mockReturnValue({ update: mocks.update, commit: mocks.commit });
});

afterEach(() => cleanup());

describe('M-092 writeBatch', () => {
  it('一次 commit，文件路徑使用 _docId，只有 teamKey 與 updatedAt', async () => {
    await commitTeamAssignments('event-document', [{
      reg: { id: 'public-registration', _docId: 'registration-document' },
      teamKey: 'B',
    }]);
    expect(mocks.doc).toHaveBeenCalledWith(
      'database', 'events', 'event-document', 'registrations', 'registration-document',
    );
    expect(mocks.update.mock.calls[0]?.[1]).toEqual({
      teamKey: 'B', updatedAt: mocks.timestamp,
    });
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });

  it('沒有文件 ID 不寫，reset 寫 null', async () => {
    expect(await commitTeamAssignments('event-document', [{
      reg: { id: 'public-only' }, teamKey: 'A',
    }])).toBe(0);
    expect(mocks.batch).not.toHaveBeenCalled();
    await commitTeamAssignments('event-document', [{
      reg: { _docId: 'reg' }, teamKey: null,
    }]);
    expect(mocks.update.mock.calls[0]?.[1]).toEqual({
      teamKey: null, updatedAt: mocks.timestamp,
    });
  });

  it('同活動寫入互斥，失敗還原，清鎖後可重新成功', async () => {
    const wait = deferred<void>();
    mocks.commit.mockReturnValueOnce(wait.promise);
    const deps = dependencies();
    const first = runTeamSplitBatch(deps);
    await vi.waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
    expect(deps.publish).toHaveBeenCalledWith([
      { _docId: 'reg-doc', status: 'confirmed', teamKey: 'A' },
    ]);

    await runTeamSplitBatch(deps);
    expect(deps.notify).toHaveBeenCalledWith('分隊更新中，請稍候');
    expect(mocks.commit).toHaveBeenCalledTimes(1);

    wait.reject({ code: 'permission-denied' });
    await first;
    expect(deps.publish).toHaveBeenLastCalledWith([
      { _docId: 'reg-doc', status: 'confirmed', teamKey: null },
    ]);
    expect(deps.notify).toHaveBeenCalledWith(
      '分隊權限被拒絕，請確認你是活動主辦或有操作權限',
    );

    await runTeamSplitBatch(deps);
    expect(mocks.commit).toHaveBeenCalledTimes(2);
  });

  it('讀取第一次拒絕後可重試，不保留失敗 inflight', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ _docId: 'reg', status: 'confirmed' }]);
    const deps = dependencies({ loadRegistrations: load });
    await runTeamSplitBatch(deps);
    await runTeamSplitBatch(deps);
    expect(load).toHaveBeenCalledTimes(2);
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });

  it('確認後與讀取後再檢查權限，權限撤回不送寫入', async () => {
    let allowed = true;
    const deps = dependencies({
      action: 'random',
      canManage: () => allowed,
      confirm: async () => { allowed = false; return true; },
    });
    await runTeamSplitBatch(deps);
    expect(deps.notify).toHaveBeenCalledWith('權限不足');
    expect(mocks.batch).not.toHaveBeenCalled();

    allowed = true;
    await runTeamSplitBatch(dependencies({
      canManage: () => allowed,
      loadRegistrations: async () => {
        allowed = false;
        return [{ _docId: 'reg', status: 'confirmed' }];
      },
    }));
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('卸載後不發布、不 toast；已提交寫入仍完成並釋放鎖', async () => {
    const wait = deferred<void>();
    let mounted = true;
    mocks.commit.mockReturnValueOnce(wait.promise);
    const deps = dependencies({ isCurrent: () => mounted });
    const operation = runTeamSplitBatch(deps);
    await vi.waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
    mounted = false;
    wait.reject(new Error('offline'));
    await operation;
    expect(deps.publish).toHaveBeenCalledTimes(1);
    expect(deps.notify).not.toHaveBeenCalled();

    await runTeamSplitBatch(dependencies());
    expect(mocks.commit).toHaveBeenCalledTimes(2);
  });

  it('重置需確認，取消確認不讀名單；無資料使用 A 文案', async () => {
    const load = vi.fn(async () => []);
    await runTeamSplitBatch(dependencies({
      action: 'reset',
      confirm: async () => false,
      loadRegistrations: load,
    }));
    expect(load).not.toHaveBeenCalled();

    const deps = dependencies({ action: 'reset', loadRegistrations: load });
    await runTeamSplitBatch(deps);
    expect(deps.notify).toHaveBeenCalledWith('目前沒有已分隊名單');
  });
});
