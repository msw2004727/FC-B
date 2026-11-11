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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocs } from 'firebase/firestore';
import type { ViewerContext } from '@/features/events/data/types';
import {
  NEXT_ACTIVITY_SNAPSHOT_FORMAT,
  NEXT_ACTIVITY_SNAPSHOT_MAX_AGE_MS,
  adopt,
  nextActivitySnapshotKey,
} from './next-activity-snapshot';
import {
  _resetNextActivityCacheForTest,
  loadNextActivityInputs,
  readNextActivitySnapshot,
  resolveNextActivity,
  whenNextActivitySnapshotReady,
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

function seed(
  uid: string,
  event: EventDoc,
  savedAt = NOW,
  registration: Record<string, unknown> | null = null,
  managedRole = '',
): void {
  const owners = [event.creatorUid, event.ownerUid, event.captainUid].map((value) => String(value ?? '').trim());
  const delegates = Array.isArray(event.delegateUids)
    ? event.delegateUids.map((value) => String(value ?? '').trim())
    : [];
  const reg = registration && typeof registration === 'object' ? registration : null;
  localStorage.setItem(nextActivitySnapshotKey(uid), JSON.stringify({
    v: NEXT_ACTIVITY_SNAPSHOT_FORMAT,
    uid,
    savedAt,
    event: {
      id: event.id,
      _docId: event._docId,
      docId: event.docId,
      title: event.title,
      date: event.date,
      status: event.status,
      location: event.location,
      image: event.image,
      startAt: event.startAt,
      startTime: event.startTime,
      imageVariants: event.imageVariants,
      teamOnly: event.teamOnly === true ? true : undefined,
      isPublic: event.isPublic === true ? true : undefined,
      privateEvent: event.privateEvent === true ? true : undefined,
      creatorTeamId: event.creatorTeamId,
      creatorTeamIds: event.creatorTeamIds,
      viewerBlocked: Array.isArray(event.blockedUids) && event.blockedUids.includes(uid) ? true : undefined,
      viewerIsOwner: owners.includes(uid) || managedRole === 'owner' ? true : undefined,
      viewerIsDelegate: delegates.includes(uid) || managedRole === 'delegate' ? true : undefined,
    },
    registration: reg && {
      eventId: reg.eventId,
      status: reg.status,
      participantType: reg.participantType,
      managedRole: reg.managedRole ?? (managedRole || undefined),
    },
    managedRole,
  }));
}

function viewerOf(uid: string, teamIds: string[] = [], roleLevel = 0): ViewerContext {
  return { uid, teamIds: new Set(teamIds), hasPermission: () => false, roleLevel };
}

beforeEach(async () => {
  vi.clearAllMocks();
  h.authUid = undefined;
  h.active = [];
  h.terminal = [];
  _clearEventsSnapshotForTest();
  await whenNextActivitySnapshotReady();
  _resetNextActivityCacheForTest();
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
    adopt();
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeTruthy();
  });

  test('第一次讀的當下 uid 是 A：刪掉 B 的鑰匙，只留 A', () => {
    seed(UID_A, eventDoc({ title: 'A 的場' }));
    seed(UID_B, eventDoc({ id: 'evt-b', _docId: 'evt-b', title: 'B 的場' }));
    setAuth(UID_A);
    expect(readNextActivitySnapshot(UID_A, NOW)?.event.title).toBe('A 的場');
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_B))).toBeNull();
    expect(readNextActivitySnapshot(UID_B, NOW)).toBeNull();
  });

  test('第一次讀的當下 uid 是 B：刪掉 A 的鑰匙，只留 B', () => {
    seed(UID_A, eventDoc({ title: 'A 的場' }));
    seed(UID_B, eventDoc({ id: 'evt-b', _docId: 'evt-b', title: 'B 的場' }));
    setAuth(UID_B);
    expect(readNextActivitySnapshot(UID_B, NOW)?.event.title).toBe('B 的場');
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
  });

  test('已經訂閱之後登出，立刻刪掉全部下一場快照', () => {
    h.authUid = UID_A;
    readNextActivitySnapshot(UID_A, NOW);
    seed(UID_A, eventDoc());
    seed(UID_B, eventDoc({ id: 'evt-b', _docId: 'evt-b' }));
    setAuth(null);
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_B))).toBeNull();
    h.authUid = UID_A;
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
  });

  test('整頁重載後 uid 已是 null：不發 auth:changed 也清掉殘留', () => {
    seed(UID_A, eventDoc());
    seed(UID_B, eventDoc({ id: 'evt-b', _docId: 'evt-b' }));
    h.authUid = null;
    adopt();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_B))).toBeNull();
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
      v: NEXT_ACTIVITY_SNAPSHOT_FORMAT,
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

  test('沿用的 open 不壓過伺服器的 full，舊欄位也不留', async () => {
    setAuth(UID_A);
    writeEventsSnapshot(UID_A, [eventDoc({
      status: 'open',
      title: '舊狀態',
      location: '舊地點',
      image: 'old.png',
      creatorUid: UID_A,
    })], NOW);
    mockedGetDocs.mockImplementation(((q: unknown) => {
      const query = queryOf(q);
      if (query.base?.kind === 'collectionGroup') {
        return Promise.resolve({ docs: [makeReg('evt-next')] }) as never;
      }
      if (isInQuery(q)) return Promise.resolve({ docs: [] }) as never;
      return Promise.resolve({
        docs: [makeEventSnap(eventDoc({
          status: 'full',
          title: '伺服器',
          location: '新地點',
          creatorUid: UID_A,
        }))],
      }) as never;
    }) as never);
    const result = await resolveNextActivity(deps, UID_A);
    expect(result?.event.status).toBe('full');
    expect(result?.event.title).toBe('伺服器');
    expect(result?.event.location).toBe('新地點');
    expect(result?.event.image).toBeUndefined();
    expect(mockedGetDocs.mock.calls.filter(([q]) => isInQuery(q))).toHaveLength(0);
    expect(readNextActivitySnapshot(UID_A, NOW)?.event.status).toBe('full');
  });

  test('有沿用、伺服器這場已取消：結果是空，舊快照也清掉', async () => {
    setAuth(UID_A);
    seed(UID_A, eventDoc({ title: '舊快照' }));
    writeEventsSnapshot(UID_A, [eventDoc({ status: 'open', title: '沿用', creatorUid: UID_A })], NOW);
    mockedGetDocs.mockImplementation(((q: unknown) => {
      const query = queryOf(q);
      if (query.base?.kind === 'collectionGroup') {
        return Promise.resolve({ docs: [makeReg('evt-next')] }) as never;
      }
      if (isInQuery(q)) return Promise.resolve({ docs: [] }) as never;
      return Promise.resolve({
        docs: [makeEventSnap(eventDoc({ status: 'cancelled', title: '伺服器已取消', creatorUid: UID_A }))],
      }) as never;
    }) as never);
    const result = await resolveNextActivity(deps, UID_A);
    expect(result).toBeNull();
    expect(mockedGetDocs.mock.calls.filter(([q]) => isInQuery(q))).toHaveLength(0);
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
  });
});

