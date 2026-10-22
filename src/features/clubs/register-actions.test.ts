import { describe, it, expect, beforeEach, vi } from 'vitest';

const { loadTeamMock, approveMock, rejectMock, ignoreMock } = vi.hoisted(() => {
  const loadTeamMock = vi.fn();
  const approveMock = vi.fn(() => Promise.resolve({ changed: true }));
  const rejectMock = vi.fn(() => Promise.resolve());
  const ignoreMock = vi.fn(() => Promise.resolve());
  return { loadTeamMock, approveMock, rejectMock, ignoreMock };
});

vi.mock('@/features/clubs/data/teams-repo', () => ({
  loadTeam: loadTeamMock,
}));

vi.mock('@/features/clubs/data/membership', () => ({
  approveTeamJoin: approveMock,
  rejectTeamJoin: rejectMock,
  ignoreTeamJoin: ignoreMock,
}));

// 匯入就會觸發 registerMessageAction('team_join_request', …)
import '@/features/clubs/register-actions';
import { clearMessageActions, getMessageAction } from '@/core/action-registry';
import type { InboxMessageLike, MessageActionViewer } from '@/core/action-registry';
import type { TeamDoc } from '@/features/clubs/data/types';

const TEAM_ID = 'team1';
const CAPTAIN_UID = 'Ucap';
const LEADER_IN_ARRAY = 'UleadA';
const LEADER_ONLY_LEGACY = 'UleadOld';
const COACH_UID = 'Ucoach';
const RANDOM_UID = 'Urandom';

function makeMessage(overrides: Partial<InboxMessageLike> = {}): InboxMessageLike {
  return {
    id: 'msg1',
    actionType: 'team_join_request',
    actionStatus: 'pending',
    meta: {
      teamId: TEAM_ID,
      applicantUid: 'Uapplicant',
      applicantName: '候選人',
      groupId: 'g1',
    },
    ...overrides,
  };
}

function makeViewer(uid: string, extras: Partial<MessageActionViewer> = {}): MessageActionViewer {
  return { uid, role: 'user', ...extras };
}

function teamWith(overrides: Partial<TeamDoc>): TeamDoc {
  return { id: TEAM_ID, _docId: TEAM_ID, ...overrides } as TeamDoc;
}

