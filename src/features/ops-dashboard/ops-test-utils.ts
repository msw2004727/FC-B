/**
 * 測試用的假 Firestore SDK（只給 ops-dashboard 的測試 import），寫法同 admin-inactive 的 inactive-test-utils：
 * 在記憶體裡照 Firestore 語意算 where／orderBy／limit，並記錄每次讀取供「讀取預算」斷言。
 * 計費模型：getDoc＝1；getDocs＝回傳文件數（0 筆仍算 1）；getCountFromServer＝每 1,000 筆符合項 1 次（至少 1）。
 * `failures[集合名]` 設錯誤碼時，該集合的讀取丟出帶 code 的錯誤（模擬 Rules 擋下的 permission-denied）。
 */
import { vi } from 'vitest';

type Doc = { id: string; data: Record<string, unknown> };
const DOC_ID = '__name__';
type Constraint =
  | { type: 'where'; field: string; op: string; value: unknown }
  | { type: 'orderBy'; field: string; dir: 'asc' | 'desc' }
  | { type: 'limit'; n: number };
type Q = { name: string; constraints: Constraint[] };
type Ref = { path: string; name: string; id: string };
export type ReadCall = { kind: 'doc' | 'docs' | 'count'; name: string; id?: string; constraints: Constraint[]; reads: number };

export const store: Record<string, Doc[]> = {};
export const calls: ReadCall[] = [];
export const failures: Record<string, string> = {};

export function resetStore(data: Record<string, Doc[]>): void {
  for (const key of Object.keys(store)) delete store[key];
  for (const key of Object.keys(failures)) delete failures[key];
  Object.assign(store, data);
  calls.length = 0;
}

export function totalReads(filter?: (c: ReadCall) => boolean): number {
  return calls.filter(filter ?? (() => true)).reduce((sum, c) => sum + c.reads, 0);
}

function fieldOf(doc: Doc, field: string): { has: boolean; value: unknown } {
  if (field === DOC_ID) return { has: true, value: doc.id };
  return { has: field in doc.data, value: doc.data[field] };
}

function cmp(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return a === b ? 0 : null;
}

function matches(doc: Doc, c: Constraint): boolean {
  if (c.type !== 'where') return true;
  const { has, value } = fieldOf(doc, c.field);
  if (!has) return false;
  if (c.op === 'in') return (c.value as unknown[]).some((x) => cmp(value, x) === 0);
  const r = cmp(value, c.value);
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

function run(q: Q, applyLimit: boolean): Doc[] {
  let docs = (store[q.name] ?? []).filter((d) => q.constraints.every((c) => matches(d, c)));
  docs = [...docs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!applyLimit) return docs;
  const lim = q.constraints.find((c): c is Extract<Constraint, { type: 'limit' }> => c.type === 'limit');
  return lim ? docs.slice(0, lim.n) : docs;
}

/**
 * 失敗碼查找：`集合/文件`（只擋該 getDoc）優先，其次 `集合:doc|docs|count`，最後整個集合。
 * 這樣才能單獨擋 `opsSummary/noshow`，而不把 `opsSummary/latest` 一起當成權限錯誤。
 */
function failCode(name: string, kind: 'doc' | 'docs' | 'count', id?: string): string | undefined {
  if (id && failures[`${name}/${id}`]) return failures[`${name}/${id}`];
  return failures[`${name}:${kind}`] || failures[name];
}

function maybeFail(name: string, kind: 'doc' | 'docs' | 'count', id?: string): void {
  const code = failCode(name, kind, id);
  if (code) throw Object.assign(new Error(`synthetic ${code}`), { code });
}

export const sdk = {
  collection: vi.fn((_db: unknown, name: string): Q => ({ name, constraints: [] })),
  doc: vi.fn((_db: unknown, name: string, id: string): Ref => ({ path: `${name}/${id}`, name, id })),
  documentId: vi.fn(() => DOC_ID),
  query: vi.fn((base: Q, ...cs: Constraint[]): Q => ({ name: base.name, constraints: [...base.constraints, ...cs] })),
  where: vi.fn((field: string, op: string, value: unknown): Constraint => ({ type: 'where', field, op, value })),
  orderBy: vi.fn((field: string, dir: 'asc' | 'desc' = 'asc'): Constraint => ({ type: 'orderBy', field, dir })),
  limit: vi.fn((n: number): Constraint => ({ type: 'limit', n })),
  getDoc: vi.fn(async (ref: Ref) => {
    calls.push({ kind: 'doc', name: ref.name, id: ref.id, constraints: [], reads: 1 });
    maybeFail(ref.name, 'doc', ref.id);
    const found = (store[ref.name] ?? []).find((d) => d.id === ref.id);
    return { id: ref.id, exists: () => Boolean(found), data: () => found?.data };
  }),
  getDocs: vi.fn(async (q: Q) => {
    const docs = run(q, true);
    calls.push({ kind: 'docs', name: q.name, constraints: q.constraints, reads: Math.max(1, docs.length) });
    maybeFail(q.name, 'docs');
    return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
  }),
  getCountFromServer: vi.fn(async (q: Q) => {
    const count = run(q, false).length;
    calls.push({ kind: 'count', name: q.name, constraints: q.constraints, reads: Math.max(1, Math.ceil(count / 1000)) });
    maybeFail(q.name, 'count');
    return { data: () => ({ count }) };
  }),
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
  // 本功能不得呼叫：
  collectionGroup: vi.fn(),
  getDocsFromServer: vi.fn(),
  onSnapshot: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  addDoc: vi.fn(),
  deleteDoc: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
};

export const FORBIDDEN_APIS = [
  'collectionGroup', 'getDocsFromServer', 'onSnapshot', 'setDoc', 'updateDoc', 'addDoc', 'deleteDoc', 'writeBatch', 'runTransaction',
] as const;

export const ts = (ms: number) => sdk.Timestamp.fromMillis(ms);

/** `documentId() in [...]` 每批的 ID 清單。 */
export function documentIdInBatches(): unknown[][] {
  return calls
    .flatMap((c) => c.constraints)
    .filter((c): c is Extract<Constraint, { type: 'where' }> => c.type === 'where' && c.field === DOC_ID && c.op === 'in')
    .map((c) => c.value as unknown[]);
}

/** 沒有 limit、也不是 `documentId() in` 的 getDocs（＝可能整集合讀）。 */
export function queriesWithoutLimitOrIdList(): ReadCall[] {
  return calls.filter(
    (c) => c.kind === 'docs'
      && !c.constraints.some((x) => x.type === 'limit')
      && !c.constraints.some((x) => x.type === 'where' && x.field === DOC_ID && x.op === 'in'),
  );
}
