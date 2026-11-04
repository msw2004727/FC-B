// T-090：自建俱樂部（createdVia === 'user_capability'）入隊審核改走 Callable reviewTeamJoin。
//
// 修正前應失敗的理由：修正前 approve／reject／ignore 一律直寫 users、呼叫 syncGroupActionStatus，
// 並由客戶端自己發核准／拒絕通知（deliverInboxMessage／enqueuePrivilegedLineNotification），
// 沒有任何 reviewTeamJoin 呼叫；錯誤也不會轉成使用者可懂的文案。

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { callFnMock, deliverMock, getDocMock, updateDocMock } = vi.hoisted(() => ({
  callFnMock: vi.fn(),
  deliverMock: vi.fn(),
  getDocMock: vi.fn(),
  updateDocMock: vi.fn(),
}));

vi.mock('@/data/callables', () => ({ callFn: callFnMock }));
vi.mock('@/data/firebase', () => ({ getFirebase: vi.fn(async () => ({ db: {} })) }));
vi.mock('@/data/inbox-delivery', () => ({ deliverInboxMessage: deliverMock }));
vi.mock('@/data/op-log', () => ({ writeOpLog: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, c: string, id: string) => ({ c, id })),
  getDoc: getDocMock,
  updateDoc: updateDocMock,
  serverTimestamp: vi.fn(() => ({ __ts: true })),
}));
vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/i18n')>()),
  t: (key: string) => key,
}));

import {
  approveTeamJoin,
  ignoreTeamJoin,
  rejectTeamJoin,
} from '@/features/clubs/data/membership';
import type { InboxMessageForReview } from '@/features/clubs/data/membership';
import type { TeamDoc } from '@/features/clubs/data/types';
import { getUserFacingMessage } from '@/features/clubs/data/user-team-errors';

const TEAM_ID = 'tm_1792700000000_own001';

function ownTeam(overrides: Partial<TeamDoc> = {}): TeamDoc {
  return {
    id: TEAM_ID,
    name: '自建隊',
    captainUid: 'Ucap',
    createdVia: 'user_capability',
    ...overrides,
  } as TeamDoc;
}

function message(): InboxMessageForReview {
  return {
    id: 'msg1',
    meta: {
      teamId: TEAM_ID,
      teamName: '自建隊',
      applicantUid: 'Uapplicant',
      applicantName: '候選人',
      groupId: 'tjr_1',
    },
  };
}

const reviewer = { uid: 'Ucap', displayName: '經理' };

function okResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    teamId: TEAM_ID,
    groupId: 'tjr_1',
    applicantUid: 'Uapplicant',
    actionStatus: 'approved',
    alreadyReviewed: false,
    membershipAdded: true,
    alreadyMember: false,
    updatedMessages: 1,
    notification: null,
    ...overrides,
  };
}

function calledNames(): string[] {
  return callFnMock.mock.calls.map(([name]) => name as string);
}

