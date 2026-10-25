// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { doc, getDoc } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import {
  USER_ATTENDANCE_STATS_COLLECTION,
  loadUserAttendanceSummary,
  normalizeUserAttendanceSummary,
} from './attendance-summary';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, collectionName: string, id: string) => ({
    path: `${collectionName}/${id}`,
  })),
  getDoc: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(),
}));

const fakeDb = { name: 'mock-db' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getFirebase).mockResolvedValue({
    db: fakeDb as never,
    app: {} as never,
    auth: {} as never,
    functions: {} as never,
  });
});

describe('normalizeUserAttendanceSummary', () => {
  it('照 A 正規化正整數並四捨五入計算出席率', () => {
    const result = normalizeUserAttendanceSummary('U-1', {
      sourceVersion: 2.9,
      expectedCount: 3,
      attendedCount: 2,
      completedCount: 5,
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(result).toEqual({
      uid: 'U-1',
      exists: true,
      sourceVersion: 2,
      expectedCount: 3,
      attendedCount: 2,
      completedCount: 5,
      attendRate: 67,
      updatedAt: '2026-05-01T00:00:00Z',
    });
  });

  it('負數與非數字歸零，expectedCount 為 0 時出席率為 0', () => {
    const result = normalizeUserAttendanceSummary('U-2', {
      sourceVersion: -1,
      expectedCount: -5,
      attendedCount: 'abc',
      completedCount: null,
    });
    expect(result).toEqual({
      uid: 'U-2',
      exists: true,
      sourceVersion: 0,
      expectedCount: 0,
      attendedCount: 0,
      completedCount: 0,
      attendRate: 0,
      updatedAt: null,
    });
  });
});

describe('loadUserAttendanceSummary', () => {
  it('空 UID 或含斜線的 UID 不查詢 Firestore 直接回 null', async () => {
    expect(await loadUserAttendanceSummary('')).toBeNull();
    expect(await loadUserAttendanceSummary('   ')).toBeNull();
    expect(await loadUserAttendanceSummary('bad/uid')).toBeNull();
    expect(getFirebase).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('正確查詢 userAttendanceStats/{uid} 並正規化回傳', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({
        expectedCount: 10,
        attendedCount: 8,
        completedCount: 7,
        sourceVersion: 1,
      }),
    } as never);

    const summary = await loadUserAttendanceSummary('U-100');
    expect(doc).toHaveBeenCalledWith(fakeDb, USER_ATTENDANCE_STATS_COLLECTION, 'U-100');
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({
      uid: 'U-100',
      exists: true,
      sourceVersion: 1,
      expectedCount: 10,
      attendedCount: 8,
      completedCount: 7,
      attendRate: 80,
      updatedAt: null,
    });
  });

  it('文件不存在時照 A 回傳全 0（exists=false）', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => false,
      data: () => undefined,
    } as never);

    expect(await loadUserAttendanceSummary('U-missing')).toEqual({
      uid: 'U-missing',
      exists: false,
      sourceVersion: 0,
      expectedCount: 0,
      attendedCount: 0,
      completedCount: 0,
      attendRate: 0,
      updatedAt: null,
    });
  });

  it('同一 UID 同時多處呼叫只讀一次（共用進行中的請求）；完成後再呼叫會重新讀取，不留過期快取', async () => {
    const emptyDoc = { exists: () => false, data: () => undefined };
    vi.mocked(getDoc).mockResolvedValue(emptyDoc as never);
    let resolveSnap: (v: unknown) => void = () => {};
    vi.mocked(getDoc).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSnap = resolve;
        }) as never,
    );

    const first = loadUserAttendanceSummary('U-shared');
    const second = loadUserAttendanceSummary('U-shared');
    const otherUid = loadUserAttendanceSummary('U-other');
    await vi.waitFor(() => expect(getDoc).toHaveBeenCalledTimes(2));

    resolveSnap({
      exists: () => true,
      data: () => ({ expectedCount: 3, attendedCount: 2, completedCount: 1 }),
    });
    const [a, b] = await Promise.all([first, second]);
    await otherUid;
    expect(a).toBe(b);
    expect(a?.expectedCount).toBe(3);

    // 已完成 → 下一次呼叫（例如按重新整理）必須重新讀伺服器
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ expectedCount: 4, attendedCount: 3, completedCount: 2 }),
    } as never);
    const third = await loadUserAttendanceSummary('U-shared');
    expect(third?.expectedCount).toBe(4);
    expect(getDoc).toHaveBeenCalledTimes(3);
  });

  it('fresh：寫入後重讀不得沿用寫入前就已發出的進行中請求，且之後的一般呼叫改共用這次新請求', async () => {
    const releases: ((v: unknown) => void)[] = [];
    vi.mocked(getDoc).mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve);
        }) as never,
    );
    const snapOf = (expectedCount: number) => ({
      exists: () => true,
      data: () => ({ expectedCount, attendedCount: 0, completedCount: 0 }),
    });

    const beforeWrite = loadUserAttendanceSummary('U-fresh'); // 寫入前發出（舊資料）
    const afterWrite = loadUserAttendanceSummary('U-fresh', { fresh: true }); // 寫入後重讀
    await vi.waitFor(() => expect(getDoc).toHaveBeenCalledTimes(2));

    // 新請求進行中，一般呼叫要加入新請求，不是舊的
    const joiner = loadUserAttendanceSummary('U-fresh');
    expect(getDoc).toHaveBeenCalledTimes(2);

    // 舊請求先完成（資料是舊的）：不可影響新請求，也不可把新請求從共用表移除
    releases[0]?.(snapOf(1));
    expect((await beforeWrite)?.expectedCount).toBe(1);
    const lateJoiner = loadUserAttendanceSummary('U-fresh');
    expect(getDoc).toHaveBeenCalledTimes(2);

    releases[1]?.(snapOf(9));
    expect((await afterWrite)?.expectedCount).toBe(9);
    expect(await joiner).toBe(await afterWrite);
    expect(await lateJoiner).toBe(await afterWrite);
  });

  it('getDoc 拋錯時捕捉並回傳 null', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(getDoc).mockRejectedValue(new Error('permission-denied'));

    expect(await loadUserAttendanceSummary('U-err')).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