describe('管理查詢失敗不寫快照', () => {
  test('creator 查詢失敗時，即使補抓到下一場也不覆寫舊快照', async () => {
    setAuth(UID_A);
    seed(UID_A, eventDoc({ title: '還在' }));
    mockedGetDocs.mockImplementation(((q: unknown) => {
      const query = queryOf(q);
      if (query.base?.kind === 'collectionGroup') {
        return Promise.resolve({ docs: [makeReg('evt-next')] }) as never;
      }
      const creator = query.constraints.some((c) => c.kind === 'where' && c.field === 'creatorUid');
      if (creator) return Promise.reject(new Error('creator down')) as never;
      if (isInQuery(q)) {
        return Promise.resolve({ docs: [makeEventSnap(eventDoc({ title: '新的' }))] }) as never;
      }
      return Promise.resolve({ docs: [] }) as never;
    }) as never);
    const result = await resolveNextActivity(deps, UID_A);
    expect(result?.event.title).toBe('新的');
    expect(readNextActivitySnapshot(UID_A, NOW)?.event.title).toBe('還在');
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).not.toContain('新的');
  });
});

describe('快照不落盤他人 UID', () => {
  test('黑名單、creator、delegate 的他人 UID 不進 localStorage', async () => {
    setAuth(UID_A);
    installServer(eventDoc({
      title: '可顯示',
      blockedUids: [UID_A, 'other-blocked-uid'],
      creatorUid: 'other-creator-uid',
      ownerUid: 'other-owner-uid',
      organizerUid: 'other-organizer-uid',
      delegateUids: ['other-delegate-uid'],
    }));
    const result = await resolveNextActivity(deps, UID_A);
    expect(result?.event.id).toBe('evt-next');
    const raw = localStorage.getItem(nextActivitySnapshotKey(UID_A)) ?? '';
    expect(raw).toContain('viewerBlocked');
    expect(raw).not.toContain('other-blocked-uid');
    expect(raw).not.toContain('other-creator-uid');
    expect(raw).not.toContain('other-owner-uid');
    expect(raw).not.toContain('other-organizer-uid');
    expect(raw).not.toContain('other-delegate-uid');
    expect(raw).not.toContain('blockedUids');
    expect(raw).not.toContain('delegateUids');
    expect(raw).not.toContain('creatorUid');
    const shown = readNextActivitySnapshot(UID_A, NOW);
    expect(shown?.event.id).toBe('evt-next');
    expect(JSON.stringify(shown?.event)).not.toContain('other-blocked-uid');
    expect(JSON.stringify(shown?.event)).not.toContain('other-delegate-uid');
  });
});

