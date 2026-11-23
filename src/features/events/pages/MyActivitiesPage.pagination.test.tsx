import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMinimalViewer } from '@/features/profile/data/viewer';
import { TERMINAL_HISTORY_LIMIT, createEventsRepo, type EventsRepo } from '../data/events-repo';
import type { EventDoc } from '../data/types';
import MyActivitiesPage from './MyActivitiesPage';

// 真實 Page → Modal → saveExternalEventEdit → EventsRepo；只以記憶體替換 Firestore 傳輸。
// where/orderBy/limit/startAfter 都實際套用，不以預製清單取代 Repo 的分頁狀態。
type Row = EventDoc & Record<string, unknown>;
type Ref = { path: string; id: string };
type Constraint =
  | { kind: 'where'; field: string; op: string; value: string[] }
  | { kind: 'order'; field: string; direction: string }
  | { kind: 'limit'; count: number }
  | { kind: 'after'; cursor: { id: string } };
type Request = { base: Ref; constraints: Constraint[] };
const memory = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  failActive: false,
  query: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
}));
let repo: EventsRepo;
const viewer = {
  ...createMinimalViewer('owner'),
  capabilities: ['user.activity.own_manage_entry', 'user.activity.own_edit_basic'],
};
vi.mock('@/features/profile/data/viewer', async original => ({
  ...await original<typeof import('@/features/profile/data/viewer')>(), useViewer: () => viewer,
}));
vi.mock('preact-iso', () => ({ useLocation: () => ({ path: '/my-activities', route: vi.fn() }) }));
vi.mock('@/data/firebase', () => ({
  getFirebase: async () => ({ db: 'memory' }), getFirebaseCore: async () => ({ db: 'memory' }),
}));
vi.mock('@/data/op-log', () => ({ writeOpLog: vi.fn(async () => undefined) }));
vi.mock('@/data/user-roles', () => ({ useUserRoles: () => ({}), getCachedUserLevel: () => undefined }));
vi.mock('@/features/profile/data/profile-model', async original => ({
  ...await original<typeof import('@/features/profile/data/profile-model')>(), loadUserProfile: async () => null,
}));
vi.mock('../components/EventFormModal', () => ({ EventFormModal: () => null }));
vi.mock('../data/activity-map-config', async original => ({
  ...await original<typeof import('../data/activity-map-config')>(),
  isActivityMapLocationPickerEnabled: () => false,
  loadActivityMapLocationPickerEnabled: async () => false,
  subscribeActivityMapFeature: () => () => undefined,
}));
vi.mock('../data/events-repo', async original => ({
  ...await original<typeof import('../data/events-repo')>(), getEventsRepo: () => repo,
}));
vi.mock('firebase/firestore', async original => ({
  ...await original<typeof import('firebase/firestore')>(),
  collection: (_db: unknown, name: string): Ref => ({ path: name, id: name }),
  doc: (_db: unknown, collection: string, id: string): Ref => ({ path: collection + '/' + id, id }),
  query: (base: Ref, ...constraints: Constraint[]): Request => ({ base, constraints }),
  where: (field: string, op: string, value: string[]): Constraint => ({ kind: 'where', field, op, value }),
  orderBy: (field: string, direction: string): Constraint => ({ kind: 'order', field, direction }),
  limit: (count: number): Constraint => ({ kind: 'limit', count }),
  startAfter: (cursor: { id: string }): Constraint => ({ kind: 'after', cursor }),
  getDocs: memory.query, getDocFromServer: memory.read, updateDoc: memory.update,
  serverTimestamp: () => 'SERVER_TIME',
}));

const TOTAL = TERMINAL_HISTORY_LIMIT * 2 + 5;
function pad(n: number): string { return String(n).padStart(3, '0'); }
function docId(n: number): string { return 'doc-' + pad(n); }

