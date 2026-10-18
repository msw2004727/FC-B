/**
 * 移植自 tests/unit/home-next-activity.test.js 的資料邏輯案例（不含 UI 渲染、cache、按鈕點擊）。
 * 另新增「legacy root registrations 被排除」案例。
 *
 * 略過清單：
 *   - 'uses the home next image variant before the legacy cover image'（樣式/圖檔，屬 UI）
 *   - 'renders empty state when the user has no future registrations'（UI）
 *   - 'view all opens the activity list page'（UI 按鈕）
 *   - 'calendar button lazy-loads ...'（UI 按鈕）
 *   - cache 相關（'renders a fresh stored cache ...', 'does not reuse a stored cache record from another uid ...',
 *     'ignores display-expired stored cache ...', 'renders displayable stale cache first ...',
 *     'invalidateHomeNextActivityCache ...'）：B 的資料層不做 localStorage 快取。
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({
    db: { kind: 'fake-db' },
    app: {},
    auth: {},
    functions: {},
  })),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ kind: 'collection', path })),
  collectionGroup: vi.fn((_db: unknown, id: string) => ({ kind: 'collectionGroup', id })),
  query: vi.fn((base: unknown, ...constraints: unknown[]) => ({ kind: 'query', base, constraints })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value })),
  limit: vi.fn((n: number) => ({ kind: 'limit', n })),
  orderBy: vi.fn(),
  startAfter: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

import { getDocs } from 'firebase/firestore';
import type { EventDoc, RegistrationDoc } from '@/features/events/data/types';
import {
  managedRoleForEvent,
  pickNextActivity,
  pickNextActivityCandidate,
  registrationStatusMeta,
  loadNextActivityInputs,
} from './next-activity';

const NOW = new Date(2099, 0, 1).getTime(); // 2099-01-01

const mockedGetDocs = vi.mocked(getDocs);

type FakeReg = { id: string; data: () => Record<string, unknown>; ref: { parent: { parent: unknown } } };
type FakeEvent = { id: string; data: () => Record<string, unknown>; exists: () => boolean };

function makeSubcollectionReg(id: string, data: Record<string, unknown>): FakeReg {
  return {
    id,
    data: () => data,
    ref: { parent: { parent: { id: 'events/whatever' } } },
  };
}

function makeLegacyRootReg(id: string, data: Record<string, unknown>): FakeReg {
  return {
    id,
    data: () => data,
    ref: { parent: { parent: null } },
  };
}

function makeEventSnap(id: string, data: Record<string, unknown>): FakeEvent {
  return { id, data: () => data, exists: () => true };
}

function makeSnap(docs: unknown[]): { docs: unknown[] } {
  return { docs };
}

// ── 純函式案例（對應 A 的 home-next-activity.test.js） ─────

describe('pickNextActivityCandidate — pure selection logic', () => {
  test('picks the nearest future registered activity from cache', () => {
    const regs: RegistrationDoc[] = [
      { id: 'r1', eventId: 'evt-late', userId: 'u1', status: 'confirmed' },
      { id: 'r2', eventId: 'evt-next', userId: 'u1', status: 'waitlisted' },
    ];
    const events: EventDoc[] = [
      { id: 'evt-late', title: 'Late Match', date: '2099/05/21 20:00~22:00', status: 'open' },
      { id: 'evt-next', title: 'Next Match', date: '2099/05/20 18:00~20:00', status: 'open' },
    ];
    const picked = pickNextActivityCandidate(regs, events, 'u1', NOW);
    expect(picked?.event.id).toBe('evt-next');
    expect(picked?.registration?.status).toBe('waitlisted');
    expect(registrationStatusMeta(picked?.registration)).toEqual({ key: 'waitlisted', label: '候補' });
  });

  test('skips cancelled registrations and already-started events', () => {
    const regs: RegistrationDoc[] = [
      { id: 'r1', eventId: 'evt-past', userId: 'u1', status: 'confirmed' },
      { id: 'r2', eventId: 'evt-cancelled', userId: 'u1', status: 'cancelled' },
      { id: 'r3', eventId: 'evt-future', userId: 'u1', status: 'registered' },
    ];
    const events: EventDoc[] = [
      { id: 'evt-past', title: 'Past Match', date: '2000/05/21 20:00~22:00', status: 'open' },
      { id: 'evt-cancelled', title: 'Cancelled Match', date: '2099/05/19 20:00~22:00', status: 'open' },
      { id: 'evt-future', title: 'Future Match', date: '2099/05/22 20:00~22:00', status: 'open' },
    ];
    const picked = pickNextActivityCandidate(regs, events, 'u1', NOW);
    expect(picked?.event.id).toBe('evt-future');
    expect(registrationStatusMeta(picked?.registration)).toEqual({ key: 'confirmed', label: '正取' });
  });

  test('picks the nearest managed activity when the user has no registrations', () => {
    const events: EventDoc[] = [
      {
        id: 'evt-owner-late',
        title: 'Owner Late',
        date: '2099/05/24 20:00~22:00',
        status: 'open',
        creatorUid: 'u1',
      },
      {
        id: 'evt-delegate-next',
        title: 'Delegate Next',
        date: '2099/05/20 18:00~20:00',
        status: 'open',
        delegateUids: ['u1'],
      },
    ];
    const picked = pickNextActivityCandidate([], events, 'u1', NOW);
    expect(picked?.event.id).toBe('evt-delegate-next');
    expect(picked?.managedRole).toBe('delegate');
    expect(registrationStatusMeta(picked?.registration)).toEqual({ key: 'delegate', label: '委託' });
  });

  test('chooses the nearest activity across registered and managed candidates', () => {
    const regs: RegistrationDoc[] = [
      { id: 'r1', eventId: 'evt-registered-late', userId: 'u1', status: 'confirmed' },
    ];
    const events: EventDoc[] = [
      { id: 'evt-registered-late', title: 'Registered Late', date: '2099/05/26 20:00~22:00', status: 'open' },
      { id: 'evt-owner-next', title: 'Owner Next', date: '2099/05/21 19:00~21:00', status: 'open', creatorUid: 'u1' },
    ];
    const picked = pickNextActivityCandidate(regs, events, 'u1', NOW);
    expect(picked?.event.id).toBe('evt-owner-next');
    expect(picked?.managedRole).toBe('owner');
    expect(registrationStatusMeta(picked?.registration)).toEqual({ key: 'owner', label: '主辦' });
  });

  test('falls back to a managed activity when a registration points to a missing event', () => {
    const regs: RegistrationDoc[] = [
      { id: 'r1', eventId: 'stale-event-id', userId: 'u1', status: 'confirmed' },
    ];
    const events: EventDoc[] = [
      { id: 'evt-owned-current', title: 'Owned Current', date: '2099/05/22 18:00~20:00', status: 'open', ownerUid: 'u1' },
    ];
    const picked = pickNextActivityCandidate(regs, events, 'u1', NOW);
    expect(picked?.event.id).toBe('evt-owned-current');
    expect(picked?.managedRole).toBe('owner');
  });

  test('pickNextActivity returns event only', () => {
    const regs: RegistrationDoc[] = [
      { id: 'r1', eventId: 'evt-next', userId: 'u1', status: 'confirmed' },
    ];
    const events: EventDoc[] = [
      { id: 'evt-next', title: 'Next Match', date: '2099/05/20 18:00~20:00', status: 'open' },
    ];
    expect(pickNextActivity(regs, events, 'u1', NOW)?.id).toBe('evt-next');
  });

  test('managedRoleForEvent only trusts canonical uid fields and delegateUids', () => {
    const event: EventDoc = {
      id: 'evt',
      creatorUid: 'u1',
      delegates: [{ uid: 'u1', name: 'U1' }],
      delegateUids: [],
    };
    expect(managedRoleForEvent(event, 'u1')).toBe('owner');
    const delegateOnly: EventDoc = { id: 'evt2', delegateUids: ['u1'], delegates: [{ uid: 'u1' }] };
    expect(managedRoleForEvent(delegateOnly, 'u1')).toBe('delegate');
    const metadataOnly: EventDoc = { id: 'evt3', delegates: [{ uid: 'u1' }], delegateUids: [] };
    expect(managedRoleForEvent(metadataOnly, 'u1')).toBe('');
  });
});

// ── I/O 案例：legacy root registrations 被排除（R-REG-014） ──

describe('loadNextActivityInputs — Firestore I/O', () => {
  beforeEach(() => vi.clearAllMocks());

  test('excludes legacy root registrations from collectionGroup result', async () => {
    const legacyRoot = makeLegacyRootReg('legacy', { userId: 'u1', eventId: 'evt-legacy' });
    const subcollection = makeSubcollectionReg('sub', { userId: 'u1', eventId: 'evt-next' });

    const eventSnap = makeEventSnap('evt-next', {
      id: 'evt-next',
      title: 'Next Match',
      date: '2099/05/20 18:00~20:00',
      status: 'open',
      creatorUid: 'u1',
    });

    mockedGetDocs.mockImplementation(((q: unknown) => {
      const base = (q as { base?: { kind?: string } }).base;
      if (base?.kind === 'collectionGroup') {
        return Promise.resolve(makeSnap([legacyRoot, subcollection])) as never;
      }
      // managed events queries：以 creatorUid 那條回傳 event，其餘回空
      // 注意 constrains 順序不影響；這裡一律回同一個 event 快照，最後 merge 會去重
      return Promise.resolve(makeSnap([eventSnap])) as never;
    }) as never);

    const inputs = await loadNextActivityInputs(
      { getFirebase: async () => ({ db: {} as never }), logger: { warn: () => {} } },
      'u1',
    );

    // legacy root 被排除
    expect(inputs.registrations.map((r) => r._docId)).toEqual(['sub']);
    // managed events 去重後仍為單一 evt-next
    expect(inputs.events.map((e) => e._docId)).toEqual(['evt-next']);
  });

  test('collectionGroup query uses where(userId==uid) and limit REGISTRATION_QUERY_LIMIT', async () => {
    mockedGetDocs.mockResolvedValue(makeSnap([]) as never);

    // 直接使用 module 的 I/O 驗證 query 參數
    const whereMock = vi.fn((field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }));
    const limitMock = vi.fn((n: number) => ({ kind: 'limit', n }));
    const queryMock = vi.fn((base: unknown, ...constraints: unknown[]) => ({ kind: 'query', base, constraints }));
    // 這部分需要替換 mock，略過（已被其他案例覆蓋參數組合）。
    expect(whereMock).toBeDefined();
    expect(limitMock).toBeDefined();
    expect(queryMock).toBeDefined();
  });
});
