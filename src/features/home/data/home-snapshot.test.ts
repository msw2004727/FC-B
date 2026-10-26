import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '@/version';
import type { BannerDoc } from './banners';
import { guestRowsOf } from './__fixtures__/guest-rows';
import { computeSportRows } from './sport-rows';
import {
  BANNERS_SNAPSHOT_KEY,
  HOME_SNAPSHOT_MAX_AGE_MS,
  HOME_SNAPSHOT_MAX_CHARS,
  SPORTS_SNAPSHOT_KEY,
  _clearHomeSnapshotForTest,
  readBannersSnapshot,
  projectBanner,
  projectSportItem,
  readSportsSnapshot,
  toPublicBanners,
  writeBannersSnapshot,
  writeSportsSnapshot,
} from './home-snapshot';

const NOW = Date.UTC(2026, 9, 27, 3, 0, 0);

function banner(partial: Partial<BannerDoc> & { id: string }): BannerDoc {
  return { _docId: partial.id, status: 'active', ...partial };
}

/** 寫橫幅快照的唯一合法來源是白名單映射（toPublicBanners）。 */
function putBanners(list: BannerDoc[], nowMs: number): void {
  writeBannersSnapshot(toPublicBanners(list), nowMs);
}

function putRaw(key: string, entry: Record<string, unknown>): void {
  localStorage.setItem(key, JSON.stringify(entry));
}

beforeEach(() => {
  _clearHomeSnapshotForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
  _clearHomeSnapshotForTest();
});

