import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActiveAnnouncements } from './announcements';
import { loadActiveBanners } from './banners';
import { bannersRestBody, parseRunQueryResponse } from './banners-rest';
import { restDoc, restInt, restStr, restTs } from './__fixtures__/banners-rest';

// O6 對照測試：首頁公告／橫幅的查詢改成「只讀有效狀態」後，畫面拿到的清單（內容＋順序）必須與舊做法完全相同。
//
// 做法：同一份假資料跑兩次「真的」loadActiveAnnouncements／loadActiveBanners／parseRunQueryResponse——
// - 舊做法：假 Firestore 忽略 where（舊程式＝新程式去掉 where，映射與客戶端篩選、排序完全沒改，limit 照舊套用）；
// - 新做法：假 Firestore 照 Firestore 語意套用 where（精確等值、型別要相同、缺欄位不符合；`in` 任一相等），
//   排序一律文件 ID 升冪（SDK 對沒有不等式的查詢隱含 __name__ 升冪，`in`／`==` 都不是不等式），limit 在篩選後套用。
// 兩者 toEqual 才算通過。已知邊界（舊做法會顯示、新查詢讀不到的資料形狀）另列一組，明確寫出差異。

type Raw = Record<string, unknown>;
interface FakeDoc {
  id: string;
  data: Raw;
}

const fake = vi.hoisted(() => ({
  collections: {} as Record<string, Array<{ id: string; data: Record<string, unknown> }>>,
  ignoreWhere: false,
}));

vi.mock('firebase/firestore', () => {
  type Constraint = { kind: 'where'; field: string; op: string; value: unknown } | { kind: 'limit'; n: number };
  const same = (a: unknown, b: unknown): boolean => typeof a === typeof b && a === b;
  return {
    collection: (_db: unknown, path: string) => ({ kind: 'collection', path }),
    where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
    limit: (n: number) => ({ kind: 'limit', n }),
    query: (base: { path: string }, ...constraints: Constraint[]) => ({ path: base.path, constraints }),
    getDocs: async (q: { path: string; constraints: Constraint[] }) => {
      let rows = [...(fake.collections[q.path] ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const c of q.constraints) {
        if (c.kind !== 'where' || fake.ignoreWhere) continue;
        rows = rows.filter((r) => {
          if (!Object.prototype.hasOwnProperty.call(r.data, c.field)) return false;
          const v = r.data[c.field];
          if (c.op === '==') return same(v, c.value);
          if (c.op === 'in') return (c.value as unknown[]).some((x) => same(v, x));
          throw new Error(`fake firestore: unsupported op ${c.op}`);
        });
      }
      for (const c of q.constraints) if (c.kind === 'limit') rows = rows.slice(0, c.n);
      return { docs: rows.map((r) => ({ id: r.id, data: () => r.data })), metadata: { fromCache: false } };
    },
  };
});

vi.mock('@/data/firebase', () => ({
  getFirebase: async () => ({ db: {} }),
  getFirebaseCore: async () => ({ db: {} }),
}));

const quietLogger = { warn: vi.fn() };

async function runBoth<T>(collection: string, docs: FakeDoc[], load: () => Promise<T>): Promise<{ before: T; after: T }> {
  fake.collections = { [collection]: docs };
  fake.ignoreWhere = true;
  const before = await load();
  fake.ignoreWhere = false;
  const after = await load();
  return { before, after };
}

// 台北 2026/11/12 12:00:00（UTC 04:00）。
const NOW = Date.UTC(2026, 10, 12, 4, 0, 0);
const MIN = 60_000;
const ts = (ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1_000_000 });

