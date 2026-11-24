/**
 * next-activity-load.ts 單元測試。
 * Firestore 用 vi.mock('firebase/firestore') 的替身；@/core/error-report 用 vi.fn()。
 */

import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';

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
  orderBy: vi.fn((field: unknown, direction: 'asc' | 'desc' = 'asc') => ({
    kind: 'orderBy',
    field,
    dir: direction,
  })),
  startAfter: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock('@/core/error-report', () => ({
  reportClientError: vi.fn(),
}));

import { getDocs } from 'firebase/firestore';
import { reportClientError } from '@/core/error-report';
import { ACTIVE_EVENTS_LIMIT } from '@/features/events/data/events-repo';
import type { EventDoc } from '@/features/events/data/types';
import {
  EVENT_IN_QUERY_CHUNK,
  EVENT_QUERY_LIMIT,
  REGISTRATION_QUERY_LIMIT,
  resolveNextActivity,
} from './next-activity';
import {
  ACTIVE_EVENTS_LIST_CAP,
  buildActiveEventIdValues,
  isValidFirestoreDocId,
  loadNextActivityInputs,
} from './next-activity-load';

const NOW = Date.parse('2099-01-01T00:00:00+08:00');
const TOMORROW = '2099/05/20 18:00~20:00';
const NEXT_WEEK = '2099/05/27 18:00~20:00';
const PAST = '2000/05/20 18:00~20:00';

// 替身回傳精簡快照，型別放寬成 any 參數、unknown 回傳。
const mockedGetDocs = vi.mocked(getDocs) as unknown as Mock<(q: any) => Promise<unknown>>;
const mockedReport = vi.mocked(reportClientError);

interface StoredEvent {
  docId: string;
  data: Record<string, unknown>;
}

interface StoredReg {
  path: string;
  root: boolean;
  docId: string;
  data: Record<string, unknown>;
}

let store: { events: StoredEvent[]; registrations: StoredReg[] } = {
  events: [],
  registrations: [],
};

function makeRegSnap(reg: StoredReg) {
  return {
    id: reg.docId,
    data: () => reg.data,
    ref: { parent: { parent: reg.root ? null : { id: 'events/whatever' } } },
  };
}

function makeEventSnap(event: StoredEvent) {
  return {
    id: event.docId,
    data: () => event.data,
    ref: { parent: { parent: { id: 'events' } } },
  };
}

function addEvent(docId: string, data: Record<string, unknown> = {}) {
  store.events.push({ docId, data });
}

function addReg(path: string, data: Record<string, unknown>, root = false) {
  const docId = path.split('/').pop() ?? '';
  store.registrations.push({ path, root, docId, data });
}

