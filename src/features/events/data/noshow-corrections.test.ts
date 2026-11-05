import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db: unknown, path: string) => ({ kind: 'collection', db, path })),
  documentId: vi.fn(() => ({ kind: 'documentId' })),
  where: vi.fn((field: unknown, op: string, value: unknown) => ({ kind: 'where', field, op, value })),
  query: vi.fn((...parts: unknown[]) => ({ kind: 'query', parts })),
  getDocs: vi.fn(),
}));
vi.mock('@/data/firebase', () => ({ getFirebase: vi.fn(async () => ({ db: {} })) }));

import { getDocs } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import { loadNoShowAdjustments } from './noshow-corrections';
import { buildNoShowCountByUid } from './noshow-roster';

const getDocsMock = vi.mocked(getDocs);
const getFirebaseMock = vi.mocked(getFirebase);

function batchOf(q: unknown): string[] {
  const parts = (q as { parts: { kind?: string; value?: string[] }[] }).parts;
  return parts.find((part) => part.kind === 'where')?.value ?? [];
}

beforeEach(() => {
  getDocsMock.mockReset();
  getFirebaseMock.mockClear();
});

describe('loadNoShowAdjustments', () => {
  it('無 canViewNoShow 權限時不初始化 Firebase、不讀 userCorrections', async () => {
    expect(await loadNoShowAdjustments(['u1'], false)).toEqual(new Map());
    expect(getFirebaseMock).not.toHaveBeenCalled();
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it('旗標關閉時即使有權限也零讀取', async () => {
    expect(await loadNoShowAdjustments(['u1'], true, false)).toEqual(new Map());
    expect(getFirebaseMock).not.toHaveBeenCalled();
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it('空名單與全空白 UID 零讀取', async () => {
    expect(await loadNoShowAdjustments([], true)).toEqual(new Map());
    expect(await loadNoShowAdjustments(['', ' ', '  '], true)).toEqual(new Map());
    expect(getFirebaseMock).not.toHaveBeenCalled();
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it.each([[1, 1], [30, 1], [31, 2], [61, 3]])(
    '%i 個 UID → %i 次 documentId in 查詢，每批最多 30，僅讀 userCorrections',
    async (count, queries) => {
      const uids = Array.from({ length: count }, (_, i) => 'u' + i);
      getDocsMock.mockImplementation(async (q: unknown) => ({
        docs: batchOf(q).map((id) => ({ id, data: () => ({ noShow: { adjustment: -1 } }) })),
      }) as never);
      const adjustments = await loadNoShowAdjustments(uids, true);
      expect(adjustments.size).toBe(count);
      expect(getDocsMock).toHaveBeenCalledTimes(queries);
      expect(getFirebaseMock).toHaveBeenCalledTimes(1);
      expect(getDocsMock.mock.calls.flatMap(([q]) => batchOf(q))).toEqual(uids);
      for (const [q] of getDocsMock.mock.calls) {
        expect(batchOf(q).length).toBeLessThanOrEqual(30);
        expect(q).toMatchObject({ parts: [
          { path: 'userCorrections' },
          { field: { kind: 'documentId' }, op: 'in' },
        ] });
      }
    },
  );

  it('UID 去重及修剪空白；用文件 ID 而非文件內容 uid 合併補正', async () => {
    getDocsMock.mockResolvedValue({ docs: [{
      id: 'u1', data: () => ({ uid: 'u2', _docId: 'u3', noShow: { adjustment: '-1.9' } }),
    }] } as never);
    const adjustments = await loadNoShowAdjustments([' u1 ', 'u1', 'u2', '', ' '], true);
    expect(batchOf(getDocsMock.mock.calls[0]![0])).toEqual(['u1', 'u2']);
    expect(adjustments).toEqual(new Map([['u1', '-1.9']]));
    expect(buildNoShowCountByUid({
      u1: { noShowCount: 2, endedRegCount: 3, lastEventWasNoShow: true },
      u2: { noShowCount: 4, endedRegCount: 10, lastEventWasNoShow: false },
    }, adjustments)).toEqual(new Map([['u1', 1], ['u2', 4]]));
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });

  it('沒有文件回空 Map；缺 noShow／adjustment 與非法值不影響原次數', async () => {
    getDocsMock.mockResolvedValueOnce({ docs: [] } as never);
    expect(await loadNoShowAdjustments(['missing'], true)).toEqual(new Map());
    getDocsMock.mockResolvedValueOnce({ docs: [
      { id: 'u1', data: () => ({}) },
      { id: 'u2', data: () => ({ noShow: null }) },
      { id: 'u3', data: () => ({ noShow: {} }) },
      { id: 'u4', data: () => ({ noShow: { adjustment: 'invalid' } }) },
      { id: 'u5', data: () => ({ noShow: { adjustment: Infinity } }) },
    ] } as never);
    const uids = ['u1', 'u2', 'u3', 'u4', 'u5'];
    const users = Object.fromEntries(uids.map((uid) => [
      uid, { noShowCount: 2, endedRegCount: 3, lastEventWasNoShow: false },
    ]));
    const adjustments = await loadNoShowAdjustments(uids, true);
    expect(buildNoShowCountByUid(users, adjustments)).toEqual(new Map(uids.map((uid) => [uid, 2])));
  });

  it('每批皆無文件仍只查對應批數，沒有追加全集合掃描', async () => {
    getDocsMock.mockResolvedValue({ docs: [] } as never);
    expect(await loadNoShowAdjustments(Array.from({ length: 61 }, (_, i) => 'u' + i), true))
      .toEqual(new Map());
    expect(getDocsMock).toHaveBeenCalledTimes(3);
  });

  it('失敗直接回報，沒有自動重試；之後可重新呼叫成功', async () => {
    getDocsMock.mockRejectedValueOnce(new Error('offline'));
    await expect(loadNoShowAdjustments(['u1'], true)).rejects.toThrow('offline');
    expect(getDocsMock).toHaveBeenCalledTimes(1);
    getDocsMock.mockResolvedValueOnce({ docs: [{ id: 'u1', data: () => ({ noShow: { adjustment: -1 } }) }] } as never);
    expect(await loadNoShowAdjustments(['u1'], true)).toEqual(new Map([['u1', -1]]));
    expect(getDocsMock).toHaveBeenCalledTimes(2);
  });

  it('第二批失敗不回傳第一批的部分結果；重試重新取得完整結果', async () => {
    const uids = Array.from({ length: 31 }, (_, i) => 'u' + i);
    getDocsMock.mockResolvedValueOnce({ docs: [{ id: 'u0', data: () => ({ noShow: { adjustment: 5 } }) }] } as never);
    getDocsMock.mockRejectedValueOnce(new Error('second batch failed'));
    await expect(loadNoShowAdjustments(uids, true)).rejects.toThrow('second batch failed');
    expect(getDocsMock).toHaveBeenCalledTimes(2);
    getDocsMock.mockImplementation(async (q: unknown) => ({
      docs: batchOf(q).map((id) => ({ id, data: () => ({ noShow: { adjustment: -1 } }) })),
    }) as never);
    const adjustments = await loadNoShowAdjustments(uids, true);
    expect(adjustments.size).toBe(31);
    expect(adjustments.get('u0')).toBe(-1);
    expect(getDocsMock).toHaveBeenCalledTimes(4);
  });

  it('上次成功不會繞過本次權限守門', async () => {
    getDocsMock.mockResolvedValueOnce({ docs: [{ id: 'u1', data: () => ({ noShow: { adjustment: -1 } }) }] } as never);
    await loadNoShowAdjustments(['u1'], true);
    expect(await loadNoShowAdjustments(['u1'], false)).toEqual(new Map());
    expect(getDocsMock).toHaveBeenCalledTimes(1);
    expect(getFirebaseMock).toHaveBeenCalledTimes(1);
  });
});
