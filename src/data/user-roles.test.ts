import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db: unknown, path: string) => ({ kind: 'collection', db, path })),
  documentId: vi.fn(() => ({ kind: 'documentId' })),
  where: vi.fn((field: unknown, op: string, value: unknown) => ({
    kind: 'where', field, op, value,
  })),
  query: vi.fn((...parts: unknown[]) => ({ kind: 'query', parts })),
  getDocs: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: {} })),
}));

import { getDocs } from 'firebase/firestore';
import {
  _resetUserRolesCacheForTest,
  getCachedUserLevel,
  getCachedUserNoShowStats,
  loadUserNoShowStats,
  loadUserRoles,
  useUserRoles,
  userLevelFromExp,
} from './user-roles';

const getDocsMock = vi.mocked(getDocs);

function extractBatchUids(arg: unknown): string[] {
  if (typeof arg !== 'object' || arg === null) return [];
  const obj = arg as { kind?: string; parts?: unknown[] };
  if (obj.kind !== 'query' || !Array.isArray(obj.parts)) return [];
  for (const part of obj.parts) {
    if (typeof part !== 'object' || part === null) continue;
    const w = part as { kind?: string; op?: string; value?: unknown };
    if (w.kind === 'where' && w.op === 'in' && Array.isArray(w.value)) {
      return w.value.filter((v): v is string => typeof v === 'string');
    }
  }
  return [];
}

interface FakeDocSnap {
  id: string;
  data: () => Record<string, unknown>;
}

function makeSnapshot(rolesByUid: Record<string, string | undefined>): {
  docs: FakeDocSnap[];
} {
  const docs: FakeDocSnap[] = [];
  for (const [id, role] of Object.entries(rolesByUid)) {
    if (role === undefined) {
      docs.push({ id, data: () => ({}) });
    } else {
      docs.push({ id, data: () => ({ role }) });
    }
  }
  return { docs };
}

function mockGetDocsByUid(rolesByUid: Record<string, string | undefined>): void {
  getDocsMock.mockImplementation(async (q: unknown) => {
    const uids = extractBatchUids(q);
    const subset: Record<string, string | undefined> = {};
    for (const uid of uids) subset[uid] = rolesByUid[uid];
    return makeSnapshot(subset) as never;
  });
}

beforeEach(() => {
  _resetUserRolesCacheForTest();
  getDocsMock.mockReset();
});

describe('loadUserRoles', () => {
  it('31 個 UID → 2 次查詢（每批 30）', async () => {
    const uids = Array.from({ length: 31 }, (_, i) => `u${i + 1}`);
    const roles: Record<string, string> = {};
    for (const uid of uids) roles[uid] = 'coach';
    mockGetDocsByUid(roles);

    const result = await loadUserRoles(uids);

    expect(getDocsMock).toHaveBeenCalledTimes(2);
    expect(Object.keys(result).sort()).toEqual(uids.slice().sort());
    for (const uid of uids) expect(result[uid]).toBe('coach');
  });

  it('去重、去空白', async () => {
    mockGetDocsByUid({ u1: 'admin', u2: 'user' });

    await loadUserRoles([' u1 ', 'u1', 'u2', '', '   ']);

    expect(getDocsMock).toHaveBeenCalledTimes(1);
    const firstCall = getDocsMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const uids = extractBatchUids(firstCall![0]);
    expect(uids.sort()).toEqual(['u1', 'u2']);
  });

  it('快取命中不再查', async () => {
    mockGetDocsByUid({ u1: 'admin' });

    await loadUserRoles(['u1']);
    expect(getDocsMock).toHaveBeenCalledTimes(1);

    const second = await loadUserRoles(['u1']);
    expect(getDocsMock).toHaveBeenCalledTimes(1);
    expect(second.u1).toBe('admin');
  });

  it('未知角色值退回 user', async () => {
    mockGetDocsByUid({ u1: 'unknown_role', u2: 'coach' });

    const result = await loadUserRoles(['u1', 'u2']);
    expect(result.u1).toBe('user');
    expect(result.u2).toBe('coach');
  });

  it('查詢失敗不丟例外，回傳 user', async () => {
    getDocsMock.mockRejectedValueOnce(new Error('boom'));

    const result = await loadUserRoles(['u1', 'u2']);
    expect(result.u1).toBe('user');
    expect(result.u2).toBe('user');
  });
});

describe('useUserRoles', () => {
  it('uids 內容不變時不重查', async () => {
    mockGetDocsByUid({ u1: 'admin', u2: 'coach' });

    const { result, rerender } = renderHook(
      ({ uids }: { uids: string[] }) => useUserRoles(uids),
      { initialProps: { uids: ['u1', 'u2'] } },
    );

    await waitFor(() => {
      expect(result.current.u1).toBe('admin');
      expect(result.current.u2).toBe('coach');
    });
    expect(getDocsMock).toHaveBeenCalledTimes(1);

    // 同樣內容、新陣列身分 → 不應重查。
    rerender({ uids: ['u1', 'u2'] });
    await Promise.resolve();
    expect(getDocsMock).toHaveBeenCalledTimes(1);

    // 內容改變 → 應重查。
    rerender({ uids: ['u1', 'u2', 'u3'] });
    await waitFor(() => {
      expect(getDocsMock).toHaveBeenCalledTimes(2);
    });
  });
});

