import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteTeamViaCallable,
  getNextTeamPinOrder,
  getTeamAdminErrorMessage,
  normalizeTeamAttentionColor,
} from './teams-admin-write';
import { invalidateTeams, loadTeams } from './teams-repo';

const mocks = vi.hoisted(() => ({
  callFn: vi.fn(),
  getDocs: vi.fn(),
}));

vi.mock('@/data/callables', () => ({ callFn: mocks.callFn }));
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: {} }) }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  getDocs: mocks.getDocs,
}));

beforeEach(() => {
  invalidateTeams();
  mocks.getDocs.mockResolvedValue({
    forEach: (cb: (d: { id: string; data: () => unknown }) => void) => {
      cb({ id: 'tm_1', data: () => ({ id: 'tm_1', name: '一隊' }) });
      cb({ id: 'tm_2', data: () => ({ id: 'tm_2', name: '二隊' }) });
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('getNextTeamPinOrder（A _getNextTeamPinOrder）', () => {
  it('取已載入清單最大 pinOrder＋1，且不小於 100', () => {
    expect(getNextTeamPinOrder([])).toBe(100);
    expect(getNextTeamPinOrder([{ pinOrder: 3 }, { pinOrder: 0 }])).toBe(100);
    expect(getNextTeamPinOrder([{ pinOrder: 120 }, { pinOrder: 'x' as unknown as number }])).toBe(121);
  });
});

describe('normalizeTeamAttentionColor（A _normalizeTeamAttentionColor）', () => {
  it('非 #RRGGBB 回預設 #fbbf24', () => {
    expect(normalizeTeamAttentionColor('#22C55E')).toBe('#22C55E');
    expect(normalizeTeamAttentionColor('red')).toBe('#fbbf24');
    expect(normalizeTeamAttentionColor(undefined)).toBe('#fbbf24');
  });
});

describe('deleteTeamViaCallable', () => {
  it('成功：呼叫 deleteTeam 並從快取移除，不重讀', async () => {
    await loadTeams();
    mocks.callFn.mockResolvedValue({ ok: true, alreadyDeleted: false });
    expect(await deleteTeamViaCallable({ id: 'tm_1', _docId: 'tm_1' })).toEqual({ status: 'deleted' });
    expect(mocks.callFn).toHaveBeenCalledWith('deleteTeam', { teamId: 'tm_1' });
    expect((await loadTeams()).map((t) => t.id)).toEqual(['tm_2']);
    expect(mocks.getDocs).toHaveBeenCalledTimes(1);
  });

  it('partial：保留快取並回報剩餘數', async () => {
    await loadTeams();
    mocks.callFn.mockResolvedValue({ ok: true, alreadyDeleted: false, partial: { remaining: 3, memberIds: [], rerun: true } });
    expect(await deleteTeamViaCallable({ id: 'tm_1', _docId: 'tm_1' })).toEqual({ status: 'partial', remaining: 3 });
    expect((await loadTeams()).map((t) => t.id)).toEqual(['tm_1', 'tm_2']);
  });

  it('錯誤往外拋；錯誤碼對應提示', async () => {
    mocks.callFn.mockRejectedValue(new Error('TEAM_DELETE_DENIED'));
    await expect(deleteTeamViaCallable({ id: 'tm_1' })).rejects.toThrow('TEAM_DELETE_DENIED');
    expect(getTeamAdminErrorMessage(new Error('TEAM_DELETE_DENIED'), 'x')).toBe('權限不足');
    expect(getTeamAdminErrorMessage(new Error('COACH_PLUS_REQUIRED'), 'x')).toBe('權限不足');
    expect(getTeamAdminErrorMessage(new Error('internal'), '刪除俱樂部失敗，請稍後再試')).toBe('刪除俱樂部失敗，請稍後再試');
  });
});
