import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: {} })),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, collection: string, id: string) => ({
    _collection: collection,
    _id: id,
  })),
  getDoc: vi.fn(),
}));

vi.mock('@/data/auth', () => ({
  getCurrentUser: vi.fn(() => null),
}));

vi.mock('@/core/events', () => ({
  on: vi.fn(() => () => {
    /* noop unsubscribe */
  }),
}));

import { getDoc } from 'firebase/firestore';

import { loadViewer, createGuestViewer, createViewerLoader, type ViewerView } from './viewer';

type DocVal = Record<string, unknown> | null | 'throw';

interface MockDocOptions {
  users?: DocVal;
  rolePermissions?: DocVal;
  userPermissionGrants?: DocVal;
  roleActivityCapabilities?: DocVal;
}

function makeSnapshot(data: Record<string, unknown> | null) {
  return {
    exists: () => data !== null,
    data: () => (data === null ? undefined : data),
  };
}

function mockDocs(opts: MockDocOptions): void {
  const getDocMock = getDoc as unknown as { mockImplementation: (f: unknown) => void };
  getDocMock.mockImplementation(async (ref: { _collection: string }) => {
    const key = ref._collection as keyof MockDocOptions;
    const val = opts[key];
    if (val === 'throw') {
      const err = Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
      throw err;
    }
    return makeSnapshot(val ?? null);
  });
}

async function flushMicrotasks(): Promise<void> {
  // 讓多層 .then 都跑完
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

describe('createGuestViewer', () => {
  it('回傳未登入快照', () => {
    const v = createGuestViewer();
    expect(v.uid).toBeNull();
    expect(v.role).toBe('guest');
    expect(v.roleLevel).toBe(0);
    expect(v.teamIds.size).toBe(0);
    expect(v.displayName).toBeNull();
    expect(v.pictureUrl).toBeNull();
    expect(v.capabilities).toEqual([]);
    expect(v.hasPermission('anything')).toBe(false);
  });
});

describe('loadViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {
      /* noop */
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uid 為空字串視同訪客', async () => {
    const v = await loadViewer('');
    expect(v.uid).toBeNull();
    expect(v.role).toBe('guest');
    expect(v.hasPermission('x')).toBe(false);
  });

  it('載入一般使用者：組裝 role、teamIds、permissions、capabilities', async () => {
    mockDocs({
      users: {
        role: 'coach',
        teamIds: ['t1', 't2'],
        displayName: 'Coach A',
        pictureUrl: 'https://example.com/a.png',
      },
      rolePermissions: { permissions: ['event.create', 'event.manage'] },
      userPermissionGrants: { permissions: [] },
      roleActivityCapabilities: { user: ['user.activity.basic_create'] },
    });

    const v = await loadViewer('uid-coach');

    expect(v.uid).toBe('uid-coach');
    expect(v.role).toBe('coach');
    expect(v.roleLevel).toBe(1);
    expect(v.displayName).toBe('Coach A');
    expect(v.pictureUrl).toBe('https://example.com/a.png');
    expect(v.teamIds.has('t1')).toBe(true);
    expect(v.teamIds.has('t2')).toBe(true);
    expect(v.teamIds.size).toBe(2);
    expect(v.hasPermission('event.create')).toBe(true);
    expect(v.hasPermission('event.manage')).toBe(true);
    expect(v.hasPermission('event.delete')).toBe(false);
    expect(v.capabilities).toEqual(['user.activity.basic_create']);
  });

  it('舊欄位 teamId（字串）也納入 teamIds', async () => {
    mockDocs({
      users: { role: 'user', teamId: 'legacy-team' },
      rolePermissions: null,
      userPermissionGrants: null,
      roleActivityCapabilities: null,
    });
    const v = await loadViewer('uid-legacy');
    expect(v.teamIds.has('legacy-team')).toBe(true);
    expect(v.teamIds.size).toBe(1);
  });

  it('users/{uid} 不存在 → 預設 role=user、無權限、不丟錯', async () => {
    mockDocs({
      users: null,
      rolePermissions: null,
      userPermissionGrants: null,
      roleActivityCapabilities: null,
    });
    const v = await loadViewer('uid-missing');
    expect(v.uid).toBe('uid-missing');
    expect(v.role).toBe('user');
    expect(v.roleLevel).toBe(0);
    expect(v.teamIds.size).toBe(0);
    expect(v.displayName).toBeNull();
    expect(v.hasPermission('any')).toBe(false);
  });

  it('讀取 rolePermissions/userPermissionGrants/roleActivityCapabilities 權限錯誤 → 視為空並 warn', async () => {
    mockDocs({
      users: { role: 'user' },
      rolePermissions: 'throw',
      userPermissionGrants: 'throw',
      roleActivityCapabilities: 'throw',
    });

    const v = await loadViewer('uid-no-perm');
    expect(v.uid).toBe('uid-no-perm');
    expect(v.role).toBe('user');
    expect(v.hasPermission('any')).toBe(false);
    expect(v.capabilities).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });

  it('userPermissionGrants 個別授權 → hasPermission 為 true', async () => {
    mockDocs({
      users: { role: 'user' },
      rolePermissions: { permissions: [] },
      userPermissionGrants: {
        grants: [{ code: 'admin.logs.audit_read', granted: true }],
      },
      roleActivityCapabilities: null,
    });
    const v = await loadViewer('uid-grant');
    expect(v.hasPermission('admin.logs.audit_read')).toBe(true);
    expect(v.hasPermission('other.code')).toBe(false);
  });
});

describe('createViewerLoader', () => {
  it('未登入（uid=null）立即切為訪客', () => {
    const events: ViewerView[] = [];
    const loader = createViewerLoader(
      vi.fn(async () => createGuestViewer()),
      (v) => events.push(v),
    );
    loader(null);
    expect(events).toHaveLength(1);
    expect(events[0]?.uid).toBeNull();
    expect(events[0]?.role).toBe('guest');
  });

  it('請求序號防舊結果覆蓋：較晚觸發者優先', async () => {
    const events: ViewerView[] = [];
    let resolveA!: (v: ViewerView) => void;
    let resolveB!: (v: ViewerView) => void;

    const loadMock = vi
      .fn<(uid: string) => Promise<ViewerView>>()
      .mockImplementationOnce(
        () => new Promise<ViewerView>((resolve) => {
          resolveA = resolve;
        }),
      )
      .mockImplementationOnce(
        () => new Promise<ViewerView>((resolve) => {
          resolveB = resolve;
        }),
      );

    const loader = createViewerLoader(loadMock, (v) => events.push(v));

    loader('a');
    loader('b');

    // 先讓 b 完成
    resolveB({ ...createGuestViewer(), uid: 'b', role: 'user' });
    await flushMicrotasks();
    expect(events).toHaveLength(1);
    expect(events[0]?.uid).toBe('b');

    // 再讓 a 完成：seq 檢查應丟棄
    resolveA({ ...createGuestViewer(), uid: 'a', role: 'admin' });
    await flushMicrotasks();
    expect(events).toHaveLength(1);
    expect(events[0]?.uid).toBe('b');
  });

  it('載入失敗時不覆蓋上一個值', async () => {
    const events: ViewerView[] = [];
    const loadMock = vi
      .fn<(uid: string) => Promise<ViewerView>>()
      .mockRejectedValueOnce(new Error('boom'));

    const loader = createViewerLoader(loadMock, (v) => events.push(v));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* noop */
    });

    loader('x');
    await flushMicrotasks();

    expect(events).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
