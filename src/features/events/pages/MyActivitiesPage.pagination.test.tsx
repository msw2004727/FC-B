import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMinimalViewer } from '@/features/profile/data/viewer';
import { createEventsRepo, type EventsRepo } from '../data/events-repo';
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
  for (let day = 1; day <= 25; day += 1) {
    const suffix = String(day).padStart(2, '0');
    memory.rows.set('doc-' + suffix, {
      id: 'public-' + suffix, title: '歷史活動' + suffix, creatorUid: 'owner', creator: '主辦人',
      type: 'external', status: 'ended', date: '2026/01/' + suffix + ' 09:00~11:00',
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
  fireEvent.click(screen.getByRole('button', { name: '查看更多' }));
  await waitFor(() => expect(titles(container)).toHaveLength(20));
  fireEvent.click(screen.getByRole('button', { name: '查看更多' }));
  await waitFor(() => expect(titles(container)).toHaveLength(25));
  // 第三次讓頁面的 hasRemoteMore 也變 false（Repo 已由不足一頁判定全讀完）。
  fireEvent.click(screen.getByRole('button', { name: '查看更多' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '查看更多' })).toBeNull());
  expect(repo.getSnapshot().terminal).toHaveLength(25);
}

describe('T-075b 歷史末頁編輯 × 真實 EventsRepo', () => {
  it.each([
    ['all', false], ['ended', false], ['cancelled', false], ['ended', true],
  ] as const)('%s 末頁儲存後可再次載入全部 25 筆（active 失敗=%s）', async (tab, failActive) => {
    if (tab === 'cancelled') {
      for (const [id, row] of memory.rows) memory.rows.set(id, { ...row, status: 'cancelled' });
    }
    const { container } = render(<MyActivitiesPage />);
    await waitFor(() => expect(titles(container)).toHaveLength(10));
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-afilter="' + tab + '"]')!);
    await reachLastPage(container);
    const oldCard = screen.getByText('歷史活動01').closest<HTMLElement>('.msg-manage-card')!;
    fireEvent.click(within(oldCard).getByRole('button', { name: '編輯' }));
    fireEvent.input(document.getElementById('cee-title')!, { target: { value: '末頁已修改' } });
    memory.failActive = failActive;
    fireEvent.click(screen.getByRole('button', { name: '儲存修改' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '編輯活動連結' })).toBeNull());
    await waitFor(() => {
      expect(titles(container)).toHaveLength(10);
      expect(repo.getSnapshot().terminal).toHaveLength(10);
      expect((screen.getByRole('button', { name: '查看更多' }) as HTMLButtonElement).disabled).toBe(false);
    });
    expect(memory.rows.get('doc-01')?.title).toBe('末頁已修改');
    expect(memory.update).toHaveBeenCalledTimes(1);
    expect(memory.read).toHaveBeenCalledTimes(1);
    expect(repo.getSnapshot().terminal).toHaveLength(10);
    expect(container.querySelector('.tab.active')?.getAttribute('data-afilter')).toBe(tab);
    expect(screen.getByText('已顯示 10 / 10+')).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看更多' })).toBeTruthy();
    await reachLastPage(container);
    expect(titles(container)).toEqual([
      ...Array.from({ length: 24 }, (_, index) => '歷史活動' + String(25 - index).padStart(2, '0')),
      '末頁已修改',
    ]);
    expect(new Set(repo.getSnapshot().terminal.map(row => row._docId)).size).toBe(25);
    expect(memory.query.mock.calls.some(([request]) =>
      (request as Request).constraints.some(clause => clause.kind === 'after' && clause.cursor.id === 'doc-16'))).toBe(true);
  });
});
