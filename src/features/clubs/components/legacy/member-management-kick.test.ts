// K4 kickTeamMember（Callable removeTeamMember）與 K6 saveMemberMatchData 的動作層契約。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClubViewer, TeamDoc } from '../../data/types';
import {
  getKickErrorMessage,
  kickTeamMember,
  saveMemberMatchData,
} from './member-management-actions';

const mocks = vi.hoisted(() => ({
  callFn: vi.fn(),
  saveTeamMemberMatchData: vi.fn(),
  writeOpLog: vi.fn(),
}));

vi.mock('@/data/callables', () => ({ callFn: mocks.callFn }));
vi.mock('@/data/inbox-delivery', () => ({ deliverInboxMessage: vi.fn() }));
vi.mock('@/data/op-log', () => ({ writeOpLog: mocks.writeOpLog }));
vi.mock('../../data/teams-write', () => ({
  MEMBER_MATCH_LIMITS: { jerseyNumber: 12, position: 20, notes: 80 },
  saveTeamMemberMatchData: mocks.saveTeamMemberMatchData,
  saveTeamMemberNote: vi.fn(),
  saveTeamRoleChange: vi.fn(),
}));

const team: TeamDoc = {
  id: 'tm_k4',
  _docId: 'tm_k4',
  name: '測試俱樂部',
  captainUid: 'U-cap',
  creatorUid: 'U-owner',
  leaderUids: ['U-lead'],
  coachUids: ['U-coach'],
};

function viewer(uid: string, manageAll = false): ClubViewer & { displayName: string } {
  return {
    uid,
    displayName: `名-${uid}`,
    teamIds: new Set(['tm_k4']),
    hasPermission: (code) => manageAll && code === 'team.manage_all',
  };
}

beforeEach(() => {
  mocks.callFn.mockResolvedValue({ ok: true, alreadyRemoved: false, memberCount: 3 });
  mocks.saveTeamMemberMatchData.mockResolvedValue(undefined);
  mocks.writeOpLog.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('kickTeamMember', () => {
  it.each(['U-cap', 'U-lead', 'U-coach'])('幹部 %s 剔一般隊員 → 呼叫 removeTeamMember', async (uid) => {
    const result = await kickTeamMember({ team, viewer: viewer(uid), targetUid: ' U-mem ' });
    expect(result).toEqual({ ok: true, alreadyRemoved: false });
    expect(mocks.callFn).toHaveBeenCalledTimes(1);
    expect(mocks.callFn).toHaveBeenCalledWith('removeTeamMember', { teamId: 'tm_k4', memberUid: 'U-mem' });
  });

  it.each(['U-cap', 'U-lead', 'U-coach'])('目標是幹部 %s（含自己）→ not-regular，不呼叫伺服器', async (target) => {
    const result = await kickTeamMember({ team, viewer: viewer('U-cap'), targetUid: target });
    expect(result).toEqual({ ok: false, reason: 'not-regular' });
    expect(mocks.callFn).not.toHaveBeenCalled();
  });

  it('一般用戶、擁有者（非幹部欄位）、只有 team.manage_all 的管理員 → forbidden（照 A _canManageTeamMembers）', async () => {
    for (const v of [viewer('U-mem'), viewer('U-owner'), viewer('U-admin', true)]) {
      expect(await kickTeamMember({ team, viewer: v, targetUid: 'U-mem2' })).toEqual({ ok: false, reason: 'forbidden' });
    }
    expect(mocks.callFn).not.toHaveBeenCalled();
  });

  it('alreadyRemoved 照實回報', async () => {
    mocks.callFn.mockResolvedValue({ ok: true, alreadyRemoved: true });
    expect(await kickTeamMember({ team, viewer: viewer('U-cap'), targetUid: 'U-mem' }))
      .toEqual({ ok: true, alreadyRemoved: true });
  });

  it('Callable 錯誤往外拋，錯誤碼轉成 A 文案', async () => {
    mocks.callFn.mockRejectedValue(new Error('COACH_PLUS_REQUIRED'));
    await expect(kickTeamMember({ team, viewer: viewer('U-cap'), targetUid: 'U-mem' })).rejects.toThrow();
    // 測試同步更新（C1）：顯示文字「隊員」統一為「成員」。
    expect(getKickErrorMessage(new Error('COACH_PLUS_REQUIRED'))).toBe('您沒有移除成員的權限');
    expect(getKickErrorMessage(new Error('TEAM_MANAGE_DENIED'))).toBe('您沒有移除成員的權限');
    expect(getKickErrorMessage(new Error('TARGET_IS_STAFF'))).toBe('僅可移除一般成員');
    expect(getKickErrorMessage(new Error('MEMBER_NOT_FOUND'))).toBe('成員資料不存在或已不在俱樂部中');
    expect(getKickErrorMessage(new Error('TEAM_ID_MISMATCH'))).toBe('此俱樂部資料格式較舊，請聯繫管理員處理');
    expect(getKickErrorMessage(new Error('boom'))).toBe('移除失敗，請稍後再試');
  });
});

describe('saveMemberMatchData', () => {
  const base = {
    team,
    memberKey: 'U-mem',
    jerseyNumber: ' 10 ',
    position: ' ST ',
    notes: ' 先發 ',
    memberName: '隊員甲',
    now: new Date('2026-11-02T04:00:00.000Z'),
  };

  it('幹部可寫：值 trim 後交給 teams-write，並寫一筆 A 的操作日誌', async () => {
    const result = await saveMemberMatchData({ ...base, viewer: viewer('U-coach') });
    expect(result).toEqual({ ok: true });
    expect(mocks.saveTeamMemberMatchData).toHaveBeenCalledWith(team, 'U-mem', {
      jerseyNumber: '10',
      position: 'ST',
      notes: '先發',
      updatedAt: '2026-11-02T04:00:00.000Z',
    });
    expect(mocks.writeOpLog).toHaveBeenCalledWith(expect.objectContaining({
      type: 'team_member_match_data_update',
      typeName: '編輯成員賽事數據',
      actorUid: 'U-coach',
      operator: '名-U-coach',
    }));
  });

  it('非幹部 forbidden、不寫', async () => {
    expect(await saveMemberMatchData({ ...base, viewer: viewer('U-mem') })).toEqual({ ok: false, reason: 'forbidden' });
    expect(mocks.saveTeamMemberMatchData).not.toHaveBeenCalled();
  });

  it('超過 A 上限（背號 12）回 invalid', async () => {
    expect(await saveMemberMatchData({ ...base, viewer: viewer('U-cap'), jerseyNumber: '1234567890123' }))
      .toEqual({ ok: false, reason: 'invalid' });
    expect(mocks.saveTeamMemberMatchData).not.toHaveBeenCalled();
  });

  it('操作日誌失敗不影響結果', async () => {
    mocks.writeOpLog.mockRejectedValue(new Error('denied'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await saveMemberMatchData({ ...base, viewer: viewer('U-cap') })).toEqual({ ok: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
