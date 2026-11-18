// 測試用假 Firestore SDK：記錄每次讀寫，計算實際讀取次數（讀取預算斷言用）。
// 用法：vi.mock('firebase/firestore', async () => (await import('<本檔>')).fakeSdk);
import { vi } from 'vitest';

export interface FakeDoc {
  id: string;
  data: Record<string, unknown>;
}

export interface Constraint {
  type: 'where' | 'orderBy' | 'limit' | 'startAfter';
  args: unknown[];
}

export interface QueryDesc {
  kind: 'query' | 'col';
  path: string;
  constraints: Constraint[];
}

type DocsHandler = (q: QueryDesc) => FakeDoc[];
type CountHandler = (q: QueryDesc) => number;

export const fakeState = {
  docsHandler: (() => []) as DocsHandler,
  countHandler: (() => 0) as CountHandler,
  /** runTransaction 內 tx.get 回傳的資料；null＝不存在。 */
  txDoc: null as Record<string, unknown> | null,
  /** 每次 getDocs／count 的讀取次數紀錄。 */
  reads: [] as { op: 'getDocs' | 'count' | 'tx.get'; path: string; count: number; q?: QueryDesc }[],
  writes: [] as { op: string; path: string; data?: unknown }[],
};

export function resetFakeFirestore(): void {
  fakeState.docsHandler = () => [];
  fakeState.countHandler = () => 0;
  fakeState.txDoc = null;
  fakeState.reads = [];
  fakeState.writes = [];
  for (const fn of Object.values(fakeSdk)) {
    if (typeof fn === 'function' && 'mockClear' in fn) (fn as { mockClear: () => void }).mockClear();
  }
}

/** 計費讀取：每次查詢至少 1 讀；count() 聚合每 1000 筆 1 讀（測試資料量小，算 1）。 */
export function totalReads(): number {
  return fakeState.reads.reduce((sum, r) => sum + r.count, 0);
}

export function limitOf(q: QueryDesc | undefined): number | null {
  const c = q?.constraints.find((x) => x.type === 'limit');
  return c ? Number(c.args[0]) : null;
}

function asQuery(target: unknown): QueryDesc {
  const t = target as QueryDesc;
  return { kind: t.kind, path: t.path, constraints: t.constraints ?? [] };
}

function snapOf(path: string, docs: FakeDoc[]) {
  return {
    docs: docs.map((d) => ({ id: d.id, data: () => ({ ...d.data }), ref: { path: `${path}/${d.id}` } })),
    forEach(cb: (d: { id: string; data: () => Record<string, unknown> }) => void) {
      for (const d of docs) cb({ id: d.id, data: () => ({ ...d.data }) });
    },
    size: docs.length,
    empty: docs.length === 0,
  };
}

export const fakeSdk = {
  collection: vi.fn((_db: unknown, path: string) => ({ kind: 'col', path, constraints: [] }) as QueryDesc),
  collectionGroup: vi.fn(() => {
    throw new Error('collectionGroup 不允許');
  }),
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  query: vi.fn((base: QueryDesc, ...constraints: Constraint[]) => ({ kind: 'query', path: base.path, constraints: [...base.constraints, ...constraints] }) as QueryDesc),
  where: vi.fn((...args: unknown[]) => ({ type: 'where', args }) as Constraint),
  orderBy: vi.fn((...args: unknown[]) => ({ type: 'orderBy', args }) as Constraint),
  limit: vi.fn((...args: unknown[]) => ({ type: 'limit', args }) as Constraint),
  startAfter: vi.fn((...args: unknown[]) => ({ type: 'startAfter', args }) as Constraint),
  getDocs: vi.fn(async (target: unknown) => {
    const q = asQuery(target);
    const docs = fakeState.docsHandler(q);
    fakeState.reads.push({ op: 'getDocs', path: q.path, count: Math.max(1, docs.length), q });
    return snapOf(q.path, docs);
  }),
  getDocsFromServer: vi.fn(async () => {
    throw new Error('getDocsFromServer 未預期');
  }),
  getDoc: vi.fn(async () => {
    throw new Error('getDoc 未預期');
  }),
  getCountFromServer: vi.fn(async (target: unknown) => {
    const q = asQuery(target);
    const count = fakeState.countHandler(q);
    fakeState.reads.push({ op: 'count', path: q.path, count: 1, q });
    return { data: () => ({ count }) };
  }),
  setDoc: vi.fn(async (ref: { path: string }, data: unknown) => {
    fakeState.writes.push({ op: 'set', path: ref.path, data });
  }),
  updateDoc: vi.fn(async (ref: { path: string }, data: unknown) => {
    fakeState.writes.push({ op: 'update', path: ref.path, data });
  }),
  deleteDoc: vi.fn(async (ref: { path: string }) => {
    fakeState.writes.push({ op: 'delete', path: ref.path });
  }),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  deleteField: vi.fn(() => ({ __deleteField: true })),
  writeBatch: vi.fn(() => {
    const pending: { path: string; data: unknown }[] = [];
    return {
      set: (ref: { path: string }, data: unknown) => {
        pending.push({ path: ref.path, data });
      },
      commit: vi.fn(async () => {
        for (const p of pending) fakeState.writes.push({ op: 'batch.set', path: p.path, data: p.data });
      }),
    };
  }),
  runTransaction: vi.fn(async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: async (ref: { path: string }) => {
        fakeState.reads.push({ op: 'tx.get', path: ref.path, count: 1 });
        const data = fakeState.txDoc;
        return { exists: () => data !== null, data: () => (data ? { ...data } : undefined) };
      },
      update: (ref: { path: string }, data: unknown) => {
        fakeState.writes.push({ op: 'tx.update', path: ref.path, data });
      },
    };
    return fn(tx);
  }),
};