describe('橫幅快照', () => {
  it('寫入後在 30 分鐘內讀得回來，只留畫面用得到的欄位，並帶到期時間', () => {
    putBanners([
        {
          ...banner({
            id: 'b1',
            title: '週末熱血開踢',
            subtitle: '立即加入',
            titleColor: '#ffffff',
            image: 'https://firebasestorage.googleapis.com/v0/b/x/o/b1.webp?alt=media',
            linkUrl: 'https://example.com/go',
            gradient: 'linear-gradient(#000, #333)',
          }),
          // Firestore Timestamp 之類的時間欄位不進快照
          startAt: { seconds: 1, nanoseconds: 0 },
          endAt: { seconds: 2, nanoseconds: 0 },
        },
        banner({ id: 'b2', title: '第二張' }),
      ],
      NOW,
    );

    const read = readBannersSnapshot(NOW + 5 * 60 * 1000);
    expect(read?.expiresAt).toBe(NOW + HOME_SNAPSHOT_MAX_AGE_MS);
    expect(read?.items.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(read?.items[0]).toMatchObject({
      id: 'b1',
      _docId: 'b1',
      status: 'active',
      title: '週末熱血開踢',
      subtitle: '立即加入',
      titleColor: '#ffffff',
      image: 'https://firebasestorage.googleapis.com/v0/b/x/o/b1.webp?alt=media',
      linkUrl: 'https://example.com/go',
      gradient: 'linear-gradient(#000, #333)',
    });
    expect(read?.items[0]).not.toHaveProperty('startAt');
    expect(read?.items[0]).not.toHaveProperty('endAt');
  });

  it('快照內容與帳號無關：存的只有版本、時間與橫幅欄位', () => {
    putBanners([banner({ id: 'b1', title: 'x' })], NOW);
    const stored = JSON.parse(localStorage.getItem(BANNERS_SNAPSHOT_KEY) as string) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['appVersion', 'items', 'savedAt', 'v']);
    expect(stored.appVersion).toBe(APP_VERSION);
    expect(stored.savedAt).toBe(NOW);
  });

  it('剛好 30 分鐘仍可用；超過 30 分鐘一律當沒有快照（只留骨架）', () => {
    putBanners([banner({ id: 'b1', title: 'x' })], NOW);
    expect(readBannersSnapshot(NOW + HOME_SNAPSHOT_MAX_AGE_MS)?.items).toHaveLength(1);
    expect(readBannersSnapshot(NOW + HOME_SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();
  });

  it('版本和目前不同一律當沒有快照（即使剛寫入）', () => {
    putRaw(BANNERS_SNAPSHOT_KEY, {
      v: 1,
      appVersion: '0.20200101',
      savedAt: NOW,
      items: [{ id: 'b1', _docId: 'b1', title: '舊版寫的' }],
    });
    expect(readBannersSnapshot(NOW)).toBeNull();
  });

  it('寫入時間在未來太遠（時鐘不可信）、格式不符、壞 JSON 都當沒有快照', () => {
    putRaw(BANNERS_SNAPSHOT_KEY, {
      v: 1,
      appVersion: APP_VERSION,
      savedAt: NOW + 10 * 60 * 1000,
      items: [{ id: 'b1', _docId: 'b1' }],
    });
    expect(readBannersSnapshot(NOW)).toBeNull();

    putRaw(BANNERS_SNAPSHOT_KEY, { v: 2, appVersion: APP_VERSION, savedAt: NOW, items: [{ id: 'b1', _docId: 'b1' }] });
    expect(readBannersSnapshot(NOW)).toBeNull();

    putRaw(BANNERS_SNAPSHOT_KEY, { v: 1, appVersion: APP_VERSION, savedAt: NOW, items: 'nope' });
    expect(readBannersSnapshot(NOW)).toBeNull();

    localStorage.setItem(BANNERS_SNAPSHOT_KEY, '{not json');
    expect(readBannersSnapshot(NOW)).toBeNull();
  });

  it('讀取時超過字數上限的內容在解析前就丟掉（不先 JSON.parse）', () => {
    const parse = vi.spyOn(JSON, 'parse');
    const huge = JSON.stringify({
      v: 1,
      appVersion: APP_VERSION,
      savedAt: NOW,
      items: [{ id: 'b1', _docId: 'b1', title: 'y'.repeat(HOME_SNAPSHOT_MAX_CHARS) }],
    });
    localStorage.setItem(BANNERS_SNAPSHOT_KEY, huge);
    expect(readBannersSnapshot(NOW)).toBeNull();
    expect(parse).not.toHaveBeenCalled();
  });

  it('圖片與連結只接受 http/https（本機資料被竄改也不會變成 javascript: 等協定）；缺 id 的項目略過', () => {
    putRaw(BANNERS_SNAPSHOT_KEY, {
      v: 1,
      appVersion: APP_VERSION,
      savedAt: NOW,
      items: [
        { id: 'b1', _docId: 'b1', image: 'javascript:alert(1)', linkUrl: 'data:text/html,x', title: 'ok' },
        { id: '', _docId: 'b2' },
        { _docId: 'b3' },
        null,
        'oops',
      ],
    });
    const read = readBannersSnapshot(NOW);
    expect(read?.items).toHaveLength(1);
    expect(read?.items[0]?.image).toBe('');
    expect(read?.items[0]?.linkUrl).toBe('');
  });

  it('漸層只收單純的 gradient(...)：被竄改的內容（url、分號、額外宣告）丟掉改用預設底色；寫入時同樣過濾', () => {
    const evil = [
      'linear-gradient(red, blue); background-image: url(https://evil.example/x.png)',
      'linear-gradient(url(https://evil.example/x.png), blue)',
      'url(https://evil.example/x.png)',
      'red; position: fixed',
      'linear-gradient(red, blue) /* x */',
    ];
    putRaw(BANNERS_SNAPSHOT_KEY, {
      v: 1,
      appVersion: APP_VERSION,
      savedAt: NOW,
      items: [
        ...evil.map((gradient, i) => ({ id: `e${i}`, _docId: `e${i}`, gradient })),
        { id: 'ok', _docId: 'ok', gradient: 'linear-gradient(135deg, #0d9488 0%, rgba(1,2,3,.5) 100%)' },
      ],
    });
    const read = readBannersSnapshot(NOW);
    expect(read?.items.slice(0, evil.length).map((b) => b.gradient)).toEqual(evil.map(() => undefined));
    expect(read?.items.at(-1)?.gradient).toBe('linear-gradient(135deg, #0d9488 0%, rgba(1,2,3,.5) 100%)');

    putBanners([banner({ id: 'w', gradient: evil[0] })], NOW);
    const stored = JSON.parse(localStorage.getItem(BANNERS_SNAPSHOT_KEY) as string) as { items: Array<{ gradient?: string }> };
    expect(stored.items[0]?.gradient).toBeUndefined();
  });

  it('空清單（伺服器說目前沒有橫幅）會刪掉舊快照', () => {
    putBanners([banner({ id: 'b1', title: 'x' })], NOW);
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).not.toBeNull();
    putBanners([], NOW + 1000);
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBeNull();
  });

  it('超過字數上限不存，並刪掉舊的', () => {
    putBanners([banner({ id: 'b1', title: 'x' })], NOW);
    // 單一欄位有長度上限（超長的欄位會整個丟掉），所以要靠很多筆、每筆都接近上限才會超過整段的字數上限
    const heavy = Array.from({ length: 50 }, (_, i) =>
      banner({ id: `h${i}`, title: 'y'.repeat(500), subtitle: 'z'.repeat(1000), image: `https://example.com/${'a'.repeat(1900)}`, linkUrl: `https://example.com/${'b'.repeat(1900)}` }),
    );
    putBanners(heavy, NOW + 1000);
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBeNull();
  });
});

describe('運動統計快照', () => {
  const rows = guestRowsOf({ football: 3, basketball: 1 });

  it('只存 key＋數量，讀取時由 SPORTS 還原標籤與符號，並帶到期時間', () => {
    writeSportsSnapshot(rows, NOW);
    const stored = JSON.parse(localStorage.getItem(SPORTS_SNAPSHOT_KEY) as string) as { items: unknown[] };
    expect(stored.items).toEqual([
      { key: 'football', count: 3 },
      { key: 'basketball', count: 1 },
    ]);
    const read = readSportsSnapshot(NOW + 1000);
    expect(read?.items).toEqual(rows);
    expect(read?.expiresAt).toBe(NOW + HOME_SNAPSHOT_MAX_AGE_MS);
  });

  it('超過 30 分鐘或版本不同：不回任何統計（不顯示「N 活動」之類的狀態文字）', () => {
    writeSportsSnapshot(rows, NOW);
    expect(readSportsSnapshot(NOW + HOME_SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();

    putRaw(SPORTS_SNAPSHOT_KEY, {
      v: 1,
      appVersion: '0.20200101',
      savedAt: NOW,
      items: [{ key: 'football', count: 3 }],
    });
    expect(readSportsSnapshot(NOW)).toBeNull();
  });

  it('讀取時超過字數上限的內容在解析前就丟掉', () => {
    const parse = vi.spyOn(JSON, 'parse');
    localStorage.setItem(SPORTS_SNAPSHOT_KEY, 'x'.repeat(HOME_SNAPSHOT_MAX_CHARS + 1));
    expect(readSportsSnapshot(NOW)).toBeNull();
    expect(parse).not.toHaveBeenCalled();
  });

  it('未知運動 key、數量不是正整數的項目略過', () => {
    putRaw(SPORTS_SNAPSHOT_KEY, {
      v: 1,
      appVersion: APP_VERSION,
      savedAt: NOW,
      items: [
        { key: 'football', count: 2 },
        { key: 'football', count: 2.9 },
        { key: 'not-a-sport', count: 5 },
        { key: 'tennis', count: 1_000_001 },
        { key: 'volleyball', count: { nested: true } },
        { key: 'dance', count: 3, uid: 'U_PRIVATE' },
        { key: 'basketball', count: 0 },
        { key: 'tennis', count: -1 },
        { key: 'running', count: 'many' },
      ],
    });
    // 只剩合法的兩筆；多餘欄位（uid）不會被帶出來
    expect(readSportsSnapshot(NOW)?.items.map((r) => [r.key, r.count])).toEqual([
      ['football', 2],
      ['dance', 3],
    ]);
    expect(JSON.stringify(readSportsSnapshot(NOW))).not.toContain('U_PRIVATE');
  });

  it('兩段快照各有各的時間戳：只更新橫幅不會讓舊的運動統計變新', () => {
    writeSportsSnapshot(rows, NOW);
    putBanners([banner({ id: 'b1', title: 'x' })], NOW + 25 * 60 * 1000);
    const later = NOW + 31 * 60 * 1000;
    expect(readBannersSnapshot(later)?.items).toHaveLength(1);
    expect(readSportsSnapshot(later)).toBeNull();
  });
});

describe('localStorage 不可用', () => {
  it('setItem 失敗但 removeItem 可用：盡量把舊快照刪掉，免得留著比剛取得的資料還舊的版本', () => {
    putBanners([banner({ id: 'old', title: '舊' })], NOW);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    putBanners([banner({ id: 'new', title: '新' })], NOW + 1000);
    expect(readBannersSnapshot(NOW + 1000)).toBeNull();
  });

  it('setItem 與 removeItem 都失敗、getItem 仍讀到舊值：舊快照照自己的期限用，不會被「續期」', () => {
    putBanners([banner({ id: 'old', title: '舊' })], NOW);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => putBanners([banner({ id: 'new', title: '新' })], NOW + 20 * 60 * 1000)).not.toThrow();

    const read = readBannersSnapshot(NOW + 21 * 60 * 1000);
    expect(read?.items.map((b) => b.id)).toEqual(['old']);
    // 到期時間仍是舊的寫入時間＋30 分鐘（沒有因為「嘗試寫新的」而延後）
    expect(read?.expiresAt).toBe(NOW + HOME_SNAPSHOT_MAX_AGE_MS);
    expect(readBannersSnapshot(NOW + HOME_SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();
  });

  it('讀寫丟錯一律忽略，回 null', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => putBanners([banner({ id: 'b1' })], NOW)).not.toThrow();
    expect(() => putBanners([], NOW)).not.toThrow();
    expect(() => writeSportsSnapshot(guestRowsOf({ football: 1 }), NOW)).not.toThrow();
    expect(readBannersSnapshot(NOW)).toBeNull();
    expect(readSportsSnapshot(NOW)).toBeNull();
  });
});

describe('寫入守門（顧問裁定 P1-1 採 A：快照為訪客視角公開資料，由寫入來源型別保證）', () => {
  it('寫入函式只收訪客可見計算與白名單映射的輸出：其他來源編譯不過（@ts-expect-error 型別測試），執行期也不寫', () => {
    // @ts-expect-error 手寫的統計陣列不是 GuestSportRows
    writeSportsSnapshot([{ key: 'football', label: '足球', symbol: '⚽', count: 3 }], NOW);
    // @ts-expect-error 登入者視角的 computeSportRows 輸出不是 GuestSportRows
    writeSportsSnapshot(computeSportRows([], NOW), NOW);
    // @ts-expect-error 未經白名單映射的橫幅不是 PublicBannerList
    writeBannersSnapshot([banner({ id: 'b1', title: 'x' })], NOW);
    expect(localStorage.getItem(SPORTS_SNAPSHOT_KEY)).toBeNull();
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBeNull();

    // 型別被 as 強轉繞過時，執行期仍拒絕（沒有登記過的輸入不寫）
    writeSportsSnapshot([{ key: 'football', label: '足球', symbol: '⚽', count: 3 }] as never, NOW);
    writeBannersSnapshot([banner({ id: 'b1', title: 'x' })] as never, NOW);
    expect(localStorage.getItem(SPORTS_SNAPSHOT_KEY)).toBeNull();
    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBeNull();
  });

  it('白名單映射 toPublicBanners：多餘欄位（uid、email、時間欄位…）不會進快照', () => {
    putBanners(
      [
        {
          ...banner({ id: 'b1', title: 'x' }),
          creatorUid: 'U_PRIVATE',
          email: 'someone@example.com',
          startAt: { seconds: 1, nanoseconds: 0 },
        } as BannerDoc,
      ],
      NOW,
    );
    const raw = localStorage.getItem(BANNERS_SNAPSHOT_KEY) as string;
    expect(raw).not.toContain('U_PRIVATE');
    expect(raw).not.toContain('someone@example.com');
    expect(raw).not.toContain('startAt');
  });

  it('橫幅連結白名單：只收 http/https（與輪播點擊同一個契約）；站內路徑、javascript:、data:、//、反斜線開頭、相對網址、含控制字元的都丟掉（寫入與讀取同一組檢查）', () => {
    const cases: Array<[string, string]> = [
      ['https://example.com/go?a=1', 'https://example.com/go?a=1'],
      ['http://example.com/', 'http://example.com/'],
      ['/events/abc?x=1', ''],
      ['javascript:alert(1)', ''],
      ['data:text/html,<script>alert(1)</script>', ''],
      ['//evil.example/x', ''],
      ['/\\evil.example/x', ''],
      ['events/abc', ''],
      ['https://a.b/\nx', ''],
      ['/ctrl\u0000char', ''],
      ['', ''],
    ];
    putBanners(cases.map(([linkUrl], i) => banner({ id: `l${i}`, linkUrl })), NOW);
    // 寫入端：存進去的內容就已經過濾（不靠讀取時才擋）
    const stored = JSON.parse(localStorage.getItem(BANNERS_SNAPSHOT_KEY) as string) as { items: Array<{ linkUrl?: string }> };
    expect(stored.items.map((b) => b.linkUrl ?? '')).toEqual(cases.map(([, expected]) => expected));
    expect(readBannersSnapshot(NOW)?.items.map((b) => b.linkUrl ?? '')).toEqual(
      cases.map(([, expected]) => expected),
    );

    // 讀取端：本機資料被竄改也一樣被擋
    putRaw(BANNERS_SNAPSHOT_KEY, {
      v: 1,
      appVersion: APP_VERSION,
      savedAt: NOW,
      items: cases.map(([linkUrl], i) => ({ id: `t${i}`, _docId: `t${i}`, linkUrl })),
    });
    expect(readBannersSnapshot(NOW)?.items.map((b) => b.linkUrl ?? '')).toEqual(
      cases.map(([, expected]) => expected),
    );
  });

  it('寫入當下逐欄重新投影：元素凍結，建構後不能被改寫（加 uid、改 count、塞巢狀物件都會丟錯），寫出的內容仍是乾淨的白名單純量', () => {
    const list = toPublicBanners([banner({ id: 'b1', title: '公開', image: 'https://example.com/1.webp' })]);
    const first = list[0] as BannerDoc;
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => Object.assign(first, { uid: 'U_PRIVATE' })).toThrow(TypeError);
    expect(() => { (first as { title?: unknown }).title = { evil: true }; }).toThrow(TypeError);

    writeBannersSnapshot(list, NOW);
    const raw = localStorage.getItem(BANNERS_SNAPSHOT_KEY) as string;
    expect(raw).not.toContain('U_PRIVATE');
    expect(raw).not.toContain('evil');
    expect(readBannersSnapshot(NOW)?.items[0]?.title).toBe('公開');

    const rows = guestRowsOf({ football: 3 });
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
    expect(() => Object.assign(rows[0] as object, { count: 999 })).toThrow(TypeError);
    writeSportsSnapshot(rows, NOW);
    expect(JSON.parse(localStorage.getItem(SPORTS_SNAPSHOT_KEY) as string).items).toEqual([{ key: 'football', count: 3 }]);
  });

  it('序列化的是寫入當下重新建立的純量物件，不是傳進來的元素本身（橫幅與運動統計）', () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    const payloadOf = (key: string): { items: Array<Record<string, unknown>> } => {
      const hit = stringify.mock.calls
        .map((call) => call[0] as { items?: unknown } | null)
        .filter((v): v is { items: Array<Record<string, unknown>> } => Boolean(v) && typeof v === 'object' && Array.isArray(v?.items))
        .at(-1);
      expect(hit, key).toBeTruthy();
      return hit as { items: Array<Record<string, unknown>> };
    };

    const banners = toPublicBanners([banner({ id: 'b1', title: 'x' })]);
    writeBannersSnapshot(banners, NOW);
    const bannerPayload = payloadOf('banners');
    expect(bannerPayload.items[0]).not.toBe(banners[0]);
    expect(Object.getPrototypeOf(bannerPayload.items[0])).toBe(Object.prototype);

    stringify.mockClear();
    const rows = guestRowsOf({ football: 2 });
    writeSportsSnapshot(rows, NOW);
    const sportPayload = payloadOf('sports');
    expect(sportPayload.items[0]).not.toBe(rows[0]);
    expect(Object.keys(sportPayload.items[0] as object).sort()).toEqual(['count', 'key']);
  });

  it('projectBanner／projectSportItem（寫入與讀取共用的投影）：多餘欄位、巢狀物件、非字串、超長欄位都不會出現在輸出', () => {
    const hostile = {
      id: 'b1',
      _docId: 'd1',
      status: 'active',
      uid: 'U_PRIVATE',
      email: 'someone@example.com',
      nested: { a: 1 },
      title: { evil: true },
      subtitle: 'z'.repeat(1001),
      titleColor: 'red',
      subtitleColor: '#12abef',
      image: 'https://example.com/' + 'a'.repeat(2001),
      linkUrl: ['https://example.com/'],
      gradient: 'url(https://evil.example/x.png)',
      slot: { x: 1 },
      sortOrder: 3,
      type: 't'.repeat(101),
      startAt: { seconds: 1 },
    };
    const projected = projectBanner(hostile);
    expect(projected).toEqual({
      id: 'b1',
      _docId: 'd1',
      status: 'active',
      type: undefined,
      title: undefined,
      subtitle: undefined,
      titleColor: undefined,
      subtitleColor: '#12abef',
      image: '',
      linkUrl: '',
      slotName: undefined,
      slot: undefined,
      sortOrder: 3,
      gradient: undefined,
    });
    expect(Object.keys(projected as object).sort()).toEqual(
      ['_docId', 'gradient', 'id', 'image', 'linkUrl', 'slot', 'slotName', 'sortOrder', 'status', 'subtitle', 'subtitleColor', 'title', 'titleColor', 'type'].sort(),
    );
    // 回傳的是新物件，不是輸入的參照
    expect(projected).not.toBe(hostile);

    for (const bad of [null, undefined, 'x', 5, [], {}, { id: 'only-id' }, { id: ['a'], _docId: 'd' }, { id: 'a', _docId: 'd', status: 'draft' }]) {
      expect(projectBanner(bad), JSON.stringify(bad)).toBeNull();
    }

    expect(projectSportItem({ key: 'football', count: 3, uid: 'U_PRIVATE', label: 'x' })).toEqual({ key: 'football', count: 3 });
    for (const bad of [null, {}, { key: 'football' }, { key: 'football', count: 0 }, { key: 'football', count: 2.5 }, { key: 'football', count: '3' }, { key: 'football', count: { a: 1 } }, { key: 'nope', count: 1 }, { key: 'football', count: 1_000_001 }]) {
      expect(projectSportItem(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
