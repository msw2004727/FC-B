import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: {} })),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ _collection: name })),
  doc: vi.fn((_db: unknown, collectionName: string, id: string) => ({
    _collection: collectionName,
    _id: id,
  })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn((ref: { _collection: string }, ...constraints: unknown[]) => ({
    _collection: ref._collection,
    _constraints: constraints,
  })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
}));

vi.mock('@/data/auth', () => ({
  getCurrentUser: vi.fn(async () => null),
}));

vi.mock('@/core/events', () => ({
  on: vi.fn(() => () => {
    /* noop unsubscribe */
  }),
}));

import { getDoc, getDocs } from 'firebase/firestore';

import {
  loadViewer,
  createGuestViewer,
  createViewerLoader,
  type ViewerView,
} from './viewer';

type DocVal = Record<string, unknown> | null | 'throw';

interface MockDocOptions {
  users?: DocVal;
  rolePermissions?: DocVal;
  userPermissionGrants?: DocVal;
  roleActivityCapabilities?: DocVal;
  teams?: Array<Record<string, unknown>>;
  adminUsers?: Array<Record<string, unknown>>;
  customRoles?: Array<Record<string, unknown>>;
}

interface WhereConstraint {
  field: string;
  op: string;
  value: unknown;
}

interface QueryLike {
  _collection: string;
  _constraints?: WhereConstraint[];
}

function makeSnapshot(data: Record<string, unknown> | null) {
  return {
    exists: () => data !== null,
    data: () => (data === null ? undefined : data),
  };
}

function makeQuerySnapshot(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    docs: docs.map((d) => ({
      id: d.id,
      data: () => d.data,
    })),
  };
}

function matchesConstraint(team: Record<string, unknown>, constraint: WhereConstraint | undefined): boolean {
  if (!constraint) return true;
  const value = team[constraint.field];
  if (constraint.op === '==') return value === constraint.value;
  if (constraint.op === 'array-contains') {
    return Array.isArray(value) && value.includes(constraint.value);
  }
  return true;
}