describe('register-actions: team_join_request', () => {
  beforeEach(() => {
    loadTeamMock.mockReset();
    approveMock.mockReset();
    approveMock.mockImplementation(() => Promise.resolve({ changed: true }));
    rejectMock.mockReset();
    rejectMock.mockImplementation(() => Promise.resolve());
    ignoreMock.mockReset();
    ignoreMock.mockImplementation(() => Promise.resolve());
  });

  it('匯入時即登錄 team_join_request', () => {
    const handler = getMessageAction('team_join_request');
    expect(handler).not.toBeNull();
    // 測試同步更新：照 A（M-137）新增 ignore 動作。
    expect(handler!.actions.map((a) => a.key)).toEqual(['approve', 'reject', 'ignore']);
  });

  it('隊長可操作（captainUid 相符）', async () => {
    loadTeamMock.mockResolvedValueOnce(
      teamWith({ captainUid: CAPTAIN_UID, coachUids: [] }),
    );
    const handler = getMessageAction('team_join_request')!;
    expect(await handler.canAct(makeViewer(CAPTAIN_UID), makeMessage())).toBe(true);
  });

  it('多領隊以陣列優先：陣列中的領隊可、只有 legacy leaderUid 的不行', async () => {
    loadTeamMock.mockResolvedValue(
      teamWith({
        captainUid: 'Usomeone',
        leaderUids: [LEADER_IN_ARRAY],
        leaderUid: LEADER_ONLY_LEGACY,
        coachUids: [],
      }),
    );
    const handler = getMessageAction('team_join_request')!;

    expect(await handler.canAct(makeViewer(LEADER_IN_ARRAY), makeMessage())).toBe(true);
    expect(await handler.canAct(makeViewer(LEADER_ONLY_LEGACY), makeMessage())).toBe(false);
  });

  it('教練可操作（coachUids 包含）', async () => {
    loadTeamMock.mockResolvedValueOnce(
      teamWith({ captainUid: 'Usomeone', coachUids: [COACH_UID] }),
    );
    const handler = getMessageAction('team_join_request')!;
    expect(await handler.canAct(makeViewer(COACH_UID), makeMessage())).toBe(true);
  });

  it('非幹部不可操作', async () => {
    loadTeamMock.mockResolvedValueOnce(
      teamWith({ captainUid: CAPTAIN_UID, coachUids: [COACH_UID] }),
    );
    const handler = getMessageAction('team_join_request')!;
    expect(await handler.canAct(makeViewer(RANDOM_UID), makeMessage())).toBe(false);
  });

  it('已處理訊息（actionStatus 非 pending）不可操作，即使 viewer 是隊長', async () => {
    loadTeamMock.mockResolvedValueOnce(teamWith({ captainUid: CAPTAIN_UID }));
    const handler = getMessageAction('team_join_request')!;
    expect(
      await handler.canAct(
        makeViewer(CAPTAIN_UID),
        makeMessage({ actionStatus: 'approved' }),
      ),
    ).toBe(false);
    // 亦不應觸發 team 讀取
    expect(loadTeamMock).not.toHaveBeenCalled();
  });

  it('admin/super_admin 直接放行', async () => {
    loadTeamMock.mockResolvedValue(teamWith({ captainUid: 'Uother' }));
    const handler = getMessageAction('team_join_request')!;
    expect(
      await handler.canAct(makeViewer(RANDOM_UID, { role: 'admin' }), makeMessage()),
    ).toBe(true);
    expect(
      await handler.canAct(makeViewer(RANDOM_UID, { role: 'super_admin' }), makeMessage()),
    ).toBe(true);
  });

  it('有 hasPermission 且兩個權限碼都沒授予時直接擋', async () => {
    loadTeamMock.mockResolvedValue(teamWith({ captainUid: CAPTAIN_UID }));
    const handler = getMessageAction('team_join_request')!;
    const deniedViewer: MessageActionViewer = {
      uid: CAPTAIN_UID,
      role: 'user',
      hasPermission: () => false,
    };
    expect(await handler.canAct(deniedViewer, makeMessage())).toBe(false);
    // 沒有讀 team 就已經從 hasPermission 分支擋下
    expect(loadTeamMock).not.toHaveBeenCalled();
  });

  it('有 hasPermission 且其中一個權限碼授予時可繼續判定', async () => {
    loadTeamMock.mockResolvedValue(teamWith({ captainUid: CAPTAIN_UID }));
    const handler = getMessageAction('team_join_request')!;
    const granted: MessageActionViewer = {
      uid: CAPTAIN_UID,
      role: 'user',
      hasPermission: (code) => code === 'team.review_join',
    };
    expect(await handler.canAct(granted, makeMessage())).toBe(true);
  });

  it('uid 為空時不可操作', async () => {
    const handler = getMessageAction('team_join_request')!;
    expect(
      await handler.canAct({ uid: null, role: 'user' }, makeMessage()),
    ).toBe(false);
  });

  it('meta.teamId 缺失時不可操作（loadTeam 不呼叫）', async () => {
    const handler = getMessageAction('team_join_request')!;
    expect(
      await handler.canAct(
        makeViewer(CAPTAIN_UID),
        makeMessage({ meta: { applicantUid: 'Uapplicant' } }),
      ),
    ).toBe(false);
    expect(loadTeamMock).not.toHaveBeenCalled();
  });

  it('approve 動作呼叫 approveTeamJoin，request 含 team/applicantUid/message/reviewer', async () => {
    loadTeamMock.mockResolvedValue(teamWith({ captainUid: CAPTAIN_UID }));
    const handler = getMessageAction('team_join_request')!;
    const message = makeMessage();
    const viewer = makeViewer(CAPTAIN_UID, { displayName: '隊長' });
    await handler.actions[0]!.run(message, viewer);
    expect(approveMock).toHaveBeenCalledTimes(1);
    const arg = (approveMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect((arg as { team: TeamDoc }).team.id).toBe(TEAM_ID);
    expect(arg.applicantUid).toBe('Uapplicant');
    expect(arg.message).toBe(message);
    expect(arg.reviewer).toEqual({ uid: CAPTAIN_UID, displayName: '隊長' });
  });

  it('reject 動作呼叫 rejectTeamJoin', async () => {
    loadTeamMock.mockResolvedValue(teamWith({ captainUid: CAPTAIN_UID }));
    const handler = getMessageAction('team_join_request')!;
    await handler.actions[1]!.run(makeMessage(), makeViewer(CAPTAIN_UID));
    expect(rejectMock).toHaveBeenCalledTimes(1);
    const arg = (rejectMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect((arg as { team: TeamDoc }).team.id).toBe(TEAM_ID);
    expect(arg.applicantUid).toBe('Uapplicant');
  });

  // 測試同步更新：照 A（M-137）新增 ignore 動作測試。
  it('ignore 動作呼叫 ignoreTeamJoin，request 含 team/message/reviewer', async () => {
    loadTeamMock.mockResolvedValue(teamWith({ captainUid: CAPTAIN_UID }));
    const handler = getMessageAction('team_join_request')!;
    const message = makeMessage();
    const viewer = makeViewer(CAPTAIN_UID, { displayName: '隊長' });
    await handler.actions[2]!.run(message, viewer);
    expect(ignoreMock).toHaveBeenCalledTimes(1);
    const arg = (ignoreMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect((arg as { team: TeamDoc }).team.id).toBe(TEAM_ID);
    expect(arg.message).toBe(message);
    expect(arg.reviewer).toEqual({ uid: CAPTAIN_UID, displayName: '隊長' });
  });

  it('無權限時 approve／reject／ignore 三個動作都不可見（canAct=false 統一擋）', async () => {
    loadTeamMock.mockResolvedValue(teamWith({ captainUid: 'Uother' }));
    const handler = getMessageAction('team_join_request')!;
    const stranger = makeViewer(RANDOM_UID);
    expect(await handler.canAct(stranger, makeMessage())).toBe(false);
    // actions 陣列本身三個動作齊備，可見性由 canAct 統一決定（與 approve／reject 同一權限判斷，R-IAM-011）。
    expect(handler.actions.map((a) => a.key)).toEqual(['approve', 'reject', 'ignore']);
  });

  it('無權限時直接執行 approve／reject／ignore 都會丟錯且不寫入（run 內再用 canAct 檢查，R-IAM-011）', async () => {
    loadTeamMock.mockResolvedValue(teamWith({ captainUid: 'Uother' }));
    const handler = getMessageAction('team_join_request')!;
    const stranger = makeViewer(RANDOM_UID);
    for (const action of handler.actions) {
      await expect(action.run(makeMessage(), stranger)).rejects.toThrow('permission denied');
    }
    expect(approveMock).not.toHaveBeenCalled();
    expect(rejectMock).not.toHaveBeenCalled();
    expect(ignoreMock).not.toHaveBeenCalled();
  });

  it('approve 找不到 team 時丟錯（不外洩空 success）', async () => {
    loadTeamMock.mockResolvedValueOnce(null);
    const handler = getMessageAction('team_join_request')!;
    await expect(handler.actions[0]!.run(makeMessage(), makeViewer(CAPTAIN_UID))).rejects.toThrow();
    expect(approveMock).not.toHaveBeenCalled();
  });

  it('清空登錄表後 getMessageAction 回 null（測試用 API）', () => {
    clearMessageActions();
    expect(getMessageAction('team_join_request')).toBeNull();
  });
});
