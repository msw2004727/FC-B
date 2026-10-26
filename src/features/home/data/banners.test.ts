import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collection, getDocs, query, type Firestore } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import {
  BANNERS_COLLECTION,
  filterAndSortBanners,
  isHomeCarouselBanner,
  loadActiveBanners,
  safeBannerColor,
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

  it('讀取失敗仍回空陣列，並通知 onFailure（呼叫端分辨「查詢失敗」與「真的沒有橫幅」）；成功時不通知', async () => {
    const warn = vi.fn();
    const onFailure = vi.fn();
    vi.mocked(getDocs).mockRejectedValueOnce(new Error('offline'));
    expect(await loadActiveBanners({ logger: { warn }, onFailure })).toEqual([]);
    expect(onFailure).toHaveBeenCalledTimes(1);

    onFailure.mockClear();
    vi.mocked(getDocs).mockResolvedValueOnce({ docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>);
    expect(await loadActiveBanners({ logger: { warn }, onFailure })).toEqual([]);
    expect(onFailure).not.toHaveBeenCalled();
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
