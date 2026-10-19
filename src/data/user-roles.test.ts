import { describe, it, expect, beforeEach, vi } from 'vitest';
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
