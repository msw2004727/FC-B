// `ignoreTeamJoin` 單元測試（M-137 照 A `handleTeamJoinAction` 的 ignore 分支）。
//
// ASSUMPTION: 本單所有權雖列「membership.test.ts 補測」，但該檔未在附件中；為避免覆寫既有測試，
// 本卡新增獨立測試檔 `membership-ignore.test.ts`。若 PM 要求集中於 `membership.test.ts`，
// 可將本檔內容整併進該檔後刪除本檔。

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { callFnMock } = vi.hoisted(() => ({ callFnMock: vi.fn() }));
const { writeOpLogMock } = vi.hoisted(() => ({ writeOpLogMock: vi.fn() }));

vi.mock('@/data/callables', () => ({
  callFn: callFnMock,
}));

// 避免真正載入 firebase 相關模組（membership.ts 靜態 import 了 getFirebase 與 deliverInbox）。
vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(),
}));

vi.mock('@/data/inbox-delivery', () => ({
  deliverInboxMessage: vi.fn(),
}));

// opLog 走動態 import；以 mock 避免真正載入 firebase/firestore。
vi.mock('@/data/op-log', () => ({
  writeOpLog: writeOpLogMock,
}));

import { ignoreTeamJoin } from '@/features/clubs/data/membership';
import type { InboxMessageForReview } from '@/features/clubs/data/membership';
import type { TeamDoc } from '@/features/clubs/data/types';

const TEAM_ID = 'team1';

function makeTeam(overrides: Partial<TeamDoc> = {}): TeamDoc {
  return { id: TEAM_ID, name: '測試隊', ...overrides } as TeamDoc;
}

function makeMessage(metaOverrides: Record<string, unknown> = {}): InboxMessageForReview {
  return {
    id: 'msg1',
    meta: {
      teamId: TEAM_ID,
      teamName: '測試隊',
      applicantUid: 'Uapplicant',
      applicantName: '候選人',
      groupId: 'g1',
      ...metaOverrides,
    },
  };
}

function makeReviewer(): { uid: string; displayName: string } {
  return { uid: 'Ureviewer', displayName: '審核人' };
}

describe('ignoreTeamJoin（M-137）', () => {
  beforeEach(() => {
    callFnMock.mockReset();
    callFnMock.mockResolvedValue({ success: true, updated: 1 });
    writeOpLogMock.mockReset();
    writeOpLogMock.mockResolvedValue(undefined);
  });

  it('呼叫 syncGroupActionStatus，參數為 { groupId, newStatus: "ignored", reviewerName }', async () => {
    await ignoreTeamJoin({
      team: makeTeam(),
      message: makeMessage(),
      reviewer: makeReviewer(),
    });
    expect(callFnMock).toHaveBeenCalledTimes(1);
    expect(callFnMock).toHaveBeenCalledWith('syncGroupActionStatus', {
      groupId: 'g1',
      newStatus: 'ignored',
      reviewerName: '審核人',
    });
  });

  it('沒有 groupId 時 throw 且不呼叫 syncGroupActionStatus', async () => {
    await expect(
      ignoreTeamJoin({
        team: makeTeam(),
        message: {
          id: 'msg1',
          meta: { teamId: TEAM_ID, applicantName: '候選人' },
        } as InboxMessageForReview,
        reviewer: makeReviewer(),
      }),
    ).rejects.toThrow(/groupId/);
    expect(callFnMock).not.toHaveBeenCalled();
  });

  it('opLog 失敗不影響結果（best-effort）', async () => {
    writeOpLogMock.mockRejectedValueOnce(new Error('oplog failed'));
    await expect(
      ignoreTeamJoin({
        team: makeTeam(),
        message: makeMessage(),
        reviewer: makeReviewer(),
      }),
    ).resolves.toBeUndefined();
    // 主要寫入仍成功
    expect(callFnMock).toHaveBeenCalledTimes(1);
  });

  it('只呼叫 syncGroupActionStatus 一次；不呼叫其他 callable（無 audit／通知／broadcast）', async () => {
    await ignoreTeamJoin({
      team: makeTeam(),
      message: makeMessage(),
      reviewer: makeReviewer(),
    });
    expect(callFnMock).toHaveBeenCalledTimes(1);
    const firstCall = callFnMock.mock.calls[0] as unknown[];
    // A 的 ignore 分支：只寫 opLog，不發通知、不寫 audit。
    expect(firstCall[0]).toBe('syncGroupActionStatus');
  });

  it('syncGroupActionStatus 失敗往外拋（主要寫入不得 silent fail）', async () => {
    callFnMock.mockRejectedValueOnce(new Error('sync failed'));
    await expect(
      ignoreTeamJoin({
        team: makeTeam(),
        message: makeMessage(),
        reviewer: makeReviewer(),
      }),
    ).rejects.toThrow('sync failed');
  });

  it('opLog 參數照 A：type=team_approve、typeName=俱樂部審批、content 含「忽略」「候選人」「測試隊」', async () => {
    await ignoreTeamJoin({
      team: makeTeam(),
      message: makeMessage(),
      reviewer: makeReviewer(),
    });
    expect(writeOpLogMock).toHaveBeenCalledTimes(1);
    const arg = writeOpLogMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.type).toBe('team_approve');
    expect(arg.typeName).toBe('俱樂部審批');
    expect(typeof arg.content).toBe('string');
    expect(String(arg.content)).toContain('忽略');
    expect(String(arg.content)).toContain('候選人');
    expect(String(arg.content)).toContain('測試隊');
    expect(arg.actorUid).toBe('Ureviewer');
  });

  it('opLog 的 actorUid 為 null 時不影響流程（Rules 拒寫仍屬 best-effort）', async () => {
    await ignoreTeamJoin({
      team: makeTeam(),
      message: makeMessage(),
      reviewer: { uid: '', displayName: '審核人' },
    });
    // 主要寫入仍成功
    expect(callFnMock).toHaveBeenCalledTimes(1);
    const arg = writeOpLogMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.actorUid).toBeNull();
  });
});
