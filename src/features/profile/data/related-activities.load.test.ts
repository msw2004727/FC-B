/**
 * O2（2026-11-12）對照測試：同一份假 Firestore 資料，
 *   舊做法（讀整個 events 集合＋逐筆 getDoc 所有報名的 eventId，下方 legacyLoadRelatedActivities 為改版前原樣）
 *   vs 新做法（loadRelatedActivities：主辦欄位條件查詢＋有效報名的 documentId() in 分批）
 * 結果（列表、排序、計數）必須完全相同；另驗讀取量下降、失敗處理與 uid 未到位不讀。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: { kind: 'fake-db' }, app: {}, auth: {}, functions: {} })),
}));

// ── 假 Firestore：依查詢條件回傳、記讀取量（查詢回 0 筆仍計 1 次，同 Firestore 計費） ──

interface FakeEventDoc { docId: string; data: Record<string, unknown> }
interface FakeRegDoc { parentDocId: string | null; docId: string; data: Record<string, unknown> }

const store = {
  events: [] as FakeEventDoc[],
  regs: [] as FakeRegDoc[],
  reads: 0,
  failDocIdIn: false,
  failGetDocIds: new Set<string>(),
  failWhereField: '' as string,
};

interface Where { kind: 'where'; field: unknown; op: string; value: unknown }
interface Ref { kind: string; path?: string; id?: string; constraints?: Where[] }

const DOC_ID = { kind: 'documentId' };

type FakeData = Record<string, unknown> | undefined;
interface FakeSnap {
  id: string;
  exists(): boolean;
  data(): FakeData;
  ref: { parent: { parent: { id: string } | null } };
}

function eventSnap(e: FakeEventDoc): FakeSnap {
  return { id: e.docId, exists: () => true, data: () => ({ ...e.data }), ref: { parent: { parent: null } } };
}
function regSnap(r: FakeRegDoc): FakeSnap {
  return {
    id: r.docId,
    exists: () => true,
    data: () => ({ ...r.data }),
    ref: { parent: { parent: r.parentDocId === null ? null : { id: r.parentDocId } } },
  };
}
function byDocId<T extends { docId: string }>(a: T, b: T): number {
  return a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0;
}
function matches(data: Record<string, unknown>, docId: string, w: Where): boolean {
  if (w.field === DOC_ID) return w.op === 'in' && (w.value as string[]).includes(docId);
  const v = data[w.field as string];
  if (w.op === '==') return v === w.value;
  if (w.op === 'array-contains') return Array.isArray(v) && v.includes(w.value);
  throw new Error(`unsupported op ${w.op}`);
}

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ kind: 'collection', path })),
  collectionGroup: vi.fn((_db: unknown, id: string) => ({ kind: 'collectionGroup', id })),
  query: vi.fn((base: Ref, ...constraints: Where[]) => ({ ...base, constraints })),
  where: vi.fn((field: unknown, op: string, value: unknown) => ({ kind: 'where', field, op, value })),
  documentId: vi.fn(() => DOC_ID),
  doc: vi.fn((_db: unknown, path: string, id: string) => {
    if (id.includes('/')) throw new Error('Invalid document reference');
    return { kind: 'doc', path, id };
  }),
  getDoc: vi.fn(async (ref: Ref): Promise<FakeSnap> => {
    store.reads += 1;
    if (store.failGetDocIds.has(ref.id as string)) throw new Error('permission-denied');
    const found = store.events.find((e) => e.docId === ref.id);
    if (found) return eventSnap(found);
    return { id: ref.id as string, exists: () => false, data: () => undefined, ref: { parent: { parent: null } } };
  }),
  getDocs: vi.fn(async (q: Ref) => {
    const constraints = q.constraints ?? [];
    for (const w of constraints) {
      if (w.field === DOC_ID && store.failDocIdIn) throw new Error('unavailable');
      if (typeof w.field === 'string' && w.field === store.failWhereField) throw new Error('unavailable');
    }
    let docs: FakeSnap[];
    if (q.kind === 'collectionGroup') {
      docs = store.regs
        .filter((r) => constraints.every((w) => matches(r.data, r.docId, w)))
        .sort(byDocId)
        .map(regSnap);
    } else {
      docs = store.events
        .filter((e) => constraints.every((w) => matches(e.data, e.docId, w)))
        .sort(byDocId)
        .map(eventSnap);
    }
    store.reads += Math.max(1, docs.length);
    return { docs };
  }),
}));

import type { Firestore } from 'firebase/firestore';
import { collection, collectionGroup, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { getFirebase } from '@/data/firebase';
import { events as eventsCollection, filterSubcollectionDocs } from '@/data/paths';

import {
  buildHostedActivities,
  buildRegisteredActivities,
  loadRelatedActivities,
  type EventRecord,
  type RegistrationRecord,
  type RelatedActivities,
} from './related-activities';

// ── 舊做法原樣（改版前 related-activities.ts 的 I/O，僅改成 test 內函式） ──

async function legacyLoadRelatedActivities(uid: string, now: number): Promise<RelatedActivities> {
  const safeUid = String(uid || '').trim();
  if (!safeUid) return { registered: [], hosted: [], counts: { registered: 0, hosted: 0 } };
  const allowedUids: ReadonlySet<string> = new Set([safeUid]);
  const db = (await getFirebase()).db as unknown as Firestore;

  const loadUserRegistrations = async (): Promise<RegistrationRecord[]> => {
    const snap = await getDocs(query(collectionGroup(db, 'registrations'), where('userId', '==', safeUid)));
    const out: RegistrationRecord[] = [];
    for (const d of filterSubcollectionDocs(snap.docs)) {
      const parentDoc = d.ref.parent.parent;
      const data = d.data() as Record<string, unknown>;
      const eventId = typeof data['eventId'] === 'string' ? data['eventId'] : parentDoc?.id || '';
      out.push({ ...data, _docId: d.id, _eventDocId: parentDoc?.id || '', eventId });
    }
    return out;
  };
  const loadAllEvents = async (): Promise<EventRecord[]> => {
    const snap = await getDocs(collection(db, eventsCollection));
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const id = typeof data['id'] === 'string' && data['id'] ? data['id'] : d.id;
      return { ...data, id };
    });
  };
  const loadEventsByIds = async (ids: readonly string[]): Promise<Map<string, EventRecord>> => {
    const unique = Array.from(new Set(ids.filter((id) => !!id)));
    const map = new Map<string, EventRecord>();
    const results = await Promise.all(
      unique.map(async (id) => {
        try {
          const snap = await getDoc(doc(db, eventsCollection, id));
          if (!snap.exists()) return null;
          return { id, data: { ...(snap.data() as Record<string, unknown>), id } as EventRecord };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) if (r) map.set(r.id, r.data);
    return map;
  };

  const [registrations, indexedEvents] = await Promise.all([loadUserRegistrations(), loadAllEvents()]);
  const regEventIds = registrations
    .map((r) => (typeof r.eventId === 'string' ? r.eventId : ''))
    .filter((v) => !!v);
  const eventsById = await loadEventsByIds(regEventIds);
  const registered = buildRegisteredActivities(registrations, eventsById, allowedUids, now);
  const hosted = buildHostedActivities(indexedEvents, allowedUids, now);
  return { registered, hosted, counts: { registered: registered.length, hosted: hosted.length } };
}

// ── 假資料 ──

const U = 'U_me';
const OTHER = 'U_other';
const NOW = Date.parse('2026-11-12T12:00:00+08:00');
const FUTURE = '2026-12-01T10:00:00+08:00';
const FUTURE2 = '2026-12-05T10:00:00+08:00';
const PAST = '2026-10-01T10:00:00+08:00';

function ev(docId: string, data: Record<string, unknown>): FakeEventDoc {
  return { docId, data: { id: docId, title: `T-${docId}`, status: 'open', startAt: FUTURE, ...data } };
}
function rg(parentDocId: string | null, docId: string, data: Record<string, unknown>): FakeRegDoc {
  return { parentDocId, docId, data: { userId: U, status: 'confirmed', ...data } };
}

function seed(): void {
  const events: FakeEventDoc[] = [
    // 主辦：各欄位
    ev('ce_host_creator', { creatorUid: U }),
    ev('ce_host_owner', { creatorUid: OTHER, ownerUid: U }),
    ev('ce_host_both', { creatorUid: U, ownerUid: U, startAt: FUTURE2 }),
    ev('ce_host_hostuid', { creatorUid: OTHER, hostUid: U }),
    ev('ce_host_hostuids', { creatorUid: OTHER, hostUids: [OTHER, U] }),
    ev('ce_host_creatoruids', { creatorUid: OTHER, creatorUids: [U] }),
    ev('ce_host_nostatus', { creatorUid: U, status: undefined }),
    ev('ce_host_past', { creatorUid: U, startAt: PAST }),
    ev('ce_host_full', { creatorUid: U, status: 'full' }),
    ev('ce_host_cancelled', { creatorUid: U, status: 'cancelled' }),
    ev('ce_host_ended', { creatorUid: U, endAt: PAST }),
    ev('ce_host_private', { creatorUid: U, privacy: 'private', teamOnly: true }),
    // 排序同分（同日同標題）：舊版依文件 id 升冪；兩場分屬不同條件查詢，合併後必須重排
    ev('zz_tie', { creatorUid: U, title: 'Same', startAt: FUTURE2 }),
    ev('aa_tie', { creatorUid: OTHER, ownerUid: U, title: 'Same', startAt: FUTURE2 }),
    // 舊 ID 主辦活動（public id ≠ 文件 id，R-ID-008）
    ev('rndLegacyHostDoc', { id: 'legacy_pub_host', creatorUid: U }),
    // 委託人：isProfileHostedActivity 不看 delegateUids，兩版都不算主辦
    ev('ce_delegate_only', { creatorUid: OTHER, delegateUids: [U] }),
    // 非字串主辦欄位、名稱相同但 UID 不同：兩版都不算
    ev('ce_host_weird', { creatorUid: [U], creatorName: U, hostUids: U }),
    // 報名用
    ev('ce_reg_ok', { creatorUid: OTHER }),
    ev('ce_reg_wait', { creatorUid: OTHER }),
    ev('ce_reg_private', { creatorUid: OTHER, privacy: 'private' }),
    ev('ce_reg_cancelled_event', { creatorUid: OTHER, status: 'cancelled' }),
    ev('ce_reg_ended', { creatorUid: OTHER, endAt: PAST }),
    ev('ce_reg_proxy', { creatorUid: OTHER }),
    ev('ce_reg_companion_only', { creatorUid: OTHER }),
    ev('ce_reg_cancelled_reg', { creatorUid: OTHER }),
    ev('ce_reg_activityid', { creatorUid: OTHER }),
    ev('ce_reg_ws', { creatorUid: OTHER }),
    ev('rndLegacyRegDoc', { id: 'legacy_pub_reg', creatorUid: OTHER }),
    ev('rndLegacyRegDoc2', { id: 'legacy_pub_reg2', creatorUid: OTHER }),
    ev('ce_reg_host_too', { creatorUid: U }),
    ev('ce_reg_other_user', { creatorUid: OTHER }),
  ];
  // 分批：70 場有效報名的活動（超過 2 批 × 30）
  for (let i = 0; i < 70; i += 1) {
    events.push(ev(`ce_bulk_${String(i).padStart(3, '0')}`, { creatorUid: OTHER, startAt: FUTURE }));
  }
  // 無關活動：撐到約 850 份
  for (let i = 0; i < 780; i += 1) {
    events.push(ev(`ce_noise_${String(i).padStart(4, '0')}`, { creatorUid: `U_n${i % 50}`, delegateUids: [`U_d${i % 7}`] }));
  }

  const regs: FakeRegDoc[] = [
    rg('ce_reg_ok', 'r1', { eventId: 'ce_reg_ok' }),
    rg('ce_reg_wait', 'r2a', { eventId: 'ce_reg_wait', status: 'waitlisted' }),
    rg('ce_reg_wait', 'r2b', { eventId: 'ce_reg_wait', status: 'registered' }),
    rg('ce_reg_private', 'r3', { eventId: 'ce_reg_private' }),
    rg('ce_reg_cancelled_event', 'r4', { eventId: 'ce_reg_cancelled_event' }),
    rg('ce_reg_ended', 'r5', { eventId: 'ce_reg_ended' }),
    // 他人代報名：userId 是我、由別人操作
    rg('ce_reg_proxy', 'r6', { eventId: 'ce_reg_proxy', registeredBy: OTHER, ownerUid: OTHER }),
    // 同行者紀錄：兩版都排除
    rg('ce_reg_companion_only', 'r7', { eventId: 'ce_reg_companion_only', participantType: 'companion', companionId: 'c1' }),
    rg('ce_reg_companion_only', 'r7b', { eventId: 'ce_reg_companion_only', companionId: 'c2' }),
    // 已取消報名
    rg('ce_reg_cancelled_reg', 'r8', { eventId: 'ce_reg_cancelled_reg', status: 'cancelled' }),
    // 已刪除活動
    rg('ce_deleted', 'r9', { eventId: 'ce_deleted' }),
    // 新舊 ID：eventId 存 public id、文件 id 不同 → 舊版 getDoc(public id) 讀不到，新版也一樣
    rg('rndLegacyRegDoc', 'r10', { eventId: 'legacy_pub_reg' }),
    // 舊資料沒寫 eventId → 用父文件 id
    rg('rndLegacyRegDoc2', 'r11', {}),
    // eventId 空字串、改由 activityId 查；activityId 指向的活動只出現在「已取消報名」的 eventId
    rg('ce_reg_cancelled_reg', 'r12', { eventId: '', activityId: 'ce_reg_cancelled_reg' }),
    rg('ce_reg_activityid', 'r13', { eventId: '', activityId: 'ce_reg_activityid' }),
    // eventId 前後有空白：查 key 會 trim，但讀取用原字串
    rg('ce_reg_ws', 'r14', { eventId: ' ce_reg_ws' }),
    rg('ce_reg_ws', 'r14b', { eventId: 'ce_reg_ws', status: 'cancelled' }),
    // 含 '/' 的 eventId（不能放進 documentId in）
    rg('ce_reg_ok', 'r15', { eventId: 'ce_reg_ok/x' }),
    // 報名紀錄上 uid 欄位不是我（userId 是我才被查到，但 recordUid 取 userId）
    rg('ce_reg_host_too', 'r16', { eventId: 'ce_reg_host_too', uid: OTHER }),
    // legacy root 報名（R-REG-014 排除）
    rg(null, 'r17', { eventId: 'ce_reg_other_user' }),
    // 其他使用者的報名
    { parentDocId: 'ce_reg_other_user', docId: 'r18', data: { userId: OTHER, status: 'confirmed', eventId: 'ce_reg_other_user' } },
    // 缺 status 的舊報名
    rg('ce_reg_ok', 'r19', { eventId: 'ce_reg_ok', status: undefined }),
  ];
  for (let i = 0; i < 70; i += 1) {
    const id = `ce_bulk_${String(i).padStart(3, '0')}`;
    regs.push(rg(id, `rb${i}`, { eventId: id, status: i % 3 === 0 ? 'waitlisted' : 'confirmed' }));
  }
  // 大量歷史取消報名（舊版每筆都多讀一次活動）
  for (let i = 0; i < 40; i += 1) {
    const id = `ce_noise_${String(i).padStart(4, '0')}`;
    regs.push(rg(id, `rc${i}`, { eventId: id, status: 'cancelled' }));
  }

  store.events = events;
  store.regs = regs;
  store.reads = 0;
  store.failDocIdIn = false;
  store.failGetDocIds = new Set();
  store.failWhereField = '';
}

function summarize(res: RelatedActivities) {
  return {
    registered: res.registered.map((r) => ({
      id: r.event.id,
      reg: r.registration['_docId'],
      status: r.registrationStatus,
      eff: r.effectiveStatus,
      event: r.event,
    })),
    hosted: res.hosted.map((h) => ({ id: h.event.id, eff: h.effectiveStatus, event: h.event })),
    counts: res.counts,
  };
}

async function runBoth(uid: string) {
  store.reads = 0;
  const legacy = await legacyLoadRelatedActivities(uid, NOW);
  const legacyReads = store.reads;
  store.reads = 0;
  const next = await loadRelatedActivities(uid, NOW);
  const nextReads = store.reads;
  return { legacy, next, legacyReads, nextReads };
}

beforeEach(() => {
  seed();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('loadRelatedActivities：新查詢與舊版讀全集合結果相同', () => {
  it('同一使用者：報名列表、主辦列表、排序與計數完全相同', async () => {
    const { legacy, next } = await runBoth(U);
    expect(summarize(next)).toEqual(summarize(legacy));
    // 合理性：資料確實涵蓋各類
    const hostedIds = next.hosted.map((h) => h.event.id);
    expect(hostedIds).toEqual(expect.arrayContaining([
      'ce_host_creator', 'ce_host_owner', 'ce_host_both', 'ce_host_hostuid', 'ce_host_hostuids',
      'ce_host_creatoruids', 'ce_host_nostatus', 'ce_host_private', 'legacy_pub_host', 'ce_reg_host_too',
    ]));
    expect(hostedIds).not.toEqual(expect.arrayContaining(['ce_delegate_only']));
    expect(hostedIds.indexOf('aa_tie')).toBeLessThan(hostedIds.indexOf('zz_tie'));
    const regIds = next.registered.map((r) => r.event.id);
    expect(regIds).toEqual(expect.arrayContaining([
      'ce_reg_ok', 'ce_reg_wait', 'ce_reg_private', 'ce_reg_proxy', 'ce_reg_cancelled_reg',
      'ce_reg_ws', 'rndLegacyRegDoc2', 'ce_reg_host_too', 'ce_bulk_069',
    ]));
    // 舊版本來就不顯示的：同行者、已取消活動、已結束、已刪除、以 public id 記錄的舊 ID 活動、
    // eventId 空字串且 activityId 指向的活動沒被任何報名 eventId 讀到
    for (const id of ['ce_reg_companion_only', 'ce_reg_cancelled_event', 'ce_reg_ended', 'ce_deleted', 'legacy_pub_reg', 'ce_reg_activityid']) {
      expect(regIds).not.toContain(id);
    }
    expect(next.counts.registered).toBe(78);
  });

  it('沒有任何相關活動的使用者：兩版都空', async () => {
    const { legacy, next } = await runBoth('U_nobody');
    expect(summarize(next)).toEqual(summarize(legacy));
    expect(next.counts).toEqual({ registered: 0, hosted: 0 });
  });

  it('只是委託人（delegateUids）的使用者：兩版結果相同', async () => {
    const { legacy, next } = await runBoth('U_d3');
    expect(summarize(next)).toEqual(summarize(legacy));
  });

  it('documentId in 批次失敗 → 退回逐筆讀，且個別讀不到的活動兩版都略過', async () => {
    store.failGetDocIds = new Set(['ce_reg_private', 'ce_bulk_010']);
    const legacy = await legacyLoadRelatedActivities(U, NOW);
    store.failDocIdIn = true;
    const next = await loadRelatedActivities(U, NOW);
    expect(summarize(next)).toEqual(summarize(legacy));
    expect(next.registered.map((r) => r.event.id)).not.toContain('ce_reg_private');
  });

  it('主辦查詢失敗 → 整體拒絕（同舊版讀全集合失敗），由畫面顯示錯誤與重試', async () => {
    store.failWhereField = 'ownerUid';
    await expect(loadRelatedActivities(U, NOW)).rejects.toThrow('unavailable');
  });
});

describe('loadRelatedActivities：讀取量', () => {
  it('約 850 份活動時，新做法讀取量遠低於舊版', async () => {
    const { legacyReads, nextReads } = await runBoth(U);
    // 舊：全集合 881 + 報名 + 每個報名 eventId 一次
    expect(legacyReads).toBeGreaterThan(900);
    // 新：五條主辦查詢＋報名＋有效報名指向的活動（每批 30）
    expect(nextReads).toBeLessThanOrEqual(250);
    expect(nextReads).toBeLessThan(legacyReads / 4);
  });

  it('一般使用者（無主辦、2 筆報名）進頁讀取 = 9', async () => {
    store.regs = [
      rg('ce_reg_ok', 'x1', { eventId: 'ce_reg_ok', userId: 'U_plain' }),
      rg('ce_reg_wait', 'x2', { eventId: 'ce_reg_wait', userId: 'U_plain' }),
    ];
    store.reads = 0;
    const res = await loadRelatedActivities('U_plain', NOW);
    expect(res.counts).toEqual({ registered: 2, hosted: 0 });
    // 五條主辦查詢（0 筆各計 1）+ 報名 2 + 活動 1 批 2 筆
    expect(store.reads).toBe(9);
  });

  it('uid 未到位（空字串）不讀任何資料', async () => {
    store.reads = 0;
    vi.mocked(getDocs).mockClear();
    vi.mocked(getDoc).mockClear();
    const res = await loadRelatedActivities('', NOW);
    expect(res.counts).toEqual({ registered: 0, hosted: 0 });
    expect(store.reads).toBe(0);
    expect(getDocs).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();
  });
});
