import { afterEach, describe, expect, it, vi } from 'vitest';

// ── firebase/firestore mock（vi.hoisted 避免 vi.mock 工廠被 hoist 後讀到未初始化變數）──
const {
  setDoc,
  updateDoc,
  addDoc,
  writeBatch,
  getDocs,
  collection,
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
  const collection = vi.fn((_db: unknown, name: string) => ({ __col: name }));
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
    collection,
    collectionGroup,
    query,
    where,
    getFirebaseMock,
  };
});

vi.mock('firebase/firestore', () => ({
  collection,
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
  parseEventStartMs,
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

function makeEventDoc(id: string, data: Record<string, unknown>): Record<string, unknown> {
  return { id: `doc-${id}`, data: () => ({ id, ...data }) };
}

/** A 現場寫入的 activityRecord 形狀（`firebase-crud.js#registerForEvent`）：沒有 eventStatus，date 只有 MM/DD。 */
function actRec(
  eventId: string,
  status: string,
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { _docId: `r-${eventId}-${status}`, eventId, status, name, date: '10/01', uid: 'u1', ...extra };
}

describe('loadUserStats（R-REG-014 過濾、無寫入）', () => {
  afterEach(() => {
    vi.clearAllMocks();
    getDocs.mockReset();
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
      data: { uid: 'u1', eventId: 'legacy-event' },
    });
    getDocs
      .mockResolvedValueOnce({ docs: [sub, legacy] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValue({ docs: [] });

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

  it('照 A getEvent：用 where(id in …) 讀出記錄所屬活動的 status／date（legacy root 與 removed 不查）', async () => {
    const act = (eventId: string, status: string, path: string, hasParent = true) =>
      makeDoc({
        id: `a-${eventId}-${status}`,
        path,
        hasParent,
        data: { uid: 'u1', eventId, status, name: eventId },
      });
    getDocs
      .mockResolvedValueOnce({
        docs: [
          act('e1', 'registered', 'events/d1/activityRecords/a1'),
          act('e2', 'cancelled', 'events/d2/activityRecords/a2'),
          act('e3', 'removed', 'events/d3/activityRecords/a3'),
          act('e-legacy', 'registered', 'activityRecords/a4', false),
        ],
      })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({
        docs: [
          makeEventDoc('e1', { status: 'open', date: '2026/10/01 19:00~21:00', title: 'T1' }),
          makeEventDoc('e2', { status: 'ended', date: '2026/09/01 19:00~21:00' }),
        ],
      });

    const result = await loadUserStats('u1');

    expect(collection).toHaveBeenCalledWith({ __mockDb: true }, 'events');
    expect(where).toHaveBeenCalledWith('id', 'in', ['e1', 'e2']);
    expect(result.events).toEqual({
      e1: { status: 'open', date: '2026/10/01 19:00~21:00' },
      e2: { status: 'ended', date: '2026/09/01 19:00~21:00' },
    });
    expect(setDoc).not.toHaveBeenCalled();
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it('活動超過 30 場時分批查詢（Firestore in 上限），結果合併', async () => {
    const ids = Array.from({ length: 65 }, (_, i) => `e${i}`);
    const actDocs = ids.map((eventId) =>
      makeDoc({
        id: `a-${eventId}`,
        path: `events/d-${eventId}/activityRecords/a-${eventId}`,
        hasParent: true,
        data: { uid: 'u1', eventId, status: 'registered', name: eventId },
      }),
    );
    getDocs
      .mockResolvedValueOnce({ docs: actDocs })
      .mockResolvedValueOnce({ docs: [] })
      .mockImplementation(async (q: { __clauses: { __value: unknown }[] }) => ({
        docs: (q.__clauses[0]?.__value as string[]).map((id) =>
          makeEventDoc(id, { status: 'open', date: '2026/10/01 19:00' }),
        ),
      }));

    const result = await loadUserStats('u1');

    const inCalls = where.mock.calls.filter((c) => c[0] === 'id' && c[1] === 'in');
    expect(inCalls.map((c) => (c[2] as string[]).length)).toEqual([30, 30, 5]);
    expect(Object.keys(result.events ?? {})).toHaveLength(65);
  });

  it('沒有任何需要查的活動時不發 events 查詢', async () => {
    getDocs.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({ docs: [] });
    const result = await loadUserStats('u1');
    expect(result.events).toEqual({});
    expect(collection).not.toHaveBeenCalled();
  });

  it('活動查詢失敗時整體 reject（避免把「查不到活動」誤顯示成沒有報名）', async () => {
    const actDoc = makeDoc({
      id: 'a1',
      path: 'events/d1/activityRecords/a1',
      hasParent: true,
      data: { uid: 'u1', eventId: 'e1', status: 'registered', name: 'A' },
    });
    getDocs
      .mockResolvedValueOnce({ docs: [actDoc] })
      .mockResolvedValueOnce({ docs: [] })
      .mockRejectedValueOnce(new Error('permission-denied'));

    await expect(loadUserStats('u1')).rejects.toThrow('permission-denied');
  });
});

describe('getFilteredRecords（照 A _categorizeRecords 四種 filter；資料形狀照正式庫）', () => {
  // 各狀況（activityRecord 沒有 eventStatus，狀態與日期都從 events 查表來）：
  //  - e1：registered + 活動進行中（open）   → registered
  //  - e2：registered + 活動已結束（ended）  → missed
  //  - e3：registered + 活動已結束，有 checkin+checkout → completed
  //  - e4：cancelled                         → cancelled
  //  - e5：removed                           → 全部跳過
  const baseStats: UserStatsSnapshot = {
    uid: 'u1',
    activityRecords: [
      actRec('e1', 'registered', 'A', { date: '03/01' }),
      actRec('e2', 'registered', 'B', { date: '02/01' }),
      actRec('e3', 'registered', 'C', { date: '01/01' }),
      actRec('e4', 'cancelled', 'D', { date: '04/01' }),
      actRec('e5', 'removed', 'E', { date: '05/01' }),
    ],
    attendanceRecords: [
      { eventId: 'e3', uid: 'u1', type: 'checkin' },
      { eventId: 'e3', uid: 'u1', type: 'checkout' },
    ],
    events: {
      e1: { status: 'open', date: '2026/03/01 19:00~21:00' },
      e2: { status: 'ended', date: '2026/02/01 19:00~21:00' },
      e3: { status: 'ended', date: '2026/01/01 19:00~21:00' },
      e4: { status: 'ended', date: '2026/04/01 19:00~21:00' },
      e5: { status: 'ended', date: '2026/05/01 19:00~21:00' },
    },
  };

  it("filter='all'：registered + completed + cancelled，依活動日期新到舊", () => {
    const result = getFilteredRecords(baseStats, 'all', false);
    expect(result.map((r) => r.name)).toEqual(['D', 'A', 'B', 'C']);
    expect(result.find((r) => r.name === 'B')?._displayStatus).toBe('missed');
    expect(result.find((r) => r.name === 'C')?._displayStatus).toBe('completed');
    expect(result.find((r) => r.name === 'A')?._displayStatus).toBeUndefined();
    expect(result.find((r) => r.name === 'D')?._displayStatus).toBeUndefined();
    // removed 不出現
    expect(result.some((r) => r.name === 'E')).toBe(false);
  });

  it("filter='registered'：只回 registered + missed（不含 cancelled／completed）", () => {
    const result = getFilteredRecords(baseStats, 'registered', false);
    expect(result.map((r) => r.name)).toEqual(['A', 'B']);
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
        actRec('e1', 'cancelled', 'old'),
        actRec('e1', 'registered', 'new'),
      ],
      attendanceRecords: [],
      events: { e1: { status: 'open', date: '2026/10/01 19:00' } },
    };
    const result = getFilteredRecords(stats, 'all', false);
    expect(result.map((r) => r.name)).toEqual(['new']);
  });

  it('活動查不到（已刪除或不在查表）→ 照 A 不推入 registered', () => {
    const stats: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: [actRec('e1', 'registered', 'A')],
      attendanceRecords: [],
      events: {},
    };
    expect(getFilteredRecords(stats, 'all', false)).toEqual([]);
    expect(getFilteredRecords({ ...stats, events: undefined }, 'all', false)).toEqual([]);
  });

  it('候補（waitlisted）：活動進行中顯示，活動已結束不算未出席、也不顯示', () => {
    const stats: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: [
        actRec('e1', 'waitlisted', 'WaitOpen'),
        actRec('e2', 'waitlisted', 'WaitEnded'),
      ],
      attendanceRecords: [],
      events: {
        e1: { status: 'open', date: '2026/10/01 19:00' },
        e2: { status: 'ended', date: '2026/09/01 19:00' },
      },
    };
    const result = getFilteredRecords(stats, 'registered', false);
    expect(result.map((r) => r.name)).toEqual(['WaitOpen']);
  });

  it('活動已被取消（event.status=cancelled）→ registered 紀錄不顯示', () => {
    const stats: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: [actRec('e1', 'registered', 'Gone')],
      attendanceRecords: [],
      events: { e1: { status: 'cancelled', date: '2026/10/01 19:00' } },
    };
    expect(getFilteredRecords(stats, 'all', false)).toEqual([]);
  });

  it('排序用活動完整日期（含年份），不是 activityRecord 的 MM/DD：跨年也是新到舊', () => {
    const stats: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: [
        actRec('e2025', 'cancelled', 'Y2025', { date: '12/20' }),
        actRec('e2026', 'cancelled', 'Y2026', { date: '01/05' }),
        actRec('e2024', 'cancelled', 'Y2024', { date: '12/31' }),
      ],
      attendanceRecords: [],
      events: {
        e2025: { status: 'ended', date: '2025/12/20 19:00~21:00' },
        e2026: { status: 'ended', date: '2026/01/05 19:00~21:00' },
        e2024: { status: 'ended', date: '2024/12/31 19:00~21:00' },
      },
    };
    const result = getFilteredRecords(stats, 'cancelled', false);
    expect(result.map((r) => r.name)).toEqual(['Y2026', 'Y2025', 'Y2024']);
  });

  it('查不到活動日期的項目排在最後（照 A null 分支）', () => {
    const stats: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: [
        actRec('eNoEvent', 'cancelled', 'NoEvent'),
        actRec('eDated', 'cancelled', 'Dated'),
      ],
      attendanceRecords: [],
      events: { eDated: { status: 'ended', date: '2026/01/05 19:00' } },
    };
    const result = getFilteredRecords(stats, 'cancelled', false);
    expect(result.map((r) => r.name)).toEqual(['Dated', 'NoEvent']);
  });

  it('已移除（removed）或已取消（cancelled）的簽到／簽退紀錄不算完成（照 A getUserAttendanceRecords）', () => {
    const stats: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: [
        actRec('e1', 'registered', 'RemovedOut'),
        actRec('e2', 'registered', 'CancelledIn'),
        actRec('e3', 'registered', 'Real'),
      ],
      attendanceRecords: [
        { eventId: 'e1', uid: 'u1', type: 'checkin' },
        { eventId: 'e1', uid: 'u1', type: 'checkout', status: 'removed' },
        { eventId: 'e2', uid: 'u1', type: 'checkin', status: 'cancelled' },
        { eventId: 'e2', uid: 'u1', type: 'checkout' },
        { eventId: 'e3', uid: 'u1', type: 'checkin', status: 'active' },
        { eventId: 'e3', uid: 'u1', type: 'checkout', status: 'active' },
      ],
      events: {
        e1: { status: 'ended', date: '2026/01/01 19:00' },
        e2: { status: 'ended', date: '2026/01/02 19:00' },
        e3: { status: 'ended', date: '2026/01/03 19:00' },
      },
    };
    const completed = getFilteredRecords(stats, 'completed', false);
    expect(completed.map((r) => r.name)).toEqual(['Real']);
    // 另兩場只簽到一半、活動已結束且正式報名：
    //  - CancelledIn：有效紀錄只剩簽退（簽到被 cancelled 排除）→ 沒有簽到 → 未出席
    //  - RemovedOut：有效紀錄只剩簽到（簽退被 removed 排除）→ 有簽到沒簽退 → 未完成（T-039）
    const registered = getFilteredRecords(stats, 'registered', false);
    expect(registered.map((r) => [r.name, r._displayStatus])).toEqual([
      ['CancelledIn', 'missed'],
      ['RemovedOut', 'incomplete'],
    ]);
  });

  it('同活動同狀態的重複 activityRecord 只留一筆（照 A _canonicalizeRecordList，保留較新的；較新的排在前面也一樣）', () => {
    const oldRec = actRec('e1', 'registered', 'Dup-old', {
      _docId: 'old',
      createdAt: { seconds: 1000 },
    });
    const newRec = actRec('e1', 'registered', 'Dup-new', {
      _docId: 'new',
      createdAt: { seconds: 2000 },
    });
    const events = {
      e1: { status: 'open', date: '2026/10/02 19:00' },
      e2: { status: 'open', date: '2026/10/01 19:00' },
    };
    // 較新的排在前面：「忽略時間、保留最後一筆」的實作會留下 Dup-old 而失敗
    const newestFirst: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: [newRec, oldRec, actRec('e2', 'registered', 'Single')],
      attendanceRecords: [],
      events,
    };
    expect(getFilteredRecords(newestFirst, 'registered', false).map((r) => r.name)).toEqual([
      'Dup-new',
      'Single',
    ]);
    // 「忽略時間、保留第一筆」的實作在這個順序會留下 Dup-old
    const oldestFirst: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: [oldRec, newRec, actRec('e2', 'registered', 'Single')],
      attendanceRecords: [],
      events,
    };
    expect(getFilteredRecords(oldestFirst, 'registered', false).map((r) => r.name)).toEqual([
      'Dup-new',
      'Single',
    ]);
  });

  it('(舊版測試保留) 較舊的在前、較新的在後', () => {
    const stats: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: [
        actRec('e1', 'registered', 'Dup-old', {
          _docId: 'old',
          createdAt: { seconds: 1000 },
        }),
        actRec('e1', 'registered', 'Dup-new', {
          _docId: 'new',
          createdAt: { seconds: 2000 },
        }),
        actRec('e2', 'registered', 'Single'),
      ],
      attendanceRecords: [],
      events: {
        e1: { status: 'open', date: '2026/10/02 19:00' },
        e2: { status: 'open', date: '2026/10/01 19:00' },
      },
    };
    const result = getFilteredRecords(stats, 'registered', false);
    expect(result.map((r) => r.name)).toEqual(['Dup-new', 'Single']);
  });

  it('不改輸入（純函式）', () => {
    const before = JSON.stringify(baseStats);
    getFilteredRecords(baseStats, 'all', false);
    expect(JSON.stringify(baseStats)).toBe(before);
  });
});