function snapshot(id: string, row: Row | undefined) {
  return { id, exists: () => row !== undefined, data: () => row && { ...row } };
}
function titles(container: Element): string[] {
  return [...container.querySelectorAll('.msg-manage-title')].map(el => el.textContent!.trim());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));
  memory.rows.clear();
  memory.failActive = false;
  // 測試同步更新：歷史一頁由 10 改 50 後，用「兩頁滿＋一頁不足」的筆數保留遠端分頁與游標的驗證。
  for (let n = 1; n <= TOTAL; n += 1) {
    const day = new Date(Date.UTC(2025, 0, 1) + n * 86_400_000);
    const ymd = day.getUTCFullYear() + '/' + String(day.getUTCMonth() + 1).padStart(2, '0') + '/'
      + String(day.getUTCDate()).padStart(2, '0');
    memory.rows.set(docId(n), {
      id: 'public-' + pad(n), title: '歷史活動' + pad(n), creatorUid: 'owner', creator: '主辦人',
      type: 'external', status: 'ended', date: ymd + ' 09:00~11:00',
      location: '球場', externalUrl: 'https://example.test/activity', sportTag: 'football',
    });
  }
  memory.query.mockImplementation(async ({ base, constraints }: Request) => {
    expect(base.path).toBe('events');
    let rows = [...memory.rows.entries()];
    for (const clause of constraints) {
      if (clause.kind === 'where') {
        expect(clause.op).toBe('in');
        if (memory.failActive && clause.value.includes('open')) throw new Error('active unavailable');
        rows = rows.filter(([, row]) => clause.value.includes(String(row[clause.field])));
      } else if (clause.kind === 'order') {
        rows.sort(([, a], [, b]) => String(a[clause.field]).localeCompare(String(b[clause.field]))
          * (clause.direction === 'desc' ? -1 : 1));
      } else if (clause.kind === 'after') {
        const index = rows.findIndex(([id]) => id === clause.cursor.id);
        expect(index).toBeGreaterThanOrEqual(0);
        rows = rows.slice(index + 1);
      } else {
        rows = rows.slice(0, clause.count);
      }
    }
    return { docs: rows.map(([id, row]) => snapshot(id, row)), metadata: { fromCache: false } };
  });
  memory.read.mockImplementation(async (ref: Ref) => snapshot(ref.id, memory.rows.get(ref.id)));
  memory.update.mockImplementation(async (ref: Ref, updates: Record<string, unknown>) => {
    const row = memory.rows.get(ref.id);
    expect(row).toBeDefined();
    memory.rows.set(ref.id, { ...row, ...updates });
  });
  repo = createEventsRepo({ getFirebase: async () => ({ db: 'memory' as never }), logger: { warn: vi.fn(), error: vi.fn() } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function reachLastPage(container: Element): Promise<void> {
  // 每按一次多顯示 10 筆；本機用完才向遠端翻下一頁。Repo 判定全讀完後按鈕立即收起，不必多按一次。
  for (let shown = 20; shown <= TOTAL + 10; shown += 10) {
    fireEvent.click(screen.getByRole('button', { name: '查看更多' }));
    const expected = Math.min(shown, TOTAL);
    await waitFor(() => expect(titles(container)).toHaveLength(expected));
    if (expected === TOTAL) break;
  }
  await waitFor(() => expect(screen.queryByRole('button', { name: '查看更多' })).toBeNull());
  expect(repo.getSnapshot().terminal).toHaveLength(TOTAL);
}

describe('T-075b 歷史末頁編輯 × 真實 EventsRepo', () => {
  it.each([
    ['all', false], ['ended', false], ['cancelled', false], ['ended', true],
  ] as const)('%s 末頁儲存後可再次載入全部歷史（active 失敗=%s）', async (tab, failActive) => {
    if (tab === 'cancelled') {
      for (const [id, row] of memory.rows) memory.rows.set(id, { ...row, status: 'cancelled' });
    }
    const { container } = render(<MyActivitiesPage />);
    await waitFor(() => expect(titles(container)).toHaveLength(10));
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-afilter="' + tab + '"]')!);
    await reachLastPage(container);
    const oldCard = screen.getByText('歷史活動001').closest<HTMLElement>('.msg-manage-card')!;
    fireEvent.click(within(oldCard).getByRole('button', { name: '編輯' }));
    fireEvent.input(document.getElementById('cee-title')!, { target: { value: '末頁已修改' } });
    memory.failActive = failActive;
    fireEvent.click(screen.getByRole('button', { name: '儲存修改' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '編輯活動連結' })).toBeNull());
    await waitFor(() => {
      expect(titles(container)).toHaveLength(10);
      expect(repo.getSnapshot().terminal).toHaveLength(TERMINAL_HISTORY_LIMIT);
      expect((screen.getByRole('button', { name: '查看更多' }) as HTMLButtonElement).disabled).toBe(false);
    });
    expect(memory.rows.get(docId(1))?.title).toBe('末頁已修改');
    expect(memory.update).toHaveBeenCalledTimes(1);
    expect(memory.read).toHaveBeenCalledTimes(1);
    expect(repo.getSnapshot().terminal).toHaveLength(TERMINAL_HISTORY_LIMIT);
    expect(container.querySelector('.tab.active')?.getAttribute('data-afilter')).toBe(tab);
    expect(screen.getByText('已顯示 10 / ' + TERMINAL_HISTORY_LIMIT)).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看更多' })).toBeTruthy();
    await reachLastPage(container);
    expect(titles(container)).toEqual([
      ...Array.from({ length: TOTAL - 1 }, (_, index) => '歷史活動' + pad(TOTAL - index)),
      '末頁已修改',
    ]);
    expect(new Set(repo.getSnapshot().terminal.map(row => row._docId)).size).toBe(TOTAL);
    const firstPageLast = docId(TOTAL - TERMINAL_HISTORY_LIMIT + 1);
    expect(memory.query.mock.calls.some(([request]) =>
      (request as Request).constraints.some(clause => clause.kind === 'after' && clause.cursor.id === firstPageLast))).toBe(true);
  });
});

describe('非管理員：自己的舊活動不在歷史第一頁', () => {
  it('清單空時仍顯示「查看更多」，翻頁後找得到自己的活動', async () => {
    memory.rows.clear();
    // 最新的一整頁都是別人的活動；自己的活動較舊，在第二頁。
    for (let n = 1; n <= TERMINAL_HISTORY_LIMIT + 3; n += 1) {
      const mine = n <= 3;
      const day = new Date(Date.UTC(2025, 0, 1) + n * 86_400_000);
      const ymd = day.getUTCFullYear() + '/' + String(day.getUTCMonth() + 1).padStart(2, '0') + '/'
        + String(day.getUTCDate()).padStart(2, '0');
      memory.rows.set(docId(n), {
        id: 'public-' + pad(n), title: (mine ? '我的活動' : '別人的活動') + pad(n),
        creatorUid: mine ? 'owner' : 'someone-else', creator: '主辦人',
        type: 'external', status: 'ended', date: ymd + ' 09:00~11:00',
        location: '球場', externalUrl: 'https://example.test/activity', sportTag: 'football',
      });
    }
    const { container } = render(<MyActivitiesPage />);
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-afilter="ended"]')!);
    await waitFor(() => expect(screen.getByText('此分類沒有活動')).toBeTruthy());
    expect(titles(container)).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: '查看更多' }));
    await waitFor(() => expect(titles(container)).toEqual(['我的活動003', '我的活動002', '我的活動001']));
    await waitFor(() => expect(screen.queryByRole('button', { name: '查看更多' })).toBeNull());
  });
});
