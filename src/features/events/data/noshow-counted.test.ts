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
import { loadCountedNoShowStats } from './noshow-counted';

const getDocsMock = vi.mocked(getDocs);
const getFirebaseMock = vi.mocked(getFirebase);

function partsOf(q: unknown): { kind?: string; value?: string[]; path?: string; op?: string }[] {
  return (q as { parts: { kind?: string; value?: string[]; path?: string; op?: string }[] }).parts;
}
function batchOf(q: unknown): string[] {
  return partsOf(q).find((part) => part.kind === 'where')?.value ?? [];
}
const V2_DOC = { countedSince: '2026-11-06', countedCount: 10, countedNoShowCount: 6 };

beforeEach(() => {
  getDocsMock.mockReset();
  getFirebaseMock.mockClear();
});

// 新增（站長 11-06 放鴿子／出席率 v2）：管理名單 🕊 的資料來源 userAttendanceStats。
describe('loadCountedNoShowStats', () => {
  it('無 canViewNoShow 權限時不初始化 Firebase、不讀 userAttendanceStats', async () => {
    expect(await loadCountedNoShowStats(['u1'], false)).toEqual(new Map());
    expect(getFirebaseMock).not.toHaveBeenCalled();
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it('旗標關閉、空名單與全空白 UID 都零讀取', async () => {
    expect(await loadCountedNoShowStats(['u1'], true, false)).toEqual(new Map());
    expect(await loadCountedNoShowStats([], true)).toEqual(new Map());
    expect(await loadCountedNoShowStats(['', ' '], true)).toEqual(new Map());
    expect(getFirebaseMock).not.toHaveBeenCalled();
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it.each([[1, 1], [30, 1], [31, 2], [61, 3]])(
    '%i 個 UID → %i 次 documentId in 查詢，每塊最多 30，只讀 userAttendanceStats，UID 去重並修剪',
    async (count, queries) => {
      const uids = Array.from({ length: count }, (_, i) => 'u' + i);
      getDocsMock.mockImplementation(async (q: unknown) => ({
        docs: batchOf(q).map((id) => ({ id, data: () => V2_DOC })),
      }) as never);
      const result = await loadCountedNoShowStats([...uids, ` ${uids[0]} `, ''], true);
      expect(result.size).toBe(count);
      expect(getDocsMock).toHaveBeenCalledTimes(queries);
      expect(getFirebaseMock).toHaveBeenCalledTimes(1);
      for (const [q] of getDocsMock.mock.calls) {
        expect(partsOf(q)[0]?.path).toBe('userAttendanceStats');
        expect(partsOf(q).find((part) => part.kind === 'where')?.op).toBe('in');
        expect(batchOf(q).length).toBeLessThanOrEqual(30);
      }
    },
  );

  it('只回傳有 countedSince 的人：放鴿子＝countedNoShowCount、計入＝countedCount；以文件 ID 為準', async () => {
    getDocsMock.mockResolvedValue({ docs: [
      { id: 'v2', data: () => ({ ...V2_DOC, uid: 'other' }) },
      { id: 'noSince', data: () => ({ countedCount: 9, countedNoShowCount: 9 }) },
      { id: 'emptySince', data: () => ({ countedSince: '', countedCount: 9, countedNoShowCount: 9 }) },
      { id: 'zero', data: () => ({ countedSince: '2026-11-06' }) },
      { id: 'dirty', data: () => ({ countedSince: '2026-11-06', countedCount: '4.9', countedNoShowCount: -3 }) },
    ] } as never);
    const result = await loadCountedNoShowStats(['v2', 'noSince', 'emptySince', 'zero', 'dirty', 'missing'], true);
    expect(result).toEqual(new Map([
      ['v2', { noShowCount: 6, countedCount: 10 }],
      ['zero', { noShowCount: 0, countedCount: 0 }],
      ['dirty', { noShowCount: 0, countedCount: 4 }],
    ]));
  });

  it('任一塊失敗就 reject，不回傳部分結果', async () => {
    const uids = Array.from({ length: 31 }, (_, i) => 'u' + i);
    getDocsMock.mockResolvedValueOnce({ docs: [{ id: 'u0', data: () => V2_DOC }] } as never)
      .mockRejectedValueOnce(new Error('second chunk failed'));
    await expect(loadCountedNoShowStats(uids, true)).rejects.toThrow('second chunk failed');
    expect(getDocsMock).toHaveBeenCalledTimes(2);
  });
});
