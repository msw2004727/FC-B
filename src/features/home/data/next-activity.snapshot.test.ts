/**
 * SPEED-2-12：下一場沿用已載入活動，以及依 uid 分隔的本機快照。
 * 換帳號、登出、過期、取消／結束、黑名單。
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { emit } from '@/core/events';
import {
  _clearEventsSnapshotForTest,
  writeEventsSnapshot,
} from '@/features/events/data/events-snapshot-cache';
import type { EventDoc } from '@/features/events/data/types';

const h = vi.hoisted(() => ({
  authUid: undefined as string | null | undefined,
  active: [] as EventDoc[],
  terminal: [] as EventDoc[],
}));

vi.mock('@/data/auth', () => ({
  getLastKnownAuthUid: () => h.authUid,
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: { kind: 'fake-db' } })),
}));

vi.mock('@/features/events/data/events-repo', () => ({
  getEventsRepo: () => ({
    getSnapshot: () => ({ active: h.active, terminal: h.terminal, activeFromCache: false }),
  }),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ kind: 'collection', path })),
  collectionGroup: vi.fn((_db: unknown, id: string) => ({ kind: 'collectionGroup', id })),
  query: vi.fn((base: unknown, ...constraints: unknown[]) => ({ kind: 'query', base, constraints })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value })),
  limit: vi.fn((n: number) => ({ kind: 'limit', n })),
  documentId: vi.fn(() => ({ kind: 'documentId' })),
  orderBy: vi.fn((field: unknown, direction: 'asc' | 'desc' = 'asc') => ({ kind: 'orderBy', field, dir: direction })),
  getDocs: vi.fn(),
  getDoc: vi.fn(),
}));

import { getDocs } from 'firebase/firestore';
import {
  NEXT_ACTIVITY_SNAPSHOT_MAX_AGE_MS,
  _resetNextActivityCacheForTest,
  loadNextActivityInputs,
  nextActivitySnapshotKey,
  readNextActivitySnapshot,
  resolveNextActivity,
} from './next-activity';

const UID_A = 'uid-a';
const UID_B = 'uid-b';
const NOW = Date.parse('2099-01-01T00:00:00+08:00');
const FUTURE = '2099/05/20 18:00~20:00';
const mockedGetDocs = vi.mocked(getDocs);

interface FakeConstraint {
  kind: string;
  field?: unknown;
  op?: string;
  value?: unknown;
}

function setAuth(uid: string | null): void {
  h.authUid = uid;
  emit('auth:changed', { uid });
}

function eventDoc(overrides: EventDoc = {}): EventDoc {
  return {
    id: 'evt-next',
    _docId: 'evt-next',
    title: '下一場',
    date: FUTURE,
    status: 'open',
    location: '台中',
    ...overrides,
  };
}

function makeReg(eventId: string, status = 'confirmed') {
  return {
    id: 'r1',
    data: () => ({ userId: UID_A, eventId, status }),
    ref: { parent: { parent: { id: 'events/whatever' } } },
  };
}

function makeEventSnap(event: EventDoc) {
  return {
    id: String(event._docId ?? event.id),
    data: () => ({ ...event }),
    exists: () => true,
  };
}

function queryOf(q: unknown): { base?: { kind?: string }; constraints: FakeConstraint[] } {
  return q as { base?: { kind?: string }; constraints: FakeConstraint[] };
}

function isInQuery(q: unknown): boolean {
  return queryOf(q).constraints.some((c) => c.kind === 'where' && c.op === 'in' && (
    typeof c.field !== 'string' || c.field === 'id'
  ));
}

/** 報名回傳一筆；管理查詢回空；文件 id 的 in 查詢回 event；其餘回空。 */
function installServer(event: EventDoc | null, eventId = 'evt-next'): void {
  mockedGetDocs.mockImplementation(((q: unknown) => {
    const query = queryOf(q);
    if (query.base?.kind === 'collectionGroup') {
      return Promise.resolve({ docs: event ? [makeReg(eventId)] : [] }) as never;
    }
    const docIdIn = query.constraints.find((c) => c.kind === 'where' && c.op === 'in' && typeof c.field !== 'string');
    if (docIdIn && event) return Promise.resolve({ docs: [makeEventSnap(event)] }) as never;
    return Promise.resolve({ docs: [] }) as never;
  }) as never);
}

/** 三條管理查詢都回傳這場（沒有報名）。 */
function installManaged(event: EventDoc): void {
  mockedGetDocs.mockImplementation(((q: unknown) => {
    const query = queryOf(q);
    if (query.base?.kind === 'collectionGroup') return Promise.resolve({ docs: [] }) as never;
    if (isInQuery(q)) return Promise.resolve({ docs: [] }) as never;
    return Promise.resolve({ docs: [makeEventSnap(event)] }) as never;
  }) as never);
}

const deps = {
  getFirebase: async () => ({ db: {} as never }),
  logger: { warn: () => {} },
  now: () => NOW,
};