describe('隊伍限定與私密', () => {
  test('沒有 viewer 時，隊伍限定且非主辦、非公開：不進快照，查詢結果仍回傳', async () => {
    setAuth(UID_A);
    installServer(eventDoc({
      teamOnly: true,
      creatorTeamIds: ['team-1'],
      creatorUid: 'other-owner-uid',
    }));
    const result = await resolveNextActivity(deps, UID_A);
    expect(result?.event.id).toBe('evt-next');
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
  });

  test('沒有 viewer 時，本人是主辦的隊伍限定活動仍進快照', async () => {
    setAuth(UID_A);
    installServer(eventDoc({ teamOnly: true, creatorTeamIds: ['team-1'], creatorUid: UID_A }));
    const result = await resolveNextActivity(deps, UID_A);
    expect(result?.event.id).toBe('evt-next');
    expect(readNextActivitySnapshot(UID_A, NOW)?.event.id).toBe('evt-next');
  });

  test('沒有 viewer 時，teamOnly 且 isPublic 仍進快照', async () => {
    setAuth(UID_A);
    installServer(eventDoc({
      teamOnly: true,
      isPublic: true,
      creatorTeamIds: ['team-1'],
      creatorUid: 'other-owner-uid',
    }));
    await resolveNextActivity(deps, UID_A);
    expect(readNextActivitySnapshot(UID_A, NOW)?.event.id).toBe('evt-next');
  });

  test('帶了隊伍的 viewer：成員看得到，非成員看不到，省略 viewer 不刪快照', async () => {
    setAuth(UID_A);
    installServer(eventDoc({
      teamOnly: true,
      creatorTeamIds: ['team-1'],
      creatorUid: 'other-owner-uid',
    }));
    const member = viewerOf(UID_A, ['team-1']);
    const result = await resolveNextActivity({ ...deps, viewer: member }, UID_A);
    expect(result?.event.id).toBe('evt-next');
    expect(readNextActivitySnapshot(UID_A, NOW, member)?.event.id).toBe('evt-next');
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeTruthy();
    expect(readNextActivitySnapshot(UID_A, NOW, viewerOf(UID_A, ['other-team']))).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
  });

  test('帶了不含該隊的 viewer：隊伍限定活動不進快照', async () => {
    setAuth(UID_A);
    installServer(eventDoc({
      teamOnly: true,
      creatorTeamIds: ['team-1'],
      creatorUid: 'other-owner-uid',
    }));
    const result = await resolveNextActivity({ ...deps, viewer: viewerOf(UID_A, ['other-team']) }, UID_A);
    expect(result?.event.id).toBe('evt-next');
    expect(readNextActivitySnapshot(UID_A, NOW, viewerOf(UID_A, ['other-team']))).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
  });

  test('私密活動：委託人進快照；路人沒有 viewer 時不進', async () => {
    setAuth(UID_A);
    installServer(eventDoc({ privateEvent: true, delegateUids: [UID_A], creatorUid: 'other-owner-uid' }));
    await resolveNextActivity(deps, UID_A);
    expect(readNextActivitySnapshot(UID_A, NOW)?.event.id).toBe('evt-next');

    _resetNextActivityCacheForTest();
    installServer(eventDoc({ privateEvent: true, creatorUid: 'other-owner-uid', delegateUids: ['other-delegate-uid'] }));
    const hidden = await resolveNextActivity(deps, UID_A);
    expect(hidden?.event.id).toBe('evt-next');
    expect(readNextActivitySnapshot(UID_A, NOW)).toBeNull();
    expect(localStorage.getItem(nextActivitySnapshotKey(UID_A))).toBeNull();
  });
});

describe('入口靜態圖', () => {
  test('next-activity.ts 只動態載入快照模組，檔尾沒有訂閱', () => {
    const dir = join(process.cwd(), 'src/features/home/data');
    const source = readFileSync(join(dir, 'next-activity.ts'), 'utf8');
    expect(source.includes("from './next-activity-snapshot'")).toBe(false);
    expect(source.includes("import('./next-activity-snapshot')")).toBe(true);
    expect(source.includes('watchNextActivityAuth()')).toBe(false);
    const snap = readFileSync(join(dir, 'next-activity-snapshot.ts'), 'utf8');
    expect(snap.split('\n').some((line) => line.startsWith('adopt();'))).toBe(false);
    expect(snap.split('\n').some((line) => line.startsWith('ensureNextActivityAuthWatch();'))).toBe(false);
  });
});