// T-039：站長 2026-10-26 同意——已結束、正式報名、只簽到沒簽退者，報名分頁顯示「未完成」而不是「未出席」。
// 刻意與 A（`_categorizeRecords` 一律 missed）不同；只改顯示分類，不改完成判定與任何統計。
describe('只簽到沒簽退 → incomplete（T-039；沒簽到仍是 missed）', () => {
  const attendedAll = (eventId: string): Record<string, unknown>[] => [
    { eventId, uid: 'u1', type: 'checkin' },
    { eventId, uid: 'u1', type: 'checkout' },
  ];
  const stats: UserStatsSnapshot = {
    uid: 'u1',
    activityRecords: [
      actRec('eIn', 'registered', 'OnlyCheckin'),
      actRec('eOut', 'registered', 'OnlyCheckout'),
      actRec('eNone', 'registered', 'NoAttendance'),
      actRec('eDone', 'registered', 'Done'),
      actRec('eWait', 'waitlisted', 'WaitEndedCheckin'),
      actRec('eOpen', 'registered', 'OpenCheckin'),
      actRec('eOther', 'registered', 'OthersCheckin'),
    ],
    attendanceRecords: [
      { eventId: 'eIn', uid: 'u1', type: 'checkin' },
      { eventId: 'eOut', uid: 'u1', type: 'checkout' },
      ...attendedAll('eDone'),
      { eventId: 'eWait', uid: 'u1', type: 'checkin' },
      { eventId: 'eOpen', uid: 'u1', type: 'checkin' },
      // 別人（不同 uid）的簽到不能算在自己身上
      { eventId: 'eOther', uid: 'someone-else', type: 'checkin' },
    ],
    events: {
      eIn: { status: 'ended', date: '2026/01/07 19:00' },
      eOut: { status: 'ended', date: '2026/01/06 19:00' },
      eNone: { status: 'ended', date: '2026/01/05 19:00' },
      eDone: { status: 'ended', date: '2026/01/04 19:00' },
      eWait: { status: 'ended', date: '2026/01/03 19:00' },
      eOpen: { status: 'open', date: '2026/01/02 19:00' },
      eOther: { status: 'ended', date: '2026/01/01 19:00' },
    },
  };
  const statusOf = (
    filter: 'all' | 'registered' | 'completed' | 'cancelled',
    name: string,
    isPublic = false,
  ): string | undefined | null => {
    const found = getFilteredRecords(stats, filter, isPublic).find((r) => r.name === name);
    return found ? (found._displayStatus ?? undefined) : null;
  };

  it('只簽到沒簽退（活動已結束、正式報名）→ incomplete', () => {
    expect(statusOf('registered', 'OnlyCheckin')).toBe('incomplete');
    expect(statusOf('all', 'OnlyCheckin')).toBe('incomplete');
  });

  it('只簽退沒簽到 → 仍是 missed', () => {
    expect(statusOf('registered', 'OnlyCheckout')).toBe('missed');
    expect(statusOf('all', 'OnlyCheckout')).toBe('missed');
  });

  it('完全沒簽到 → 仍是 missed', () => {
    expect(statusOf('registered', 'NoAttendance')).toBe('missed');
    expect(statusOf('all', 'NoAttendance')).toBe('missed');
  });

  it('別人（不同 uid）的簽到不算 → 仍是 missed', () => {
    expect(statusOf('registered', 'OthersCheckin')).toBe('missed');
  });

  it('簽到＋簽退 → completed，完成判定不變（只出現在完成／全部，不在報名分頁）', () => {
    expect(statusOf('completed', 'Done')).toBe('completed');
    expect(statusOf('all', 'Done')).toBe('completed');
    expect(statusOf('registered', 'Done')).toBeNull();
    // 只簽到沒簽退的不算完成
    expect(statusOf('completed', 'OnlyCheckin')).toBeNull();
  });

  it("filter='registered'：incomplete 與 missed 同在報名這一桶，依活動日期新到舊", () => {
    const names = getFilteredRecords(stats, 'registered', false).map((r) => r.name);
    expect(names).toEqual(['OnlyCheckin', 'OnlyCheckout', 'NoAttendance', 'OpenCheckin', 'OthersCheckin']);
  });

  it("filter='all'：incomplete／missed／completed 一起依活動日期新到舊（排序不變）", () => {
    const result = getFilteredRecords(stats, 'all', false);
    expect(result.map((r) => [r.name, r._displayStatus ?? null])).toEqual([
      ['OnlyCheckin', 'incomplete'],
      ['OnlyCheckout', 'missed'],
      ['NoAttendance', 'missed'],
      ['Done', 'completed'],
      ['OpenCheckin', null],
      ['OthersCheckin', 'missed'],
    ]);
  });

  it('候補（waitlisted）活動已結束：即使有簽到也不顯示（waitlisted 不算應到，不變）', () => {
    expect(statusOf('registered', 'WaitEndedCheckin')).toBeNull();
    expect(statusOf('all', 'WaitEndedCheckin')).toBeNull();
  });

  it('活動進行中：有簽到沒簽退仍是一般報名中（沒有 _displayStatus，不變）', () => {
    expect(statusOf('registered', 'OpenCheckin')).toBeUndefined();
  });

  it('公開名片仍隱藏報名中（incomplete 與 missed 都不出現）', () => {
    for (const filter of ['all', 'registered'] as const) {
      expect(getFilteredRecords(stats, filter, true).map((r) => r._displayStatus)).not.toContain(
        'incomplete',
      );
      expect(getFilteredRecords(stats, filter, true).map((r) => r._displayStatus)).not.toContain(
        'missed',
      );
    }
    expect(getFilteredRecords(stats, 'registered', true)).toEqual([]);
    expect(getFilteredRecords(stats, 'all', true).map((r) => r.name)).toEqual(['Done']);
  });

  it('只簽到、但同活動已取消後沒有重新報名（cancelled）→ 只出現在取消，不當 incomplete', () => {
    const cancelledStats: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: [actRec('eC', 'cancelled', 'CancelledOnly')],
      attendanceRecords: [{ eventId: 'eC', uid: 'u1', type: 'checkin' }],
      events: { eC: { status: 'ended', date: '2026/01/01 19:00' } },
    };
    expect(getFilteredRecords(cancelledStats, 'registered', false)).toEqual([]);
    expect(getFilteredRecords(cancelledStats, 'cancelled', false).map((r) => r.name)).toEqual([
      'CancelledOnly',
    ]);
  });

  it('不改輸入（純函式）', () => {
    const before = JSON.stringify(stats);
    getFilteredRecords(stats, 'all', false);
    expect(JSON.stringify(stats)).toBe(before);
  });
});