function seed(uid: string, event: EventDoc, savedAt = NOW, registration: Record<string, unknown> | null = null, managedRole = ''): void {
  localStorage.setItem(nextActivitySnapshotKey(uid), JSON.stringify({
    v: 1,
    uid,
    savedAt,
    event,
    registration,
    managedRole,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.authUid = undefined;
  h.active = [];
  h.terminal = [];
  _resetNextActivityCacheForTest();
  _clearEventsSnapshotForTest();
});

describe('本機快照：帳號、登出、過期', () => {
  test('登入者成功查完才寫入；同步讀得到', async () => {
    setAuth(UID_A);
    installServer(eventDoc());
    const result = await resolveNextActivity(deps, UID_A);
    expect(result?.event.id).toBe('evt-next');
    expect(readNextActivitySnapshot(UID_A, NOW)?.event.title).toBe('下一場');
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toContain('evt-next');
  });

  test('帳號還沒確認時不讀快照，鑰匙留著', () => {
    h.authUid = undefined;
    seed(UID_A, eventDoc());
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeTruthy();
  });

  test('換成 A 時刪掉 B 的鑰匙，只留 A', () => {
    seed(UID_A, eventDoc({ title: 'A 的場' }));
    seed(UID_B, eventDoc({ id: 'evt-b', _docId: 'evt-b', title: 'B 的場' }));
    setAuth(UID_A);
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_B))).toBeNull();
    expect(readNextActivitySnapshot(UID_A, NOW)?.event.title).toBe('A 的場');
    expect(readNextActivitySnapshot(UID_B, NOW)).toBeNull();
  });

  test('換成 B 時刪掉 A 的鑰匙，只留 B', () => {
    seed(UID_A, eventDoc({ title: 'A 的場' }));
    seed(UID_B, eventDoc({ id: 'evt-b', _docId: 'evt-b', title: 'B 的場' }));
    setAuth(UID_B);
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
    expect(readNextActivitySnapshot(UID_B, NOW)?.event.title).toBe('B 的場');
  });

  test('登出刪掉全部下一場快照', () => {
    seed(UID_A, eventDoc());
    seed(UID_B, eventDoc({ id: 'evt-b', _docId: 'evt-b' }));
    setAuth(null);
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_B))).toBeNull();
    h.authUid = UID_A;
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
  });

  test('期限剛好仍顯示', () => {
    setAuth(UID_A);
    seed(UID_A, eventDoc(), NOW - NEXT_ACTIVITY_SNAPSHOT_MAX_AGE_MS);
    expect(readNextActivitySnapshot(UID_A, NOW)?.event.id).toBe('evt-next');
  });

  test('超過期限不顯示並刪掉', () => {
    setAuth(UID_A);
    seed(UID_A, eventDoc(), NOW - NEXT_ACTIVITY_SNAPSHOT_MAX_AGE_MS - 1);
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
  });

  test('時鐘超前超過 60 秒不顯示並刪掉', () => {
    setAuth(UID_A);
    seed(UID_A, eventDoc(), NOW + 60_001);
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
  });

  test('版本不符不顯示並刪掉', () => {
    setAuth(UID_A);
    localStorage.setItem(nextActivitySnapshotKey(UID_A), JSON.stringify({
      v: 99,
      uid: UID_A,
      savedAt: NOW,
      event: eventDoc(),
      registration: null,
      managedRole: '',
    }));
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
  });

  test('快照裡的 uid 與登入者不符：不顯示並刪掉', () => {
    setAuth(UID_A);
    localStorage.setItem(nextActivitySnapshotKey(UID_A), JSON.stringify({
      v: 1,
      uid: UID_B,
      savedAt: NOW,
      event: eventDoc(),
      registration: null,
      managedRole: '',
    }));
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
  });

  test('進行中的查詢在登出後不回寫快照', async () => {
    setAuth(UID_A);
    const pending: Array<() => void> = [];
    mockedGetDocs.mockImplementation(((q: unknown) => new Promise((resolve) => {
      pending.push(() => {
        const query = queryOf(q);
        if (query.base?.kind === 'collectionGroup') {
          resolve({ docs: [makeReg('evt-next')] });
          return;
        }
        const docIdIn = query.constraints.find((c) => c.op === 'in' && typeof c.field !== 'string');
        resolve({ docs: docIdIn ? [makeEventSnap(eventDoc())] : [] });
      });
    })) as never);

    const done = resolveNextActivity(deps, UID_A);
    await vi.waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(4));
    setAuth(null);
    // 補抓的 in 查詢在第一輪 Promise.all 之後才發出，要接著放行，否則這筆會掛到逾時。
    let settled = false;
    void done.finally(() => {
      settled = true;
    });
    for (let i = 0; i < 20 && !settled; i += 1) {
      if (pending.length > 0) pending.splice(0).forEach((release) => release());
      await Promise.resolve();
    }
    await done;
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
  });
});

