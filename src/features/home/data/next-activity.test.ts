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
  documentId: vi.fn(() => ({ kind: 'documentId' })),
  orderBy: vi.fn(),
  startAfter: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

import { collectionGroup, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import type { EventDoc, RegistrationDoc } from '@/features/events/data/types';
import {
  ACTIVE_REGISTRATION_STATUSES,
  EVENT_IN_QUERY_CHUNK,
  REGISTRATION_QUERY_LIMIT,
  isValidFirestoreDocId,
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

// ── T-033：報名紀錄很多的帳號，最新報名不能被 limit 截掉 ─────────────

const HEAVY_UID = 'U0000000000000000000000000000001';

type StoreDoc = FakeReg & { path: string };

function subDoc(eventDocId: string, regId: string, status: string): StoreDoc {
  return {
    ...makeSubcollectionReg(regId, { userId: HEAVY_UID, eventId: eventDocId, status }),
    path: `events/${eventDocId}/registrations/${regId}`,
  };
}

function rootDoc(regId: string, eventId: string, status: string): StoreDoc {
  return {
    ...makeLegacyRootReg(regId, { userId: HEAVY_UID, eventId, status }),
    path: `registrations/${regId}`,
  };
}

const pad = (n: number): string => String(n).padStart(4, '0');

/** Firestore 的預設順序：依完整文件路徑逐段比較（`events/…` 排在根 `registrations/…` 之前）。 */
function comparePath(a: string, b: string): number {
  const sa = a.split('/');
  const sb = b.split('/');
  for (let i = 0; i < Math.min(sa.length, sb.length); i += 1) {
    const x = sa[i] as string;
    const y = sb[i] as string;
    if (x !== y) return x < y ? -1 : 1;
  }
  return sa.length - sb.length;
}

const TARGET_EVENT_DOC_ID = `ce_${pad(157)}`;

/**
 * 站長帳號形狀的壓力資料（309 筆；數字照診斷：子集合 250＝cancelled 217／confirmed 31／removed 1／waitlisted 1，
 * 舊根殘留 59＝約 55 筆 cancelled＋4 筆進行中）。這是「依診斷數字人工排出來」的資料，不是診斷的逐筆重放：
 * 子集合第 158 筆是明天活動的報名（診斷中該筆被 limit(120) 截掉），前 120 筆為 113 cancelled＋6 confirmed＋1 removed。
 * 為了涵蓋 `registered`，子集合的 31 筆 confirmed 裡有 1 筆改成 registered。
 */
function buildHeavyUserRegistrations(): StoreDoc[] {
  const sub: string[] = [];
  for (let i = 0; i < 120; i += 1) sub.push('cancelled');
  [20, 40, 60, 80, 100, 110].forEach((i) => { sub[i] = 'confirmed'; });
  sub[119] = 'removed';
  for (let i = 120; i < 157; i += 1) sub.push('cancelled');
  sub.push('confirmed'); // 第 158 筆（index 157）：明天活動
  sub.push(
    ...Array<string>(67).fill('cancelled'),
    ...Array<string>(23).fill('confirmed'),
    'registered',
    'waitlisted',
  );
  const docs: StoreDoc[] = sub.map((status, i) => subDoc(`ce_${pad(i)}`, `r_${pad(i)}`, status));
  for (let i = 0; i < 59; i += 1) {
    const status = i === 0 || i === 1 || i === 2 ? 'confirmed' : i === 3 ? 'registered' : 'cancelled';
    docs.push(rootDoc(`root_${i}`, `ce_root_${i}`, status));
  }
  return docs;
}

interface FakeConstraint {
  kind: string;
  field?: unknown;
  op?: string;
  value?: unknown;
  n?: number;
}

/** 照 Firestore 語意執行 collectionGroup('registrations') 查詢：依完整路徑排序 → where（==、in）→ limit。 */
function runRegistrationQuery(store: StoreDoc[], constraints: FakeConstraint[]): { docs: StoreDoc[] } {
  let docs = [...store].sort((a, b) => comparePath(a.path, b.path));
  for (const c of constraints) {
    if (c.kind !== 'where' || typeof c.field !== 'string') continue;
    const field = c.field;
    docs = docs.filter((d) => {
      const actual = d.data()[field];
      if (c.op === '==') return actual === c.value;
      if (c.op === 'in') return Array.isArray(c.value) && c.value.includes(actual);
      return false;
    });
  }
  const lim = constraints.find((c) => c.kind === 'limit')?.n;
  return { docs: lim === undefined ? docs : docs.slice(0, lim) };
}

interface EventInQuery {
  field: 'documentId' | 'id';
  ids: string[];
}

function targetEventSnap(id: string): FakeEvent {
  const isTarget = id === TARGET_EVENT_DOC_ID;
  return makeEventSnap(id, {
    id,
    title: isTarget ? 'Tomorrow Match' : 'Old',
    date: isTarget ? '2099/01/02 09:00~11:00' : '2000/01/01 09:00~11:00',
    status: 'open',
  });
}

/**
 * 依查詢種類回應：registrations collectionGroup 走假資料；管理的活動（creator／owner／delegate）回空；
 * 補抓活動的 `in` 查詢（documentId() in … 與 id in …）記下要查的 id，documentId 那條回對應的活動，id 那條回空。
 */
function installFirestore(store: StoreDoc[]): {
  requestedEventDocIds: string[];
  regSnapshotSizes: number[];
  inQueries: EventInQuery[];
} {
  const probe = {
    requestedEventDocIds: [] as string[],
    regSnapshotSizes: [] as number[],
    inQueries: [] as EventInQuery[],
  };
  mockedGetDocs.mockImplementation(((q: unknown) => {
    const { base, constraints } = q as { base: { kind?: string; id?: string }; constraints: FakeConstraint[] };
    if (base?.kind === 'collectionGroup' && base.id === 'registrations') {
      const snap = runRegistrationQuery(store, constraints);
      probe.regSnapshotSizes.push(snap.docs.length);
      return Promise.resolve(snap) as never;
    }
    const inWhere = constraints.find((c) => c.kind === 'where' && c.op === 'in');
    if (base?.kind === 'collection' && inWhere) {
      const ids = inWhere.value as string[];
      const byDocId = typeof inWhere.field !== 'string';
      probe.inQueries.push({ field: byDocId ? 'documentId' : 'id', ids });
      if (!byDocId) return Promise.resolve(makeSnap([])) as never;
      probe.requestedEventDocIds.push(...ids);
      return Promise.resolve(makeSnap(ids.map((id) => targetEventSnap(id)))) as never;
    }
    return Promise.resolve(makeSnap([])) as never;
  }) as never);
  return probe;
}

const deps = (warn: (...args: unknown[]) => void) => ({
  getFirebase: async () => ({ db: {} as never }),
  logger: { warn },
});

describe('T-033：報名紀錄很多的帳號（309 筆、217 筆已取消）', () => {
  beforeEach(() => vi.clearAllMocks());

  test('壓力資料的形狀：309 筆、依路徑排序後前 120 筆都是子集合的舊紀錄，舊查詢（userId ＋ limit 120）漏掉目標報名', () => {
    const store = buildHeavyUserRegistrations();
    expect(store).toHaveLength(309);
    expect(store.filter((r) => String(r.path).startsWith('events/'))).toHaveLength(250);

    const legacyQuery = query(
      collectionGroup({} as never, 'registrations'),
      where('userId', '==', HEAVY_UID),
      limit(120),
    ) as unknown as { constraints: FakeConstraint[] };
    const firstWindow = runRegistrationQuery(store, legacyQuery.constraints).docs;

    expect(firstWindow).toHaveLength(120);
    // 子集合（events/…）排在根（registrations/…）前：窗口全是子集合文件，不是被舊根佔用。
    expect(firstWindow.every((r) => r.path.startsWith('events/'))).toBe(true);
    const statuses = firstWindow.map((r) => String(r.data().status));
    expect(statuses.filter((s) => s === 'cancelled')).toHaveLength(113);
    expect(statuses.filter((s) => s === 'confirmed')).toHaveLength(6);
    expect(statuses.filter((s) => s === 'removed')).toHaveLength(1);
    expect(firstWindow.some((r) => r.data().eventId === TARGET_EVENT_DOC_ID)).toBe(false);
  });

  test('新查詢取得明天的報名：只回進行中的子集合報名，舊根的進行中資料被擋下且不補抓活動', async () => {
    const probe = installFirestore(buildHeavyUserRegistrations());
    const warn = vi.fn();

    const inputs = await loadNextActivityInputs(deps(warn), HEAVY_UID);

    // 伺服器端 status in 後有 36 筆（32 筆子集合＋4 筆舊根進行中）；舊根由 filterSubcollectionDocs 擋掉，剩 32 筆。
    expect(probe.regSnapshotSizes).toEqual([36]);
    expect(inputs.registrations).toHaveLength(32);
    expect(inputs.registrations.some((r) => r.eventId === TARGET_EVENT_DOC_ID)).toBe(true);
    expect(inputs.registrations.every((r) => ACTIVE_REGISTRATION_STATUSES.includes(String(r.status)))).toBe(true);
    expect(inputs.registrations.some((r) => String(r.eventId).startsWith('ce_root_'))).toBe(false);
    expect(probe.requestedEventDocIds.some((id) => id.startsWith('ce_root_'))).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  test('舊根殘留的 confirmed／registered：伺服器端查得到，但不進結果、不補抓活動（filterSubcollectionDocs 在擋）', async () => {
    const probe = installFirestore([
      rootDoc('root-a', 'ce_root_a', 'confirmed'),
      rootDoc('root-b', 'ce_root_b', 'registered'),
      rootDoc('root-c', 'ce_root_c', 'waitlisted'),
    ]);

    const inputs = await loadNextActivityInputs(deps(vi.fn()), HEAVY_UID);

    expect(probe.regSnapshotSizes).toEqual([3]);
    expect(inputs.registrations).toEqual([]);
    expect(probe.requestedEventDocIds).toEqual([]);
  });

  test('resolveNextActivity：壓力資料會選出明天的活動（舊查詢得不到它）', async () => {
    installFirestore(buildHeavyUserRegistrations());

    const result = await resolveNextActivity(
      { ...deps(vi.fn()), now: () => new Date(2099, 0, 1).getTime() },
      HEAVY_UID,
    );

    expect(result?.event.id).toBe(TARGET_EVENT_DOC_ID);
    expect(registrationStatusMeta(result?.registration)).toEqual({ key: 'confirmed', label: '正取' });
  });

  describe('上限邊界（有效報名前面還有 30 筆已取消，status 篩選要在 limit 之前）', () => {
    function activeStore(n: number): StoreDoc[] {
      const noise = Array.from({ length: 30 }, (_, i) => subDoc(`ce_0_${pad(i)}`, `n_${i}`, 'cancelled'));
      const active = Array.from({ length: n }, (_, i) => subDoc(`ce_1_${pad(i)}`, `a_${i}`, 'confirmed'));
      return [...noise, ...active];
    }
    const isLimitWarning = ([msg]: unknown[]): boolean => String(msg).includes('hit the limit');

    test.each([
      { n: 119, expected: 119, warns: false },
      { n: 150, expected: 150, warns: false }, // 超過舊上限 120：全部取得，證明上限不是 120
      { n: 299, expected: 299, warns: false }, // 2026-10-26 統計的最大值：上限 500 之下全部取得
      { n: 499, expected: 499, warns: false },
      { n: 500, expected: 500, warns: true },
      { n: 501, expected: 500, warns: true },
    ])('有效報名 $n 筆 → 取得 $expected 筆、上限警告 $warns', async ({ n, expected, warns }) => {
      installFirestore(activeStore(n));
      const warn = vi.fn();

      const inputs = await loadNextActivityInputs(deps(warn), HEAVY_UID);

      expect(inputs.registrations).toHaveLength(expected);
      expect(warn.mock.calls.some(isLimitWarning)).toBe(warns);
    });
  });

  test('報名查詢失敗（例如索引或網路）→ 記警告並略過，不丟錯', async () => {
    mockedGetDocs.mockRejectedValue(new Error('boom'));
    const warn = vi.fn();
    const inputs = await loadNextActivityInputs(deps(warn), HEAVY_UID);
    expect(inputs.registrations).toEqual([]);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('registration query skipped'))).toBe(true);
  });

  test('查詢用的進行中狀態都被客戶端 isActiveRegistration 接受（白名單是客戶端接受集合的子集；缺 status 的報名不在此保證內）', () => {
    expect(ACTIVE_REGISTRATION_STATUSES).toEqual(expect.arrayContaining(['confirmed', 'waitlisted', 'registered']));
    for (const status of ACTIVE_REGISTRATION_STATUSES) {
      expect(isActiveRegistration({ id: 'r', userId: HEAVY_UID, status }, HEAVY_UID)).toBe(true);
    }
  });
});

// ── T-041 A4：查詢並行與補抓改批次 ──────────────────────

describe('T-041 A4：報名與管理查詢並行、缺的活動一次 in 補抓', () => {
  beforeEach(() => vi.clearAllMocks());

  const UID = 'U0000000000000000000000000000002';
  const regDoc = (id: string, eventId: string): FakeReg =>
    makeSubcollectionReg(id, { userId: UID, eventId, status: 'confirmed' });

  test('報名查詢與三個管理查詢同時發出，不必等報名先回來', async () => {
    const pending: Array<(snap: { docs: unknown[] }) => void> = [];
    mockedGetDocs.mockImplementation((() =>
      new Promise((resolve) => {
        pending.push(resolve as (snap: { docs: unknown[] }) => void);
      })) as never);

    const done = loadNextActivityInputs(deps(vi.fn()), UID);

    // 四個查詢（報名＋creator／owner／delegate）都已發出，但還沒有任何一個回來
    await vi.waitFor(() => expect(mockedGetDocs).toHaveBeenCalledTimes(4));
    pending.forEach((resolve) => resolve(makeSnap([])));
    await expect(done).resolves.toEqual({ registrations: [], events: [] });
    // 沒有缺的活動 → 不發補抓查詢
    expect(mockedGetDocs).toHaveBeenCalledTimes(4);
  });

  test('缺的活動改一次 in 查詢：35 筆 → 2 批 × （文件 id、id 欄位）共 4 個查詢，且不再逐筆 getDoc', async () => {
    const ids = Array.from({ length: 35 }, (_, i) => `miss_${pad(i)}`);
    const probe = installFirestore(ids.map((id, i) => ({
      ...regDoc(`r_${i}`, id),
      path: `events/${id}/registrations/r_${i}`,
    })));

    const inputs = await loadNextActivityInputs(deps(vi.fn()), UID);

    expect(inputs.registrations).toHaveLength(35);
    expect(probe.inQueries).toHaveLength(4);
    const byDocId = probe.inQueries.filter((q) => q.field === 'documentId');
    const byId = probe.inQueries.filter((q) => q.field === 'id');
    expect(byDocId.map((q) => q.ids.length).sort((a, b) => a - b)).toEqual([5, EVENT_IN_QUERY_CHUNK]);
    expect(byId.map((q) => q.ids.length).sort((a, b) => a - b)).toEqual([5, EVENT_IN_QUERY_CHUNK]);
    expect(new Set(byDocId.flatMap((q) => q.ids))).toEqual(new Set(ids));
    expect(vi.mocked(getDoc)).not.toHaveBeenCalled();
    expect(inputs.events).toHaveLength(35);
  });

  test('同一個活動被多筆報名指向只查一次', async () => {
    const probe = installFirestore([
      { ...regDoc('r1', 'dup'), path: 'events/dup/registrations/r1' },
      { ...regDoc('r2', 'dup'), path: 'events/dup/registrations/r2' },
    ]);

    await loadNextActivityInputs(deps(vi.fn()), UID);

    expect(probe.inQueries.find((q) => q.field === 'documentId')?.ids).toEqual(['dup']);
  });

  test('報名記的是 public id、文件 id 不同：由 id 欄位的 in 查詢補回（R-ID-010）', async () => {
    mockedGetDocs.mockImplementation(((q: unknown) => {
      const { base, constraints } = q as { base: { kind?: string }; constraints: FakeConstraint[] };
      if (base?.kind === 'collectionGroup') {
        return Promise.resolve(makeSnap([regDoc('r1', 'pub-1')])) as never;
      }
      const inWhere = constraints.find((c) => c.op === 'in');
      if (inWhere && typeof inWhere.field === 'string') {
        return Promise.resolve(makeSnap([
          makeEventSnap('doc-xyz', { id: 'pub-1', title: 'Public Id Match', date: '2099/01/02 09:00~11:00', status: 'open' }),
        ])) as never;
      }
      return Promise.resolve(makeSnap([])) as never;
    }) as never);

    const result = await resolveNextActivity({ ...deps(vi.fn()), now: () => NOW }, UID);

    expect(result?.event.id).toBe('pub-1');
    expect(result?.event._docId).toBe('doc-xyz');
  });

  test('補抓的某一批失敗：記警告、其他批次與報名照常（不丟錯）', async () => {
    const warn = vi.fn();
    mockedGetDocs.mockImplementation(((q: unknown) => {
      const { base, constraints } = q as { base: { kind?: string }; constraints: FakeConstraint[] };
      if (base?.kind === 'collectionGroup') {
        return Promise.resolve(makeSnap([regDoc('r1', 'evt-a')])) as never;
      }
      const inWhere = constraints.find((c) => c.op === 'in');
      if (inWhere && typeof inWhere.field === 'string') return Promise.reject(new Error('index missing')) as never;
      if (inWhere) {
        return Promise.resolve(makeSnap([
          makeEventSnap('evt-a', { id: 'evt-a', title: 'A', date: '2099/01/02 09:00~11:00', status: 'open' }),
        ])) as never;
      }
      return Promise.resolve(makeSnap([])) as never;
    }) as never);

    const inputs = await loadNextActivityInputs(deps(warn), UID);

    expect(inputs.events.map((e) => e.id)).toEqual(['evt-a']);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('event fetch skipped'))).toBe(true);
  });

  // ── 退修 1（P3-3）：補抓的邊界 ──

  /** 照真的 SDK：documentId() 條件的值含 '/' 時，建查詢（where）就會同步丟錯。 */
  function makeWhereRejectInvalidDocIds(): () => void {
    const original = vi.mocked(where).getMockImplementation();
    vi.mocked(where).mockImplementation(((field: unknown, op: string, value: unknown) => {
      const isDocumentId = typeof field !== 'string';
      if (isDocumentId && Array.isArray(value) && value.some((v) => String(v).includes('/'))) {
        throw new Error("Invalid query. When querying with documentId(), you must provide a valid document ID, but it contains a '/'.");
      }
      return { kind: 'where', field, op, value };
    }) as never);
    return () => {
      if (original) vi.mocked(where).mockImplementation(original);
    };
  }

  function eventsByQuery(
    registrations: FakeReg[],
    answer: (field: 'documentId' | 'id', ids: string[]) => unknown[],
  ): { inQueries: Array<{ field: 'documentId' | 'id'; ids: string[] }> } {
    const probe = { inQueries: [] as Array<{ field: 'documentId' | 'id'; ids: string[] }> };
    mockedGetDocs.mockImplementation(((q: unknown) => {
      const { base, constraints } = q as { base: { kind?: string }; constraints: FakeConstraint[] };
      if (base?.kind === 'collectionGroup') return Promise.resolve(makeSnap(registrations)) as never;
      const inWhere = constraints.find((c) => c.kind === 'where' && c.op === 'in');
      if (!inWhere) return Promise.resolve(makeSnap([])) as never;
      const field = typeof inWhere.field === 'string' ? 'id' : 'documentId';
      const ids = inWhere.value as string[];
      probe.inQueries.push({ field, ids });
      return Promise.resolve(makeSnap(answer(field, ids))) as never;
    }) as never);
    return probe;
  }

  test('isValidFirestoreDocId：含 /、. ／ ..、__x__、空字串、超過 1500 bytes 都不是合法文件 id', () => {
    expect(isValidFirestoreDocId('ce_20261026_ab12')).toBe(true);
    expect(isValidFirestoreDocId('活動-1')).toBe(true);
    for (const bad of ['', '.', '..', 'a/b', '/x', '__name__', '__x__', 'a'.repeat(1501)]) {
      expect(isValidFirestoreDocId(bad), bad.slice(0, 20)).toBe(false);
    }
  });

  test('eventId 含 / ：不放進 documentId() 那條（否則建查詢就同步丟錯），仍走 id 欄位那條，其他 id 照常補抓，整張卡不失敗', async () => {
    const restore = makeWhereRejectInvalidDocIds();
    try {
      const warn = vi.fn();
      const probe = eventsByQuery(
        [regDoc('r1', 'a/b'), regDoc('r2', 'ok1')],
        (field, ids) => (field === 'documentId'
          ? ids.filter((id) => id === 'ok1').map((id) => makeEventSnap(id, { id, title: 'OK', date: '2099/01/02 09:00~11:00', status: 'open' }))
          : []),
      );

      const inputs = await loadNextActivityInputs(deps(warn), UID);

      expect(probe.inQueries.find((q) => q.field === 'documentId')?.ids).toEqual(['ok1']);
      expect(probe.inQueries.find((q) => q.field === 'id')?.ids).toEqual(['a/b', 'ok1']);
      expect(inputs.events.map((e) => e.id)).toEqual(['ok1']);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test('某條補抓在建查詢時同步丟錯：只記警告、整張卡不失敗；該批 id 不採 id 欄位備援（缺席比錯卡好）', async () => {
    const original = vi.mocked(where).getMockImplementation();
    vi.mocked(where).mockImplementation(((field: unknown, op: string, value: unknown) => {
      if (typeof field !== 'string') throw new Error('invalid documentId query');
      return { kind: 'where', field, op, value };
    }) as never);
    try {
      const warn = vi.fn();
      eventsByQuery(
        [regDoc('r1', 'pub-1')],
        (field) => (field === 'id'
          ? [makeEventSnap('doc-1', { id: 'pub-1', title: 'By id field', date: '2099/01/02 09:00~11:00', status: 'open' })]
          : []),
      );

      const inputs = await loadNextActivityInputs(deps(warn), UID);

      // 直接文件 id 那條失敗 → 不知道 events/pub-1 在不在 → 不採 id 欄位備援找到的 doc-1
      expect(inputs.events).toEqual([]);
      expect(warn.mock.calls.some(([msg, label]) => String(msg).includes('event fetch skipped') && label === 'documentId')).toBe(true);
    } finally {
      if (original) vi.mocked(where).mockImplementation(original);
    }
  });

  test.each([
    { name: '兩份的 id 欄位都等於 public id', docIdFieldOfA: 'X' },
    { name: '文件 id 那份的 id 欄位是別的值', docIdFieldOfA: 'a-other' },
  ])('R-ID-010：同一個 public id 對應兩份文件時，events/{eventId} 那份優先，id 欄位那份丟掉（$name）', async ({ docIdFieldOfA }) => {
    const docA = makeEventSnap('X', { id: docIdFieldOfA, title: 'A（文件 id = X）', date: '2099/01/02 09:00~11:00', status: 'open' });
    const docB = makeEventSnap('Y', { id: 'X', title: 'B（id 欄位 = X）', date: '2099/01/03 09:00~11:00', status: 'open' });
    eventsByQuery(
      [regDoc('r1', 'X')],
      (field) => (field === 'documentId' ? [docA] : [docB, ...(docIdFieldOfA === 'X' ? [docA] : [])]),
    );

    const inputs = await loadNextActivityInputs(deps(vi.fn()), UID);
    expect(inputs.events.map((e) => e._docId)).toEqual(['X']);

    const result = await resolveNextActivity({ ...deps(vi.fn()), now: () => NOW }, UID);
    expect(result?.event._docId).toBe('X');
    expect(result?.event.title).toBe('A（文件 id = X）');
  });

  test('文件 id 那份不存在時，id 欄位那份照常採用', async () => {
    eventsByQuery(
      [regDoc('r1', 'X')],
      (field) => (field === 'id'
        ? [makeEventSnap('Y', { id: 'X', title: 'B', date: '2099/01/03 09:00~11:00', status: 'open' })]
        : []),
    );
    const inputs = await loadNextActivityInputs(deps(vi.fn()), UID);
    expect(inputs.events.map((e) => e._docId)).toEqual(['Y']);
  });


  // ── 退修 4（P2，R-ID-010）：直接文件 id 查詢失敗 ≠ 文件不存在 ──
  test('直接文件 id 的查詢（非同步）失敗：同一批的 id 都不採 id 欄位備援找到的文件（缺席比錯卡好）', async () => {
    const warn = vi.fn();
    mockedGetDocs.mockImplementation(((q: unknown) => {
      const { base, constraints } = q as { base: { kind?: string }; constraints: FakeConstraint[] };
      if (base?.kind === 'collectionGroup') {
        return Promise.resolve(makeSnap([regDoc('r1', 'X'), regDoc('r2', 'Z')])) as never;
      }
      const inWhere = constraints.find((c) => c.kind === 'where' && c.op === 'in');
      if (!inWhere) return Promise.resolve(makeSnap([])) as never;
      if (typeof inWhere.field !== 'string') return Promise.reject(new Error('network')) as never; // documentId 那條整批失敗
      // id 欄位那條：X 對應到另一份文件 Y；Z 對應到 Z2
      return Promise.resolve(makeSnap([
        makeEventSnap('Y', { id: 'X', title: '錯的卡（events/X 其實存在）', date: '2099/01/02 09:00~11:00', status: 'open' }),
        makeEventSnap('Z2', { id: 'Z', title: 'Z', date: '2099/01/03 09:00~11:00', status: 'open' }),
      ])) as never;
    }) as never);

    const inputs = await loadNextActivityInputs(deps(warn), UID);

    // documentId 那批（X、Z 同一批）失敗 → 兩個 id 都不確定 → 都不採備援（缺席比錯卡好）
    expect(inputs.events).toEqual([]);
    expect(warn.mock.calls.some(([msg, label]) => String(msg).includes('event fetch skipped') && label === 'documentId')).toBe(true);
  });

  // ── 退修 5（P2 測試）：跨批次——失敗批次不採備援，成功批次的結果與備援照常保留；原錯誤物件傳進 logger ──
  test('跨批次（61 個缺的 id → documentId 30／30／1 三批）：第一批失敗只讓該批不採備援；其他批次的結果與備援照常；原錯誤物件傳進 logger', async () => {
    const ids = Array.from({ length: EVENT_IN_QUERY_CHUNK * 2 + 1 }, (_, i) => `x_${pad(i)}`);
    const boom = new Error('network (documentId batch 1)');
    const documentIdBatches: string[][] = [];
    const doc = (docId: string, publicId: string) =>
      makeEventSnap(docId, { id: publicId, title: `doc ${docId}`, date: '2099/01/02 09:00~11:00', status: 'open' });
    mockedGetDocs.mockImplementation(((q: unknown) => {
      const { base, constraints } = q as { base: { kind?: string }; constraints: FakeConstraint[] };
      if (base?.kind === 'collectionGroup') {
        return Promise.resolve(makeSnap(ids.map((id, i) => regDoc(`r${i}`, id)))) as never;
      }
      const inWhere = constraints.find((c) => c.kind === 'where' && c.op === 'in');
      if (!inWhere) return Promise.resolve(makeSnap([])) as never;
      const batchIds = inWhere.value as string[];
      if (typeof inWhere.field !== 'string') {
        const index = documentIdBatches.push(batchIds) - 1;
        if (index === 0) return Promise.reject(boom) as never; // 第一批整批失敗
        // 第二批：只有批內第一個 id 的 events/{id} 存在（其餘「確認不存在」）；第三批（1 個 id）存在
        const present = index === 1 ? batchIds.slice(0, 1) : batchIds;
        return Promise.resolve(makeSnap(present.map((id) => doc(id, id)))) as never;
      }
      // id 欄位那條：每個 id 都有一份別名文件 alias_<id>（文件 id 不同、id 欄位 = 該 id）
      return Promise.resolve(makeSnap(batchIds.map((id) => doc(`alias_${id}`, id)))) as never;
    }) as never);
    const warn = vi.fn();

    const inputs = await loadNextActivityInputs(deps(warn), UID);

    expect(documentIdBatches.map((batch) => batch.length)).toEqual([EVENT_IN_QUERY_CHUNK, EVENT_IN_QUERY_CHUNK, 1]);
    const [failedIds = [], okIds = [], lastIds = []] = documentIdBatches;
    const [okFirst = '', ...okRest] = okIds;
    const [lastId = ''] = lastIds;
    const docIds = new Set(inputs.events.map((event) => event._docId));

    // 失敗那批：自己的文件補不到，id 欄位備援也不採
    for (const id of failedIds) {
      expect(docIds.has(id), id).toBe(false);
      expect(docIds.has(`alias_${id}`), `alias_${id}`).toBe(false);
    }
    // 成功批次：events/{id} 存在的用它（別名丟掉）；確認不存在的才採 id 欄位備援
    expect(docIds.has(okFirst)).toBe(true);
    expect(docIds.has(`alias_${okFirst}`)).toBe(false);
    for (const id of okRest) expect(docIds.has(`alias_${id}`), `alias_${id}`).toBe(true);
    expect(docIds.has(lastId)).toBe(true);
    expect(docIds.has(`alias_${lastId}`)).toBe(false);
    expect(inputs.events).toHaveLength(1 + okRest.length + 1);

    // 只記一則警告（id 欄位那條都成功），且原錯誤物件原封不動傳進 logger
    expect(warn).toHaveBeenCalledTimes(1);
    const call = warn.mock.calls[0] ?? [];
    expect(call[0]).toBe('[NextActivity] event fetch skipped:');
    expect(call[1]).toBe('documentId');
    expect(call[2]).toEqual(failedIds);
    expect(call[3]).toBe(boom);
  });

  test('直接文件 id 查詢成功但沒找到：才採 id 欄位備援（確認 events/X 不存在）', async () => {
    mockedGetDocs.mockImplementation(((q: unknown) => {
      const { base, constraints } = q as { base: { kind?: string }; constraints: FakeConstraint[] };
      if (base?.kind === 'collectionGroup') return Promise.resolve(makeSnap([regDoc('r1', 'X')])) as never;
      const inWhere = constraints.find((c) => c.kind === 'where' && c.op === 'in');
      if (inWhere && typeof inWhere.field === 'string') {
        return Promise.resolve(makeSnap([
          makeEventSnap('Y', { id: 'X', title: 'B', date: '2099/01/03 09:00~11:00', status: 'open' }),
        ])) as never;
      }
      return Promise.resolve(makeSnap([])) as never; // documentId 那條成功但空
    }) as never);

    const inputs = await loadNextActivityInputs(deps(vi.fn()), UID);
    expect(inputs.events.map((e) => e._docId)).toEqual(['Y']);
  });

  test('不可能是文件 id 的 public id（含 /）：只能走 id 欄位，找到就採用（本來就不會有 events/{含 / 的 id}）', async () => {
    const restore = makeWhereRejectInvalidDocIds();
    try {
      const probe = eventsByQuery(
        [regDoc('r1', 'a/b')],
        (field) => (field === 'id'
          ? [makeEventSnap('Q', { id: 'a/b', title: 'slash id', date: '2099/01/02 09:00~11:00', status: 'open' })]
          : []),
      );

      const inputs = await loadNextActivityInputs(deps(vi.fn()), UID);

      expect(probe.inQueries.find((q) => q.field === 'documentId')).toBeUndefined(); // 沒有可查的合法文件 id
      expect(inputs.events.map((e) => e._docId)).toEqual(['Q']);
    } finally {
      restore();
    }
  });

  // ── 已知未修（既有邏輯，T-041 沒改；Codex 觀察項）：只登記為待辦，不斷言目前行為 ──
  test.todo('已知未修：managed 活動的 public id 恰好等於報名的 eventId 時，haveIds 會把該 eventId 視為已涵蓋，應優先的 events/{eventId} 直接文件不會被查（R-ID-010）');
  test.todo('已知未修：mergeEventsByIdentity 以 public id 合併，managed 活動與補抓活動（或兩份直接文件）共用同一個 public id 時，後者的欄位覆蓋前者、只剩一份');
});
