import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => (await import('../inactive-test-utils')).sdk);
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: {} }) }));

import { calls, resetStore, sdk, totalReads, ts, WRITE_OR_OTHER_READ_APIS } from '../inactive-test-utils';
import {
  fetchInactiveEventsPage,
  fetchInactiveTeamsPage,
  fetchUserSegmentPage,
  INACTIVE_PAGE_SIZE,
  loadInactiveEvents,
  loadInactiveTeams,
  loadUserStatus,
  USER_LIST_PAGE_SIZE,
} from './inactive-data';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 2, 4, 0, 0);

function seed(): void {
  const teams = Array.from({ length: 45 }, (_, i) => ({ id: `tm_${String(i).padStart(3, '0')}`, data: { name: `T${i}`, active: i % 3 !== 0 ? false : true } }));
  const events = Array.from({ length: 60 }, (_, i) => ({
    id: `ce_${String(i).padStart(3, '0')}`,
    data: { title: `E${i}`, status: ['ended', 'cancelled', 'open', 'full'][i % 4], createdAt: ts(NOW - i * DAY) },
  }));
  const users = [
    ...Array.from({ length: 40 }, (_, i) => ({ id: `ua${i}`, data: { displayName: `A${i}`, lastLogin: ts(NOW - (i % 30) * DAY) } })),
    ...Array.from({ length: 25 }, (_, i) => ({ id: `um${i}`, data: { displayName: `M${i}`, lastLogin: ts(NOW - (31 + i) * DAY - 1) } })),
    ...Array.from({ length: 33 }, (_, i) => ({ id: `uo${i}`, data: { displayName: `O${i}`, lastLogin: ts(NOW - (91 + i) * DAY) } })),
    { id: 'never1', data: { displayName: '從沒登入' } },
    { id: 'legacy1', data: { displayName: '舊字串', lastLogin: '2025/01/01' } },
  ];
  resetStore({ teams, events, users });
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

function expectNoForbiddenApis(): void {
  for (const name of WRITE_OR_OTHER_READ_APIS) expect(sdk[name]).not.toHaveBeenCalled();
}

function everyListHasWhereAndLimit(): void {
  for (const call of calls.filter((c) => c.kind === 'docs')) {
    expect(call.constraints.some((c) => c.type === 'where')).toBe(true);
    const lim = call.constraints.find((c) => c.type === 'limit');
    expect(lim && lim.type === 'limit' ? lim.n : Infinity).toBeLessThanOrEqual(INACTIVE_PAGE_SIZE);
  }
  for (const call of calls.filter((c) => c.kind === 'count' && c.name !== 'users')) {
    expect(call.constraints.some((c) => c.type === 'where')).toBe(true);
  }
}

describe('俱樂部頁籤', () => {
  it('進頁：count 1 次＋名單 1 次（≤ 20 筆），讀取 ≤ 21；只查 active == false', async () => {
    const { total, page } = await loadInactiveTeams();
    expect(total).toBe(30);
    expect(page.items).toHaveLength(INACTIVE_PAGE_SIZE);
    expect(page.done).toBe(false);
    expect(calls.map((c) => c.kind).sort()).toEqual(['count', 'docs']);
    expect(totalReads()).toBeLessThanOrEqual(21);
    expect(sdk.where).toHaveBeenCalledWith('active', '==', false);
    everyListHasWhereAndLimit();
    expectNoForbiddenApis();
  });

  it('載入更多從上一頁最後一筆接續，每次 ≤ 20 讀，讀完標 done', async () => {
    const first = await loadInactiveTeams();
    calls.length = 0;
    const second = await fetchInactiveTeamsPage(first.page.cursor);
    expect(second.items).toHaveLength(10);
    expect(second.done).toBe(true);
    expect(second.items[0]!.id > first.page.items[19]!.id).toBe(true);
    expect(totalReads()).toBeLessThanOrEqual(INACTIVE_PAGE_SIZE);
  });
});

describe('活動頁籤', () => {
  it('進頁：status in [ended, cancelled]、createdAt 新到舊、≤ 20 筆＋count，讀取 ≤ 21', async () => {
    const { total, page } = await loadInactiveEvents();
    expect(total).toBe(30);
    expect(page.items).toHaveLength(INACTIVE_PAGE_SIZE);
    expect(page.items.every((e) => e.status === 'ended' || e.status === 'cancelled')).toBe(true);
    expect(page.items[0]!.id).toBe('ce_000');
    expect(sdk.where).toHaveBeenCalledWith('status', 'in', ['ended', 'cancelled']);
    expect(sdk.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(totalReads()).toBeLessThanOrEqual(21);
    everyListHasWhereAndLimit();
    expectNoForbiddenApis();
    calls.length = 0;
    const next = await fetchInactiveEventsPage(page.cursor);
    expect(next.items).toHaveLength(10);
    expect(totalReads()).toBeLessThanOrEqual(INACTIVE_PAGE_SIZE);
  });
});

describe('用戶狀態頁籤', () => {
  it('進頁：4 個 count＋兩段名單各 ≤ 10，讀取 ≤ 24（預算 26）；不整集合讀 users', async () => {
    const result = await loadUserStatus(NOW);
    // 統計框含從未登入、lastLogin 非時間戳的 2 人；名單人數只算查得到的。
    expect(result.stats).toEqual({ active: 40, mid: 25, over90: 35 });
    expect(result.listTotals).toEqual({ over90: 33, mid: 25 });
    expect(result.over90.items).toHaveLength(USER_LIST_PAGE_SIZE);
    expect(result.mid.items).toHaveLength(USER_LIST_PAGE_SIZE);
    // 最久沒登入的在前（同 A 天數由多到少）
    expect(result.over90.items[0]!.name).toBe('O32');
    expect(result.mid.items[0]!.name).toBe('M24');
    expect(calls.filter((c) => c.kind === 'count')).toHaveLength(4);
    expect(calls.filter((c) => c.kind === 'docs')).toHaveLength(2);
    expect(totalReads()).toBeLessThanOrEqual(24);
    everyListHasWhereAndLimit();
    expectNoForbiddenApis();
  });

  it('兩段名單各自載入更多，每次 ≤ 10 讀，與第一頁不重複', async () => {
    const first = await loadUserStatus(NOW);
    calls.length = 0;
    const more = await fetchUserSegmentPage('over90', first.over90.cursor, NOW);
    expect(more.items).toHaveLength(USER_LIST_PAGE_SIZE);
    const firstIds = new Set(first.over90.items.map((u) => u.id));
    expect(more.items.some((u) => firstIds.has(u.id))).toBe(false);
    expect(totalReads()).toBeLessThanOrEqual(USER_LIST_PAGE_SIZE);
    everyListHasWhereAndLimit();
  });

  it('超過 90 天名單全部載完的筆數＝listTotals.over90（從未登入者不在名單）', async () => {
    const first = await loadUserStatus(NOW);
    const items = [...first.over90.items];
    let page = first.over90;
    while (!page.done) {
      page = await fetchUserSegmentPage('over90', page.cursor, NOW);
      items.push(...page.items);
    }
    expect(items).toHaveLength(first.listTotals.over90);
    expect(items.some((u) => u.id === 'never1' || u.id === 'legacy1')).toBe(false);
  });

  it('count 失敗時整體失敗（不假裝 0 人）', async () => {
    sdk.getCountFromServer.mockRejectedValueOnce(new Error('synthetic'));
    await expect(loadUserStatus(NOW)).rejects.toThrow('synthetic');
  });
});