const ANNOUNCEMENTS: FakeDoc[] = [
  { id: 'a01', data: { title: '一般 A', content: 'x', status: 'active', sortOrder: 2, publishAt: '2026/11/01 10:00' } },
  { id: 'a02', data: { title: '同序 B', content: 'x', status: 'active', sortOrder: 2 } },
  { id: 'a03', data: { title: '到期剛好現在', content: 'x', status: 'active', sortOrder: 1, unpublishAt: '2026/11/12 12:00' } },
  { id: 'a04', data: { title: '晚一分到期', content: 'x', status: 'active', sortOrder: 1, unpublishAt: '2026/11/12 12:01' } },
  { id: 'a05', data: { title: 'TS 到期剛好', content: 'x', status: 'active', unpublishAt: ts(NOW) } },
  { id: 'a06', data: { title: 'TS 晚一秒', content: 'x', status: 'active', unpublishAt: ts(NOW + 1000) } },
  { id: 'a07', data: { title: '排程剛好現在', content: 'x', status: 'scheduled', sortOrder: 3, publishAt: '2026/11/12 12:00' } },
  { id: 'a08', data: { title: '排程未開始', content: 'x', status: 'scheduled', sortOrder: 3, publishAt: '2026/11/12 12:01' } },
  { id: 'a09', data: { title: '排程 UTC 字串', content: 'x', status: 'scheduled', publishAt: '2026-11-12T03:59:59Z' } },
  { id: 'a10', data: { title: '排程沒時間', content: 'x', status: 'scheduled' } },
  { id: 'a11', data: { title: '排程到點但已下架時間', content: 'x', status: 'scheduled', publishAt: '2026/11/10 09:00', unpublishAt: '2026/11/11 09:00' } },
  { id: 'a12', data: { title: '已下架', content: 'x', status: 'expired', sortOrder: 1 } },
  { id: 'a13', data: { title: '已下架但結束在未來', content: 'x', status: 'expired', unpublishAt: '2026/12/31 23:59' } },
  { id: 'a14', data: { title: '草稿', content: 'x', status: 'draft' } },
  { id: 'a15', data: { title: '停用', content: 'x', status: 'inactive' } },
  { id: 'a16', data: { title: '停用 2', content: 'x', status: 'disabled' } },
  { id: 'a17', data: { title: '字串序', content: 'x', status: 'active', sortOrder: '1' } },
  { id: 'a18', data: { title: '沒有序', content: 'x', status: 'active' } },
  { id: 'a19', data: { title: '排程 TS 剛好', content: 'x', status: 'scheduled', publishAt: ts(NOW) } },
  { id: 'a20', data: { title: '大寫狀態', content: 'x', status: 'Active' } },
  { id: 'a21', data: { title: '數字狀態', content: 'x', status: 1 } },
  { id: 'a22', data: { title: '排程 TS 晚一秒', content: 'x', status: 'scheduled', publishAt: ts(NOW + 1000) } },
];

describe('O6 公告：只讀 active／scheduled 與舊做法（讀全集合）結果相同', () => {
  it('同一份假資料：內容與順序完全一致（含同序穩定排序、過期邊界、排程未開始、草稿、停用）', async () => {
    const { before, after } = await runBoth('announcements', ANNOUNCEMENTS, () =>
      loadActiveAnnouncements({ now: () => NOW, logger: quietLogger }),
    );
    expect(after).toEqual(before);
    // 防止「兩邊都空」的假陽性：確認真的有顯示、也真的有被擋掉的項目。
    // 預期值手算：到期／排程邊界「<= 現在」算到點；sortOrder 兩段穩定排序（A 的 ||99 再 ||0），同序依文件 ID。
    expect(after.map((a) => a._docId)).toEqual(['a06', 'a09', 'a18', 'a19', 'a04', 'a17', 'a01', 'a02', 'a07']);
    expect(quietLogger.warn).not.toHaveBeenCalled();
  });

  it('時間前後掃描（11:58～12:03 每 30 秒，加上很早與很晚）每個時間點都一致', async () => {
    const points = [Date.UTC(2020, 0, 1), Date.UTC(2030, 0, 1)];
    for (let t = NOW - 2 * MIN; t <= NOW + 3 * MIN; t += 30_000) points.push(t, t - 1, t + 1);
    for (const t of points) {
      const { before, after } = await runBoth('announcements', ANNOUNCEMENTS, () =>
        loadActiveAnnouncements({ now: () => t, logger: quietLogger }),
      );
      expect(after, `now=${new Date(t).toISOString()}`).toEqual(before);
    }
  });

  describe('時區：不論執行環境 TZ，判斷都用台北時間且兩邊一致', () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      process.env.TZ = originalTz;
    });
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Taipei', 'Pacific/Kiritimati']) {
      it(tz, async () => {
        process.env.TZ = tz;
        const { before, after } = await runBoth('announcements', ANNOUNCEMENTS, () =>
          loadActiveAnnouncements({ now: () => NOW, logger: quietLogger }),
        );
        expect(after).toEqual(before);
        expect(after.map((a) => a._docId)).not.toContain('a03');
        expect(after.map((a) => a._docId)).toContain('a07');
      });
    }
  });

  it('已知邊界：status 缺欄位／null／空字串／前後空白，舊做法當成 active 顯示，新查詢讀不到（A 後台只寫字面值、B 無公告寫入端）', async () => {
    const odd: FakeDoc[] = [
      { id: 'o1', data: { title: '缺狀態', content: 'x' } },
      { id: 'o2', data: { title: 'null', content: 'x', status: null } },
      { id: 'o3', data: { title: '空字串', content: 'x', status: '' } },
      { id: 'o4', data: { title: '前後空白', content: 'x', status: ' active ' } },
    ];
    const { before, after } = await runBoth('announcements', odd, () =>
      loadActiveAnnouncements({ now: () => NOW, logger: quietLogger }),
    );
    expect(before.map((a) => a._docId)).toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(after).toEqual([]);
  });
});