describe('活動查表的原型鍵（eventId 剛好叫 constructor／__proto__ 等）', () => {
  const protoKeys = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

  it('查表是空的時候，這些 eventId 一律是「查不到活動」，不能被當成查得到', () => {
    const stats: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: protoKeys.map((eventId) => actRec(eventId, 'registered', `P-${eventId}`)),
      attendanceRecords: [],
      events: {},
    };
    expect(getFilteredRecords(stats, 'all', false)).toEqual([]);
    expect(getFilteredRecords({ ...stats, events: undefined }, 'all', false)).toEqual([]);
  });

  it('活動真的叫這些 id 時查得到（載入器的查表不受原型影響）', async () => {
    const actDocs = protoKeys.map((eventId) =>
      makeDoc({
        id: `a-${eventId}`,
        path: `events/d-${eventId}/activityRecords/a-${eventId}`,
        hasParent: true,
        data: { uid: 'u1', eventId, status: 'registered', name: `P-${eventId}` },
      }),
    );
    getDocs
      .mockResolvedValueOnce({ docs: actDocs })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({
        docs: protoKeys.map((id) => makeEventDoc(id, { status: 'open', date: '2026/10/01 19:00' })),
      });

    const stats = await loadUserStats('u1');
    for (const id of protoKeys) {
      expect(Object.prototype.hasOwnProperty.call(stats.events, id)).toBe(true);
    }
    const names = getFilteredRecords(stats, 'registered', false).map((r) => r.name);
    expect(names.sort()).toEqual(protoKeys.map((id) => `P-${id}`).sort());
  });
});