describe('隱身與等級（照 A _stealthRole、_calcLevelFromExp）', () => {
  beforeEach(() => {
    _resetUserRolesCacheForTest();
    getDocsMock.mockReset();
  });

  it('管理員／總管開啟隱身時顯示為一般用戶；其他角色不受影響', async () => {
    getDocsMock.mockResolvedValue({
      docs: [
        { id: 'a1', data: () => ({ role: 'admin', stealth: true }) },
        { id: 's1', data: () => ({ role: 'super_admin', stealth: true }) },
        { id: 'a2', data: () => ({ role: 'admin', stealth: false }) },
        { id: 'c1', data: () => ({ role: 'coach', stealth: true }) },
      ],
    } as never);
    const roles = await loadUserRoles(['a1', 's1', 'a2', 'c1']);
    expect(roles).toEqual({ a1: 'user', s1: 'user', a2: 'admin', c1: 'coach' });
  });

  it('快取 EXP 算出 A 的等級；沒有快取回 undefined', async () => {
    expect(userLevelFromExp(0)).toBe(0);
    expect(userLevelFromExp(99)).toBe(0);
    expect(userLevelFromExp(100)).toBe(1);
    expect(userLevelFromExp(300)).toBe(2);
    getDocsMock.mockResolvedValue({ docs: [{ id: 'u1', data: () => ({ role: 'user', exp: 300 }) }] } as never);
    expect(getCachedUserLevel('u1')).toBeUndefined();
    await loadUserRoles(['u1']);
    expect(getCachedUserLevel('u1')).toBe(2);
  });
});

// T-073a：三欄沿用 users 查詢，不能為統計另讀一次 users。
afterEach(() => {
  vi.restoreAllMocks();
});

const emptyNoShowStats = { noShowCount: 0, endedRegCount: 0, lastEventWasNoShow: false };

