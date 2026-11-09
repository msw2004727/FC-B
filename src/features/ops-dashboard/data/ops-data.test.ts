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