describe('parseEventStartMs（照 A event-list-stats.js#_parseEventStartDate 的格式變體）', () => {
  const local = (y: number, m: number, d: number, hh = 0, mm = 0): number =>
    new Date(y, m, d, hh, mm).getTime();

  it('YYYY/MM/DD HH:mm~HH:mm 取開始時間（本地時區）', () => {
    expect(parseEventStartMs('2026/10/01 19:00~21:00')).toBe(local(2026, 9, 1, 19, 0));
  });

  it('只有日期 → 當天 00:00；沒有結束時間 → 取該時間；不補零也可', () => {
    expect(parseEventStartMs('2026/10/01')).toBe(local(2026, 9, 1));
    expect(parseEventStartMs('2026/10/01 19:30')).toBe(local(2026, 9, 1, 19, 30));
    expect(parseEventStartMs('2026/1/5 9:05~10:00')).toBe(local(2026, 0, 5, 9, 5));
  });

  it('A 的細節：空時間段或缺小時／分鐘一律當 0（hh || 0）', () => {
    expect(parseEventStartMs('2026/10/01  19:00')).toBe(local(2026, 9, 1)); // 雙空白 → parts[1] 為空字串
    expect(parseEventStartMs('2026/10/01 ~21:00')).toBe(local(2026, 9, 1));
    expect(parseEventStartMs('2026/10/01 19')).toBe(local(2026, 9, 1, 19, 0));
  });

  it('不是 A 的格式就是 null（A 回 null；不另外用 Date.parse 猜），排序時墊底', () => {
    expect(parseEventStartMs('2026-10-01T10:00:00Z')).toBeNull(); // A：第一段不足 3 節 → null
    expect(parseEventStartMs('10/01')).toBeNull(); // activityRecord 自己的 MM/DD
    expect(parseEventStartMs('')).toBeNull();
    expect(parseEventStartMs(undefined)).toBeNull();
    expect(parseEventStartMs(null)).toBeNull();
    expect(parseEventStartMs(1760000000000)).toBeNull();
    expect(parseEventStartMs({ seconds: 1760000000 })).toBeNull();
  });

  it('無法解成數字的日期（A 會得到 Invalid Date）→ null，不讓排序比較函式回 NaN', () => {
    expect(parseEventStartMs('abc/def/ghi')).toBeNull();
    expect(parseEventStartMs('2026/xx/01 19:00')).toBeNull();
  });
});

