import { afterEach, describe, expect, it, vi } from 'vitest';

// ── firebase/firestore mock（vi.hoisted 避免 vi.mock 工廠被 hoist 後讀到未初始化變數）──
const {
  setDoc,
  updateDoc,
  addDoc,
  writeBatch,
  getDocs,
  collectionGroup,
  query,
  where,
  getFirebaseMock,
} = vi.hoisted(() => {
  const setDoc = vi.fn();
  const updateDoc = vi.fn();
  const addDoc = vi.fn();
  const writeBatch = vi.fn();
  const getDocs = vi.fn();
  const collectionGroup = vi.fn((_db: unknown, name: string) => ({ __cg: name }));
  const query = vi.fn((base: unknown, ...clauses: unknown[]) => ({
    __query: base,
    __clauses: clauses,
  }));
  const where = vi.fn((field: string, op: string, value: unknown) => ({
    __where: field,
    __op: op,
    __value: value,
  }));
  const getFirebaseMock = vi.fn(() => Promise.resolve({ db: { __mockDb: true } }));
  return {
    setDoc,
    updateDoc,
    addDoc,
    writeBatch,
    getDocs,
    collectionGroup,
    query,
    where,
    getFirebaseMock,
  };
});

vi.mock('firebase/firestore', () => ({
  collectionGroup,
  query,
  where,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  writeBatch,
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: getFirebaseMock,
}));

import {
  formatUserAttendanceSummaryTime,
  getFilteredRecords,
  loadUserStats,
  type UserStatsSnapshot,
} from './activity-records';

interface MockDocSpec {
  id: string;
  path: string;
  hasParent: boolean;
  data: Record<string, unknown>;
}

function makeDoc(spec: MockDocSpec): Record<string, unknown> {
  const parentPath = spec.path.split('/').slice(0, -2).join('/');
  return {
    id: spec.id,
    ref: {
      id: spec.id,
      path: spec.path,
      parent: {
        parent: spec.hasParent ? { path: parentPath } : null,
      },
    },
    data: () => spec.data,
  };
}