async function fakeGetDocs(q: any) {
  const base = q.base;
  const constraints: any[] = q.constraints ?? [];

  if (base?.kind === 'collectionGroup' && base.id === 'registrations') {
    let regs = store.registrations.slice();
    let limitN: number | null = null;
    constraints.forEach((c) => {
      if (c.kind === 'where') {
        if (c.field === 'userId' && c.op === '==') {
          regs = regs.filter((r) => String(r.data.userId ?? '') === String(c.value));
        } else if (c.field === 'eventId' && c.op === 'in') {
          const values = (c.value as unknown[]).map(String);
          regs = regs.filter((r) => values.includes(String(r.data.eventId ?? '')));
        } else if (c.field === 'status' && c.op === 'in') {
          const values = (c.value as unknown[]).map(String);
          regs = regs.filter((r) => values.includes(String(r.data.status ?? '')));
        }
      } else if (c.kind === 'limit') {
        limitN = c.n as number;
      }
    });
    regs.sort((a, b) => a.path.localeCompare(b.path));
    if (limitN != null) regs = regs.slice(0, limitN);
    return { docs: regs.map(makeRegSnap) };
  }

  if (base?.kind === 'collection' && base.path === 'events') {
    let events = store.events.slice();
    let limitN: number | null = null;
    constraints.forEach((c) => {
      if (c.kind === 'where') {
        if (c.field?.kind === 'documentId' && c.op === 'in') {
          const values = (c.value as unknown[]).map(String);
          events = events.filter((e) => values.includes(e.docId));
        } else if (c.field === 'id' && c.op === 'in') {
          const values = (c.value as unknown[]).map(String);
          events = events.filter((e) => values.includes(String(e.data.id ?? '')));
        } else if (c.field === 'status' && c.op === 'in') {
          const values = (c.value as unknown[]).map(String);
          events = events.filter((e) => values.includes(String(e.data.status ?? '')));
        } else if (c.field === 'creatorUid' && c.op === '==') {
          events = events.filter((e) => String(e.data.creatorUid ?? '') === String(c.value));
        } else if (c.field === 'ownerUid' && c.op === '==') {
          events = events.filter((e) => String(e.data.ownerUid ?? '') === String(c.value));
        } else if (c.field === 'delegateUids' && c.op === 'array-contains') {
          events = events.filter((e) => Array.isArray(e.data.delegateUids)
            && e.data.delegateUids.map(String).includes(String(c.value)));
        }
      } else if (c.kind === 'limit') {
        limitN = c.n as number;
      }
    });
    events.sort((a, b) => a.docId.localeCompare(b.docId));
    if (limitN != null) events = events.slice(0, limitN);
    return { docs: events.map(makeEventSnap) };
  }

  throw new Error('unexpected query');
}

function queries(): any[] {
  return mockedGetDocs.mock.calls.map((call) => call[0] as any);
}

function makeLogger() {
  return { warn: vi.fn() };
}

function active(docId: string, data: Partial<EventDoc> = {}): EventDoc {
  return { id: docId, _docId: docId, status: 'open', date: TOMORROW, ...data };
}

beforeEach(() => {
  // 超量回報每台裝置每天一次（limit-report）：每案清掉，避免前一案的紀錄吞掉後一案的回報。
  localStorage.clear();
  store = { events: [], registrations: [] };
  mockedGetDocs.mockReset();
  mockedGetDocs.mockImplementation(fakeGetDocs);
  mockedReport.mockReset();
});

