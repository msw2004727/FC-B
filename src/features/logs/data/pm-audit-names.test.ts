import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetPmNameCacheForTest, resolvePmUserNames } from './pm-audit-names';

const state = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
  whereCalls: [] as string[][],
  getDocsCalls: 0,
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: async () => ({ db: {} }),
}));

vi.mock('firebase/firestore', () => ({
  documentId: () => 'documentId',
  collection: (_db: unknown, name: string) => ({ name }),
  where: (_field: unknown, _op: unknown, value: string[]) => {
    state.whereCalls.push([...value]);
    return { field: _field, op: _op, value };
  },
  query: (...parts: unknown[]) => ({ parts }),
  getDocs: async (q: unknown) => {
    state.getDocsCalls += 1;
    const parts = (q as { parts?: unknown[] }).parts ?? [];
    const wherePart = parts.find(
      (p) => p && typeof p === 'object' && Array.isArray((p as { value?: unknown }).value),
    ) as { value: string[] } | undefined;
    const uids = wherePart?.value ?? [];
    const docs = uids
      .filter((uid) => state.users.has(uid))
      .map((uid) => ({
        id: uid,
        data: () => state.users.get(uid) ?? {},
      }));
    return { docs };
  },
}));

function makeUid(i: number): string {
  return `U${i.toString(16).padStart(32, '0')}`;
}

describe('聊天室稽核 UID 暱稱查詢', () => {
  beforeEach(() => {
    _resetPmNameCacheForTest();
    state.users.clear();
    state.whereCalls.length = 0;
    state.getDocsCalls = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('35 個 UID 分兩批查詢（30＋5）', async () => {
    const uids = Array.from({ length: 35 }, (_, i) => makeUid(i + 1));
    for (const [i, uid] of uids.entries()) {
      state.users.set(uid, { displayName: `名稱${i}` });
    }

    const result = await resolvePmUserNames(uids);

    expect(state.getDocsCalls).toBe(2);
    expect(state.whereCalls).toHaveLength(2);
    expect(state.whereCalls[0]).toHaveLength(30);
    expect(state.whereCalls[1]).toHaveLength(5);
    expect(Object.keys(result)).toHaveLength(35);
    expect(result[uids[0]!]).toBe('名稱0');
  });

  it('displayName 優先、其次 name、都沒有回空字串', async () => {
    const a = makeUid(1);
    const b = makeUid(2);
    const c = makeUid(3);
    state.users.set(a, { displayName: '甲', name: '乙' });
    state.users.set(b, { name: '丙' });
    state.users.set(c, {});

    const result = await resolvePmUserNames([a, b, c]);

    expect(result[a]).toBe('甲');
    expect(result[b]).toBe('丙');
    expect(result[c]).toBe('');
  });

  it('查不到的 UID 回空字串', async () => {
    const a = makeUid(1);
    const missing = makeUid(999);
    state.users.set(a, { displayName: '甲' });

    const result = await resolvePmUserNames([a, missing]);

    expect(result[a]).toBe('甲');
    expect(result[missing]).toBe('');
  });

  it('第二次查同一批不再呼叫 getDocs', async () => {
    const a = makeUid(1);
    state.users.set(a, { displayName: '甲' });

    const first = await resolvePmUserNames([a]);
    const second = await resolvePmUserNames([a]);

    expect(first[a]).toBe('甲');
    expect(second[a]).toBe('甲');
    expect(state.getDocsCalls).toBe(1);
  });

  it('重複與空白 UID 會去重', async () => {
    const a = makeUid(1);
    const b = makeUid(2);
    state.users.set(a, { displayName: '甲' });
    state.users.set(b, { displayName: '乙' });

    const result = await resolvePmUserNames([a, a, '', '   ', b]);

    expect(state.whereCalls).toHaveLength(1);
    expect(state.whereCalls[0]).toEqual([a, b]);
    expect(Object.keys(result).sort()).toEqual([a, b].sort());
    expect(result[a]).toBe('甲');
    expect(result[b]).toBe('乙');
  });

  it('不寫入 localStorage', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const a = makeUid(1);
    state.users.set(a, { displayName: '甲' });

    await resolvePmUserNames([a]);

    expect(setItemSpy).not.toHaveBeenCalled();
  });
});
