import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── mocks（必須在 import 之下）─────────────
vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(),
}));
vi.mock('@/data/callables', () => ({
  callFn: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
}));

import { callFn } from '@/data/callables';
import { getFirebase } from '@/data/firebase';
import {
  doc as fsDoc,
  getDoc as fsGetDoc,
  serverTimestamp as fsServerTimestamp,
  updateDoc as fsUpdateDoc,
} from 'firebase/firestore';

import { InternalTestBlockedError, sha256Hex } from '@/data/internal-test';
import golden from './__fixtures__/membership-golden.json';
import {
  approveTeamJoin,
  buildApproveMembershipUpdate,
  buildLeaveMembershipUpdate,
  leaveTeam,
  normalizeMembership,
  rejectTeamJoin,
  requestTeamJoin,
} from './membership';
import type { TeamDoc, TeamMember } from './types';

/* ──────────────────────────────────────────────────
 * 純函式 golden 測試（讀 __fixtures__/membership-golden.json）
 * ────────────────────────────────────────────────── */

describe('normalizeMembership (golden)', () => {
  for (const tc of golden.normalizeMembership) {
    it(tc.name, () => {
      expect(normalizeMembership(tc.input as Record<string, unknown>)).toEqual(tc.output);
    });
  }
});

describe('buildApproveMembershipUpdate (golden)', () => {
  for (const tc of golden.buildApproveMembershipUpdate) {
    it(tc.name, () => {
      const { applicantLiveDoc, teamId, teamName } = tc.input as {
        applicantLiveDoc: Record<string, unknown>;
        teamId: string;
        teamName: string;
      };
      expect(buildApproveMembershipUpdate(applicantLiveDoc, teamId, teamName)).toEqual(
        tc.output,
      );
    });
  }
});

describe('buildLeaveMembershipUpdate (golden)', () => {
  for (const tc of golden.buildLeaveMembershipUpdate) {
    it(tc.name, () => {
      const { selfDoc, teamId } = tc.input as {
        selfDoc: Record<string, unknown>;
        teamId: string;
      };
      expect(buildLeaveMembershipUpdate(selfDoc, teamId)).toEqual(tc.output);
    });
  }
});

/* ──────────────────────────────────────────────────
 * 非同步動作測試（Callable 名稱、request 欄位、寫入路徑、payload、best-effort）
 * ────────────────────────────────────────────────── */

const mockDb = { __db: 'mock' };
const callFnMock = vi.mocked(callFn);
const getFirebaseMock = vi.mocked(getFirebase);
const docMock = vi.mocked(fsDoc);
const getDocMock = vi.mocked(fsGetDoc);
const updateDocMock = vi.mocked(fsUpdateDoc);
const serverTimestampMock = vi.mocked(fsServerTimestamp);

type CallFnImpl = (name: string, request: unknown) => Promise<unknown>;

const defaultCallFnImpl: CallFnImpl = async (name) => {
  if (name === 'deliverToInbox') return { success: true, delivered: 1 };
  if (name === 'syncGroupActionStatus') return { success: true, updated: 0 };
  if (name === 'autoPromoteTeamRole') return { success: true, targetUid: '', newRole: 'user' };
  if (name === 'writeAuditLog') return { success: true, dayKey: '', timeKey: '' };
  if (name === 'enqueuePrivilegedLineNotification') {
    return { queued: true, skipped: false, queueId: 'q1' };
  }
  return { success: true };
};