describe('不可顯示：取消、結束、已開始、黑名單', () => {
  test.each(['cancelled', 'canceled', 'ended', 'archived', 'removed'])(
    '狀態 %s 不顯示',
    (status) => {
      setAuth(UID_A);
      seed(UID_A, eventDoc({ status }), NOW, null, 'owner');
      expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
    },
  );

  test('已開始的活動不顯示', () => {
    setAuth(UID_A);
    seed(UID_A, eventDoc({ date: '2000/05/20 18:00~20:00', status: 'open' }), NOW, null, 'owner');
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
  });

  test('黑名單含本人且沒有這場報名：不顯示', () => {
    setAuth(UID_A);
    seed(UID_A, eventDoc({ blockedUids: [UID_A] }), NOW, null, 'owner');
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
  });

  test('黑名單含本人但報名對到這場：仍可見（與 isEventVisibleToUser 相同）', () => {
    setAuth(UID_A);
    seed(
      UID_A,
      eventDoc({ blockedUids: [UID_A, 'other'] }),
      NOW,
      { eventId: 'evt-next', userId: UID_A, status: 'confirmed' },
    );
    expect(readNextActivitySnapshot(UID_A, NOW)?.event.id).toBe('evt-next');
  });

  test('伺服器選到黑名單主辦場時不寫快照，函式仍回傳該場給畫面過濾', async () => {
    setAuth(UID_A);
    seed(UID_A, eventDoc({ title: '舊的' }));
    installManaged(eventDoc({ blockedUids: [UID_A], creatorUid: UID_A }));
    const result = await resolveNextActivity(deps, UID_A);
    expect(result?.event.id).toBe('evt-next');
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
  });

  test('查詢失敗不清掉既有快照；查完確定沒有下一場才清', async () => {
    setAuth(UID_A);
    seed(UID_A, eventDoc({ title: '還在' }));
    mockedGetDocs.mockRejectedValue(new Error('network'));
    await resolveNextActivity(deps, UID_A);
    expect(readNextActivitySnapshot(UID_A, NOW)?.event.title).toBe('還在');

    mockedGetDocs.mockResolvedValue({ docs: [] } as never);
    await resolveNextActivity(deps, UID_A);
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
  });
});

describe('沿用已載入活動', () => {
  test('沒有沿用時：報名＋3 管理＋2 次 in，共 6 次 getDocs', async () => {
    setAuth(UID_A);
    installServer(eventDoc());
    const inputs = await loadNextActivityInputs(deps, UID_A);
    expect(inputs.events.map((event) => event.id)).toEqual(['evt-next']);
    expect(mockedGetDocs).toHaveBeenCalledTimes(6);
    expect(mockedGetDocs.mock.calls.filter(([q]) => isInQuery(q))).toHaveLength(2);
  });

  test('列表快照已有這場：不再補抓（4 次 getDocs）', async () => {
    setAuth(UID_A);
    writeEventsSnapshot(UID_A, [eventDoc()], NOW);
    installServer(eventDoc());
    const inputs = await loadNextActivityInputs(deps, UID_A);
    expect(inputs.events.map((event) => event.id)).toEqual(['evt-next']);
    expect(mockedGetDocs).toHaveBeenCalledTimes(4);
    expect(mockedGetDocs.mock.calls.filter(([q]) => isInQuery(q))).toHaveLength(0);
  });

  test('repo 記憶體已有這場：不再補抓', async () => {
    setAuth(UID_A);
    h.active = [eventDoc()];
    installServer(eventDoc());
    const inputs = await loadNextActivityInputs(deps, UID_A);
    expect(inputs.events.map((event) => event.id)).toEqual(['evt-next']);
    expect(mockedGetDocs.mock.calls.filter(([q]) => isInQuery(q))).toHaveLength(0);
  });

  test('副本已取消：不沿用，仍補抓', async () => {
    setAuth(UID_A);
    h.active = [eventDoc({ status: 'cancelled' })];
    installServer(eventDoc({ status: 'open', title: '伺服器這份' }));
    const inputs = await loadNextActivityInputs(deps, UID_A);
    expect(inputs.events.map((event) => event.title)).toEqual(['伺服器這份']);
    expect(mockedGetDocs.mock.calls.filter(([q]) => isInQuery(q))).toHaveLength(2);
  });

  test('不拿訪客快照，也不拿另一個 uid 的列表快照', async () => {
    setAuth(UID_A);
    writeEventsSnapshot(null, [eventDoc({ title: '訪客' })], NOW);
    writeEventsSnapshot(UID_B, [eventDoc({ title: '別人' })], NOW);
    installServer(eventDoc({ title: '自己的查詢' }));
    const inputs = await loadNextActivityInputs(deps, UID_A);
    expect(inputs.events.map((event) => event.title)).toEqual(['自己的查詢']);
    expect(mockedGetDocs.mock.calls.filter(([q]) => isInQuery(q))).toHaveLength(2);
  });
});
