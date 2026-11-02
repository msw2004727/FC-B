/**
 * 測試用的假 Firestore SDK（只給 admin-inactive 的測試 import）：在記憶體裡照 Firestore 語意算出
 * where／orderBy／startAfter／limit 的結果，並記錄每次讀取，供「讀取預算」斷言。
 * 計費模型：getDocs＝回傳文件數（0 筆仍算 1 次）；getCountFromServer＝每 1,000 筆符合項 1 次（至少 1 次）。
 */
import { vi } from 'vitest';

type Doc = { id: string; data: Record<string, unknown> };
type Constraint =
  | { type: 'where'; field: string; op: string; value: unknown }
  | { type: 'orderBy'; field: string; dir: 'asc' | 'desc' }
  | { type: 'limit'; n: number }
  | { type: 'startAfter'; snap: { id: string } };
type Q = { name: string; constraints: Constraint[] };
export type ReadCall = { kind: 'docs' | 'count'; name: string; constraints: Constraint[]; reads: number };

export const store: Record<string, Doc[]> = {};
export const calls: ReadCall[] = [];

export function resetStore(data: Record<string, Doc[]>): void {
  for (const key of Object.keys(store)) delete store[key];
  Object.assign(store, data);
  calls.length = 0;
}

export function totalReads(filter?: (c: ReadCall) => boolean): number {
  return calls.filter(filter ?? (() => true)).reduce((sum, c) => sum + c.reads, 0);
}

const isTs = (v: unknown): v is { toMillis: () => number } =>
  !!v && typeof v === 'object' && typeof (v as { toMillis?: unknown }).toMillis === 'function';

function cmp(a: unknown, b: unknown): number | null {
  if (isTs(a) && isTs(b)) return a.toMillis() - b.toMillis();
  if (isTs(a) || isTs(b)) return null; // 型別不同：Firestore 範圍條件不會命中
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (a === b) return 0;
  return null;
}

function matches(doc: Doc, c: Constraint): boolean {
  if (c.type !== 'where') return true;
  if (!(c.field in doc.data)) return false;
  const v = doc.data[c.field];
  if (c.op === 'in') return (c.value as unknown[]).some((x) => cmp(v, x) === 0);
  const r = cmp(v, c.value);
  if (r === null) return false;
  switch (c.op) {
    case '==': return r === 0;
    case '<': return r < 0;
    case '<=': return r <= 0;
    case '>': return r > 0;
    case '>=': return r >= 0;
    default: throw new Error(`unsupported op ${c.op}`);
  }
}

function run(q: Q, applyPaging: boolean): Doc[] {
  let docs = (store[q.name] ?? []).filter((d) => q.constraints.every((c) => matches(d, c)));
  const order = q.constraints.find((c): c is Extract<Constraint, { type: 'orderBy' }> => c.type === 'orderBy');
  docs = [...docs].sort((a, b) => a.id.localeCompare(b.id));
  if (order) {
    docs = docs.filter((d) => order.field in d.data);
    docs.sort((a, b) => {
      const r = cmp(a.data[order.field], b.data[order.field]) ?? 0;
      return (order.dir === 'desc' ? -r : r) || a.id.localeCompare(b.id);
    });
  }
  if (!applyPaging) return docs;
  const after = q.constraints.find((c): c is Extract<Constraint, { type: 'startAfter' }> => c.type === 'startAfter');
  if (after) docs = docs.slice(docs.findIndex((d) => d.id === after.snap.id) + 1);
  const lim = q.constraints.find((c): c is Extract<Constraint, { type: 'limit' }> => c.type === 'limit');
  return lim ? docs.slice(0, lim.n) : docs;
}

const asQuery = (q: unknown): Q => q as Q;

export const sdk = {
  collection: vi.fn((_db: unknown, name: string): Q => ({ name, constraints: [] })),
  collectionGroup: vi.fn(),
  query: vi.fn((base: Q, ...cs: Constraint[]): Q => ({ name: base.name, constraints: [...base.constraints, ...cs] })),
  where: vi.fn((field: string, op: string, value: unknown): Constraint => ({ type: 'where', field, op, value })),
  orderBy: vi.fn((field: string, dir: 'asc' | 'desc' = 'asc'): Constraint => ({ type: 'orderBy', field, dir })),
  limit: vi.fn((n: number): Constraint => ({ type: 'limit', n })),
  startAfter: vi.fn((snap: { id: string }): Constraint => ({ type: 'startAfter', snap })),
  getDocs: vi.fn(async (q: unknown) => {
    const query = asQuery(q);
    const docs = run(query, true);
    calls.push({ kind: 'docs', name: query.name, constraints: query.constraints, reads: Math.max(1, docs.length) });
    return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
  }),
  getCountFromServer: vi.fn(async (q: unknown) => {
    const query = asQuery(q);
    const count = run(query, false).length;
    calls.push({ kind: 'count', name: query.name, constraints: query.constraints, reads: Math.max(1, Math.ceil(count / 1000)) });
    return { data: () => ({ count }) };
  }),
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
  // 寫入與其他讀取 API：本頁不得呼叫。
  getDoc: vi.fn(),
  getDocsFromServer: vi.fn(),
  onSnapshot: vi.fn(),
  doc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  addDoc: vi.fn(),
  deleteDoc: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
};

export const WRITE_OR_OTHER_READ_APIS = [
  'collectionGroup', 'getDoc', 'getDocsFromServer', 'onSnapshot', 'setDoc', 'updateDoc', 'addDoc', 'deleteDoc', 'writeBatch', 'runTransaction',
] as const;

export const ts = (ms: number) => sdk.Timestamp.fromMillis(ms);