describe('簽到／簽退去重順序（A getUserAttendanceRecords：先 _canonicalizeRecordList 再排除 removed／cancelled）', () => {
  // A 的 attendanceRecords canonical key 含 status：eventId|uid|type|participantType|companionKey|status
  // （js/firebase-service.js#_canonicalRecordKey），所以「先去重再排除」與「先排除再去重」的結果集合相同——狀態不同的文件永遠不會互相淘汰。
  const events = { e1: { status: 'ended', date: '2026/01/01 19:00' } };
  const base = [actRec('e1', 'registered', 'Event1')];

  it('有效簽退旁邊還有較新的 removed 簽退 → 仍算完成（A 不會用失效版本淘汰有效版本）', () => {
    const stats: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: base,
      attendanceRecords: [
        { eventId: 'e1', uid: 'u1', type: 'checkin', status: 'active' },
        { eventId: 'e1', uid: 'u1', type: 'checkout', status: 'active', createdAt: { seconds: 1000 } },
        { eventId: 'e1', uid: 'u1', type: 'checkout', status: 'removed', createdAt: { seconds: 2000 } },
      ],
      events,
    };
    expect(getFilteredRecords(stats, 'completed', false).map((r) => r.name)).toEqual(['Event1']);
  });

  it('同狀態重複的簽到文件不影響結果；只剩 removed 的簽退則不算完成', () => {
    const dup: UserStatsSnapshot = {
      uid: 'u1',
      activityRecords: base,
      attendanceRecords: [
        { eventId: 'e1', uid: 'u1', type: 'checkin' },
        { eventId: 'e1', uid: 'u1', type: 'checkin' },
        { eventId: 'e1', uid: 'u1', type: 'checkout' },
      ],
      events,
    };
    expect(getFilteredRecords(dup, 'completed', false)).toHaveLength(1);

    const onlyRemoved: UserStatsSnapshot = {
      ...dup,
      attendanceRecords: [
        { eventId: 'e1', uid: 'u1', type: 'checkin' },
        { eventId: 'e1', uid: 'u1', type: 'checkout', status: 'removed' },
        { eventId: 'e1', uid: 'u1', type: 'checkout', status: 'removed' },
      ],
    };
    expect(getFilteredRecords(onlyRemoved, 'completed', false)).toHaveLength(0);
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
