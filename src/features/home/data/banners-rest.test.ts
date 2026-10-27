import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { collection, getDocs, limit, query, type Firestore } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import { FIREBASE_CONFIG } from '@/data/firebase-config';
import { BANNERS_COLLECTION, loadActiveBanners, type BannerDoc } from './banners';
import {
  BANNERS_REST_MAX_BYTES,
  BANNERS_REST_TIMEOUT_MS,
  _resetBannersRestForTest,
  bannersRestBody,
  bannersRestUrl,
  fetchBannersViaRest,
  parseRunQueryResponse,
  startBannersRestFetch,
} from './banners-rest';
import { toPublicBanners } from './home-snapshot';
import {
  fakeResponse,
  jsonResponse,
  restActiveFields,
  restArray,
  restBool,
  restDoc,
  restDocName,
  restDouble,
  restEmptyMarker,
  restInt,
  restMap,
  restNull,
  restStr,
  restTs,
  splitBytes,
} from './__fixtures__/banners-rest';

// T-042c：冷啟動橫幅清單的 REST 讀取。測試一律用假的 fetch，不對任何線上端點發請求（src/test-setup.ts 另有全域守門）。

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  limit: vi.fn((n: number) => ({ kind: 'limit', n })),
  getDocs: vi.fn(),
}));

// 只換掉 getFirebase（SDK 路徑的 parity 對照用）；其餘匯出維持原樣，home-snapshot 的相依圖才不會缺匯出。
vi.mock('@/data/firebase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/firebase')>()),
  getFirebase: vi.fn(),
}));

const fakeDb = { name: 'mock-db' } as unknown as Firestore;

let errorSpy: MockInstance<typeof console.error>;
let warnSpy: MockInstance<typeof console.warn>;
let debugSpy: MockInstance<typeof console.debug>;

beforeEach(() => {
  vi.resetAllMocks();
  _resetBannersRestForTest();
  vi.mocked(getFirebase).mockResolvedValue({ db: fakeDb } as Awaited<ReturnType<typeof getFirebase>>);
  vi.mocked(collection).mockReturnValue('banners-col-ref' as unknown as ReturnType<typeof collection>);
  vi.mocked(query).mockImplementation((ref) => ref as unknown as ReturnType<typeof query>);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const ONE_DOC = [restDoc('b1', restActiveFields({ title: restStr('標題一') }))];

function mockFetch(make: () => Promise<Response> | Response): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async () => make());
}

/** startBannersRestFetch 每次頁面載入只發一次；這裡的案例都是「第一次呼叫」，拿不到就是測試前置錯了。 */
function startOrFail(options: Parameters<typeof startBannersRestFetch>[0]): NonNullable<ReturnType<typeof startBannersRestFetch>> {
  const request = startBannersRestFetch(options);
  if (!request) throw new Error('startBannersRestFetch 回傳 null（旗標沒有重設？）');
  return request;
}

function firstCall(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>): { url: string; init: RequestInit } {
  const call = fetchImpl.mock.calls[0];
  if (!call) throw new Error('fetch 沒有被呼叫');
  return { url: String(call[0]), init: call[1] ?? {} };
}

