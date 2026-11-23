/**
 * 臨時取消：名單出席場數讀取與確認框操作者資料（複審 P2-1、P3-3）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db: unknown, path: string) => ({ kind: 'collection', db, path })),
  documentId: vi.fn(() => ({ kind: 'documentId' })),
  where: vi.fn((field: unknown, op: string, value: unknown) => ({ kind: 'where', field, op, value })),
  query: vi.fn((...parts: unknown[]) => ({ kind: 'query', parts })),
  getDocs: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: {} })),
}));

import { getDocs } from 'firebase/firestore';
import { _resetUserRolesCacheForTest } from '@/data/user-roles';
import {
  _resetLateCancelAttendedCacheForTest,
  loadAttendedCounts,
  loadLateCancelUser,
} from './use-late-cancel-tags';

const getDocsMock = vi.mocked(getDocs);

function collectionOf(arg: unknown): string {
  const parts = (arg as { parts?: unknown[] }).parts ?? [];
  const col = parts.find(part => (part as { kind?: string }).kind === 'collection') as { path?: string } | undefined;
  return col?.path ?? '';
}

function snap(docs: Record<string, Record<string, unknown>>): { docs: { id: string; data: () => Record<string, unknown> }[] } {
  return { docs: Object.entries(docs).map(([id, data]) => ({ id, data: () => data })) };
}

beforeEach(() => {
  getDocsMock.mockReset();
  _resetLateCancelAttendedCacheForTest();
  _resetUserRolesCacheForTest();
});

describe('loadAttendedCounts', () => {
  it('同時讀兩次同一批 UID 只打一次 Firestore（進行中請求共用）', async () => {
    let resolve!: (value: unknown) => void;
    getDocsMock.mockImplementation(() => new Promise(r => { resolve = r; }) as never);
    const first = loadAttendedCounts(['u1', 'u2']);
    const second = loadAttendedCounts(['u2', 'u1']);
    await vi.waitFor(() => expect(getDocsMock).toHaveBeenCalledTimes(1));
    resolve(snap({ u1: { attendedCount: 4 } }));
    const [a, b] = await Promise.all([first, second]);
    expect(getDocsMock).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(a)).toEqual({ u1: 4, u2: 0 });
    expect(Object.fromEntries(b)).toEqual({ u1: 4, u2: 0 });
  });

  it('讀取失敗會 reject，且不留下卡住的進行中請求：下一次可重試', async () => {
    getDocsMock.mockRejectedValueOnce(new Error('offline'));
    await expect(loadAttendedCounts(['u1'])).rejects.toThrow('offline');
    getDocsMock.mockResolvedValueOnce(snap({ u1: { attendedCount: 2 } }) as never);
    const counts = await loadAttendedCounts(['u1']);
    expect(counts.get('u1')).toBe(2);
    expect(getDocsMock).toHaveBeenCalledTimes(2);
  });
});

describe('loadLateCancelUser', () => {
  it('略過快取重讀：剛記過點的人拿到伺服器最新次數', async () => {
    getDocsMock.mockImplementation((async (q: unknown) => {
      expect(collectionOf(q)).toBe('users');
      return snap({ u1: { lateCancelLevel: 'black', lateCancelRecent: [] } });
    }) as never);
    const first = await loadLateCancelUser('u1');
    expect(first?.level).toBe('black');

    const now = Date.now();
    getDocsMock.mockImplementation((async () => snap({
      u1: { lateCancelLevel: 'red', lateCancelRecent: [now - 1000, now - 500, now] },
    })) as never);
    const second = await loadLateCancelUser('u1');
    expect(getDocsMock).toHaveBeenCalledTimes(2);
    expect(second?.level).toBe('red');
  });
});