describe('T-090 自建俱樂部入隊審核走 reviewTeamJoin', () => {
  beforeEach(() => {
    callFnMock.mockReset();
    deliverMock.mockReset();
    getDocMock.mockReset();
    updateDocMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('approve：呼叫 reviewTeamJoin，membershipAdded 時重算人數；不直寫 users、不自發通知、不呼叫 syncGroupActionStatus', async () => {
    callFnMock.mockImplementation(async (name: string) =>
      name === 'reviewTeamJoin' ? okResponse() : { success: true, members: 2 });
    const result = await approveTeamJoin({
      team: ownTeam(), applicantUid: 'Uapplicant', message: message(), reviewer,
    });
    expect(result).toEqual({ changed: true });
    expect(callFnMock).toHaveBeenCalledWith('reviewTeamJoin', {
      teamId: TEAM_ID, groupId: 'tjr_1', applicantUid: 'Uapplicant', action: 'approve',
    });
    expect(callFnMock).toHaveBeenCalledWith('recountTeamMembers', { teamId: TEAM_ID });
    expect(calledNames()).not.toContain('syncGroupActionStatus');
    expect(calledNames()).not.toContain('enqueuePrivilegedLineNotification');
    // 測試同步更新（T-090 P2-4）：原斷言「不呼叫 writeAuditLog」；審查要求自建路徑補寫與既有路徑相同的審計紀錄。
    expect(callFnMock).toHaveBeenCalledWith('writeAuditLog', {
      action: 'team_join_approve',
      targetType: 'team',
      targetId: TEAM_ID,
      targetLabel: '自建隊',
      result: 'success',
      meta: { teamId: TEAM_ID, statusTo: 'approved' },
      source: 'web',
    });
    expect(deliverMock).not.toHaveBeenCalled();
    expect(getDocMock).not.toHaveBeenCalled();
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('approve：已是成員（membershipAdded=false）不重算人數', async () => {
    // 測試同步更新（T-090 P2-4）：本次做出決定（alreadyReviewed=false）會補寫審計紀錄。
    callFnMock.mockResolvedValue(okResponse({ membershipAdded: false, alreadyMember: true }));
    const result = await approveTeamJoin({
      team: ownTeam(), applicantUid: 'Uapplicant', message: message(), reviewer,
    });
    expect(result).toEqual({ changed: false });
    expect(calledNames()).toEqual(['reviewTeamJoin', 'writeAuditLog']);
  });

  it('reject／ignore：呼叫 reviewTeamJoin（action 各自對應），只有拒絕寫審計紀錄', async () => {
    // 測試同步更新（T-090 P2-4）：拒絕補寫 team_join_reject；忽略照既有路徑不寫。
    callFnMock.mockResolvedValue(okResponse({ membershipAdded: false, actionStatus: 'rejected' }));
    await rejectTeamJoin({ team: ownTeam(), applicantUid: 'Uapplicant', message: message(), reviewer });
    await ignoreTeamJoin({ team: ownTeam(), message: message(), reviewer });
    expect(callFnMock.mock.calls).toEqual([
      ['reviewTeamJoin', { teamId: TEAM_ID, groupId: 'tjr_1', applicantUid: 'Uapplicant', action: 'reject' }],
      ['writeAuditLog', {
        action: 'team_join_reject',
        targetType: 'team',
        targetId: TEAM_ID,
        targetLabel: '自建隊',
        result: 'success',
        meta: { teamId: TEAM_ID, statusTo: 'rejected' },
        source: 'web',
      }],
      ['reviewTeamJoin', { teamId: TEAM_ID, groupId: 'tjr_1', applicantUid: 'Uapplicant', action: 'ignore' }],
    ]);
    expect(deliverMock).not.toHaveBeenCalled();
  });

  // T-090 P2-4：修正前自建路徑完全不寫審計紀錄（應失敗）；先前已審過（alreadyReviewed=true）則不重寫。
  it('先前已審過不重寫審計紀錄；審計失敗不影響審核結果', async () => {
    callFnMock.mockResolvedValue(okResponse({ alreadyReviewed: true, membershipAdded: false }));
    await approveTeamJoin({ team: ownTeam(), applicantUid: 'Uapplicant', message: message(), reviewer });
    expect(calledNames()).toEqual(['reviewTeamJoin']);

    callFnMock.mockReset();
    callFnMock.mockImplementation(async (name: string) => {
      if (name === 'writeAuditLog') throw new Error('audit down');
      return name === 'reviewTeamJoin' ? okResponse({ membershipAdded: false }) : {};
    });
    await expect(approveTeamJoin({
      team: ownTeam(), applicantUid: 'Uapplicant', message: message(), reviewer,
    })).resolves.toEqual({ changed: false });
    expect(calledNames()).toEqual(['reviewTeamJoin', 'writeAuditLog']);
  });

  // T-090 P3-6：修正前送 team.id；舊格式俱樂部（公開 id ≠ 文件 ID）時後端比對 meta.teamId 會不符（應失敗）。
  it('送出的 teamId 以申請 meta.teamId 優先，沒有才用 team.id', async () => {
    callFnMock.mockResolvedValue(okResponse({ alreadyReviewed: true, membershipAdded: false }));
    await ignoreTeamJoin({ team: ownTeam({ id: 'doc_id_1' }), message: message(), reviewer });
    const noMetaTeam = message();
    noMetaTeam.meta = { ...noMetaTeam.meta, teamId: '' };
    await ignoreTeamJoin({ team: ownTeam({ id: 'doc_id_1' }), message: noMetaTeam, reviewer });
    expect(callFnMock.mock.calls.map(([, payload]) => (payload as { teamId: string }).teamId))
      .toEqual([TEAM_ID, 'doc_id_1']);
  });

  it('錯誤碼轉成使用者文案（UserFacingError），不露出原始錯誤', async () => {
    callFnMock.mockRejectedValueOnce(
      Object.assign(new Error('TEAM_JOIN_REQUEST_NOT_PENDING'), { code: 'functions/failed-precondition' }),
    );
    const error = await approveTeamJoin({
      team: ownTeam(), applicantUid: 'Uapplicant', message: message(), reviewer,
    }).catch((err: unknown) => err);
    expect(getUserFacingMessage(error)).toBe('clubs.joinReview.error.notPending');

    callFnMock.mockRejectedValueOnce(new Error('Error: internal at index.js:99'));
    const unknown = await rejectTeamJoin({
      team: ownTeam(), applicantUid: 'Uapplicant', message: message(), reviewer,
    }).catch((err: unknown) => err);
    expect(getUserFacingMessage(unknown)).toBe('clubs.joinReview.error.failed');
  });

  it('既有俱樂部不倒退：仍走 syncGroupActionStatus，不呼叫 reviewTeamJoin', async () => {
    callFnMock.mockResolvedValue({ success: true, updated: 1 });
    await ignoreTeamJoin({ team: ownTeam({ createdVia: undefined }), message: message(), reviewer });
    expect(calledNames()).toEqual(['syncGroupActionStatus']);
  });
});