const BANNERS: FakeDoc[] = [
  { id: 'b01', data: { status: 'active', title: '一', image: 'https://firebasestorage.googleapis.com/b01.jpg', linkUrl: 'https://example.com/1', slot: 1 } },
  { id: 'b02', data: { status: 'scheduled', title: '排程', publishAt: '2026/11/20 10:00' } },
  { id: 'b03', data: { status: 'expired', title: '下架' } },
  { id: 'b04', data: { status: 'empty', title: '' } },
  { id: 'b05', data: { status: 'draft', title: '草稿' } },
  { id: 'b06', data: { status: 'inactive', title: '停用' } },
  { id: 'b07', data: { status: 'active', type: 'shotgame', title: '射門遊戲' } },
  { id: 'b08', data: { status: 'active', type: 'homeInfo', title: '首頁資訊' } },
  { id: 'home-info', data: { status: 'active', title: '首頁資訊文件' } },
  { id: 'b09', data: { status: 'active', slot: 'home-layout', title: '版面' } },
  { id: 'b10', data: { status: 'active', id: 'home-info', title: 'id 欄位排除' } },
  { id: 'b11', data: { title: '缺狀態' } },
  { id: 'b12', data: { status: 'active', title: '壞連結', linkUrl: 'javascript:alert(1)', endAt: '2000-01-01T00:00:00Z', sortOrder: 9 } },
  { id: 'b2', data: { status: 'active', title: '字串序在 b12 之後', subtitle: '副', gradient: 'linear-gradient(135deg,#000,#fff)' } },
  { id: 'watch-party-bg', data: { status: 'active', type: 'watchParty', title: '觀賽' } },
  { id: 'b13', data: { status: 'active', title: '過期時間不影響（A 不看時間）', unpublishAt: '2020/01/01 00:00', publishAt: ts(NOW) } },
];

/** SDK 資料 → REST fields（只轉這份測試資料會出現的型別）。 */
function toRestFields(data: Raw): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') out[k] = restStr(v);
    else if (typeof v === 'number') out[k] = restInt(v);
    else if (v && typeof v === 'object' && 'seconds' in v) {
      out[k] = restTs(new Date((v as { seconds: number }).seconds * 1000).toISOString().replace('.000Z', 'Z'));
    }
  }
  return out;
}