function mockFirestore(opts: MockDocOptions): void {
  const getDocMock = getDoc as unknown as { mockImplementation: (f: unknown) => void };
  getDocMock.mockImplementation(async (ref: { _collection: string }) => {
    const key = ref._collection as keyof MockDocOptions;
    const val = opts[key] as DocVal | undefined;
    if (val === 'throw') {
      const err = Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
      throw err;
    }
    return makeSnapshot(val ?? null);
  });

  const getDocsMock = getDocs as unknown as { mockImplementation: (f: unknown) => void };
  getDocsMock.mockImplementation(async (q: QueryLike) => {
    const collectionName = q._collection;
    const constraint = q._constraints?.[0];

    if (collectionName === 'teams') {
      const teams = (opts.teams ?? []).filter((team) => matchesConstraint(team, constraint));
      return makeQuerySnapshot(
        teams.map((team, index) => ({
          id: String(team.id ?? `team-${index}`),
          data: team,
        })),
      );
    }

    if (collectionName === 'adminUsers') {
      const users = (opts.adminUsers ?? []).filter((user) => matchesConstraint(user, constraint));
      return makeQuerySnapshot(
        users.map((user, index) => ({
          id: String(user.id ?? `admin-${index}`),
          data: user,
        })),
      );
    }

    if (collectionName === 'customRoles') {
      return makeQuerySnapshot(
        (opts.customRoles ?? []).map((role, index) => ({
          id: String(role.id ?? role.key ?? `role-${index}`),
          data: role,
        })),
      );
    }

    return makeQuerySnapshot([]);
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

function viewerFor(
  uid: string,
  role = 'user',
  roleLevel = 0,
  allowed = false,
): ViewerView {
  return {
    ...createGuestViewer(),
    uid,
    role,
    roleLevel,
    hasPermission: () => allowed,
  };
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
    mockFirestore({
      users: {
        role: 'coach',
        teamIds: ['t1', 't2'],
        displayName: 'Coach A',
        pictureUrl: 'https://example.com/a.png',
      },
      rolePermissions: { permissions: ['event.create', 'event.manage'] },
      userPermissionGrants: { uid: 'uid-coach', enabled: true, permissions: [] },
      roleActivityCapabilities: null,
    });

    const v = await loadViewer('uid-coach');

    expect(v.uid).toBe('uid-coach');
    expect(v.role).toBe('coach');
    expect(v.roleLevel).toBe(1);
    expect(v.displayName).toBe('Coach A');
    expect(v.pictureUrl).toBe('https://example.com/a.png');
    expect(v.teamIds.has('t1')).toBe(true);
    expect(v.teamIds.has('t2')).toBe(true);
    expect(v.hasPermission('event.create')).toBe(true);
    expect(v.hasPermission('event.manage')).toBe(true);
    expect(v.hasPermission('event.delete')).toBe(false);
    expect(v.capabilities).toEqual([]);
  });

  it('舊欄位 teamId（字串）也納入 teamIds', async () => {
    mockFirestore({
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
    mockFirestore({
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

  it('讀取文件權限錯誤 → 視為空並 warn', async () => {
    mockFirestore({
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

  it('rolePermissions/user 不授予 admin.repair.event_blocklist', async () => {
    mockFirestore({
      users: { role: 'user' },
      rolePermissions: { permissions: ['admin.repair.event_blocklist'] },
      userPermissionGrants: null,
      roleActivityCapabilities: null,
    });
    const v = await loadViewer('uid-user');
    expect(v.hasPermission('admin.repair.event_blocklist')).toBe(false);
  });

  it('有效的 userPermissionGrants 可授予 admin.repair.event_blocklist', async () => {
    mockFirestore({
      users: { role: 'user' },
      rolePermissions: { permissions: [] },
      userPermissionGrants: {
        uid: 'uid-grant',
        enabled: true,
        permissions: ['admin.repair.event_blocklist'],
      },
      roleActivityCapabilities: null,
    });
    const v = await loadViewer('uid-grant');
    expect(v.hasPermission('admin.repair.event_blocklist')).toBe(true);
  });

  it('停用的 userPermissionGrants 不授予權限', async () => {
    mockFirestore({
      users: { role: 'user' },
      rolePermissions: { permissions: [] },
      userPermissionGrants: {
        uid: 'uid-grant',
        enabled: false,
        permissions: ['admin.repair.event_blocklist'],
      },
      roleActivityCapabilities: null,
    });
    const v = await loadViewer('uid-grant');
    expect(v.hasPermission('admin.repair.event_blocklist')).toBe(false);
  });

  it('super_admin inherent 權限為 true', async () => {
    mockFirestore({
      users: { role: 'super_admin' },
      rolePermissions: { permissions: [] },
      userPermissionGrants: null,
      roleActivityCapabilities: null,
    });
    const v = await loadViewer('uid-super');
    expect(v.hasPermission('admin.repair.event_blocklist')).toBe(true);
    expect(v.hasPermission('admin.seo.entry')).toBe(true);
  });

  it('roleActivityCapabilities 讀取 roleActivityCapabilities/user 的 capabilities 欄位', async () => {
    mockFirestore({
      users: { role: 'user' },
      rolePermissions: null,
      userPermissionGrants: null,
      roleActivityCapabilities: {
        capabilities: ['user.activity.basic_create'],
        user: ['wrong.code'],
      },
    });
    const v = await loadViewer('uid-caps');
    expect(v.capabilities).toEqual(['user.activity.basic_create']);
  });

  it('自訂角色由 customRoles 載入並傳入 getRoleLevel', async () => {
    mockFirestore({
      users: { role: 'judge' },
      rolePermissions: { permissions: [] },
      userPermissionGrants: null,
      roleActivityCapabilities: null,
      customRoles: [{ id: 'cr1', key: 'judge', afterRole: 'captain' }],
    });
    const v = await loadViewer('uid-judge');
    expect(v.roleLevel).toBeCloseTo(2.5, 10);
  });

  it('俱樂部範圍以 UID 補齊 captain / leaderUid / leaderUids / coachUids', async () => {
    mockFirestore({
      users: { role: 'user', teamIds: [], displayName: 'Same Name' },
      rolePermissions: null,
      userPermissionGrants: null,
      roleActivityCapabilities: null,
      teams: [
        { id: 'team-captain', captainUid: 'uid-1' },
        { id: 'team-leader', leaderUid: 'uid-1' },
        { id: 'team-leader-array', leaderUids: ['uid-1'] },
        { id: 'team-coach', coachUids: ['uid-1'] },
        { id: 'team-same-name', captainUid: 'other-uid', captainName: 'Same Name' },
      ],
    });
    const v = await loadViewer('uid-1');
    expect(v.teamIds.has('team-captain')).toBe(true);
    expect(v.teamIds.has('team-leader')).toBe(true);
    expect(v.teamIds.has('team-leader-array')).toBe(true);
    expect(v.teamIds.has('team-coach')).toBe(true);
    expect(v.teamIds.has('team-same-name')).toBe(false);
  });

  it('adminUsers 以 UID 比對補齊 teamIds / teamId，不使用名稱', async () => {
    mockFirestore({
      users: { role: 'user', teamIds: [], displayName: 'Same Name' },
      rolePermissions: null,
      userPermissionGrants: null,
      roleActivityCapabilities: null,
      adminUsers: [
        { id: 'au1', uid: 'uid-1', teamIds: ['admin-team'], teamId: 'admin-team-2' },
        { id: 'au2', uid: 'other-uid', name: 'Same Name', teamIds: ['wrong-team'] },
      ],
    });
    const v = await loadViewer('uid-1');
    expect(v.teamIds.has('admin-team')).toBe(true);
    expect(v.teamIds.has('admin-team-2')).toBe(true);
    expect(v.teamIds.has('wrong-team')).toBe(false);
  });
});

describe('createViewerLoader', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {
      /* noop */
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('切換 UID 時立即換成新 UID 的最小權限暫態；新 UID 載入失敗維持暫態', async () => {
    const events: ViewerView[] = [];
    let rejectUser!: (err: unknown) => void;

    const loadMock = vi
      .fn<(uid: string) => Promise<ViewerView>>()
      .mockImplementationOnce(async () => viewerFor('admin', 'admin', 4, true))
      .mockImplementationOnce(
        () => new Promise<ViewerView>((_resolve, reject) => {
          rejectUser = reject;
        }),
      );

    const loader = createViewerLoader(loadMock, (v) => events.push(v));

    loader('admin');
    expect(events).toHaveLength(1);
    expect(events[0]?.uid).toBe('admin');
    expect(events[0]?.role).toBe('user');
    expect(events[0]?.roleLevel).toBe(0);
    expect(events[0]?.hasPermission('anything')).toBe(false);

    await flushMicrotasks();
    expect(events).toHaveLength(2);
    expect(events[1]?.uid).toBe('admin');
    expect(events[1]?.role).toBe('admin');
    expect(events[1]?.hasPermission('anything')).toBe(true);

    loader('user');
    expect(events).toHaveLength(3);
    expect(events[2]?.uid).toBe('user');
    expect(events[2]?.role).toBe('user');
    expect(events[2]?.roleLevel).toBe(0);
    expect(events[2]?.hasPermission('anything')).toBe(false);

    rejectUser(new Error('permission-denied'));
    await flushMicrotasks();
    expect(events).toHaveLength(3);
    expect(events[2]?.uid).toBe('user');
    expect(events[2]?.hasPermission('anything')).toBe(false);
  });

  it('同一 UID 的重新整理失敗時保留上一份完整資料', async () => {
    const events: ViewerView[] = [];
    const loadMock = vi
      .fn<(uid: string) => Promise<ViewerView>>()
      .mockResolvedValueOnce(viewerFor('u1', 'admin', 4, true))
      .mockRejectedValueOnce(new Error('boom'));

    const loader = createViewerLoader(loadMock, (v) => events.push(v));

    loader('u1');
    await flushMicrotasks();
    expect(events).toHaveLength(2);
    expect(events[1]?.role).toBe('admin');
    expect(events[1]?.hasPermission('anything')).toBe(true);

    loader('u1');
    expect(events).toHaveLength(2);
    await flushMicrotasks();
    expect(events).toHaveLength(2);
    expect(events[1]?.role).toBe('admin');
    expect(events[1]?.hasPermission('anything')).toBe(true);
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
    expect(events).toHaveLength(2);
    expect(events[0]?.uid).toBe('a');
    expect(events[1]?.uid).toBe('b');

    resolveB(viewerFor('b', 'admin', 4, true));
    await flushMicrotasks();
    expect(events).toHaveLength(3);
    expect(events[2]?.uid).toBe('b');
    expect(events[2]?.role).toBe('admin');

    resolveA(viewerFor('a', 'admin', 4, true));
    await flushMicrotasks();
    expect(events).toHaveLength(3);
    expect(events[2]?.uid).toBe('b');
  });
});
