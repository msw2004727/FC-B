import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collection, getDocs, limit, query, type Firestore } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import {
  ANNOUNCEMENTS_COLLECTION,
  ANNOUNCEMENTS_QUERY_LIMIT,
  computeMarqueeDurationSeconds,
  filterAndSortAnnouncements,
  getAnnouncementEffectiveStatus,
  loadActiveAnnouncements,
  type AnnouncementDoc,
} from './announcements';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  limit: vi.fn(),
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
  vi.mocked(collection).mockReturnValue('ann-col-ref' as unknown as ReturnType<typeof collection>);
  vi.mocked(query).mockImplementation((ref) => ref as unknown as ReturnType<typeof query>);
  vi.mocked(limit).mockImplementation((n) => ({ limit: n }) as unknown as ReturnType<typeof limit>);
});

describe('announcements data layer', () => {
  it('queries announcements collection, filters active ones, and sorts by sortOrder', async () => {
    const nowMs = Date.parse('2026-05-01T12:00:00Z');
    const mockDocs = [
      {
        id: 'a2',
        data: () => ({
          id: 'a2',
          status: 'active',
          sortOrder: 20,
          title: '系統維護',
          content: '今晚十點維護',
          publishAt: '2026/05/01 10:00',
        }),
      },
      {
        id: 'a1',
        data: () => ({
          id: 'a1',
          status: 'active',
          sortOrder: 5,
          title: '重要通知',
          content: '週末活動開放報名',
          publishAt: '2026/05/01 08:00',
        }),
      },
      {
        id: 'a-hidden',
        data: () => ({
          id: 'a-hidden',
          status: 'inactive',
          sortOrder: 1,
          title: '隱藏',
          content: '不顯示',
        }),
      },
    ];

    vi.mocked(getDocs).mockResolvedValue({
      docs: mockDocs,
    } as unknown as Awaited<ReturnType<typeof getDocs>>);

    const result = await loadActiveAnnouncements({ now: () => nowMs });

    expect(collection).toHaveBeenCalledWith(fakeDb, ANNOUNCEMENTS_COLLECTION);
    expect(result.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(result[0]?.title).toBe('重要通知');
  });

  it('caps the query with limit(200) like A (A4)', async () => {
    vi.mocked(getDocs).mockResolvedValue({ docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>);

    await loadActiveAnnouncements();

    expect(ANNOUNCEMENTS_QUERY_LIMIT).toBe(200);
    expect(limit).toHaveBeenCalledWith(200);
    expect(query).toHaveBeenCalledWith('ann-col-ref', { limit: 200 });
  });

  it('computes marquee duration matching A formula Math.max(10, totalChars * 0.35)', () => {
    expect(computeMarqueeDurationSeconds([])).toBe(10);
    const list = filterAndSortAnnouncements([
      {
        id: '1',
        _docId: '1',
        status: 'active',
        title: '12345678901234567890',
        content: '12345678901234567890',
      },
    ]);
    expect(computeMarqueeDurationSeconds(list)).toBe(40 * 0.35);
  });
});

describe('公告有效狀態（照 A _getAnnouncementEffectiveStatus）', () => {
  const base: AnnouncementDoc = { id: 'a', _docId: 'a', title: 'T', content: '', status: '', sortOrder: 0 } as AnnouncementDoc;
  const now = Date.parse('2026-10-19T12:00:00+08:00');

  it('沒有狀態視為上架中；超過下架時間為已下架', () => {
    expect(getAnnouncementEffectiveStatus({ ...base }, now)).toBe('active');
    expect(getAnnouncementEffectiveStatus({ ...base, status: 'active', unpublishAt: '2026/10/19 11:00' }, now)).toBe('expired');
  });

  it('排程中：發布時間到了才上架', () => {
    expect(getAnnouncementEffectiveStatus({ ...base, status: 'scheduled', rawPublishAt: '2026/10/19 13:00' }, now)).toBe('scheduled');
    expect(getAnnouncementEffectiveStatus({ ...base, status: 'scheduled', rawPublishAt: '2026/10/19 11:00' }, now)).toBe('active');
    expect(filterAndSortAnnouncements([{ ...base, status: 'scheduled', rawPublishAt: '2026/10/19 13:00' }], now)).toEqual([]);
  });
});
