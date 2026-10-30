import { beforeEach, describe, expect, it, vi } from 'vitest';
const mockDocs = vi.fn();
const mockCount = vi.fn();
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: {} }) }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => name,
  getDocsFromServer: (name: string) => mockDocs(name),
  query: (name: string, ...conditions: unknown[]) => ({ name, conditions }),
  orderBy: (field: string) => ({ field, order: true }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  getCountFromServer: (q: unknown) => mockCount(q),
}));
import { loadRoleCounts, loadRolesData } from './role-admin';

beforeEach(() => {
  vi.resetAllMocks();
  mockDocs.mockImplementation(async (name: string) => ({ docs: name === 'roleActivityCapabilities'
    ? [{ id: 'user', data: () => ({ capabilities: [] }) }]
    : name === 'rolePermissions' ? [{ id: 'coach', data: () => ({ permissions: [], defaultPermissions: [], catalogVersion: 'old' }) }]
    : [] }));
  mockCount.mockImplementation(async (q: string | { conditions: { order?: boolean; value?: unknown }[] }) => {
    let count = 0;
    if (typeof q === 'string') count = 12;
    else if (q.conditions[0]?.order) count = 10;
    else {
      const value = q.conditions[0]?.value;
      if (value === 'user') count = 3;
      else if (value === null || value === '') count = 1;
      else if (value === 'coach') count = 3;
    }
    return { data: () => ({ count }) };
  });
});
describe('T-079a 一次性讀取與 Q6', () => {
  it('缺 role＝total - 有 role，未知角色不被誤算為 user，另補 A falsy 值', async () => {
    expect(await loadRoleCounts(['user', 'coach'])).toEqual({ user: 7, coach: 3 });
    expect(mockDocs).not.toHaveBeenCalled();
    expect(mockCount).toHaveBeenCalledWith({ name: 'users', conditions: [{ field: 'role', order: true }] });
  });
  it.each([0, false])('S6 user 聚合 count=%s，false／0 角色與缺欄補算都保留', async userCount => {
    mockCount.mockImplementation(async (q: string | { conditions: { order?: boolean; value?: unknown }[] }) => {
      const condition = typeof q === 'string' ? undefined : q.conditions[0];
      const count = typeof q === 'string' ? 9 : condition?.order ? 7
        : condition?.value === 'user' ? userCount
        : condition?.value === false ? 2 : condition?.value === 0 ? 3 : 0;
      return { data: () => ({ count }) };
    });
    const result = await loadRoleCounts(['user', 'coach']);
    expect(result).toEqual({ user: 7, coach: 0 });
    expect(Number.isFinite(result['user'])).toBe(true);
    for (const value of [false, 0]) {
      expect(mockCount).toHaveBeenCalledWith({ name: 'users', conditions: [{ field: 'role', op: '==', value }] });
    }
    expect(mockDocs).not.toHaveBeenCalled();
  });
  it.each([0, false])('S6 空聚合 count=%s 回傳數值零，不產生 NaN', async count => {
    mockCount.mockResolvedValue({ data: () => ({ count }) });
    expect(await loadRoleCounts(['user'])).toEqual({ user: 0 });
  });
  it('S6 keys 不含 user 仍補算缺 role 欄位', async () => {
    expect(await loadRoleCounts(['coach'])).toEqual({ user: 4, coach: 3 });
  });
  it('四集合只讀一次，不下載 users，保留 raw metadata 與空 capabilities', async () => {
    const result = await loadRolesData();
    expect(mockDocs.mock.calls.map(call => call[0]).sort()).toEqual(
      ['customRoles', 'permissions', 'roleActivityCapabilities', 'rolePermissions'].sort(),
    );
    expect(result.rolePermissions['coach']).toEqual({ permissions: [], defaultPermissions: [], catalogVersion: 'old' });
    expect(result.roleActivityCapabilities).toEqual({ user: [] });
    expect(result.counts['user']).toBe(7);
  });
  it('集合或聚合失敗不假裝空資料，不產生可寫快照', async () => {
    mockDocs.mockRejectedValueOnce(new Error('synthetic-load-failure'));
    await expect(loadRolesData()).rejects.toThrow();
    mockCount.mockRejectedValueOnce(new Error('synthetic-count-failure'));
    await expect(loadRolesData()).rejects.toThrow();
  });
});