beforeEach(() => {
  vi.clearAllMocks();
  getFirebaseMock.mockResolvedValue({ db: mockDb } as never);
  docMock.mockImplementation(((...args: unknown[]) => {
    const path = args.slice(1).map((v) => String(v)).join('/');
    return { __ref: path } as never;
  }) as never);
  getDocMock.mockResolvedValue({
    exists: () => true,
    data: () => ({}),
  } as never);
  updateDocMock.mockResolvedValue(undefined as never);
  serverTimestampMock.mockReturnValue({ __serverTimestamp: true } as never);
  callFnMock.mockImplementation(defaultCallFnImpl as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── requestTeamJoin ─────────────────────────── */

describe('requestTeamJoin', () => {
  const baseTeam: TeamDoc = {
    id: 'team_main',
    name: 'Main Team',
    captainUid: 'cap_uid',
    leaderUids: ['leader_uid'],
    coachUids: ['coach_uid'],
  };
  const baseApplicant: TeamMember = {
    uid: 'applicant_uid',
    displayName: '申請者',
  };

  it('deliverToInbox 對每位幹部 + enqueuePrivilegedLineNotification + writeAuditLog', async () => {
    const result = await requestTeamJoin({ team: baseTeam, applicant: baseApplicant });
    expect(result).toBeTruthy();
    expect((result as { groupId: string }).groupId).toMatch(/^tjr_/);

    const calls = callFnMock.mock.calls;

    // deliverToInbox 三次（cap/leader/coach）+ line 三次 + audit 一次
    const inboxCalls = calls.filter((c) => c[0] === 'deliverToInbox');
    expect(inboxCalls).toHaveLength(3);
    const deliveredUids = inboxCalls.map((c) => (c[1] as { targetUid: string }).targetUid);
    expect(deliveredUids.sort()).toEqual(['cap_uid', 'coach_uid', 'leader_uid']);

    for (const c of inboxCalls) {
      const req = c[1] as { message: Record<string, unknown>; targetUid: string };
      expect(req.message['title']).toBe('俱樂部加入申請');
      expect(req.message['body']).toBe('申請者 申請加入「Main Team」俱樂部，請審核此申請。');
      expect(req.message['type']).toBe('system');
      expect(req.message['typeName']).toBe('系統');
      expect(req.message['senderName']).toBe('申請者');
      expect(req.message['actionType']).toBe('team_join_request');
      expect(req.message['actionStatus']).toBe('pending');
      const meta = req.message['meta'] as Record<string, unknown>;
      expect(meta).toMatchObject({
        teamId: 'team_main',
        teamName: 'Main Team',
        applicantUid: 'applicant_uid',
        applicantName: '申請者',
      });
      expect(meta['groupId']).toMatch(/^tjr_/);
    }

    const lineCalls = calls.filter((c) => c[0] === 'enqueuePrivilegedLineNotification');
    expect(lineCalls).toHaveLength(3);
    for (const c of lineCalls) {
      const req = c[1] as Record<string, unknown>;
      expect(req['category']).toBe('system');
      expect(req['source']).toBe('team_join_request');
      expect(typeof req['uid']).toBe('string');
      expect(req['title']).toBe('俱樂部加入申請');
    }

    const auditCalls = calls.filter((c) => c[0] === 'writeAuditLog');
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]![1]).toMatchObject({
      action: 'team_join_request',
      targetType: 'team',
      targetId: 'team_main',
      targetLabel: 'Main Team',
      result: 'success',
      source: 'web',
    });
  });

  it('LINE 推播失敗不影響主結果', async () => {
    callFnMock.mockImplementation((async (name: string, request: unknown) => {
      if (name === 'enqueuePrivilegedLineNotification') {
        throw new Error('line push down');
      }
      return defaultCallFnImpl(name, request);
    }) as never);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      requestTeamJoin({ team: baseTeam, applicant: baseApplicant }),
    ).resolves.toBeTruthy();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('無幹部 → 拋錯', async () => {
    await expect(
      requestTeamJoin({
        team: { id: 'team_empty', name: 'Empty' },
        applicant: baseApplicant,
      }),
    ).rejects.toThrow(/no staff/);
  });

  it('全部 deliverToInbox 失敗 → 拋錯', async () => {
    callFnMock.mockImplementation((async (name: string) => {
      if (name === 'deliverToInbox') throw new Error('delivery down');
      return { success: true };
    }) as never);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      requestTeamJoin({ team: baseTeam, applicant: baseApplicant }),
    ).rejects.toThrow(/all staff deliveries failed/);
  });
});

/* ── approveTeamJoin ─────────────────────────── */

describe('approveTeamJoin', () => {
  const team: TeamDoc = {
    id: 'team_main',
    name: 'Main Team',
    captainUid: 'cap_uid',
    leaderUids: ['leader_uid'],
    coachUids: [],
  };
  const reviewer: TeamMember = { uid: 'cap_uid', displayName: '隊長' };
  const message = {
    id: 'msg_cap_1',
    meta: {
      teamId: 'team_main',
      teamName: 'Main Team',
      applicantUid: 'applicant_uid',
      applicantName: '申請者',
      groupId: 'tjr_group_1',
    },
  };

  it('先讀 applicant live doc，再寫 users（含 serverTimestamp）；照 A 不呼叫 autoPromoteTeamRole', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        teamIds: ['team_a'],
        teamNames: ['Team A'],
        teamId: 'team_a',
        teamName: 'Team A',
      }),
    } as never);
    updateDocMock.mockResolvedValue(undefined as never);

    const result = await approveTeamJoin({
      team,
      applicantUid: 'applicant_uid',
      message,
      reviewer,
    });

    expect(result.changed).toBe(true);

    // 讀 users/applicant_uid
    expect(getDocMock).toHaveBeenCalled();
    const readRef = docMock.mock.calls.find((c) =>
      (c as unknown[]).slice(1).join('/').endsWith('users/applicant_uid'),
    );
    expect(readRef).toBeTruthy();

    // 寫 users/applicant_uid 帶 serverTimestamp + 正確 payload
    const userWrite = updateDocMock.mock.calls.find((c) => {
      const ref = (c[0] as { __ref?: string } | undefined)?.__ref ?? '';
      return ref === 'users/applicant_uid';
    });
    expect(userWrite).toBeTruthy();
    const payload = userWrite![1] as unknown as Record<string, unknown>;
    expect(payload['teamIds']).toEqual(['team_a', 'team_main']);
    expect(payload['teamNames']).toEqual(['Team A', 'Main Team']);
    expect(payload['teamId']).toBe('team_a');
    expect(payload['teamName']).toBe('Team A');
    expect(payload['updatedAt']).toEqual({ __serverTimestamp: true });

    // A handleTeamJoinAction 核准分支不重算角色
    expect(callFnMock.mock.calls.some((c) => c[0] === 'autoPromoteTeamRole')).toBe(false);

    // syncGroupActionStatus
    const sync = callFnMock.mock.calls.find((c) => c[0] === 'syncGroupActionStatus');
    expect(sync).toBeTruthy();
    expect(sync![1]).toMatchObject({
      groupId: 'tjr_group_1',
      newStatus: 'approved',
      reviewerName: '隊長',
    });

    // 不直寫審核者收件匣（inbox Rules 只允許本人改 read／readAt），由 syncGroupActionStatus 更新
    const inboxWrite = updateDocMock.mock.calls.find((c) => {
      const ref = (c[0] as { __ref?: string } | undefined)?.__ref ?? '';
      return ref.includes('/inbox/');
    });
    expect(inboxWrite).toBeUndefined();
  });

  it('changed=false（已在隊上）時不寫 users 但仍同步訊息狀態', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        teamIds: ['team_main'],
        teamNames: ['Main Team'],
        teamId: 'team_main',
        teamName: 'Main Team',
      }),
    } as never);

    const result = await approveTeamJoin({
      team,
      applicantUid: 'applicant_uid',
      message,
      reviewer,
    });
    expect(result.changed).toBe(false);

    const userWrite = updateDocMock.mock.calls.find((c) => {
      const ref = (c[0] as { __ref?: string } | undefined)?.__ref ?? '';
      return ref === 'users/applicant_uid';
    });
    expect(userWrite).toBeUndefined();

    const sync = callFnMock.mock.calls.find((c) => c[0] === 'syncGroupActionStatus');
    expect(sync).toBeTruthy();
  });

  it('writeAuditLog 失敗不影響主結果', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        teamIds: ['team_a'],
        teamNames: ['Team A'],
        teamId: 'team_a',
        teamName: 'Team A',
      }),
    } as never);
    callFnMock.mockImplementation((async (name: string, request: unknown) => {
      if (name === 'writeAuditLog') throw new Error('audit down');
      return defaultCallFnImpl(name, request);
    }) as never);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      approveTeamJoin({ team, applicantUid: 'applicant_uid', message, reviewer }),
    ).resolves.toMatchObject({ changed: true });
  });

  it('users 主寫入失敗往外拋', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        teamIds: ['team_a'],
        teamNames: ['Team A'],
        teamId: 'team_a',
        teamName: 'Team A',
      }),
    } as never);
    updateDocMock.mockImplementation((async (ref: unknown) => {
      const r = ref as { __ref?: string };
      if (r.__ref === 'users/applicant_uid') throw new Error('permission-denied');
    }) as never);

    await expect(
      approveTeamJoin({ team, applicantUid: 'applicant_uid', message, reviewer }),
    ).rejects.toThrow(/permission-denied/);
  });
});

