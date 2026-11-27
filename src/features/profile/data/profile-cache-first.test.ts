import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: { kind: 'fake-db' }, app: {}, auth: {}, functions: {} })),
}));

const {
  getDocFromCacheMock,
  getDocsFromCacheMock,
  getDocMock,
  getDocsMock,
} = vi.hoisted(() => ({
  getDocFromCacheMock: vi.fn(),
  getDocsFromCacheMock: vi.fn(),
  getDocMock: vi.fn(),
  getDocsMock: vi.fn(),
}));

const DOC_ID = { kind: 'documentId' };

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ kind: 'collection', path })),
  collectionGroup: vi.fn((_db: unknown, id: string) => ({ kind: 'collectionGroup', id })),
  query: vi.fn((base: Record<string, unknown>, ...constraints: unknown[]) => ({ ...base, constraints })),
  where: vi.fn((field: unknown, op: string, value: unknown) => ({ kind: 'where', field, op, value })),
  documentId: vi.fn(() => DOC_ID),
  doc: vi.fn((_db: unknown, ...parts: string[]) => ({
    kind: 'doc',
    path: parts.join('/'),
    id: parts[parts.length - 1],
  })),
  limit: vi.fn((n: number) => ({ kind: 'limit', n })),
  getDoc: getDocMock,
  getDocs: getDocsMock,
  getDocFromCache: getDocFromCacheMock,
  getDocsFromCache: getDocsFromCacheMock,
}));

import { getFirebase } from '@/data/firebase';
import { loadPrivateProfileFromCache } from '@/data/profile-private';
import { loadOwnUserProfileFromCache } from './profile-model';
import { loadRelatedActivities, loadRelatedActivitiesFromCache } from './related-activities';

interface FakeDoc {
  docId: string;
  parentDocId?: string | null;
  data: Record<string, unknown>;
}

const store = {
  events: [] as FakeDoc[],
  regs: [] as FakeDoc[],
  cacheFail: false,
};

function snapFor(doc: FakeDoc) {
  return {
    id: doc.docId,
    exists: () => true,
    data: () => ({ ...doc.data }),
    ref: { parent: { parent: doc.parentDocId ? { id: doc.parentDocId } : null } },
  };
}

function docSnap(id: string, data: Record<string, unknown> | null) {
  return {
    id,
    exists: () => data !== null,
    data: () => data ?? undefined,
  };
}

function byDocId(a: FakeDoc, b: FakeDoc): number {
  return a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0;
}

function matches(data: Record<string, unknown>, docId: string, w: {
  field: unknown;
  op: string;
  value: unknown;
}): boolean {
  if (w.field === DOC_ID) return w.op === 'in' && (w.value as string[]).includes(docId);
  const value = data[w.field as string];
  if (w.op === '==') return value === w.value;
  if (w.op === 'array-contains') return Array.isArray(value) && value.includes(w.value);
  throw new Error(`unsupported op ${w.op}`);
}

function runQuery(q: {
  kind?: string;
  constraints?: Array<{ field: unknown; op: string; value: unknown }>;
}, useCache: boolean) {
  if (useCache && store.cacheFail) throw new Error('cache-miss');
  const constraints = q.constraints ?? [];
  const base = q.kind === 'collectionGroup' ? store.regs : store.events;
  return {
    docs: base
      .filter((doc) => constraints.every((w) => matches(doc.data, doc.docId, w)))
      .sort(byDocId)
      .map(snapFor),
  };
}

function seed(): void {
  store.events = [
    {
      docId: 'e1',
      data: { id: 'e1', title: 'Hosted', status: 'open', startAt: '2026-12-01T10:00:00+08:00', creatorUid: 'U1' },
    },
    {
      docId: 'e2',
      data: { id: 'e2', title: 'Registered', status: 'open', startAt: '2026-12-02T10:00:00+08:00' },
    },
  ];
  store.regs = [
    {
      docId: 'r1',
      parentDocId: 'e2',
      data: { userId: 'U1', status: 'confirmed', eventId: 'e2' },
    },
  ];
  store.cacheFail = false;
}

beforeEach(() => {
  vi.mocked(getFirebase).mockResolvedValue({ db: { kind: 'fake-db' } } as never);
  getDocFromCacheMock.mockReset();
  getDocsFromCacheMock.mockReset();
  getDocMock.mockReset();
  getDocsMock.mockReset();
  getDocMock.mockResolvedValue({ exists: () => false, id: 'missing', data: () => undefined } as never);
  getDocsMock.mockImplementation(async (q: never) => runQuery(q, false) as never);
  getDocsFromCacheMock.mockImplementation(async (q: never) => runQuery(q, true) as never);
  seed();
});

