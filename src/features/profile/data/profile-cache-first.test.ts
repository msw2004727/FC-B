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
import {
  _resetConfirmMissingForTest,
  loadRelatedActivities,
  loadRelatedActivitiesFromCache,
} from './related-activities';

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

  it('快取少了有效報名的活動：當整體沒命中回 null，不畫偏少的筆數（PROFILE-SPEED，MiMo B1）', async () => {
    // 報名仍在快取，但活動 e2 不在：活動查詢（documentId in）回空
    getDocsFromCacheMock.mockImplementation(async (q: never) => {
      const qq = q as { constraints?: Array<{ field: unknown }> };
      if ((qq.constraints ?? []).some((w) => w.field === DOC_ID)) return { docs: [] } as never;
      return runQuery(q, true) as never;
    });
    expect(await loadRelatedActivitiesFromCache('U1', NOW)).toBeNull();
    // 伺服器版同樣情境（活動真的不見）照舊略過該筆、不丟錯
    getDocsMock.mockImplementation(async (q: never) => {
      const qq = q as { constraints?: Array<{ field: unknown }> };
      if ((qq.constraints ?? []).some((w) => w.field === DOC_ID)) return { docs: [] } as never;
      return runQuery(q, false) as never;
    });
    const server = await loadRelatedActivities('U1', NOW);
    expect(server.counts.registered).toBe(0);
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

// PROFILE-SPEED（顧問 §3.935）：老帳號常有「孤兒報名」（活動文件已刪、報名子文件還在，或報名的 eventId 對不上文件 id）。
// 伺服器的 documentId() in 查詢對查不到的 id 不會在快取留下「不存在」紀錄，原本快取路徑因此永遠不生效。
// 改成：伺服器路徑在背景對「快取還不知道不存在」的 id 讀一次單筆（SDK 會記下不存在）；
// 快取路徑只放行「快取確知不存在」的缺件，其他缺件照舊回 null（不畫偏少的筆數）。
describe('孤兒報名：快取確知不存在才放行（§3.935）', () => {
  const NOW = Date.parse('2026-11-12T12:00:00+08:00');
  const isIdQuery = (q: unknown): boolean =>
    ((q as { constraints?: Array<{ field: unknown }> }).constraints ?? []).some((w) => w.field === DOC_ID);
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
  };

  beforeEach(() => {
    // 報名 r1 指向 e2，但 e2 已不存在（伺服器與快取的活動查詢都查不到）
    store.events = store.events.filter((e) => e.docId !== 'e2');
    _resetConfirmMissingForTest();
  });

  it('快取確知 e2 不存在：快取結果可用，且與伺服器結果相同', async () => {
    getDocFromCacheMock.mockImplementation(async (ref: { path: string }) => {
      if (ref.path === 'events/e2') return docSnap('e2', null);
      throw new Error('not-in-cache');
    });
    const cached = await loadRelatedActivitiesFromCache('U1', NOW);
    expect(cached).not.toBeNull();
    expect(getDocMock).not.toHaveBeenCalled();
    expect(getDocsMock).not.toHaveBeenCalled();
    const server = await loadRelatedActivities('U1', NOW);
    expect(cached).toEqual(server);
    expect(cached?.counts).toEqual({ registered: 0, hosted: 1 });
  });

  it('快取不知道 e2 是否存在（沒讀過）：回 null，不畫偏少的筆數', async () => {
    getDocFromCacheMock.mockRejectedValue(new Error('not-in-cache'));
    expect(await loadRelatedActivitiesFromCache('U1', NOW)).toBeNull();
  });

  it('快取記得 e2「存在」卻查不到（不該發生）：仍回 null', async () => {
    getDocFromCacheMock.mockImplementation(async () => docSnap('e2', { id: 'e2' }));
    getDocsFromCacheMock.mockImplementation(async (q: never) => (isIdQuery(q) ? { docs: [] } : runQuery(q, true)) as never);
    expect(await loadRelatedActivitiesFromCache('U1', NOW)).toBeNull();
  });

  it('伺服器路徑：快取還不知道 → 背景單筆讀一次 e2；不等它就回結果', async () => {
    getDocFromCacheMock.mockRejectedValue(new Error('not-in-cache'));
    let release: () => void = () => {};
    getDocMock.mockImplementation(() => new Promise((r) => { release = () => r(docSnap('e2', null)); }));
    const server = await loadRelatedActivities('U1', NOW);
    expect(server.counts).toEqual({ registered: 0, hosted: 1 });
    await flush();
    expect(getDocMock).toHaveBeenCalledTimes(1);
    expect((getDocMock.mock.calls[0]?.[0] as { path: string }).path).toBe('events/e2');
    release();
  });

  it('伺服器路徑：快取已確知 e2 不存在 → 不再讀（0 次）', async () => {
    getDocFromCacheMock.mockImplementation(async (ref: { path: string }) => {
      if (ref.path === 'events/e2') return docSnap('e2', null);
      throw new Error('not-in-cache');
    });
    await loadRelatedActivities('U1', NOW);
    await flush();
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it('伺服器路徑：查不到的活動很多時每次最多補讀 20 筆', async () => {
    store.regs = Array.from({ length: 25 }, (_, i) => ({
      docId: `r${i}`,
      parentDocId: `gone${i}`,
      data: { userId: 'U1', status: 'confirmed', eventId: `gone${i}` },
    }));
    getDocFromCacheMock.mockRejectedValue(new Error('not-in-cache'));
    await loadRelatedActivities('U1', NOW);
    await flush();
    expect(getDocMock).toHaveBeenCalledTimes(20);
  });

  it('超過 20 筆：補讀過且快取已記得的不再讀，下一次開頁補剩下的（MiMo F2）', async () => {
    store.regs = Array.from({ length: 25 }, (_, i) => ({
      docId: `r${i}`,
      parentDocId: `gone${i}`,
      data: { userId: 'U1', status: 'confirmed', eventId: `gone${i}` },
    }));
    // 模擬 SDK：伺服器單筆讀過的 id，之後 getDocFromCache 回「不存在」
    const known = new Set<string>();
    getDocFromCacheMock.mockImplementation(async (ref: { id: string }) => {
      if (known.has(ref.id)) return docSnap(ref.id, null);
      throw new Error('not-in-cache');
    });
    getDocMock.mockImplementation(async (ref: { id: string }) => {
      known.add(ref.id);
      return docSnap(ref.id, null);
    });
    await loadRelatedActivities('U1', NOW);
    await flush();
    expect(getDocMock).toHaveBeenCalledTimes(20);
    _resetConfirmMissingForTest(); // 下一次開頁（新的工作階段）
    await loadRelatedActivities('U1', NOW);
    await flush();
    expect(getDocMock).toHaveBeenCalledTimes(25);
    // 全部確知後：快取路徑可用，伺服器路徑不再補讀
    expect(await loadRelatedActivitiesFromCache('U1', NOW)).not.toBeNull();
    await loadRelatedActivities('U1', NOW);
    await flush();
    expect(getDocMock).toHaveBeenCalledTimes(25);
  });

  it('補讀一直失敗：同一工作階段不再重讀（MiMo F2）', async () => {
    getDocFromCacheMock.mockRejectedValue(new Error('not-in-cache'));
    getDocMock.mockRejectedValue(new Error('offline'));
    await loadRelatedActivities('U1', NOW);
    await flush();
    await loadRelatedActivities('U1', NOW);
    await flush();
    expect(getDocMock).toHaveBeenCalledTimes(1);
  });

  it('伺服器路徑沒有缺件：不碰快取、不補讀', async () => {
    seed();
    await loadRelatedActivities('U1', NOW);
    await flush();
    expect(getDocFromCacheMock).not.toHaveBeenCalled();
    expect(getDocMock).not.toHaveBeenCalled();
  });
});