describe('請求內容：匿名、公開讀取、與 SDK 路徑同一個查詢', () => {
  it('POST runQuery：網址、body（collectionId＋limit 200）、credentials omit', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(ONE_DOC).response);
    const result = await fetchBannersViaRest({ fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url, init } = firstCall(fetchImpl);
    expect(url).toBe(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:runQuery`,
    );
    expect(url).toBe(bannersRestUrl());
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    // text/plain＝跨來源簡單請求，不觸發 CORS preflight（Firestore SDK 對同一端點的做法）；body 仍是 JSON 字串。
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain' });
    expect(JSON.parse(String(init.body))).toEqual({
      structuredQuery: { from: [{ collectionId: 'banners' }], limit: 200 },
    });
    expect(String(init.body)).toBe(bannersRestBody());
    expect(result?.map((b) => b.id)).toEqual(['b1']);
  });

  it('與 SDK 路徑同一個查詢：同一個集合名稱常數與 limit(200)', async () => {
    vi.mocked(getDocs).mockResolvedValue({ docs: [], metadata: { fromCache: false } } as unknown as Awaited<ReturnType<typeof getDocs>>);
    await loadActiveBanners({ getFirebase: async () => ({ db: fakeDb }) });
    const sdkLimit = vi.mocked(limit).mock.calls[0]?.[0];
    const sdkCollection = vi.mocked(collection).mock.calls[0]?.[1];

    const body = JSON.parse(bannersRestBody()) as { structuredQuery: { from: Array<{ collectionId: string }>; limit: number } };
    expect(body.structuredQuery.limit).toBe(sdkLimit);
    expect(body.structuredQuery.from[0]?.collectionId).toBe(sdkCollection);
    expect(sdkCollection).toBe(BANNERS_COLLECTION);
  });

  it('不帶任何憑證：標頭只有 Content-Type、沒有 Authorization／x-goog-api-key；網址、標頭、body 都沒有 API key', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(ONE_DOC).response);
    await fetchBannersViaRest({ fetchImpl });
    const { url, init } = firstCall(fetchImpl);

    const headerNames = Object.keys((init.headers ?? {}) as Record<string, string>).map((k) => k.toLowerCase());
    expect(headerNames).toEqual(['content-type']);
    expect(headerNames).not.toContain('authorization');
    expect(headerNames).not.toContain('x-goog-api-key');
    expect(url).not.toMatch(/[?&]key=/i);
    expect(url).not.toContain('?');
    expect(JSON.stringify([url, init])).not.toContain(FIREBASE_CONFIG.apiKey);
    // 只有 credentials: 'omit'（不帶 cookie）；沒有 withCredentials 之類的旁路。
    expect(init.credentials).toBe('omit');
  });

  it('預設用全域 fetch（沒注入時）', async () => {
    const stub = mockFetch(() => jsonResponse(ONE_DOC).response);
    vi.stubGlobal('fetch', stub);
    try {
      expect((await fetchBannersViaRest())?.map((b) => b.id)).toEqual(['b1']);
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('回應映射：成功、空結果、略過、損毀、未知欄位、型別不符', () => {
  it('成功：映射成 BannerDoc，只留 active，保留查詢順序', async () => {
    const payload = [
      restDoc('b1', restActiveFields({ title: restStr('第一張'), image: restStr('https://example.com/b1.jpg') })),
      restDoc('b2', restActiveFields({ title: restStr('第二張'), linkUrl: restStr('https://example.com/go') })),
      restDoc('draft', { status: restStr('draft'), title: restStr('草稿') }),
    ];
    const result = await fetchBannersViaRest({ fetchImpl: mockFetch(() => jsonResponse(payload).response) });
    expect(result?.map((b) => [b.id, b._docId, b.status, b.title])).toEqual([
      ['b1', 'b1', 'active', '第一張'],
      ['b2', 'b2', 'active', '第二張'],
    ]);
    expect(result?.[0]?.image).toBe('https://example.com/b1.jpg');
    expect(result?.[1]?.linkUrl).toBe('https://example.com/go');
  });

  it('空結果（只有 readTime 的標記元素）→ 空陣列，不是 null', () => {
    expect(parseRunQueryResponse([restEmptyMarker()])).toEqual([]);
    expect(parseRunQueryResponse([])).toEqual([]);
  });

  it('沒有 document 的元素略過，其餘照常映射', () => {
    const result = parseRunQueryResponse([
      restEmptyMarker(),
      restDoc('b1', restActiveFields({ title: restStr('A') })),
      { readTime: 'x', skippedResults: 3 },
      null,
      42,
      restDoc('b2', restActiveFields({ title: restStr('B') })),
    ]);
    expect(result?.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('單筆損毀只丟該筆（name 格式錯、fields 不是物件、document 不是物件、欄位值損毀）', () => {
    const goodBefore = restDoc('good-1', restActiveFields({ title: restStr('前') }));
    const goodAfter = restDoc('good-2', restActiveFields({ title: restStr('後') }));
    const result = parseRunQueryResponse([
      goodBefore,
      { document: { name: 'banners/short', fields: restActiveFields() } },
      { document: { name: 'projects/p/databases/(default)/documents/events/e1', fields: restActiveFields() } },
      { document: { name: 'projects/p/databases/(default)/documents/banners/x/sub/y', fields: restActiveFields() } },
      { document: { name: 'projects/p/databases/(default)/documents/banners/', fields: restActiveFields() } },
      { document: { name: 12345, fields: restActiveFields() } },
      { document: 'oops' },
      restDoc('empty-fields', {}),
      { document: { name: restDocName('bad-fields'), fields: 'not-an-object' } },
      { document: { name: restDocName('weird-value'), fields: { status: 'raw-string', title: { stringValue: 7 } } } },
      goodAfter,
    ]);
    expect(result?.map((b) => b.id)).toEqual(['good-1', 'good-2']);
  });

  it('未知欄位一律丟棄（不會出現在輸出，也不會被序列化進去）', () => {
    const result = parseRunQueryResponse([
      restDoc(
        'b1',
        restActiveFields({
          title: restStr('標題'),
          uid: restStr('U-secret-123'),
          email: restStr('a@example.com'),
          createdBy: restMap({ uid: restStr('U-nested-456') }),
          extra: restArray([restStr('x')]),
          nested: restMap({ deep: restStr('y') }),
        }),
      ),
    ]);
    const banner = result?.[0] as BannerDoc;
    const keys = Object.keys(banner);
    for (const bad of ['uid', 'email', 'createdBy', 'extra', 'nested']) expect(keys).not.toContain(bad);
    const text = JSON.stringify(banner);
    for (const secret of ['U-secret-123', 'a@example.com', 'U-nested-456', 'deep']) expect(text).not.toContain(secret);
    expect(banner.title).toBe('標題');
  });

  it('欄位型別不符丟棄該欄位（其餘欄位照常）', () => {
    const result = parseRunQueryResponse([
      restDoc(
        'b1',
        restActiveFields({
          title: restInt(5),
          subtitle: restBool(true),
          image: restInt(1),
          linkUrl: restMap({ a: restStr('https://example.com') }),
          titleColor: restNull(),
          sortOrder: restBool(true),
          slot: restArray([restInt(1)]),
          subtitleColor: restInt('12abc'),
          gradient: restDouble(1.5),
          slotName: restStr('hero'),
        }),
      ),
    ]);
    const b = result?.[0] as BannerDoc;
    expect(b.title).toBeUndefined();
    expect(b.subtitle).toBeUndefined();
    expect(b.image).toBe('');
    expect(b.linkUrl).toBe('');
    expect(b.titleColor).toBeUndefined();
    expect(b.subtitleColor).toBeUndefined(); // integerValue 不是十進位整數字串 → 當作沒有這個欄位（不是 NaN）
    expect(b.sortOrder).toBeUndefined();
    expect(b.slot).toBeUndefined();
    expect(b.gradient).toBeUndefined();
    expect(b.slotName).toBe('hero');
  });

  it('危險連結與圖片網址沿用既有白名單（javascript:、data:、ftp: 一律變空字串）', () => {
    const result = parseRunQueryResponse([
      restDoc('b1', restActiveFields({ linkUrl: restStr('javascript:alert(1)'), image: restStr('data:image/png;base64,AAAA') })),
      restDoc('b2', restActiveFields({ linkUrl: restStr('//evil.example/x'), image: restStr('ftp://example.com/a.png') })),
    ]);
    expect(result?.map((b) => [b.linkUrl, b.image])).toEqual([
      ['', ''],
      ['', ''],
    ]);
  });

  it('巢狀穿透欄位的 __proto__ 鍵被丟掉，不會污染原型', () => {
    // 值是物件：若沒被丟掉，賦值給 __proto__ 會真的換掉結果物件的原型（字串值則會被引擎默默忽略，測不出來）。
    const polluted = Object.fromEntries([
      ['__proto__', restMap({ inherited: restStr('yes') })],
      ['seconds', restInt(7)],
    ]);
    const result = parseRunQueryResponse([restDoc('b1', restActiveFields({ startAt: restMap(polluted) }))]);
    const startAt = result?.[0]?.startAt as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(startAt, '__proto__')).toBe(false);
    expect(startAt.seconds).toBe(7);
    expect(Object.getPrototypeOf(startAt)).toBe(Object.prototype);
    expect(startAt.inherited).toBeUndefined();
    expect(({} as Record<string, unknown>).inherited).toBeUndefined();
  });

  it('timestampValue → { seconds, nanoseconds }（Z、小數、時區位移；格式不符則丟棄該欄位）', () => {
    const at = (iso: string): unknown => {
      const r = parseRunQueryResponse([restDoc('b1', restActiveFields({ startAt: restTs(iso) }))]);
      return r?.[0]?.startAt;
    };
    expect(at('1970-01-01T00:00:00Z')).toEqual({ seconds: 0, nanoseconds: 0 });
    expect(at('2026-10-21T08:00:00Z')).toEqual({ seconds: Date.UTC(2026, 9, 21, 8, 0, 0) / 1000, nanoseconds: 0 });
    expect(at('2026-10-21T08:00:00.5Z')).toEqual({ seconds: Date.UTC(2026, 9, 21, 8, 0, 0) / 1000, nanoseconds: 500_000_000 });
    expect(at('2026-12-31T15:59:59.123456789Z')).toEqual({ seconds: Date.UTC(2026, 11, 31, 15, 59, 59) / 1000, nanoseconds: 123_456_789 });
    expect(at('2026-10-21T16:00:00+08:00')).toEqual({ seconds: Date.UTC(2026, 9, 21, 8, 0, 0) / 1000, nanoseconds: 0 });
    expect(at('2026-10-21T02:30:00-05:30')).toEqual({ seconds: Date.UTC(2026, 9, 21, 8, 0, 0) / 1000, nanoseconds: 0 });
    expect(at('2026-10-21T08:00:00')).toBeUndefined();
    expect(at('not-a-date')).toBeUndefined();
    expect(at('')).toBeUndefined();
  });

  it('整體格式不符回 null：不是陣列、含 error 元素', () => {
    expect(parseRunQueryResponse({})).toBeNull();
    expect(parseRunQueryResponse(null)).toBeNull();
    expect(parseRunQueryResponse('[]')).toBeNull();
    expect(parseRunQueryResponse([restDoc('b1', restActiveFields()), { error: { code: 403, message: 'denied' } }])).toBeNull();
  });

  it('最多處理 200 筆文件（與 limit 一致，多的丟棄）', () => {
    const docs = Array.from({ length: 230 }, (_, i) => restDoc(`b${i}`, restActiveFields({ title: restStr(`t${i}`) })));
    expect(parseRunQueryResponse(docs)?.length).toBe(200);
  });
});

describe('與 SDK 路徑的 parity（同一批樣本，經 REST 映射與經 SDK mapBannerDoc 映射，結果相同）', () => {
  const SPECIAL = '<script>alert("x")</script> & \'引號\' 🎉 中文 \\ 換\n行';
  const sec = (y: number, mo: number, d: number, h: number, mi: number, s: number): number =>
    Date.UTC(y, mo - 1, d, h, mi, s) / 1000;

  interface Sample {
    id: string;
    rest: Record<string, unknown>;
    sdk: Record<string, unknown>;
  }

  const SAMPLES: Sample[] = [
    {
      id: 'b1',
      rest: {
        status: restStr('active'),
        type: restStr('ad'),
        title: restStr(SPECIAL),
        subtitle: restStr('副標題'),
        titleColor: restStr('#112233'),
        subtitleColor: restStr('#445566'),
        image: restStr('https://example.com/x.jpg?a=1&b=2'),
        linkUrl: restStr('https://example.com/go?x=%E4%B8%AD'),
        slotName: restStr('hero'),
        slot: restInt(3),
        sortOrder: restInt(10),
        gradient: restStr('linear-gradient(135deg,#111111,#222222)'),
        startAt: restTs('2026-10-21T08:00:00Z'),
        endAt: restTs('2026-12-31T15:59:59.123456789Z'),
        publishAt: restStr('2026/10/01 08:00'),
        unpublishAt: restTs('2026-12-31T23:59:59+08:00'),
        uid: restStr('U-should-be-ignored'),
      },
      sdk: {
        status: 'active',
        type: 'ad',
        title: SPECIAL,
        subtitle: '副標題',
        titleColor: '#112233',
        subtitleColor: '#445566',
        image: 'https://example.com/x.jpg?a=1&b=2',
        linkUrl: 'https://example.com/go?x=%E4%B8%AD',
        slotName: 'hero',
        slot: 3,
        sortOrder: 10,
        gradient: 'linear-gradient(135deg,#111111,#222222)',
        startAt: { seconds: sec(2026, 10, 21, 8, 0, 0), nanoseconds: 0 },
        endAt: { seconds: sec(2026, 12, 31, 15, 59, 59), nanoseconds: 123_456_789 },
        publishAt: '2026/10/01 08:00',
        unpublishAt: { seconds: sec(2026, 12, 31, 15, 59, 59), nanoseconds: 0 },
        uid: 'U-should-be-ignored',
      },
    },
    {
      id: 'b2',
      rest: { status: restStr('active'), sortOrder: restStr('2'), slot: restStr('home-main') },
      sdk: { status: 'active', sortOrder: '2', slot: 'home-main' },
    },
    {
      id: 'b3',
      rest: { id: restStr('custom-id'), status: restStr(' active '), title: restStr('欄位 id 覆蓋文件 id') },
      sdk: { id: 'custom-id', status: ' active ', title: '欄位 id 覆蓋文件 id' },
    },
    { id: 'b4', rest: { status: restStr('draft'), title: restStr('草稿') }, sdk: { status: 'draft', title: '草稿' } },
    {
      id: 'b5',
      rest: { status: restStr('active'), linkUrl: restStr('javascript:alert(1)'), image: restStr('ftp://x/y.png') },
      sdk: { status: 'active', linkUrl: 'javascript:alert(1)', image: 'ftp://x/y.png' },
    },
    { id: 'b6', rest: { status: restStr('active'), type: restStr('shotgame') }, sdk: { status: 'active', type: 'shotgame' } },
    { id: 'home-info', rest: { status: restStr('active'), title: restStr('首頁資訊') }, sdk: { status: 'active', title: '首頁資訊' } },
    {
      id: 'b8',
      rest: {
        status: restStr('active'),
        sortOrder: restDouble(2.5),
        slot: restDouble(1.5),
        title: restNull(),
        subtitle: restBool(true),
      },
      sdk: { status: 'active', sortOrder: 2.5, slot: 1.5, title: null, subtitle: true },
    },
    {
      id: 'banner 中文-1',
      rest: { status: restStr('active'), title: restStr('含空白與中文的文件 ID') },
      sdk: { status: 'active', title: '含空白與中文的文件 ID' },
    },
    {
      id: 'b10',
      rest: { status: restStr('active'), titleColor: restStr('#abc'), subtitleColor: restStr('red') },
      sdk: { status: 'active', titleColor: '#abc', subtitleColor: 'red' },
    },
    {
      id: 'b12',
      rest: { status: restStr('active'), sortOrder: restDouble('Infinity'), slot: restDouble('NaN') },
      sdk: { status: 'active', sortOrder: Number.POSITIVE_INFINITY, slot: Number.NaN },
    },
    { id: 'b13', rest: {}, sdk: {} },
  ];

  async function viaSdk(): Promise<BannerDoc[]> {
    vi.mocked(getDocs).mockResolvedValue({
      docs: SAMPLES.map((s) => ({ id: s.id, data: () => s.sdk })),
      metadata: { fromCache: false },
    } as unknown as Awaited<ReturnType<typeof getDocs>>);
    return loadActiveBanners({ getFirebase: async () => ({ db: fakeDb }) });
  }

  const restPayload = (): unknown[] => [
    restEmptyMarker(),
    ...SAMPLES.map((s) => restDoc(s.id, s.rest)),
  ];

  it('過 filterAndSortBanners 後，REST 與 SDK 的結果逐筆相同（含 timestamp、缺欄位、特殊字元、sortOrder 字串／數字、特殊文件 ID）', async () => {
    const sdk = await viaSdk();
    const rest = await fetchBannersViaRest({ fetchImpl: mockFetch(() => jsonResponse(restPayload()).response) });

    // 非空洞比對：被篩掉與留下的都有。
    expect(sdk.map((b) => b.id)).toEqual(['b1', 'b2', 'custom-id', 'b5', 'b8', 'banner 中文-1', 'b10', 'b12']);
    expect(rest).toEqual(sdk);
    expect(rest?.map((b) => b._docId)).toEqual(sdk.map((b) => b._docId));
  });

  it('寫進首屏快照的內容也相同（toPublicBanners 白名單投影後逐筆相同）', async () => {
    const sdk = await viaSdk();
    const rest = (await fetchBannersViaRest({ fetchImpl: mockFetch(() => jsonResponse(restPayload()).response) })) ?? [];
    expect([...toPublicBanners(rest)]).toEqual([...toPublicBanners(sdk)]);
    expect(toPublicBanners(rest).length).toBeGreaterThan(0);
  });
});

describe('失敗一律回 null（絕不丟錯、不重試、不 console.error）', () => {
  it.each([
    ['401', () => jsonResponse([], { status: 401 })],
    ['403', () => jsonResponse([{ error: { code: 403 } }], { status: 403 })],
    ['429', () => jsonResponse([], { status: 429 })],
    ['500', () => jsonResponse([], { status: 500 })],
    ['503', () => jsonResponse([], { status: 503 })],
    ['JSON 損毀', () => fakeResponse('[{"document":')],
    ['不是 JSON', () => fakeResponse('<html>captive portal</html>')],
    ['空回應', () => fakeResponse('')],
    ['只有空白', () => fakeResponse('   \n')],
    ['JSON 但不是陣列（物件）', () => jsonResponse({ documents: [] })],
    ['JSON null', () => fakeResponse('null')],
    ['陣列裡有 error 元素', () => jsonResponse([{ error: { code: 14, message: 'unavailable' } }])],
  ])('非預期回應：%s', async (_name, make) => {
    const fetchImpl = mockFetch(() => make().response);
    expect(await fetchBannersViaRest({ fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith('[banners-rest] fallback to SDK');
  });

  it('網路錯誤（fetch 被拒絕）→ null，固定文字的 debug，沒有 error／warn', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await fetchBannersViaRest({ fetchImpl })).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith('[banners-rest] fallback to SDK');
  });

  it('全域 fetch 不存在（舊 WebView）→ null', async () => {
    vi.stubGlobal('fetch', undefined);
    try {
      expect(await fetchBannersViaRest()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('AbortError（被中止）→ null，不當錯誤', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    expect(await fetchBannersViaRest({ fetchImpl })).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('呼叫端取消（畫面卸載）：已經取消就不發請求；請求中取消就放棄', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const never = vi.fn<typeof fetch>();
    expect(await fetchBannersViaRest({ fetchImpl: never, signal: aborted.signal })).toBeNull();
    expect(never).not.toHaveBeenCalled();

    let signal: AbortSignal | undefined;
    const request = startOrFail({
      fetchImpl: vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init?.signal ?? undefined;
            signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    });
    expect(signal?.aborted).toBe(false);
    request.cancel();
    expect(signal?.aborted).toBe(true);
    expect(await request.result).toBeNull();
  });
});

describe('4 秒逾時真的生效', () => {
  function hangingFetch(): { fetchImpl: typeof fetch; signalOf: () => AbortSignal | undefined } {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    return { fetchImpl, signalOf: () => signal };
  }

  it('逾時常數是 4000 ms；3999 ms 時還在等，到 4000 ms 就放棄並中止請求', async () => {
    expect(BANNERS_REST_TIMEOUT_MS).toBe(4000);
    vi.useFakeTimers();
    const { fetchImpl, signalOf } = hangingFetch();
    const settled = vi.fn();
    const pending = fetchBannersViaRest({ fetchImpl }).then(settled);

    await vi.advanceTimersByTimeAsync(BANNERS_REST_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    expect(signalOf()?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith(null);
    expect(signalOf()?.aborted).toBe(true);
    await pending;
  });

  it('即使 fetch 完全不理會 signal，到時間也會放棄（不會永遠卡住）', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    const settled = vi.fn();
    const pending = fetchBannersViaRest({ fetchImpl }).then(settled);
    await vi.advanceTimersByTimeAsync(BANNERS_REST_TIMEOUT_MS);
    expect(settled).toHaveBeenCalledWith(null);
    await pending;
  });

  it('標頭到了、本文卻一直讀不完，一樣在 4 秒放棄', async () => {
    vi.useFakeTimers();
    const handle = fakeResponse('[]');
    handle.read.mockImplementation(() => new Promise(() => undefined));
    const fetchImpl = mockFetch(() => handle.response);
    const settled = vi.fn();
    const pending = fetchBannersViaRest({ fetchImpl }).then(settled);
    await vi.advanceTimersByTimeAsync(BANNERS_REST_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith(null);
    await pending;
  });

  it('成功時清掉計時器（不留下待執行的計時器）', async () => {
    vi.useFakeTimers();
    const fetchImpl = mockFetch(() => jsonResponse(ONE_DOC).response);
    const pending = fetchBannersViaRest({ fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending)?.map((b) => b.id)).toEqual(['b1']);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('256 KB 回應大小上限真的生效', () => {
  const MAX = BANNERS_REST_MAX_BYTES;
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

  /** 合法 JSON，後面補空白到剛好 `bytes` 個位元組。 */
  function paddedPayload(bytes: number): string {
    const base = JSON.stringify([restDoc('b1', restActiveFields({ title: restStr('剛好') }))]);
    const used = encode(base).length;
    if (used > bytes) throw new Error('樣本太大');
    return base + ' '.repeat(bytes - used);
  }

  it('上限是 256 KB', () => {
    expect(MAX).toBe(256 * 1024);
  });

  it('標頭宣告的 Content-Length 超過上限：直接丟棄，連本文都不讀', async () => {
    const handle = jsonResponse(ONE_DOC, { headers: { 'Content-Length': String(MAX + 1) } });
    expect(await fetchBannersViaRest({ fetchImpl: mockFetch(() => handle.response) })).toBeNull();
    expect(handle.read).not.toHaveBeenCalled();
    expect(handle.text).not.toHaveBeenCalled();
  });

  it('沒有 Content-Length、串流讀到超過上限：取消讀取並丟棄', async () => {
    const chunk = 64 * 1024;
    const bytes = encode(paddedPayload(chunk * 5));
    const handle = fakeResponse(splitBytes(bytes, chunk));
    expect(await fetchBannersViaRest({ fetchImpl: mockFetch(() => handle.response) })).toBeNull();
    expect(handle.cancel).toHaveBeenCalledTimes(1);
    // 讀到第 5 個 chunk（累計 320 KB > 256 KB）就停，沒有把剩下的讀完。
    expect(handle.read.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('剛好 256 KB 可以通過；多 1 個位元組就丟棄（邊界）', async () => {
    const exact = fakeResponse(splitBytes(encode(paddedPayload(MAX)), 50_000));
    expect(
      (await fetchBannersViaRest({ fetchImpl: mockFetch(() => exact.response) }))?.map((b) => b.id),
    ).toEqual(['b1']);

    const over = fakeResponse(splitBytes(encode(paddedPayload(MAX + 1)), 50_000));
    expect(await fetchBannersViaRest({ fetchImpl: mockFetch(() => over.response) })).toBeNull();
    expect(over.cancel).toHaveBeenCalled();
  });

  it('沒有串流介面（舊 WebView）時改讀 text()，一樣量位元組：中文每字 3 位元組，字數沒超過但位元組超過也丟棄', async () => {
    const fits = fakeResponse(paddedPayload(MAX), { noStream: true });
    expect((await fetchBannersViaRest({ fetchImpl: mockFetch(() => fits.response) }))?.length).toBe(1);

    const base = JSON.stringify([restDoc('b1', restActiveFields({ title: restStr('中'.repeat(90_000)) }))]);
    expect(base.length).toBeLessThan(MAX); // 字數沒超過
    expect(encode(base).length).toBeGreaterThan(MAX); // 位元組超過
    const heavy = fakeResponse(base, { noStream: true });
    expect(await fetchBannersViaRest({ fetchImpl: mockFetch(() => heavy.response) })).toBeNull();
  });

  it('多位元組字元被切在 chunk 邊界也能正確還原', async () => {
    const payload = JSON.stringify([restDoc('b1', restActiveFields({ title: restStr('中文標題🎉測試') }))]);
    const handle = fakeResponse(splitBytes(encode(payload), 7));
    const result = await fetchBannersViaRest({ fetchImpl: mockFetch(() => handle.response) });
    expect(result?.[0]?.title).toBe('中文標題🎉測試');
  });
});

describe('startBannersRestFetch', () => {
  it('result 永遠 resolve（失敗＝null）；cancel 後請求被中止', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const request = startOrFail({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);
    request.cancel();
    expect(signal?.aborted).toBe(true);
    await expect(request.result).resolves.toBeNull();
  });

  it('成功時 result 是清單', async () => {
    const request = startOrFail({ fetchImpl: mockFetch(() => jsonResponse(ONE_DOC).response) });
    expect((await request.result)?.map((b) => b.id)).toEqual(['b1']);
  });

  it('每次頁面載入只發一次：第二次呼叫回 null、不再發請求；第一次失敗也不重試', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const first = startBannersRestFetch({ fetchImpl });
    expect(first).not.toBeNull();
    expect(await first?.result).toBeNull(); // 第一次失敗

    expect(startBannersRestFetch({ fetchImpl })).toBeNull();
    expect(startBannersRestFetch({ fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('旗標只由測試用的重設函式清掉（等於一次新的頁面載入）', () => {
    const fetchImpl = mockFetch(() => jsonResponse(ONE_DOC).response);
    expect(startBannersRestFetch({ fetchImpl })).not.toBeNull();
    expect(startBannersRestFetch({ fetchImpl })).toBeNull();
    _resetBannersRestForTest();
    expect(startBannersRestFetch({ fetchImpl })).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('模組重新載入（新的頁面載入）時旗標是全新的：不需要任何重設匯出', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(ONE_DOC).response);
    expect(startBannersRestFetch({ fetchImpl })).not.toBeNull();
    expect(startBannersRestFetch({ fetchImpl })).toBeNull();
    vi.resetModules();
    const fresh = await import('./banners-rest');
    expect(fresh.startBannersRestFetch({ fetchImpl })).not.toBeNull();
    expect(fresh.startBannersRestFetch({ fetchImpl })).toBeNull();
  });
});

describe('靜態檢查：REST 模組只 import firebase-config，不碰 firebase.ts 與 firebase/*', () => {
  const source = readFileSync(join(__dirname, 'banners-rest.ts'), 'utf8');
  // 去掉區塊註解與整行註解（說明文字會提到這些名稱）；字串裡的 // 不受影響（只刪整行以 // 開頭的行）。
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');

  function staticSpecs(text: string): string[] {
    const specs: string[] = [];
    for (const m of text.matchAll(/^\s*import\b(?!\s*\()[^;]*?\bfrom\s*(['"])([^'"]+)\1/gm)) specs.push(m[2] ?? '');
    for (const m of text.matchAll(/^\s*import\s*(['"])([^'"]+)\1/gm)) specs.push(m[2] ?? '');
    for (const m of text.matchAll(/^\s*export\b[^;]*?\bfrom\s*(['"])([^'"]+)\1/gm)) specs.push(m[2] ?? '');
    return specs;
  }

  it('靜態 import 只有 firebase-config 與同資料夾的 banners（共用映射）', () => {
    expect(staticSpecs(code).sort()).toEqual(['./banners', '@/data/firebase-config']);
  });

  it('沒有 firebase/*、@firebase/*、data/firebase 的 import（含動態 import）', () => {
    const specs = [...staticSpecs(code), ...Array.from(code.matchAll(/\bimport\s*\(\s*(['"`])([^'"`]+)\1/g), (m) => m[2] ?? '')];
    for (const spec of specs) {
      expect(spec).not.toMatch(/^@?firebase(\/|$)/);
      expect(spec).not.toBe('@/data/firebase');
      expect(spec).not.toMatch(/(^|\/)firebase$/);
    }
  });

  it('程式碼本身不出現 apiKey、key=、Authorization、x-goog-api-key、console.error', () => {
    for (const forbidden of [/apiKey/i, /[?&]key=/i, /authorization/i, /x-goog-api-key/i, /console\.(error|warn)/]) {
      expect(code, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it('firebase-config.ts 本身沒有任何 import（不會把 SDK 帶進入口）', () => {
    const config = readFileSync(join(__dirname, '..', '..', '..', 'data', 'firebase-config.ts'), 'utf8');
    expect(config.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/^\s*(import|export\s[^=]*\sfrom)\b/m);
  });
});
