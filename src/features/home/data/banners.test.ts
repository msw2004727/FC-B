import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collection, getDocs, query, type Firestore } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import {
  BANNERS_COLLECTION,
  filterAndSortBanners,
  isHomeCarouselBanner,
  loadActiveBanners,
  safeBannerColor,
  safeBannerGradient,
  safeBannerLinkUrl,
  sanitizeHttpUrl,
  type BannerDoc,
} from './banners';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  limit: vi.fn((n: number) => ({ kind: 'limit', n })),
  getDocs: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(),
}));

const fakeDb = { name: 'mock-db' } as unknown as Firestore;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getFirebase).mockResolvedValue({
    db: fakeDb,
  } as Awaited<ReturnType<typeof getFirebase>>);
  vi.mocked(collection).mockReturnValue('banners-col-ref' as unknown as ReturnType<typeof collection>);
  vi.mocked(query).mockImplementation((ref) => ref as unknown as ReturnType<typeof query>);
});

describe('banners data layer', () => {
  // 測試同步更新（R-QA-005）：PM 對照 A 修正——A 只看 status === 'active' 並排除特殊文件，沒有時間區間、不另外排序。
  it('照 A：limit(200) 查詢、保留查詢順序、只留 active，不看時間區間', async () => {
    const mockDocs = [
      { id: 'b1', data: () => ({ status: 'active', title: 'First', image: 'https://example.com/b1.jpg', linkUrl: 'javascript:alert(1)', endAt: '2000-01-01T00:00:00Z' }) },
      { id: 'b2', data: () => ({ status: 'active', title: 'Second', linkUrl: 'https://example.com/target2' }) },
      { id: 'b-draft', data: () => ({ status: 'draft', title: 'Draft' }) },
    ];
    vi.mocked(getDocs).mockResolvedValue({ docs: mockDocs } as unknown as Awaited<ReturnType<typeof getDocs>>);

    const result = await loadActiveBanners();

    expect(collection).toHaveBeenCalledWith(fakeDb, BANNERS_COLLECTION);
    expect(query).toHaveBeenCalledWith('banners-col-ref', { kind: 'limit', n: 200 });
    expect(result.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(result[0]?.linkUrl).toBe('');
  });

  it('讀取失敗仍回空陣列，而且不回報結果（onResult 不被呼叫）——呼叫端靠這點分辨「查詢失敗」與「伺服器確認沒有橫幅」', async () => {
    const warn = vi.fn();
    const onResult = vi.fn();
    vi.mocked(getDocs).mockRejectedValueOnce(new Error('offline'));
    expect(await loadActiveBanners({ logger: { warn }, onResult })).toEqual([]);
    expect(onResult).not.toHaveBeenCalled();

    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [],
      metadata: { fromCache: false },
    } as unknown as Awaited<ReturnType<typeof getDocs>>);
    expect(await loadActiveBanners({ logger: { warn }, onResult })).toEqual([]);
    expect(onResult).toHaveBeenCalledWith({ fromCache: false });
  });

  it('onResult 丟錯也不破壞回傳契約：仍回橫幅，而不是被當成讀取失敗回 []', async () => {
    const warn = vi.fn();
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [{ id: 'b1', data: () => ({ status: 'active', title: 'ok' }) }],
    } as unknown as Awaited<ReturnType<typeof getDocs>>);
    const result = await loadActiveBanners({
      logger: { warn },
      onResult: () => {
        throw new Error('callback failed');
      },
    });
    expect(result.map((b) => b.id)).toEqual(['b1']);
  });

  it('onResult 回報這份結果是不是從本機快取回來的（離線時 getDocs 回持久快取）；沒有 metadata 回 undefined', async () => {
    const onResult = vi.fn();
    const docs = [{ id: 'b1', data: () => ({ status: 'active' }) }];
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs,
      metadata: { fromCache: false },
    } as unknown as Awaited<ReturnType<typeof getDocs>>);
    await loadActiveBanners({ onResult });
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs,
      metadata: { fromCache: true },
    } as unknown as Awaited<ReturnType<typeof getDocs>>);
    await loadActiveBanners({ onResult });
    vi.mocked(getDocs).mockResolvedValueOnce({ docs } as unknown as Awaited<ReturnType<typeof getDocs>>);
    await loadActiveBanners({ onResult });
    expect(onResult.mock.calls.map((c) => c[0])).toEqual([
      { fromCache: false },
      { fromCache: true },
      { fromCache: undefined },
    ]);
  });

  it('safeBannerLinkUrl 只收 http/https（與輪播點擊同一個契約）', () => {
    expect(safeBannerLinkUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeBannerLinkUrl('  http://example.com/x  ')).toBe('http://example.com/x');
    const bads = ['javascript:alert(1)', 'data:text/html,x', '//evil.example', '/events/abc', '/\\evil.example', 'events/abc', 'https://a.b/\nx', 'https://a.b/\u0000x', '', null, undefined];
    for (const bad of bads) {
      expect(safeBannerLinkUrl(bad), String(bad)).toBe('');
    }
    expect(safeBannerLinkUrl('https://example.com/' + 'a'.repeat(2000))).toBe('');
  });

  it('safeBannerGradient 只收單一、括號平衡的 linear-gradient(...)，內容限色碼／rgb(a)／hsl(a)／英文色名／% 與 px／方向或角度', () => {
    for (const ok of [
      'linear-gradient(135deg, #0d9488 0%, rgba(1,2,3,.5) 100%)',
      'linear-gradient(to right, red, blue)',
      'linear-gradient(to bottom right, #fff, #000 50%)',
      'linear-gradient(0.25turn, hsl(210 40% 50%), transparent)',
      'linear-gradient(#0d9488, #1e3a8a)',
      // 色碼只收 3、4、6、8 位
      'linear-gradient(#abc, #abcd)',
      'linear-gradient(#aabbcc, #aabbccdd)',
      // 方向：單一方向、角落（一個水平加一個垂直，順序不拘）、角度
      'linear-gradient(to right, red, blue)',
      'linear-gradient(to left top, red, blue)',
      'linear-gradient(to top left, red, blue)',
      'linear-gradient(-45deg, red, blue)',
      // rgb／hsl：逗號式與空白加斜線式
      'linear-gradient(rgb(1 2 3 / 50%), rgb(10%, 20%, 30%))',
      'linear-gradient(hsla(120, 50%, 50%, .5), hsl(120deg 50% 50% / 0.5))',
    ]) {
      expect(safeBannerGradient(ok), ok).toBe(ok);
    }
    for (const bad of [
      'linear-gradient(red,blue),var(--extra)',
      'linear-gradient(red,blue), linear-gradient(green,yellow)',
      'linear-gradient(red,blue)) , x(',
      'linear-gradient(red,blue',
      'linear-gradient(red, blue); background-image:url(https://evil.example/x)',
      'linear-gradient(url(https://evil.example/x), blue)',
      'linear-gradient(var(--a), var(--b))',
      'linear-gradient(red, blue) /* x */',
      'radial-gradient(circle, red, blue)',
      'conic-gradient(red, blue)',
      'url(https://evil.example/x)',
      'linear-gradient(red)',
      'linear-gradient(to right)',
      'linear-gradient(red, calc(1px + 2px))',
      'linear-gradient(red, blue 10%%%)',
      // 無效 CSS（不會注入資源，但也不該收）：色碼位數、無效的方向組合、rgb／hsl 引數不合法
      'linear-gradient(#12345, blue)',
      'linear-gradient(#12, blue)',
      'linear-gradient(#1234567, blue)',
      'linear-gradient(#ggg, blue)',
      'linear-gradient(to top bottom, red, blue)',
      'linear-gradient(to left right, red, blue)',
      'linear-gradient(to top top, red, blue)',
      'linear-gradient(to, red, blue)',
      'linear-gradient(rgb(1,2), blue)',
      'linear-gradient(rgb(1 2 3, 4), blue)',
      'linear-gradient(rgb(1,2,3 / 4), blue)',
      'linear-gradient(rgb(a,b,c), blue)',
      'linear-gradient(hsl(1,2,3), blue)',
      'linear-gradient(hsl(1 2% 3%, 4), blue)',
      'linear-gradient(red 10px 20px 30px, blue)',
      'linear-gradient(' + 'a,'.repeat(200) + 'b)',
      'red',
      '',
    ]) {
      expect(safeBannerGradient(bad), bad).toBe('');
    }
    expect(safeBannerGradient(null)).toBe('');
  });

  it('validates colors and http/https urls safely', () => {
    expect(sanitizeHttpUrl('https://toosterx.com/a')).toBe('https://toosterx.com/a');
    expect(sanitizeHttpUrl('http://toosterx.com/a')).toBe('http://toosterx.com/a');
    expect(sanitizeHttpUrl('javascript:void(0)')).toBe('');
    expect(sanitizeHttpUrl('data:text/html,hi')).toBe('');

    expect(safeBannerColor('#12abef', '#ffffff')).toBe('#12abef');
    expect(safeBannerColor('red', '#ffffff')).toBe('#ffffff');
  });

  it('照 A getBanners 排除射門遊戲／觀賽／首頁資訊／版面設定', () => {
    const base = { status: 'active' } as const;
    const docs: BannerDoc[] = [
      { ...base, id: 'shot', _docId: 'shot', type: 'shotgame' },
      { ...base, id: 'wp', _docId: 'wp', type: 'watchParty' },
      { ...base, id: 'home-info', _docId: 'home-info' },
      { ...base, id: 'x', _docId: 'x', slot: 'home-layout' },
      { ...base, id: 'ok', _docId: 'ok' },
    ];
    expect(isHomeCarouselBanner(docs[4])).toBe(true);
    expect(filterAndSortBanners(docs).map((d) => d.id)).toEqual(['ok']);
  });
});