describe('loadPrivateProfileFromCache', () => {
  it('文件存在：hit=true 且只挑四欄', async () => {
    getDocFromCacheMock.mockResolvedValue(docSnap('profile', {
      phone: '0900',
      email: 'a@example.com',
      companions: [{ name: 'c' }],
      eduChildren: [{ name: 'k' }],
      extra: 'ignored',
    }));

    const result = await loadPrivateProfileFromCache('u1');
    expect(result).toEqual({
      hit: true,
      data: {
        phone: '0900',
        email: 'a@example.com',
        companions: [{ name: 'c' }],
        eduChildren: [{ name: 'k' }],
      },
    });
  });

  it('文件不存在：hit=true、data=null', async () => {
    getDocFromCacheMock.mockResolvedValue(docSnap('profile', null));
    expect(await loadPrivateProfileFromCache('u1')).toEqual({ hit: true, data: null });
  });

  it('getDocFromCache 丟錯：hit=false', async () => {
    getDocFromCacheMock.mockRejectedValue(new Error('cache miss'));
    expect(await loadPrivateProfileFromCache('u1')).toEqual({ hit: false, data: null });
  });

  it('不合法 uid：hit=false', async () => {
    expect(await loadPrivateProfileFromCache('bad/uid')).toEqual({ hit: false, data: null });
  });
});

describe('loadOwnUserProfileFromCache', () => {
  function mockRootAndPrivate(
    rootData: Record<string, unknown> | null,
    privateData: Record<string, unknown> | null,
    privateError?: Error,
  ): void {
    getDocFromCacheMock.mockImplementation(async (ref: { path: string }) => {
      if (ref.path.includes('/profilePrivate/')) {
        if (privateError) throw privateError;
        return docSnap('profile', privateData) as never;
      }
      return docSnap('u1', rootData) as never;
    });
  }

  it('根文件與私密文件都在快取：合併後私密欄覆蓋根文件同名欄', async () => {
    mockRootAndPrivate(
      { displayName: 'Alice', uid: 'u1', phone: 'root-phone', role: 'user' },
      { phone: 'priv-phone' },
    );

    const result = await loadOwnUserProfileFromCache('u1');
    expect(result?.name).toBe('Alice');
    expect(result?.phone).toBe('priv-phone');
    expect(getDocMock).not.toHaveBeenCalled();
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it('根文件快取讀取丟錯：null', async () => {
    getDocFromCacheMock.mockRejectedValue(new Error('cache miss'));
    expect(await loadOwnUserProfileFromCache('u1')).toBeNull();
    expect(getDocMock).not.toHaveBeenCalled();
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it('根文件不存在：null', async () => {
    mockRootAndPrivate(null, { phone: 'priv-phone' });
    expect(await loadOwnUserProfileFromCache('u1')).toBeNull();
  });

  it('私密 hit=false：null', async () => {
    mockRootAndPrivate({ displayName: 'Alice', uid: 'u1' }, null, new Error('cache miss'));
    expect(await loadOwnUserProfileFromCache('u1')).toBeNull();
  });
});

describe('loadRelatedActivitiesFromCache', () => {
  const NOW = Date.parse('2026-11-12T12:00:00+08:00');

  it('只呼叫 cache 版，且形狀與 server 版相同', async () => {
    const cached = await loadRelatedActivitiesFromCache('U1', NOW);
    expect(getDocsFromCacheMock).toHaveBeenCalled();
    expect(getDocMock).not.toHaveBeenCalled();
    expect(getDocsMock).not.toHaveBeenCalled();
    expect(cached).not.toBeNull();
    expect(cached?.counts).toEqual({ registered: 1, hosted: 1 });

    getDocsMock.mockClear();
    getDocMock.mockClear();
    getDocsFromCacheMock.mockClear();
    const server = await loadRelatedActivities('U1', NOW);
    expect(cached).toEqual(server);
  });

  it('cache 讀取丟錯：null', async () => {
    store.cacheFail = true;
    expect(await loadRelatedActivitiesFromCache('U1', NOW)).toBeNull();
  });
});

describe('loadRelatedActivities（server）', () => {
  const NOW = Date.parse('2026-11-12T12:00:00+08:00');

  it('只呼叫 server 版，不呼叫 cache 版', async () => {
    await loadRelatedActivities('U1', NOW);
    expect(getDocsMock).toHaveBeenCalled();
    expect(getDocsFromCacheMock).not.toHaveBeenCalled();
    expect(getDocFromCacheMock).not.toHaveBeenCalled();
  });
});
