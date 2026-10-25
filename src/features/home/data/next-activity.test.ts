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

// resolveEventDocId 內部是動態 import('firebase/firestore')，不吃上面的假 SDK；這裡直接視為「公開 id ＝ 文件 id」。
vi.mock('@/data/paths', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/paths')>()),
  resolveEventDocId: vi.fn(async (eventId: string) => eventId),
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

import { collectionGroup, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import type { EventDoc, RegistrationDoc } from '@/features/events/data/types';
import {
  ACTIVE_REGISTRATION_STATUSES,
  REGISTRATION_QUERY_LIMIT,
  isActiveRegistration,
  managedRoleForEvent,
  pickNextActivity,
  pickNextActivityCandidate,
  registrationStatusMeta,
  loadNextActivityInputs,
  resolveNextActivity,
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

  // 測試同步更新（R-QA-005）：原案例只有佔位斷言（沒有驗證任何 query 參數），T-033 改成真正檢查查詢形狀。
  test('registration collectionGroup query = userId == uid + status in ACTIVE + limit REGISTRATION_QUERY_LIMIT', async () => {
    const seen: Array<{ base: { kind?: string; id?: string }; constraints: unknown[] }> = [];
    mockedGetDocs.mockImplementation(((q: unknown) => {
      seen.push(q as (typeof seen)[number]);
      return Promise.resolve(makeSnap([])) as never;
    }) as never);

    await loadNextActivityInputs(
      { getFirebase: async () => ({ db: {} as never }), logger: { warn: () => {} } },
      'U0000000000000000000000000000001',
    );

    const regQuery = seen.find((q) => q.base?.kind === 'collectionGroup');
    expect(regQuery?.base.id).toBe('registrations');
    expect(regQuery?.constraints).toEqual([
      { kind: 'where', field: 'userId', op: '==', value: 'U0000000000000000000000000000001' },
      { kind: 'where', field: 'status', op: 'in', value: ['confirmed', 'waitlisted', 'registered'] },
      { kind: 'limit', n: REGISTRATION_QUERY_LIMIT },
    ]);
  });
});

// ── T-033：報名很多的帳號，最新報名不能被 limit 截掉 ─────────────

const HEAVY_UID = 'U0000000000000000000000000000001';

/**
 * 站長帳號形狀的假資料（309 筆、217 筆 cancelled），依文件路徑排序（collectionGroup 預設順序）：
 * 先是 59 筆舊版根集合殘留（已取消）、158 筆已取消的子集合報名、1 筆 removed、
 * 89 筆過去活動的 confirmed（含 1 筆舊資料殘留的 registered）、1 筆 waitlisted，最後一筆才是明天活動的 confirmed。
 */
function buildHeavyUserRegistrations(): FakeReg[] {
  const regs: FakeReg[] = [];
  const base = { userId: HEAVY_UID };
  for (let i = 0; i < 59; i += 1) {
    regs.push(makeLegacyRootReg(`root-${i}`, { ...base, eventId: `evt-old-root-${i}`, status: 'cancelled' }));
  }
  for (let i = 0; i < 158; i += 1) {
    regs.push(makeSubcollectionReg(`c-${i}`, { ...base, eventId: `evt-old-c-${i}`, status: 'cancelled' }));
  }
  regs.push(makeSubcollectionReg('removed-0', { ...base, eventId: 'evt-old-removed', status: 'removed' }));
  for (let i = 0; i < 89; i += 1) {
    // 其中一筆是舊資料殘留的 registered（沒有現行寫入點，但讀端都承認它是進行中）。
    regs.push(makeSubcollectionReg(`ok-${i}`, { ...base, eventId: `evt-old-ok-${i}`, status: i === 0 ? 'registered' : 'confirmed' }));
  }
  regs.push(makeSubcollectionReg('wait-0', { ...base, eventId: 'evt-old-wait', status: 'waitlisted' }));
  regs.push(makeSubcollectionReg('tomorrow', { ...base, eventId: 'evt-tomorrow', status: 'confirmed' }));
  return regs;
}

interface FakeConstraint {
  kind: string;
  field?: string;
  op?: string;
  value?: unknown;
  n?: number;
}

/** 照 Firestore 語意執行 collectionGroup('registrations') 查詢：where（==、in）依序過濾後再 limit。 */
function runRegistrationQuery(store: FakeReg[], constraints: FakeConstraint[]): { docs: FakeReg[] } {
  let docs = store;
  for (const c of constraints) {
    if (c.kind !== 'where' || !c.field) continue;
    const field = c.field;
    docs = docs.filter((d) => {
      const actual = d.data()[field];
      if (c.op === '==') return actual === c.value;
      if (c.op === 'in') return Array.isArray(c.value) && c.value.includes(actual);
      return false;
    });
  }
  const lim = constraints.find((c) => c.kind === 'limit')?.n;
  return makeSnap(lim === undefined ? docs : docs.slice(0, lim)) as { docs: FakeReg[] };
}

function installHeavyUserFirestore(store: FakeReg[]): void {
  mockedGetDocs.mockImplementation(((q: unknown) => {
    const { base, constraints } = q as { base: { kind?: string }; constraints: FakeConstraint[] };
    if (base?.kind === 'collectionGroup') return Promise.resolve(runRegistrationQuery(store, constraints)) as never;
    return Promise.resolve(makeSnap([])) as never; // 管理的活動（creator／owner／delegate）與 id 反查：都沒有
  }) as never);
  vi.mocked(doc).mockImplementation(((_db: unknown, path: string, id: string) => ({ path, id })) as never);
  vi.mocked(getDoc).mockImplementation(((ref: { id: string }) => {
    if (ref.id === 'evt-tomorrow') {
      return Promise.resolve(
        makeEventSnap('evt-tomorrow', {
          id: 'evt-tomorrow',
          title: 'Tomorrow Match',
          date: '2099/01/02 09:00~11:00',
          status: 'open',
        }),
      ) as never;
    }
    return Promise.resolve(
      makeEventSnap(ref.id, { id: ref.id, title: 'Old', date: '2000/01/01 09:00~11:00', status: 'open' }),
    ) as never;
  }) as never);
}

describe('T-033：報名紀錄很多的帳號（309 筆、217 筆已取消）', () => {
  beforeEach(() => vi.clearAllMocks());

  test('假資料重現舊問題：舊查詢（只有 userId ＋ limit 120）窗口全是取消紀錄，漏掉明天的報名', async () => {
    const store = buildHeavyUserRegistrations();
    expect(store).toHaveLength(309);
    expect(store.filter((r) => r.data().status === 'cancelled')).toHaveLength(217);

    const legacyQuery = query(
      collectionGroup({} as never, 'registrations'),
      where('userId', '==', HEAVY_UID),
      limit(120),
    ) as unknown as { constraints: FakeConstraint[] };
    const window = runRegistrationQuery(store, legacyQuery.constraints).docs;

    expect(window).toHaveLength(120);
    expect(window.some((r) => r.data().eventId === 'evt-tomorrow')).toBe(false);
    expect(window.every((r) => r.data().status === 'cancelled')).toBe(true);
  });

  test('新查詢取得明天的報名，排除取消／removed 與舊版根集合殘留，也不觸發上限警告', async () => {
    installHeavyUserFirestore(buildHeavyUserRegistrations());
    const warn = vi.fn();

    const inputs = await loadNextActivityInputs(
      { getFirebase: async () => ({ db: {} as never }), logger: { warn } },
      HEAVY_UID,
    );

    // 89 筆過去活動（confirmed／registered）＋ 1 筆 waitlisted ＋ 明天這筆；舊版根集合殘留（皆 cancelled）本來就被 status 篩掉。
    expect(inputs.registrations).toHaveLength(91);
    expect(inputs.registrations.some((r) => r.eventId === 'evt-tomorrow')).toBe(true);
    expect(inputs.registrations.every((r) => ACTIVE_REGISTRATION_STATUSES.includes(String(r.status)))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  test('resolveNextActivity：站長帳號形狀的資料會選出明天的活動（舊查詢會得到 null）', async () => {
    installHeavyUserFirestore(buildHeavyUserRegistrations());

    const result = await resolveNextActivity(
      {
        getFirebase: async () => ({ db: {} as never }),
        logger: { warn: () => {} },
        now: () => new Date(2099, 0, 1).getTime(),
      },
      HEAVY_UID,
    );

    expect(result?.event.id).toBe('evt-tomorrow');
    expect(registrationStatusMeta(result?.registration)).toEqual({ key: 'confirmed', label: '正取' });
  });

  test('回傳筆數打到上限 → logger.warn（避免日後又靜默截斷）；未達上限不警告', async () => {
    const full = Array.from({ length: REGISTRATION_QUERY_LIMIT }, (_, i) =>
      makeSubcollectionReg(`r-${i}`, { userId: HEAVY_UID, eventId: `evt-old-${i}`, status: 'confirmed' }),
    );
    mockedGetDocs.mockResolvedValue(makeSnap(full) as never);
    vi.mocked(doc).mockImplementation(((_db: unknown, path: string, id: string) => ({ path, id })) as never);
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as never);
    const warn = vi.fn();
    await loadNextActivityInputs({ getFirebase: async () => ({ db: {} as never }), logger: { warn } }, HEAVY_UID);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('hit the limit'))).toBe(true);

    warn.mockClear();
    mockedGetDocs.mockResolvedValue(makeSnap(full.slice(0, REGISTRATION_QUERY_LIMIT - 1)) as never);
    await loadNextActivityInputs({ getFirebase: async () => ({ db: {} as never }), logger: { warn } }, HEAVY_UID);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('hit the limit'))).toBe(false);
  });

  test('報名查詢失敗（例如索引或網路）→ 記警告並略過，不丟錯', async () => {
    mockedGetDocs.mockRejectedValue(new Error('boom'));
    const warn = vi.fn();
    const inputs = await loadNextActivityInputs(
      { getFirebase: async () => ({ db: {} as never }), logger: { warn } },
      HEAVY_UID,
    );
    expect(inputs.registrations).toEqual([]);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('registration query skipped'))).toBe(true);
  });

  test('查詢用的進行中狀態，客戶端 isActiveRegistration 也都視為進行中（兩邊不漂移）', () => {
    expect(ACTIVE_REGISTRATION_STATUSES).toEqual(expect.arrayContaining(['confirmed', 'waitlisted', 'registered']));
    for (const status of ACTIVE_REGISTRATION_STATUSES) {
      expect(isActiveRegistration({ id: 'r', userId: HEAVY_UID, status }, HEAVY_UID)).toBe(true);
    }
  });
});