/* ── rejectTeamJoin ──────────────────────────── */

describe('rejectTeamJoin', () => {
  const team: TeamDoc = {
    id: 'team_main',
    name: 'Main Team',
    captainUid: 'cap_uid',
    leaderUids: ['leader_uid'],
    coachUids: [],
  };
  const reviewer: TeamMember = { uid: 'cap_uid', displayName: '隊長' };
  const message = {
    id: 'msg_cap_1',
    meta: {
      teamId: 'team_main',
      teamName: 'Main Team',
      applicantUid: 'applicant_uid',
      applicantName: '申請者',
      groupId: 'tjr_group_1',
    },
  };

  it('syncGroupActionStatus 是主要寫入：失敗時往外拋，且不通知申請人、不寫 audit', async () => {
    callFnMock.mockImplementation((async (name: string) => {
      if (name === 'syncGroupActionStatus') throw new Error('sync down');
      return { success: true };
    }) as never);
    await expect(
      rejectTeamJoin({ team, applicantUid: 'applicant_uid', message, reviewer }),
    ).rejects.toThrow('sync down');
    const names = callFnMock.mock.calls.map((c) => c[0]);
    expect(names).toEqual(['syncGroupActionStatus']);
  });

  it('訊息沒有 groupId 時拒絕操作，不呼叫任何 Callable', async () => {
    const legacy = { ...message, meta: { ...message.meta, groupId: undefined } };
    await expect(
      rejectTeamJoin({ team, applicantUid: 'applicant_uid', message: legacy as never, reviewer }),
    ).rejects.toThrow(/groupId/);
    expect(callFnMock).not.toHaveBeenCalled();
  });

  it('先同步審核狀態，再通知申請人', async () => {
    await rejectTeamJoin({ team, applicantUid: 'applicant_uid', message, reviewer });
    const names = callFnMock.mock.calls.map((c) => c[0]);
    expect(names[0]).toBe('syncGroupActionStatus');
    expect(names.indexOf('deliverToInbox')).toBeGreaterThan(0);
  });

  it('不寫 users、不直寫收件匣，只用 syncGroupActionStatus 更新審核狀態', async () => {
    await rejectTeamJoin({ team, applicantUid: 'applicant_uid', message, reviewer });

    const userWrite = updateDocMock.mock.calls.find((c) => {
      const ref = (c[0] as { __ref?: string } | undefined)?.__ref ?? '';
      return ref === 'users/applicant_uid';
    });
    expect(userWrite).toBeUndefined();

    // inbox Rules 只允許本人改 read／readAt；審核者訊息由 syncGroupActionStatus 更新
    const inboxWrite = updateDocMock.mock.calls.find((c) => {
      const ref = (c[0] as { __ref?: string } | undefined)?.__ref ?? '';
      return ref.includes('/inbox/');
    });
    expect(inboxWrite).toBeUndefined();

    const sync = callFnMock.mock.calls.find((c) => c[0] === 'syncGroupActionStatus');
    expect(sync).toBeTruthy();
    expect(sync![1]).toMatchObject({ newStatus: 'rejected', reviewerName: '隊長' });

    // autoPromoteTeamRole 不應被呼叫
    const autoPromote = callFnMock.mock.calls.find(
      (c) => c[0] === 'autoPromoteTeamRole',
    );
    expect(autoPromote).toBeUndefined();
  });

  it('通知 applicant 透過 deliverToInbox', async () => {
    await rejectTeamJoin({ team, applicantUid: 'applicant_uid', message, reviewer });
    const calls = callFnMock.mock.calls.filter((c) => c[0] === 'deliverToInbox');
    const toApplicant = calls.find(
      (c) => (c[1] as { targetUid: string }).targetUid === 'applicant_uid',
    );
    expect(toApplicant).toBeTruthy();
    const req = toApplicant![1] as { message: Record<string, unknown> };
    expect(req.message['title']).toBe('俱樂部申請結果');
    expect(req.message['body']).toContain('很抱歉');
  });
});

