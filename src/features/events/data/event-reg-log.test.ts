import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRegLogTime, loadEventRegLog, mergeEventRegLogs, regLogTimeMs } from './event-reg-log';

const mocks = vi.hoisted(() => ({
  getFirebase: vi.fn(), collection: vi.fn(), query: vi.fn(), where: vi.fn(), getDocs: vi.fn(),
}));
vi.mock('@/data/firebase', () => ({ getFirebase: mocks.getFirebase }));
vi.mock('firebase/firestore', () => ({
  collection: mocks.collection, query: mocks.query, where: mocks.where, getDocs: mocks.getDocs,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFirebase.mockResolvedValue({ db: 'db' });
  mocks.collection.mockImplementation((_db: unknown, ...parts: string[]) => parts.join('/'));
  mocks.where.mockImplementation((...parts: unknown[]) => parts);
  mocks.query.mockImplementation((...parts: unknown[]) => parts);
});

describe('M-089：報名紀錄', () => {
  it('時間格式照 A', () => {
    expect(regLogTimeMs({ toMillis: () => 3000 })).toBe(3000);
    expect(regLogTimeMs({ toDate: () => new Date(4000) })).toBe(4000);
    expect(regLogTimeMs({ seconds: 5, nanoseconds: 2_000_000 })).toBe(5002);
    expect(regLogTimeMs({ _seconds: 6, _nanoseconds: 3_000_000 })).toBe(6003);
    expect(regLogTimeMs('invalid')).toBe(0);
    expect(formatRegLogTime(new Date(2026, 9, 2, 3, 4).getTime())).toBe('10/02 03:04');
  });

  it('包含取消紀錄、同行者名、七種操作與 ID 時間回退', () => {
    const operations = [
      ['force_promote', '手動正取', 'promote'],
      ['auto_promote', '自動遞補', 'promote'],
      ['force_demote', '下放候補', 'demote'],
      ['capacity_demote', '容量降級', 'demote'],
      ['team_reservation_create', '建立席位', 'promote'],
      ['team_reservation_update', '調整席位', 'promote'],
      ['team_reservation_cancel', '取消席位', 'promote'],
    ] as const;
    for (const [type, label, actionClass] of operations) {
      const result = mergeEventRegLogs([
        { userName: '本人', companionName: '夥伴', registeredAt: 1000,
          status: 'cancelled', cancelledAt: 2000 },
      ], [{ id: 'op_1800000000000', type, content: '將 小明 下放候補' }]);
      expect(result.map(item => item.label)).toEqual([label, '取消', '報名']);
      expect(result[0]).toMatchObject({ userName: '小明', actionClass, ms: 1800000000000 });
      expect(result[1]?.userName).toBe('夥伴');
    }
    expect(mergeEventRegLogs([], [
      { id: 'x', type: 'other', createdAt: 100 },
      { id: 'x', type: 'auto_promote' },
    ])).toEqual([]);
    expect(mergeEventRegLogs([], [{
      id: 'x', type: 'auto_promote', createdAt: 10, content: '候補 小華 自動遞補正取',
    }])[0]?.userName).toBe('小華');
  });

  it('子集合用文件 ID；操作日誌只查 public ID 與七種類型', async () => {
    mocks.getDocs.mockResolvedValue({ docs: [] });
    expect(await loadEventRegLog('public-id', 'document-id')).toEqual([]);
    expect(mocks.collection).toHaveBeenCalledWith('db', 'events', 'document-id', 'registrations');
    expect(mocks.where).toHaveBeenCalledWith('eventId', '==', 'public-id');
    expect(mocks.where).toHaveBeenCalledWith('type', 'in', [
      'force_promote', 'auto_promote', 'force_demote', 'capacity_demote',
      'team_reservation_create', 'team_reservation_update', 'team_reservation_cancel',
    ]);
    expect(mocks.where).toHaveBeenCalledTimes(2);
  });

  it('報名讀取失敗保留快取，操作失敗不丟棄報名', async () => {
    mocks.getDocs.mockRejectedValue(new Error('offline'));
    const cached = [{ userName: '快取', registeredAt: 100 }];
    expect(await loadEventRegLog('public', 'doc', cached))
      .toEqual(mergeEventRegLogs(cached, []));
    mocks.getDocs.mockResolvedValue({ docs: [{
      id: 'r', data: () => ({ userName: '新資料', registeredAt: 200 }),
    }] });
    const result = await loadEventRegLog('public', 'doc', cached);
    expect(result[0]?.userName).toBe('新資料');
  });
});
