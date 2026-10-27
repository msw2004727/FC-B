import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collection, getDocs, query, type Firestore } from 'firebase/firestore';
import { getFirebaseCore } from '@/data/firebase';
import {
  ANNOUNCEMENTS_COLLECTION,
  computeMarqueeDurationSeconds,
  filterAndSortAnnouncements,
  getAnnouncementEffectiveStatus,
  loadActiveAnnouncements,
  type AnnouncementDoc,
} from './announcements';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  getDocs: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({
  getFirebaseCore: vi.fn(),
}));

const fakeDb = { name: 'mock-db' } as unknown as Firestore;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getFirebaseCore).mockResolvedValue({
    db: fakeDb,
  } as Awaited<ReturnType<typeof getFirebaseCore>>);
  vi.mocked(collection).mockReturnValue('ann-col-ref' as unknown as ReturnType<typeof collection>);
  vi.mocked(query).mockImplementation((ref) => ref as unknown as ReturnType<typeof query>);
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

  it('Timestamp 的 publishAt 格式化成台北牆鐘，00:30 不會變成前一天', async () => {
    const seconds = Math.floor(Date.parse('2026-10-19T00:30:00+08:00') / 1000);
    vi.mocked(getDocs).mockResolvedValue({
      docs: [{
        id: 'ts',
        data: () => ({
          id: 'ts',
          status: 'active',
          title: '凌晨',
          content: '',
          publishAt: { seconds, nanoseconds: 0 },
        }),
      }],
    } as unknown as Awaited<ReturnType<typeof getDocs>>);

    const result = await loadActiveAnnouncements({
      now: () => Date.parse('2026-10-19T12:00:00+08:00'),
    });
    expect(result[0]?.publishAt).toBe('2026/10/19 00:30');
  });

  it('queries the whole collection without limit (main semantics restored; active ones are filtered client-side)', async () => {
    vi.mocked(getDocs).mockResolvedValue({ docs: [] } as unknown as Awaited<ReturnType<typeof getDocs>>);

    await loadActiveAnnouncements();

    // query(collection) 只有一個參數：沒有 limit／orderBy／where，不會「先截取、再篩選」而漏掉有效公告
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('ann-col-ref');
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

// 非標準字串刻意與舊版不同（正式資料只寫標準 YYYY/MM/DD HH:mm；差異記入 project_b_intentional_diffs_from_a）：
// ① ISO 純日期（'2026-10-19'：舊＝UTC 午夜＝台北 08:00，新＝台北 00:00）
// ② 不存在的日期（2026-02-30：舊 V8 進位成 3/2，新回 null）
// ③ 英文日期（'Oct 19, 2026'：舊 V8 能解析、新回 null）
// ④ 其他 V8 能解析而 parseTaipei 不收的格式（+0800、無時區小數秒、toString()）
// 可接受：寫入端只寫標準格式。
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

  it('刻意與舊版不同：英文日期不當絕對時間，不會下架', () => {
    expect(getAnnouncementEffectiveStatus({
      ...base,
      status: 'active',
      unpublishAt: 'Oct 19 2026 11:00',
    }, now)).toBe('active');
    expect(getAnnouncementEffectiveStatus({
      ...base,
      status: 'active',
      unpublishAt: 'Oct 19 2020 11:00',
    }, now)).toBe('active');
  });

  it('帶 Z 的下架時間是絕對時間，04:00Z 之後已下架', () => {
    expect(getAnnouncementEffectiveStatus({
      ...base,
      status: 'active',
      unpublishAt: '2026-10-19T03:00:00Z',
    }, now)).toBe('expired');
    expect(getAnnouncementEffectiveStatus({
      ...base,
      status: 'active',
      unpublishAt: '2026-10-19T05:00:00Z',
    }, now)).toBe('active');
  });
});
