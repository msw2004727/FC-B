import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFirebase: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({ getFirebase: mocks.getFirebase }));
vi.mock('@/data/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/core/events', () => ({ on: vi.fn(() => () => undefined) }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, name: string, id: string) => `${name}/${id}`,
  collection: (_db: unknown, name: string) => name,
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
}));

import {
  createMinimalOperateContext,
  createOperateLoader,
  loadOperateContext,
} from './viewer-operate';
import {
  canManageEvent,
  canOperateEventSite,
  hasActivityManageEntry,
  type OperateContext,
} from '@/features/events/data/operate-permissions';
import { getDefaultRoleActivityCapabilities } from './permissions';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function complete(uid: string): OperateContext {
  return {
    uid,
    role: 'coach',
    rolePermissions: [],
    userGrants: null,
    capabilities: [],
    customRoles: [],
  };
}

function snapshot(data: Record<string, unknown> | null): {
  exists: () => boolean;
  data: () => Record<string, unknown> | undefined;
} {
  return {
    exists: () => data !== null,
    data: () => data ?? undefined,
  };
}

describe('Operate loader 競態', () => {
  it('UID 切換立即最小化；A 晚回不覆蓋 B', async () => {
    const a = deferred<OperateContext>();
    const b = deferred<OperateContext>();
    const changes: OperateContext[] = [];
    const loader = createOperateLoader(
      uid => uid === 'a' ? a.promise : b.promise,
      context => changes.push(context),
    );

    loader('a');
    loader('b');
    expect(changes).toEqual([
      createMinimalOperateContext('a'),
      createMinimalOperateContext('b'),
    ]);

    b.resolve(complete('b'));
    await b.promise;
    a.resolve(complete('a'));
    await a.promise;

    expect(changes).toHaveLength(3);
    expect(changes.at(-1)).toEqual(complete('b'));
  });

  it('同 UID 快取完成與較早網路結果交錯，只有最新請求提交', async () => {
    const network = deferred<OperateContext>();
    const cached = { ...complete('a'), role: 'user' };
    const load = vi.fn<(uid: string) => Promise<OperateContext>>()
      .mockImplementationOnce(() => network.promise)
      .mockResolvedValueOnce(cached);
    const changes: OperateContext[] = [];
    const loader = createOperateLoader(load, context => changes.push(context));

    loader('a');
    loader('a');
    await Promise.resolve();
    network.resolve(complete('a'));
    await network.promise;

    expect(changes).toEqual([createMinimalOperateContext('a'), cached]);
  });

  it('第一次拒絕後重新呼叫 load 並恢復', async () => {
    const first = deferred<OperateContext>();
    const second = deferred<OperateContext>();
    const load = vi.fn<(uid: string) => Promise<OperateContext>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const changes: OperateContext[] = [];
    const onError = vi.fn();
    const loader = createOperateLoader(load, context => changes.push(context), onError);

    loader('a');
    first.reject(new Error('read denied'));
    await first.promise.catch(() => undefined);
    expect(changes).toEqual([createMinimalOperateContext('a')]);
    expect(onError).toHaveBeenCalledTimes(1);

    loader('a');
    second.resolve(complete('a'));
    await second.promise;
    expect(load).toHaveBeenCalledTimes(2);
    expect(changes.at(-1)).toEqual(complete('a'));
  });

  it('同 UID refresh 失敗保留完整快照', async () => {
    const refresh = deferred<OperateContext>();
    const load = vi.fn<(uid: string) => Promise<OperateContext>>()
      .mockResolvedValueOnce(complete('a'))
      .mockImplementationOnce(() => refresh.promise);
    const changes: OperateContext[] = [];
    const loader = createOperateLoader(load, context => changes.push(context), () => undefined);

    loader('a');
    await Promise.resolve();
    loader('a');
    refresh.reject(new Error('offline'));
    await refresh.promise.catch(() => undefined);

    expect(changes).toEqual([createMinimalOperateContext('a'), complete('a')]);
  });

  it('登出與 dispose 都阻止未完成請求提交', async () => {
    const first = deferred<OperateContext>();
    const second = deferred<OperateContext>();
    const load = vi.fn<(uid: string) => Promise<OperateContext>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const changes: OperateContext[] = [];
    const loader = createOperateLoader(load, context => changes.push(context));

    loader('a');
    loader(null);
    first.resolve(complete('a'));
    await first.promise;
    expect(changes.at(-1)).toEqual(createMinimalOperateContext());

    loader('b');
    const count = changes.length;
    loader.dispose();
    second.resolve(complete('b'));
    await second.promise;
    loader('c');
    expect(changes).toHaveLength(count);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('最小暫態不因 UID 恰好是 owner/delegate 而放行', () => {
    const minimal = createMinimalOperateContext('a');
    const event = { creatorUid: 'a', delegateUids: ['a'] };
    expect(canManageEvent(minimal, event)).toBe(false);
    expect(canOperateEventSite(minimal, event)).toBe(false);
    expect(hasActivityManageEntry(minimal)).toBe(false);
  });
});

describe('loadOperateContext storage 契約', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFirebase.mockResolvedValue({ db: {} });
    mocks.getDocs.mockResolvedValue({ docs: [] });
  });

  it('讀取 A 文件形狀，保留 []，不使用 defaultCapabilities 覆蓋', async () => {
    const documents: Record<string, Record<string, unknown>> = {
      'users/a': { role: 'coach' },
      'rolePermissions/coach': { permissions: [] },
      'userPermissionGrants/a': {
        uid: 'a', enabled: false, permissions: ['event.edit_self'],
      },
      'roleActivityCapabilities/user': {
        capabilities: [], defaultCapabilities: ['user.activity.site_operate'],
      },
    };
    mocks.getDoc.mockImplementation(async (path: string) => snapshot(documents[path] ?? null));
    mocks.getDocs.mockResolvedValue({
      docs: [
        { id: 'judge', data: () => ({ key: 'judge', afterRole: 'captain' }) },
        { id: 'missing-key', data: () => ({ afterRole: 'admin' }) },
      ],
    });

    const context = await loadOperateContext('a');
    expect(context.rolePermissions).toEqual([]);
    expect(context.capabilities).toEqual([]);
    expect(context.userGrants?.enabled).toBe(false);
    expect(context.customRoles).toEqual([{
      key: 'judge', label: 'judge', color: '#6366f1', afterRole: 'captain',
    }]);
    expect(mocks.getDoc.mock.calls.map(call => call[0]).sort()).toEqual([
      'users/a',
      'rolePermissions/coach',
      'userPermissionGrants/a',
      'roleActivityCapabilities/user',
    ].sort());
    expect(mocks.getDocs).toHaveBeenCalledWith('customRoles');
  });

  it('文件真正缺失時使用 A defaults', async () => {
    mocks.getDoc.mockImplementation(async (path: string) =>
      snapshot(path === 'users/a' ? { role: 'admin' } : null),
    );
    const context = await loadOperateContext('a');
    expect(context.rolePermissions).toBeNull();
    expect(context.capabilities).toEqual(getDefaultRoleActivityCapabilities('user'));
    expect(canManageEvent(context, { creatorUid: 'other' })).toBe(true);
  });

  it('讀取拒絕不當成缺失而賦予 admin defaults', async () => {
    mocks.getDoc.mockImplementation(async (path: string) => {
      if (path === 'rolePermissions/admin') throw new Error('permission-denied');
      return snapshot(path === 'users/a' ? { role: 'admin' } : null);
    });
    await expect(loadOperateContext('a')).rejects.toThrow('permission-denied');
  });
});
