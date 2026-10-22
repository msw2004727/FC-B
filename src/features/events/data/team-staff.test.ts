import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEventLimitedTeamIds, isTeamStaff, loadEventStaffTeamIds } from './team-staff';

const mocks = vi.hoisted(() => ({
  getFirebase: vi.fn(),
  getDoc: vi.fn(),
  doc: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({ getFirebase: mocks.getFirebase }));
vi.mock('firebase/firestore', () => ({ getDoc: mocks.getDoc, doc: mocks.doc }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFirebase.mockResolvedValue({ db: 'db' });
  mocks.doc.mockImplementation((_db: unknown, collection: string, id: string) => `${collection}/${id}`);
});

describe('M-089：俱樂部幹部', () => {
  it('限定 ID 去重保序，單值放最後', () => {
    expect(getEventLimitedTeamIds({
      creatorTeamIds: [' b ', 'a', '', 'b', null],
      creatorTeamId: 'c',
    })).toEqual(['b', 'a', 'c']);
    expect(getEventLimitedTeamIds(null)).toEqual([]);
  });

  it('只認 UID；空 leaderUids 不回退 leaderUid', () => {
    expect(isTeamStaff('u', { captainUid: 'u' })).toBe(true);
    expect(isTeamStaff('u', { coachUids: ['u'] })).toBe(true);
    expect(isTeamStaff('u', { leaderUid: 'u' })).toBe(true);
    expect(isTeamStaff('u', { leaderUids: [], leaderUid: 'u' })).toBe(false);
    expect(isTeamStaff('u', { captainUid: ' u ' })).toBe(false);
    expect(isTeamStaff(null, { captainUid: 'u' })).toBe(false);
  });

  it('訪客與非限定活動不查資料', async () => {
    await loadEventStaffTeamIds(null, { teamOnly: true, creatorTeamId: 't' });
    await loadEventStaffTeamIds('u', { teamOnly: false, creatorTeamId: 't' });
    expect(mocks.getFirebase).not.toHaveBeenCalled();
  });

  it('讀限定 teams 文件並回傳本人幹部 ID', async () => {
    mocks.getDoc.mockImplementation(async (path: string) => ({
      exists: () => true,
      data: () => path === 'teams/a' ? { captainUid: 'u' } : { captainUid: 'other' },
    }));
    expect(await loadEventStaffTeamIds('u', {
      teamOnly: true,
      creatorTeamIds: ['a', 'b'],
    })).toEqual(new Set(['a']));
    expect(mocks.doc).toHaveBeenCalledWith('db', 'teams', 'a');
  });

  it('第一次失敗回空集合，第二次重新讀取成功', async () => {
    mocks.getDoc.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      exists: () => true,
      data: () => ({ leaderUid: 'u' }),
    });
    const event = { teamOnly: true, creatorTeamId: 'a' };
    expect(await loadEventStaffTeamIds('u', event)).toEqual(new Set());
    expect(await loadEventStaffTeamIds('u', event)).toEqual(new Set(['a']));
    expect(mocks.getDoc).toHaveBeenCalledTimes(2);
  });
});