/* ── leaveTeam ───────────────────────────────── */

describe('leaveTeam', () => {
  const team: TeamDoc = {
    id: 'team_main',
    name: 'Main Team',
    captainUid: 'cap_uid',
    leaderUids: ['leader_uid'],
    coachUids: ['coach_uid'],
  };

  it('單隊使用者 → 寫清空形狀並回 stillStaff=false', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        teamIds: ['team_main'],
        teamNames: ['Main Team'],
        teamId: 'team_main',
        teamName: 'Main Team',
      }),
    } as never);

    const self: TeamMember = { uid: 'regular_uid', displayName: '一般' };
    const result = await leaveTeam({ team, self });

    expect(result.stillStaff).toBe(false);

    const write = updateDocMock.mock.calls.find((c) => {
      const ref = (c[0] as { __ref?: string } | undefined)?.__ref ?? '';
      return ref === 'users/regular_uid';
    });
    expect(write).toBeTruthy();
    const payload = write![1] as unknown as Record<string, unknown>;
    expect(payload['teamId']).toBeNull();
    expect(payload['teamName']).toBeNull();
    expect(payload['teamIds']).toEqual([]);
    expect(payload['teamNames']).toEqual([]);
    expect(payload['updatedAt']).toEqual({ __serverTimestamp: true });

    const autoPromote = callFnMock.mock.calls.find(
      (c) => c[0] === 'autoPromoteTeamRole',
    );
    expect(autoPromote).toBeTruthy();
    expect(autoPromote![1]).toMatchObject({ targetUid: 'regular_uid', teamId: 'team_main' });
  });

  it('coach 退出 → stillStaff=true（B 不寫 team.coachUids）', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        teamIds: ['team_main', 'team_other'],
        teamNames: ['Main Team', 'Other Team'],
        teamId: 'team_main',
        teamName: 'Main Team',
      }),
    } as never);

    const self: TeamMember = { uid: 'coach_uid', displayName: '教練' };
    const result = await leaveTeam({ team, self });

    expect(result.stillStaff).toBe(true);
    // 沒有 teams/{id} 寫入
    const teamWrite = updateDocMock.mock.calls.find((c) => {
      const ref = (c[0] as { __ref?: string } | undefined)?.__ref ?? '';
      return ref.startsWith('teams/');
    });
    expect(teamWrite).toBeUndefined();
  });

  it('users 主寫入失敗往外拋', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        teamIds: ['team_main'],
        teamNames: ['Main Team'],
        teamId: 'team_main',
        teamName: 'Main Team',
      }),
    } as never);
    updateDocMock.mockImplementation((async () => {
      throw new Error('permission-denied');
    }) as never);

    await expect(
      leaveTeam({ team, self: { uid: 'regular_uid' } }),
    ).rejects.toThrow(/permission-denied/);
  });

  it('autoPromoteTeamRole 失敗只 warn，主結果成功', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        teamIds: ['team_main'],
        teamNames: ['Main Team'],
        teamId: 'team_main',
        teamName: 'Main Team',
      }),
    } as never);
    callFnMock.mockImplementation((async (name: string) => {
      if (name === 'autoPromoteTeamRole') throw new Error('role service down');
      return { success: true };
    }) as never);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await leaveTeam({ team, self: { uid: 'regular_uid' } });
    expect(result.stillStaff).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('內測模式守衛', () => {
  const realTeam: TeamDoc = {
    id: 'team_main',
    name: 'Main Team',
    captainUid: 'cap_uid',
    leaderUids: ['leader_uid'],
    coachUids: ['coach_uid'],
  };

  afterEach(() => vi.unstubAllEnvs());

  it('對真實俱樂部申請加入被擋，不呼叫任何 Callable', async () => {
    vi.stubEnv('VITE_INTERNAL_TEST', '1');
    vi.stubEnv('VITE_INTERNAL_TEST_UID_HASHES', await sha256Hex('applicant_uid'));
    await expect(requestTeamJoin({ team: realTeam, applicant: { uid: 'applicant_uid', displayName: '申請者' } }))
      .rejects.toBeInstanceOf(InternalTestBlockedError);
    expect(callFn).not.toHaveBeenCalled();
  });

  it('申請人與幹部全在名單 → 照常送出', async () => {
    vi.stubEnv('VITE_INTERNAL_TEST', '1');
    const hashes = await Promise.all(
      ['applicant_uid', 'cap_uid', 'leader_uid', 'coach_uid'].map((uid) => sha256Hex(uid)),
    );
    vi.stubEnv('VITE_INTERNAL_TEST_UID_HASHES', hashes.join(','));
    await requestTeamJoin({ team: realTeam, applicant: { uid: 'applicant_uid', displayName: '申請者' } });
    expect(callFn).toHaveBeenCalledWith('deliverToInbox', expect.anything());
  });

  it('名稱帶 [內測] 不豁免：幹部不在名單照樣擋，不呼叫任何 Callable', async () => {
    vi.stubEnv('VITE_INTERNAL_TEST', '1');
    vi.stubEnv('VITE_INTERNAL_TEST_UID_HASHES', await sha256Hex('applicant_uid'));
    await expect(requestTeamJoin({
      team: { ...realTeam, name: '[內測] 測試隊' },
      applicant: { uid: 'applicant_uid', displayName: '申請者' },
    })).rejects.toBeInstanceOf(InternalTestBlockedError);
    expect(callFn).not.toHaveBeenCalled();
  });

  it('核准名單外的申請人：寫入任何資料前就擋下（不留半套資料）', async () => {
    vi.stubEnv('VITE_INTERNAL_TEST', '1');
    const hashes = await Promise.all(['cap_uid', 'leader_uid', 'coach_uid'].map((uid) => sha256Hex(uid)));
    vi.stubEnv('VITE_INTERNAL_TEST_UID_HASHES', hashes.join(','));
    await expect(approveTeamJoin({
      team: { ...realTeam, name: '[內測] 測試隊' },
      applicantUid: 'real_applicant',
      message: { meta: { groupId: 'tjr_1', teamName: '[內測] 測試隊', applicantName: '路人' } },
      reviewer: { uid: 'cap_uid', displayName: '隊長' },
    } as Parameters<typeof approveTeamJoin>[0])).rejects.toBeInstanceOf(InternalTestBlockedError);
    expect(fsGetDoc).not.toHaveBeenCalled();
    expect(fsUpdateDoc).not.toHaveBeenCalled();
    expect(callFn).not.toHaveBeenCalled();
  });
});