/** 依 bannersRestBody() 的 structuredQuery 跑假 runQuery（文件名稱升冪；EQUAL 只比 stringValue；limit 篩選後套用）。 */
function fakeRunQuery(docs: FakeDoc[], ignoreWhere: boolean): unknown[] {
  const q = (JSON.parse(bannersRestBody()) as {
    structuredQuery: {
      from: Array<{ collectionId: string }>;
      where?: { fieldFilter: { field: { fieldPath: string }; op: string; value: { stringValue?: string } } };
      limit: number;
    };
  }).structuredQuery;
  expect(q.from).toEqual([{ collectionId: 'banners' }]);
  let rows = [...docs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((d) => restDoc(d.id, toRestFields(d.data)));
  if (q.where && !ignoreWhere) {
    const f = q.where.fieldFilter;
    expect(f.op).toBe('EQUAL');
    rows = rows.filter((r) => {
      const doc = (r as { document: { fields?: Record<string, { stringValue?: unknown }> } }).document;
      const field = (doc.fields ?? {})[f.field.fieldPath];
      return typeof field?.stringValue === 'string' && field.stringValue === f.value.stringValue;
    });
  }
  // restDoc 已是 runQuery 回應元素（{ document, readTime }）。
  return rows.slice(0, q.limit);
}

describe('O6 橫幅：只讀 status == active 與舊做法（limit 200 不分狀態）結果相同', () => {
  it('SDK 路徑：內容與順序完全一致（排程、下架、空白、草稿、停用、特殊文件、文件 ID 字串序）', async () => {
    const { before, after } = await runBoth('banners', BANNERS, () => loadActiveBanners({ logger: quietLogger }));
    expect(after).toEqual(before);
    expect(after.map((b) => b._docId)).toEqual(['b01', 'b12', 'b13', 'b2']);
    expect(quietLogger.warn).not.toHaveBeenCalled();
  });

  it('REST 路徑（banners-rest.ts 與 index.html 同一個 body）：內容與順序完全一致，且與 SDK 路徑相同', async () => {
    const before = parseRunQueryResponse(fakeRunQuery(BANNERS, true));
    const after = parseRunQueryResponse(fakeRunQuery(BANNERS, false));
    expect(after).not.toBeNull();
    expect(after).toEqual(before);
    expect(after?.map((b) => b._docId)).toEqual(['b01', 'b12', 'b13', 'b2']);
    fake.collections = { banners: BANNERS };
    fake.ignoreWhere = false;
    const sdk = await loadActiveBanners({ logger: quietLogger });
    expect(after?.map((b) => b._docId)).toEqual(sdk.map((b) => b._docId));
  });

  it('剛好 200 筆（多數非 active、active 散在各處）仍一致', async () => {
    const statuses = ['expired', 'active', 'empty', 'scheduled', 'draft'];
    const docs: FakeDoc[] = Array.from({ length: 200 }, (_, i) => ({
      id: `x${String(i).padStart(3, '0')}`,
      data: { status: statuses[i % statuses.length], title: `t${i}` },
    }));
    const { before, after } = await runBoth('banners', docs, () => loadActiveBanners({ logger: quietLogger }));
    expect(after).toEqual(before);
    expect(after).toHaveLength(40);
    expect(parseRunQueryResponse(fakeRunQuery(docs, false))).toEqual(parseRunQueryResponse(fakeRunQuery(docs, true)));
  });

  it('已知邊界：status 前後空白舊做法會顯示、新查詢讀不到；集合超過 200 筆時舊做法會截掉後面的 active、新查詢不會（A／B 後台只寫字面值，正式集合遠少於 200 筆）', async () => {
    const padded: FakeDoc[] = [{ id: 'p1', data: { status: ' active', title: '空白' } }];
    const r1 = await runBoth('banners', padded, () => loadActiveBanners({ logger: quietLogger }));
    expect(r1.before.map((b) => b._docId)).toEqual(['p1']);
    expect(r1.after).toEqual([]);

    const many: FakeDoc[] = Array.from({ length: 210 }, (_, i) => ({
      id: `y${String(i).padStart(3, '0')}`,
      data: { status: i < 205 ? 'expired' : 'active', title: `t${i}` },
    }));
    const r2 = await runBoth('banners', many, () => loadActiveBanners({ logger: quietLogger }));
    expect(r2.before).toEqual([]);
    expect(r2.after).toHaveLength(5);
  });
});

beforeEach(() => {
  quietLogger.warn.mockClear();
  fake.collections = {};
  fake.ignoreWhere = false;
});