describe('放鴿子統計共用角色快取', () => {
  it('既有角色查詢同時快取三欄，以文件 ID 為 key，保留隱身與 EXP 行為', async () => {
    getDocsMock.mockResolvedValue({ docs: [{
      id: 'u1',
      data: () => ({
        uid: 'wrong-uid', lineUserId: 'wrong-line-uid', role: 'admin', stealth: true,
        exp: 300, noShowCount: '2', endedRegCount: '3', lastEventWasNoShow: true,
      }),
    }] } as never);
    expect(await loadUserRoles(['u1'])).toEqual({ u1: 'user' });
    expect(getCachedUserLevel('u1')).toBe(2);
    expect(getCachedUserNoShowStats(' u1 ')).toEqual({
      noShowCount: 2, endedRegCount: 3, lastEventWasNoShow: true,
    });
    expect(getCachedUserNoShowStats('wrong-uid')).toBeUndefined();
    const stats = await loadUserNoShowStats(['u1']);
    expect(stats.u1).toEqual(getCachedUserNoShowStats('u1'));
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });

  it('缺欄、缺文件、無法轉成數字時回 0／false，缺文件也快取', async () => {
    getDocsMock.mockResolvedValue({ docs: [
      { id: 'empty', data: () => ({}) },
      { id: 'invalid', data: () => ({ noShowCount: 'bad', endedRegCount: NaN, lastEventWasNoShow: 0 }) },
    ] } as never);
    const stats = await loadUserNoShowStats(['empty', 'invalid', 'missing']);
    expect(stats).toEqual({ empty: emptyNoShowStats, invalid: emptyNoShowStats, missing: emptyNoShowStats });
    await loadUserRoles(['missing']);
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });

  it('同步 getter 不查詢、回傳副本，修改回傳物件不污染快取', async () => {
    expect(getCachedUserNoShowStats('missing')).toBeUndefined();
    expect(getDocsMock).not.toHaveBeenCalled();
    getDocsMock.mockResolvedValue({ docs: [{ id: 'u1', data: () => ({ noShowCount: 2 }) }] } as never);
    const stats = await loadUserNoShowStats(['u1']);
    stats.u1!.noShowCount = 99;
    const cached = getCachedUserNoShowStats('u1')!;
    cached.noShowCount = 88;
    expect(getCachedUserNoShowStats('u1')?.noShowCount).toBe(2);
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });

  it('角色與統計同時讀 31 個 UID，共用同批 inflight，仍只有 2 次 users 查詢', async () => {
    const uids = Array.from({ length: 31 }, (_, i) => 'u' + i);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    getDocsMock.mockImplementation(async (q: unknown) => {
      await gate;
      return { docs: extractBatchUids(q).map((id) => ({
        id, data: () => ({ role: 'coach', noShowCount: 2, endedRegCount: 10, lastEventWasNoShow: true }),
      })) } as never;
    });
    const rolesPromise = loadUserRoles(uids);
    const statsPromise = loadUserNoShowStats([...uids].reverse());
    await waitFor(() => expect(getDocsMock).toHaveBeenCalledTimes(1));
    release();
    const [roles, stats] = await Promise.all([rolesPromise, statsPromise]);
    expect(Object.keys(stats)).toHaveLength(31);
    for (const uid of uids) {
      expect(roles[uid]).toBe('coach');
      expect(stats[uid]).toEqual({ noShowCount: 2, endedRegCount: 10, lastEventWasNoShow: true });
    }
    await loadUserNoShowStats([' u0 ', 'u0', 'u30', '', ' ']);
    expect(getDocsMock).toHaveBeenCalledTimes(2);
    expect(getDocsMock.mock.calls.map(([q]) => extractBatchUids(q).length)).toEqual([30, 1]);
    for (const [q] of getDocsMock.mock.calls) {
      expect(q).toMatchObject({ parts: [
        { path: 'users' },
        { field: { kind: 'documentId' }, op: 'in' },
      ] });
    }
  });

  it('統計先載入後讀角色仍共用快取，空白與重複 UID 不增加讀取', async () => {
    getDocsMock.mockResolvedValue({ docs: [{ id: 'u1', data: () => ({ role: 'coach', noShowCount: 1 }) }] } as never);
    expect(Object.keys(await loadUserNoShowStats([' u1 ', 'u1', ' ', '']))).toEqual(['u1']);
    expect(await loadUserRoles(['u1'])).toEqual({ u1: 'coach' });
    expect(extractBatchUids(getDocsMock.mock.calls[0]![0])).toEqual(['u1']);
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });

  it('5 分鐘到期前不查，到期的同步 getter 回 undefined，再載入才更新三欄', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    getDocsMock.mockResolvedValueOnce({ docs: [{ id: 'u1', data: () => ({ noShowCount: 2 }) }] } as never);
    await loadUserRoles(['u1']);
    now.mockReturnValue(300_999);
    await loadUserNoShowStats(['u1']);
    expect(getCachedUserNoShowStats('u1')?.noShowCount).toBe(2);
    expect(getDocsMock).toHaveBeenCalledTimes(1);
    now.mockReturnValue(301_000);
    expect(getCachedUserNoShowStats('u1')).toBeUndefined();
    getDocsMock.mockResolvedValueOnce({ docs: [{ id: 'u1', data: () => ({
      noShowCount: 3, endedRegCount: 4, lastEventWasNoShow: true,
    }) }] } as never);
    expect((await loadUserNoShowStats(['u1'])).u1).toEqual({
      noShowCount: 3, endedRegCount: 4, lastEventWasNoShow: true,
    });
    expect(getDocsMock).toHaveBeenCalledTimes(2);
  });

  it('首次失敗回預設值、不寫失敗快取；再次呼叫可成功', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getDocsMock.mockRejectedValueOnce(new Error('offline'));
    expect(await loadUserNoShowStats(['u1'])).toEqual({ u1: emptyNoShowStats });
    expect(getCachedUserNoShowStats('u1')).toBeUndefined();
    getDocsMock.mockResolvedValueOnce({ docs: [{ id: 'u1', data: () => ({ noShowCount: 2 }) }] } as never);
    expect((await loadUserNoShowStats(['u1'])).u1?.noShowCount).toBe(2);
    expect(getDocsMock).toHaveBeenCalledTimes(2);
  });

  it('到期重讀失敗沿用舊統計，且不把舊值視為新鮮快取', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    getDocsMock.mockResolvedValueOnce({ docs: [{ id: 'u1', data: () => ({ noShowCount: 2 }) }] } as never);
    await loadUserRoles(['u1']);
    now.mockReturnValue(300_000);
    getDocsMock.mockRejectedValueOnce(new Error('offline'));
    expect((await loadUserNoShowStats(['u1'])).u1?.noShowCount).toBe(2);
    expect(getCachedUserNoShowStats('u1')).toBeUndefined();
    getDocsMock.mockResolvedValueOnce({ docs: [{ id: 'u1', data: () => ({ noShowCount: 1 }) }] } as never);
    expect((await loadUserNoShowStats(['u1'])).u1?.noShowCount).toBe(1);
    expect(getDocsMock).toHaveBeenCalledTimes(3);
  });

  it('空名單零查詢', async () => {
    expect(await loadUserNoShowStats(['', ' '])).toEqual({});
    expect(getDocsMock).not.toHaveBeenCalled();
  });
});
