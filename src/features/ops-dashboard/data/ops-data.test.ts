import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => (await import('../ops-test-utils')).sdk);
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: {} }) }));

import {
  calls,
  documentIdInBatches,
  failures,
  FORBIDDEN_APIS,
  queriesWithoutLimitOrIdList,
  resetStore,
  sdk,
  totalReads,
  ts,
} from '../ops-test-utils';
import { loadDashboard, OPEN_EVENT_STATUSES } from './ops-data';

const GENERATED = Date.UTC(2026, 10, 8, 19, 0, 0); // 台北 11-09 03:00

function seed(withSummary: boolean, eventCount = 60): void {
  const statuses = ['open', 'full', 'upcoming', 'ended', 'cancelled'];
  resetStore({
    opsSummary: withSummary ? [{ id: 'latest', data: { generatedAt: ts(GENERATED), asOf: '2026-11-08' } }] : [],
    events: Array.from({ length: eventCount }, (_, i) => ({ id: `ce_${String(i).padStart(4, '0')}`, data: { status: statuses[i % 5] } })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seed(true);
});

function expectBudget(): void {
  // 字典 §5 斷言：每次進頁 ≤ 60、id 清單每批 ≤ 30、不整集合讀、不用 collectionGroup、不即時查用戶數、不開監聽。
  expect(totalReads()).toBeLessThanOrEqual(60);
  expect(documentIdInBatches().every((b) => b.length <= 30)).toBe(true);
  expect(queriesWithoutLimitOrIdList()).toEqual([]);
  expect(sdk.collectionGroup).not.toHaveBeenCalled();
  expect(calls.filter((c) => c.name === 'users')).toEqual([]);
  expect(sdk.onSnapshot).not.toHaveBeenCalled();
  for (const name of FORBIDDEN_APIS) expect(sdk[name]).not.toHaveBeenCalled();
}

describe('進頁讀取（C1）', () => {
  it('opsSummary/latest getDoc 1 次＋報名中 count 1 次，合計 2 次（≤ 60）；不讀 opsSummary/noshow', async () => {
    const load = await loadDashboard();
    expect(load.summary).toEqual({ kind: 'ok', value: { generatedAtMs: GENERATED, asOf: '2026-11-08' } });
    expect(load.openEvents).toEqual({ kind: 'ok', value: 36 });
    expect(calls.map((c) => `${c.kind}:${c.name}${c.id ? `/${c.id}` : ''}`).sort()).toEqual(['count:events', 'doc:opsSummary/latest']);
    expect(totalReads()).toBe(2);
    expect(sdk.where).toHaveBeenCalledWith('status', 'in', [...OPEN_EVENT_STATUSES]);
    expect(OPEN_EVENT_STATUSES).toEqual(['open', 'full', 'upcoming']);
    expect(calls.some((c) => c.id === 'noshow')).toBe(false);
    expectBudget();
  });

  it('活動很多時 count 依每 1,000 筆計費，仍在預算內', async () => {
    seed(true, 5000);
    await loadDashboard();
    expect(totalReads()).toBe(1 + 3);
    expectBudget();
  });

  it('opsSummary/latest 不存在（C2 未部署）→ absent，不是錯誤；報名中照常', async () => {
    seed(false);
    const load = await loadDashboard();
    expect(load.summary).toEqual({ kind: 'absent' });
    expect(load.openEvents.kind).toBe('ok');
    expectBudget();
  });

  it('權限錯誤 → error（不可當成沒有資料）；另一個區塊不受影響', async () => {
    failures['opsSummary'] = 'permission-denied';
    const load = await loadDashboard();
    expect(load.summary).toEqual({ kind: 'error', code: 'permission-denied' });
    expect(load.openEvents.kind).toBe('ok');
  });

  it('count 失敗 → error', async () => {
    failures['events'] = 'unavailable';
    const load = await loadDashboard();
    expect(load.openEvents).toEqual({ kind: 'error', code: 'unavailable' });
    expect(load.summary.kind).toBe('ok');
  });
});

const PERIOD = {
  start: '2026-10-12', end: '2026-11-08', prevStart: '2026-09-12', prevEnd: '2026-10-11',
  complete: true, prevComplete: true,
  kpi: {
    activeUsers: { cur: 120, prev: 100 },
    newUsers: { cur: 10, prev: 0 },
    eventsHeld: { cur: 8, prev: 8 },
    registrations: { cur: 80, prev: 100 },
    attend: {
      completed: 50, counted: 100, countedEvents: 5,
      prevCompleted: 40, prevCounted: 100, prevCountedEvents: 4,
    },
  },
  topEvents: [{ docId: 'ev_top', title: '熱門', dateKey: '2026-11-01', occupied: 18, max: 20 }],
  topHosts: [{ uid: 'U-host', name: '阿明', events: 3, registrations: 40 }],
};

function summaryData(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generatedAt: ts(GENERATED),
    asOf: '2026-11-08',
    noshowSince: '2026-11-07',
    users: { totalUsers: 200, qaUsers: 4 },
    periods: { d30: PERIOD },
    trend: { daily: [{ d: '2026-11-08', active7: 40, active30: 120, newUsers: 2, eventsHeld: 1, registrations: 10, completed: 8, counted: 10, countedEvents: 1 }], monthly: [] },
    upcomingLowFill: [],
    upcomingLowFillOverflow: 0,
    attention: [],
    cost: null,
    lineQuota: null,
    integrity: { lastReconcileAt: null, lastMismatchDays: [] },
    ...extra,
  };
}

describe('opsSummary 形狀與放鴿子讀取（C3a）', () => {
  it('解析 latest 的期間、用戶、趨勢；預設不讀 noshow', async () => {
    resetStore({
      opsSummary: [{ id: 'latest', data: summaryData() }],
      events: [],
    });
    const load = await loadDashboard();
    expect(load.summary).toEqual({ kind: 'ok', value: { generatedAtMs: GENERATED, asOf: '2026-11-08' } });
    expect(load.latest.kind).toBe('ok');
    if (load.latest.kind !== 'ok') return;
    expect(load.latest.value.users).toEqual({ totalUsers: 200, qaUsers: 4 });
    expect(load.latest.value.periods.d30?.kpi.activeUsers).toEqual({ cur: 120, prev: 100 });
    expect(load.latest.value.periods.d30?.prevComplete).toBe(true);
    expect(load.latest.value.trend.daily).toHaveLength(1);
    expect(load.latest.value.periods.d30?.topEvents[0]?.docId).toBe('ev_top');
    expect(load.noshow).toEqual({ kind: 'skipped' });
    expect(load.lowFillEvents).toEqual({ kind: 'ok', value: [] });
    expect(calls.some((c) => c.id === 'noshow')).toBe(false);
    expect(calls.some((c) => c.kind === 'docs')).toBe(false);
    expectBudget();
  });

  it('有放鴿子權限才讀 noshow；文件不存在是 absent，不是錯誤', async () => {
    resetStore({ opsSummary: [{ id: 'latest', data: summaryData() }], events: [] });
    const missing = await loadDashboard({ canViewNoShow: true });
    expect(missing.noshow).toEqual({ kind: 'absent' });
    expect(calls.some((c) => c.id === 'noshow')).toBe(true);

    calls.length = 0;
    resetStore({
      opsSummary: [
        { id: 'latest', data: summaryData() },
        { id: 'noshow', data: { generatedAt: ts(GENERATED), asOf: '2026-11-08', periods: { d30: { noShow: 6, counted: 35, countedEvents: 5, prevNoShow: 10, prevCounted: 40, prevCountedEvents: 5 } }, attention: [{ kind: 'host_noshow_high', uid: 'U-host', name: '阿明', noShow: 6, counted: 35 }] } },
      ],
      events: [],
    });
    const load = await loadDashboard({ canViewNoShow: true });
    expect(load.noshow.kind).toBe('ok');
    if (load.noshow.kind !== 'ok') return;
    expect(load.noshow.value.periods.d30?.noShow).toBe(6);
    expect(load.noshow.value.attention).toEqual([{ uid: 'U-host', name: '阿明', noShow: 6, counted: 35 }]);
  });

  it('noshow 權限錯誤不是 absent；latest 不受影響', async () => {
    resetStore({ opsSummary: [{ id: 'latest', data: summaryData() }], events: [] });
    failures['opsSummary/noshow'] = 'permission-denied';
    const load = await loadDashboard({ canViewNoShow: true });
    expect(load.summary.kind).toBe('ok');
    expect(load.noshow).toEqual({ kind: 'error', code: 'permission-denied' });
  });

  it('A1 候選 40 筆：兩批 documentId in（30＋10），有權限時進頁 43 次（≤ 60）', async () => {
    const candidates = Array.from({ length: 45 }, (_, i) => ({
      docId: `ev_${String(i).padStart(2, '0')}`,
      title: `場${i}`,
      startMs: GENERATED + i * 1000,
      max: 20,
      occupiedAtRun: 1,
    }));
    resetStore({
      opsSummary: [
        { id: 'latest', data: summaryData({ upcomingLowFill: candidates, upcomingLowFillOverflow: 5 }) },
        { id: 'noshow', data: { generatedAt: ts(GENERATED), asOf: '2026-11-08' } },
      ],
      events: candidates.slice(0, 40).map((item) => ({ id: item.docId, data: { status: 'ended', title: item.title } })),
    });
    const load = await loadDashboard({ canViewNoShow: true });
    expect(load.lowFillEvents.kind).toBe('ok');
    if (load.lowFillEvents.kind === 'ok') expect(load.lowFillEvents.value).toHaveLength(40);
    const batches = documentIdInBatches();
    expect(batches.map((batch) => batch.length)).toEqual([30, 10]);
    expect(batches.every((batch) => batch.length <= 30)).toBe(true);
    expect(totalReads()).toBe(43);
    expectBudget();
    expect(calls.some((c) => c.id === 'noshow')).toBe(true);
  });

  it('沒有放鴿子權限：40 筆候選仍讀，但不出現 noshow', async () => {
    const candidates = Array.from({ length: 40 }, (_, i) => ({
      docId: `ev_${String(i).padStart(2, '0')}`,
      title: `場${i}`,
      startMs: GENERATED + i,
      max: 20,
      occupiedAtRun: 1,
    }));
    resetStore({
      opsSummary: [
        { id: 'latest', data: summaryData({ upcomingLowFill: candidates }) },
        { id: 'noshow', data: { generatedAt: ts(GENERATED) } },
      ],
      events: candidates.map((item) => ({ id: item.docId, data: { status: 'ended' } })),
    });
    await loadDashboard();
    expect(calls.some((c) => c.id === 'noshow')).toBe(false);
    expect(totalReads()).toBe(42);
    expectBudget();
  });

  it('A1 重讀失敗是 error，報名中 count 不受影響', async () => {
    resetStore({
      opsSummary: [{ id: 'latest', data: summaryData({ upcomingLowFill: [{ docId: 'ev_low', title: '夜足', startMs: 1, max: 20, occupiedAtRun: 1 }] }) }],
      events: [{ id: 'ev_low', data: { status: 'open' } }],
    });
    failures['events:docs'] = 'unavailable';
    const load = await loadDashboard();
    expect(load.lowFillEvents).toEqual({ kind: 'error', code: 'unavailable' });
    expect(load.openEvents.kind).toBe('ok');
    expect(queriesWithoutLimitOrIdList()).toEqual([]);
  });
});