describe('loadUserStats（R-REG-014 過濾、無寫入）', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('使用 collectionGroup + where(uid)，過濾 legacy root，且不做任何寫入', async () => {
    const sub = makeDoc({
      id: 'r1',
      path: 'events/e1/activityRecords/r1',
      hasParent: true,
      data: { uid: 'u1', eventId: 'e1', name: 'A' },
    });
    const legacy = makeDoc({
      id: 'l1',
      path: 'activityRecords/l1',
      hasParent: false,
      data: { uid: 'u1' },
    });
    getDocs
      .mockResolvedValueOnce({ docs: [sub, legacy] })
      .mockResolvedValueOnce({ docs: [] });

    const result = await loadUserStats('u1');

    expect(result.uid).toBe('u1');
    expect(result.activityRecords).toHaveLength(1);
    expect(result.activityRecords[0]).toMatchObject({
      _docId: 'r1',
      _sourceCollection: 'activityRecords',
      _sourceKind: 'subcollection',
      eventId: 'e1',
    });
    expect(result.attendanceRecords).toHaveLength(0);

    expect(collectionGroup).toHaveBeenCalledWith({ __mockDb: true }, 'activityRecords');
    expect(collectionGroup).toHaveBeenCalledWith({ __mockDb: true }, 'attendanceRecords');
    expect(where).toHaveBeenCalledWith('uid', '==', 'u1');

    expect(setDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
    expect(addDoc).not.toHaveBeenCalled();
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it('空 uid 直接拒絕', async () => {
    await expect(loadUserStats('')).rejects.toThrow(/uid/);
    await expect(loadUserStats('   ')).rejects.toThrow(/uid/);
  });
});

describe('getFilteredRecords（照 A _categorizeRecords 四種 filter）', () => {
  // 各狀況：
  //  - e1：registered + ongoing       → registered
  //  - e2：registered + ended         → missed
  //  - e3：registered + ended，且有 checkin+checkout → completed
  //  - e4：cancelled                  → cancelled
  //  - e5：removed                    → 全部跳過
  const baseStats: UserStatsSnapshot = {
    uid: 'u1',
    activityRecords: [
      { _docId: 'r1', eventId: 'e1', status: 'registered', name: 'A', date: '2024-01-01T00:00:00Z', eventStatus: 'ongoing' },
      { _docId: 'r2', eventId: 'e2', status: 'registered', name: 'B', date: '2024-02-01T00:00:00Z', eventStatus: 'ended' },
      { _docId: 'r3', eventId: 'e3', status: 'registered', name: 'C', date: '2024-03-01T00:00:00Z', eventStatus: 'ended' },
      { _docId: 'r4', eventId: 'e4', status: 'cancelled', name: 'D', date: '2024-04-01T00:00:00Z' },
      { _docId: 'r5', eventId: 'e5', status: 'removed', name: 'E', date: '2024-05-01T00:00:00Z' },
    ],
    attendanceRecords: [
      { eventId: 'e3', uid: 'u1', type: 'checkin' },
      { eventId: 'e3', uid: 'u1', type: 'checkout' },
    ],
  };

  it("filter='all'：registered + completed + cancelled，依活動日期新到舊", () => {
    const result = getFilteredRecords(baseStats, 'all', false);
    expect(result.map((r) => r.name)).toEqual(['D', 'C', 'B', 'A']);
    expect(result.find((r) => r.name === 'B')?._displayStatus).toBe('missed');
    expect(result.find((r) => r.name === 'C')?._displayStatus).toBe('completed');
    expect(result.find((r) => r.name === 'A')?._displayStatus).toBeUndefined();
    expect(result.find((r) => r.name === 'D')?._displayStatus).toBeUndefined();
    // removed 不出現
    expect(result.some((r) => r.name === 'E')).toBe(false);
  });

  it("filter='registered'：只回 registered + missed（不含 cancelled／completed）", () => {
    const result = getFilteredRecords(baseStats, 'registered', false);
    expect(result.map((r) => r.name)).toEqual(['B', 'A']);
  });

  it("filter='completed'：只回有 checkin+checkout 者", () => {
    const result = getFilteredRecords(baseStats, 'completed', false);
    expect(result.map((r) => r.name)).toEqual(['C']);
    expect(result[0]?._displayStatus).toBe('completed');
  });

  it("filter='cancelled'：只回未被重新報名的取消紀錄", () => {
    const result = getFilteredRecords(baseStats, 'cancelled', false);
    expect(result.map((r) => r.name)).toEqual(['D']);
  });

  it('isPublic=true 隱藏 registered／missed，僅回 completed + cancelled', () => {
    const result = getFilteredRecords(baseStats, 'all', true);
    expect(result.map((r) => r.name)).toEqual(['D', 'C']);
  });

  it('重新報名後舊 cancelled 不出現', () => {
    const stats: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: [
        { eventId: 'e1', status: 'cancelled', name: 'old', date: '2024-01-01T00:00:00Z' },
        { eventId: 'e1', status: 'registered', name: 'new', date: '2024-01-01T00:00:00Z', eventStatus: 'ongoing' },
      ],
      attendanceRecords: [],
    };
    const result = getFilteredRecords(stats, 'all', false);
    expect(result.map((r) => r.name)).toEqual(['new']);
  });

  it('缺少 eventStatus 時照 A「查不到活動」不推入 registered', () => {
    const stats: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: [
        { eventId: 'e1', status: 'registered', name: 'A', date: '2024-01-01T00:00:00Z' },
      ],
      attendanceRecords: [],
    };
    const result = getFilteredRecords(stats, 'all', false);
    expect(result).toEqual([]);
  });
});

describe('formatUserAttendanceSummaryTime', () => {
  it('無值／無效回 --', () => {
    expect(formatUserAttendanceSummaryTime(null)).toBe('--');
    expect(formatUserAttendanceSummaryTime(undefined)).toBe('--');
    expect(formatUserAttendanceSummaryTime('not-a-date')).toBe('--');
  });

  it('Date／toDate／{seconds} 皆輸出 YYYY/MM/DD HH:mm', () => {
    const d = new Date(2024, 0, 5, 9, 7, 0);
    const expected = '2024/01/05 09:07';
    expect(formatUserAttendanceSummaryTime(d)).toBe(expected);
    expect(formatUserAttendanceSummaryTime({ toDate: () => d })).toBe(expected);
    expect(
      formatUserAttendanceSummaryTime({ seconds: Math.floor(d.getTime() / 1000) }),
    ).toBe(expected);
  });
});