describe('next-activity-load', () => {
  test('T-1 查詢形狀：scoped 報名查詢只有 userId 與 eventId in', async () => {
    addReg('events/e1/registrations/r1', { userId: 'u1', eventId: 'e1', status: 'confirmed' });
    const logger = makeLogger();
    const inputs = await loadNextActivityInputs({
      activeEvents: [active('e1')],
      logger,
    }, 'u1');

    const regQueries = queries().filter((q) => q.base?.kind === 'collectionGroup');
    expect(regQueries).toHaveLength(1);
    const constraints = regQueries[0].constraints as any[];
    expect(constraints.some((c) => c.kind === 'where' && c.field === 'userId' && c.op === '==')).toBe(true);
    expect(constraints.some((c) => c.kind === 'where' && c.field === 'eventId' && c.op === 'in')).toBe(true);
    expect(constraints.some((c) => c.kind === 'where' && c.field === 'status')).toBe(false);
    expect(constraints.some((c) => c.kind === 'orderBy')).toBe(false);
    expect(constraints.some((c) => c.kind === 'limit')).toBe(false);
    expect(inputs.registrations).toHaveLength(1);
  });

  test('T-2 兩種 eventId：新格式與舊格式都放進值清單且都選得到', async () => {
    const activeEvents = [
      active('e1'),
      active('doc-old', { id: 'public-old' }),
    ];
    expect(buildActiveEventIdValues(activeEvents)).toEqual(['e1', 'public-old', 'doc-old']);
    addReg('events/e1/registrations/r1', { userId: 'u1', eventId: 'e1', status: 'confirmed' });
    addReg('events/doc-old/registrations/r2', { userId: 'u1', eventId: 'public-old', status: 'confirmed' });

    const inputs = await loadNextActivityInputs({ activeEvents, logger: makeLogger() }, 'u1');
    expect(inputs.registrations.map((r) => r.eventId).sort()).toEqual(['e1', 'public-old']);
    expect(inputs.events.some((e) => e._docId === 'e1')).toBe(true);
    expect(inputs.events.some((e) => e._docId === 'doc-old')).toBe(true);
  });

  test('T-3 分批：29 場（16 舊格式）→ 45 值 → 30／15 兩批，並與主辦查詢同時發出', async () => {
    const activeEvents: EventDoc[] = [];
    for (let i = 0; i < 16; i += 1) activeEvents.push(active(`doc-${i}`, { id: `pub-${i}` }));
    for (let i = 0; i < 13; i += 1) activeEvents.push(active(`new-${i}`));

    await loadNextActivityInputs({ activeEvents, logger: makeLogger() }, 'u1');

    const regQueries = queries().filter((q) => q.base?.kind === 'collectionGroup');
    const chunkSizes = regQueries
      .map((q) => (q.constraints as any[]).find((c) => c.kind === 'where' && c.field === 'eventId')?.value as string[])
      .map((values) => values.length)
      .sort((a, b) => b - a);
    expect(chunkSizes).toEqual([30, 15]);

    const managedQueries = queries().filter((q) => q.base?.kind === 'collection' && q.base.path === 'events');
    expect(managedQueries.filter((q) => (q.constraints as any[]).some((c) => c.field === 'creatorUid'))).toHaveLength(1);
    expect(managedQueries.filter((q) => (q.constraints as any[]).some((c) => c.field === 'ownerUid'))).toHaveLength(1);
    expect(managedQueries.filter((q) => (q.constraints as any[]).some((c) => c.field === 'delegateUids'))).toHaveLength(1);
  });

  test('T-4 舊格式根文件不進結果', async () => {
    addReg('registrations/r0', { userId: 'u1', eventId: 'e1', status: 'confirmed' }, true);
    addReg('events/e1/registrations/r1', { userId: 'u1', eventId: 'e1', status: 'confirmed' });
    const inputs = await loadNextActivityInputs({
      activeEvents: [active('e1')],
      logger: makeLogger(),
    }, 'u1');
    expect(inputs.registrations.map((r) => r._docId)).toEqual(['r1']);
  });

  test('T-5 狀態一致：只留 confirmed／waitlisted／registered', async () => {
    const statuses = ['cancelled', 'removed', undefined, 'confirmed', 'waitlisted', 'registered'];
    statuses.forEach((status, index) => {
      addReg(`events/e1/registrations/r${index}`, {
        userId: 'u1',
        eventId: 'e1',
        ...(status === undefined ? {} : { status }),
      });
    });
    const inputs = await loadNextActivityInputs({
      activeEvents: [active('e1')],
      logger: makeLogger(),
    }, 'u1');
    expect(inputs.registrations.map((r) => r.status).sort()).toEqual(['confirmed', 'registered', 'waitlisted']);
  });

  test('T-6 清單 ≥ 200：退回現行報名查詢並記 fallback 警告', async () => {
    const activeEvents = Array.from({ length: ACTIVE_EVENTS_LIST_CAP }, (_, i) => active(`e${i}`));
    const logger = makeLogger();
    await loadNextActivityInputs({ activeEvents, logger }, 'u1');

    const regQueries = queries().filter((q) => q.base?.kind === 'collectionGroup');
    expect(regQueries).toHaveLength(1);
    const constraints = regQueries[0].constraints as any[];
    expect(constraints.some((c) => c.kind === 'where' && c.field === 'status' && c.op === 'in')).toBe(true);
    expect(constraints.some((c) => c.kind === 'limit')).toBe(true);
    expect(constraints.some((c) => c.kind === 'where' && c.field === 'eventId')).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('[NextActivity] active event list may be incomplete; using registration query fallback');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('u1');
    expect(mockedReport).toHaveBeenCalledWith('next-activity-active-list-incomplete', expect.any(Error));
  });

  test('T-7 沒傳清單：行為與 HEAD 相同，不記 fallback 警告', async () => {
    const logger = makeLogger();
    await loadNextActivityInputs({ logger }, 'u1');
    const regQueries = queries().filter((q) => q.base?.kind === 'collectionGroup');
    expect(regQueries).toHaveLength(1);
    const constraints = regQueries[0].constraints as any[];
    expect(constraints.some((c) => c.kind === 'where' && c.field === 'status')).toBe(true);
    expect(constraints.some((c) => c.kind === 'limit')).toBe(true);
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('active event list may be incomplete'));
  });

  test('T-8 新查詢某批失敗：整段退回現行報名查詢＋補抓，主辦查詢不重發', async () => {
    addEvent('managed-1', { creatorUid: 'u1', status: 'open', date: TOMORROW });
    addReg('events/e1/registrations/r1', { userId: 'u1', eventId: 'e1', status: 'confirmed' });
    const indexError = Object.assign(new Error('index missing'), { code: 'failed-precondition' });
    mockedGetDocs.mockImplementation(async (q: any) => {
      const constraints = (q.constraints ?? []) as any[];
      if (q.base?.kind === 'collectionGroup'
        && constraints.some((c) => c.kind === 'where' && c.field === 'eventId')) {
        throw indexError;
      }
      return fakeGetDocs(q);
    });

    const inputs = await loadNextActivityInputs({
      activeEvents: [active('e1')],
      logger: makeLogger(),
    }, 'u1');

    // 退路真的跑了：現行報名查詢（status in ＋ limit REGISTRATION_QUERY_LIMIT）取回 r1。
    expect(inputs.registrations.map((r) => (r as { _docId?: string })._docId)).toEqual(['r1']);
    const fallbackQueries = queries().filter((q) => q.base?.kind === 'collectionGroup'
      && (q.constraints as any[]).some((c) => c.kind === 'where' && c.field === 'status' && c.op === 'in')
      && (q.constraints as any[]).some((c) => c.kind === 'limit' && c.n === REGISTRATION_QUERY_LIMIT));
    expect(fallbackQueries).toHaveLength(1);
    const managedQueries = queries().filter((q) => q.base?.kind === 'collection' && q.base.path === 'events');
    expect(managedQueries.filter((q) => (q.constraints as any[]).some((c) => c.field === 'creatorUid'))).toHaveLength(1);
    expect(managedQueries.filter((q) => (q.constraints as any[]).some((c) => c.field === 'ownerUid'))).toHaveLength(1);
    expect(managedQueries.filter((q) => (q.constraints as any[]).some((c) => c.field === 'delegateUids'))).toHaveLength(1);
    expect(mockedReport).toHaveBeenCalledWith('next-activity-scoped-fallback', expect.any(Error));
  });

  test('T-9 R-ID-010 清單內衝突：文件代號那份勝出', async () => {
    const docEvent = active('X', { id: 'doc-x-public', date: TOMORROW });
    const publicEvent = active('Y', { id: 'X', date: NEXT_WEEK });
    addReg('events/X/registrations/r1', { userId: 'u1', eventId: 'X', status: 'confirmed' });
    const picked = await resolveNextActivity({
      activeEvents: [docEvent, publicEvent],
      now: () => NOW,
      logger: makeLogger(),
    }, 'u1');
    expect(picked?.event._docId).toBe('X');
  });

  test('T-9b R-ID-010 清單內衝突、公開代號那份排在前面：文件代號那份仍勝出（清單無固定順序）', async () => {
    const docEvent = active('X', { id: 'doc-x-public', date: TOMORROW });
    const publicEvent = active('Y', { id: 'X', date: NEXT_WEEK });
    addReg('events/X/registrations/r1', { userId: 'u1', eventId: 'X', status: 'confirmed' });
    const picked = await resolveNextActivity({
      activeEvents: [publicEvent, docEvent],
      now: () => NOW,
      logger: makeLogger(),
    }, 'u1');
    expect(picked?.event._docId).toBe('X');
  });

  test('T-10 R-ID-010 清單外文件存在：已結束文件覆蓋公開代號那場', async () => {
    const activeEvents = [active('Y', { id: 'X', date: TOMORROW })];
    addEvent('X', { id: 'X', status: 'open', date: PAST });
    addReg('events/Y/registrations/r1', { userId: 'u1', eventId: 'X', status: 'confirmed' });
    const picked = await resolveNextActivity({
      activeEvents,
      now: () => NOW,
      logger: makeLogger(),
    }, 'u1');
    expect(picked).toBeNull();
  });

  test('T-11 R-ID-010 確認失敗：對應報名移除、其他報名照常', async () => {
    const activeEvents = [active('Y', { id: 'X' }), active('e2')];
    addReg('events/Y/registrations/r1', { userId: 'u1', eventId: 'X', status: 'confirmed' });
    addReg('events/e2/registrations/r2', { userId: 'u1', eventId: 'e2', status: 'confirmed' });
    mockedGetDocs.mockImplementation(async (q: any) => {
      const constraints = (q.constraints ?? []) as any[];
      if (q.base?.kind === 'collection'
        && constraints.some((c) => c.kind === 'where' && c.field?.kind === 'documentId')) {
        throw new Error('doc check failed');
      }
      return fakeGetDocs(q);
    });

    const logger = makeLogger();
    const inputs = await loadNextActivityInputs({ activeEvents, logger }, 'u1');
    expect(inputs.registrations.map((r) => r.eventId)).toEqual(['e2']);
    expect(logger.warn).toHaveBeenCalledWith('[NextActivity] event fetch skipped:', 'documentId', expect.any(Error));
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('X');
  });

  test('T-12 契約：清單上限與 chunks 上限', () => {
    expect(ACTIVE_EVENTS_LIST_CAP).toBe(ACTIVE_EVENTS_LIMIT);
    expect(EVENT_IN_QUERY_CHUNK).toBeLessThanOrEqual(30);
    expect(isValidFirestoreDocId('a/b')).toBe(false);
  });

  test('T-13 不把整份清單當主辦候選', async () => {
    const organizerEvent = active('not-managed', { organizerUid: 'u1' });
    const inputs = await loadNextActivityInputs({
      activeEvents: [organizerEvent],
      logger: makeLogger(),
    }, 'u1');
    expect(inputs.registrations).toEqual([]);
    expect(inputs.events).toEqual([]);
    const picked = await resolveNextActivity({
      activeEvents: [organizerEvent],
      now: () => NOW,
      logger: makeLogger(),
    }, 'u1');
    expect(picked).toBeNull();
  });

  test('T-14 新格式不發確認查詢', async () => {
    addReg('events/e1/registrations/r1', { userId: 'u1', eventId: 'e1', status: 'confirmed' });
    await loadNextActivityInputs({
      activeEvents: [active('e1')],
      logger: makeLogger(),
    }, 'u1');
    const confirmQueries = queries().filter((q) => q.base?.kind === 'collection'
      && (q.constraints as any[]).some((c) => c.kind === 'where' && c.field?.kind === 'documentId'));
    expect(confirmQueries).toHaveLength(0);
  });

  test('T-R 回歸：上限＋100 筆已結束＋2 筆未來，選到明天那場', async () => {
    const totalEnded = REGISTRATION_QUERY_LIMIT + 100;
    for (let i = 0; i < totalEnded; i += 1) {
      addReg(`events/a-ended-${i}/registrations/r${i}`, {
        userId: 'u1',
        eventId: `ended-${i}`,
        status: 'confirmed',
      });
    }
    addReg('events/z-tomorrow/registrations/r-t', {
      userId: 'u1',
      eventId: 'future-tomorrow',
      status: 'confirmed',
    });
    addReg('events/z-next-week/registrations/r-n', {
      userId: 'u1',
      eventId: 'future-next-week',
      status: 'confirmed',
    });

    const activeEvents = [
      active('future-tomorrow', { date: TOMORROW }),
      active('future-next-week', { date: NEXT_WEEK }),
    ];
    const picked = await resolveNextActivity({
      activeEvents,
      now: () => NOW,
      logger: makeLogger(),
    }, 'u1');
    expect(picked?.event._docId).toBe('future-tomorrow');
  });

  test('T-E E-1 報名上限回報', async () => {
    for (let i = 0; i < REGISTRATION_QUERY_LIMIT; i += 1) {
      addReg(`events/e${i}/registrations/r${i}`, { userId: 'u1', eventId: `e${i}`, status: 'confirmed' });
    }
    await loadNextActivityInputs({ logger: makeLogger() }, 'u1');
    const call = mockedReport.mock.calls.find((c) => c[0] === 'next-activity-registration-limit');
    expect(call).toBeTruthy();
    expect((call?.[1] as Error).message).toBe('registration query hit the limit');
    const serialized = JSON.stringify(mockedReport.mock.calls.map(([context, err]) => ({
      context,
      message: (err as Error).message,
      code: (err as { code?: string }).code,
    })));
    expect(serialized).not.toContain('u1');
    expect(serialized).not.toContain('e0');
  });

  test('T-E E-2 主辦上限回報', async () => {
    for (let i = 0; i < EVENT_QUERY_LIMIT; i += 1) {
      addEvent(`managed-${i}`, { creatorUid: 'u1', status: 'open', date: TOMORROW });
    }
    await loadNextActivityInputs({ logger: makeLogger() }, 'u1');
    const call = mockedReport.mock.calls.find((c) => c[0] === 'next-activity-managed-limit');
    expect(call).toBeTruthy();
    expect((call?.[1] as Error).message).toBe('creator query hit the limit');
    expect(JSON.stringify(mockedReport.mock.calls)).not.toContain('u1');
  });

  test('T-E E-3 清單不完整回報', async () => {
    const activeEvents = Array.from({ length: ACTIVE_EVENTS_LIST_CAP }, (_, i) => active(`e${i}`));
    await loadNextActivityInputs({ activeEvents, logger: makeLogger() }, 'u1');
    expect(mockedReport).toHaveBeenCalledWith('next-activity-active-list-incomplete', expect.any(Error));
    expect(JSON.stringify(mockedReport.mock.calls)).not.toContain('u1');
  });

  test('T-E E-4 scoped 退路回報：固定訊息與 code', async () => {
    const original = Object.assign(new Error('original secret message'), { code: 'failed-precondition' });
    mockedGetDocs.mockImplementation(async (q: any) => {
      const constraints = (q.constraints ?? []) as any[];
      if (q.base?.kind === 'collectionGroup'
        && constraints.some((c) => c.kind === 'where' && c.field === 'eventId')) {
        throw original;
      }
      return fakeGetDocs(q);
    });

    await loadNextActivityInputs({
      activeEvents: [active('e1')],
      logger: makeLogger(),
    }, 'u1');

    const call = mockedReport.mock.calls.find((c) => c[0] === 'next-activity-scoped-fallback');
    expect(call).toBeTruthy();
    const err = call?.[1] as Error & { code?: string };
    expect(err.message).toBe('scoped registration query failed');
    expect(err.code).toBe('failed-precondition');
    const serialized = JSON.stringify(mockedReport.mock.calls.map(([context, error]) => ({
      context,
      message: (error as Error).message,
      code: (error as { code?: string }).code,
    })));
    expect(serialized).not.toContain('u1');
    expect(serialized).not.toContain('e1');
    expect(serialized).not.toContain('original secret message');
  });
});
