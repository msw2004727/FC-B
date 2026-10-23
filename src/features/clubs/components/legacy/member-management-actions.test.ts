/**
 * 驗證 A team-detail.js:1436-1540 角色變更與 :1685-1768 活動備註契約。
 * 使用真的 club-policy；驗證 B 不寫 members／captainUid、不提供剔除、
 * 副作用 best-effort，以及備註 120 字硬上限與不寫 opLog 的差異。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMemberRoleUpdates } from '../../club-policy';
import type { MemberRoleTarget, MemberRoleUpdates } from '../../club-policy';
import type { saveTeamRoleChange } from '../../data/teams-write';
import type { ClubViewer, TeamDoc } from '../../data/types';
import {
  changeMemberRole,
  getRoleChangeLabels,
  getTeamRoleOfMember,
  saveMemberActivityNote,
} from './member-management-actions';
import type { ChangeMemberRoleInput, SaveMemberNoteInput } from './member-management-actions';

const mocks = vi.hoisted(() => ({
  saveTeamRoleChange: vi.fn<typeof saveTeamRoleChange>(), // 測試同步更新
  saveTeamMemberNote: vi.fn(),
  callFn: vi.fn(),
  deliverInboxMessage: vi.fn(),
}));

vi.mock('../../data/teams-write', () => ({
  saveTeamRoleChange: mocks.saveTeamRoleChange, // 測試同步更新
  saveTeamMemberNote: mocks.saveTeamMemberNote,
}));
vi.mock('@/data/callables', () => ({ callFn: mocks.callFn }));
vi.mock('@/data/inbox-delivery', () => ({
  deliverInboxMessage: mocks.deliverInboxMessage,
}));

function makeTeam(): TeamDoc {
  return {
    id: 'tm_test_1',
    name: '測試俱樂部',
    captainUid: 'U-cap',
    leaderUids: ['U-lead'],
    leaders: ['領隊甲'],
    coachUids: ['U-coach'],
    coaches: ['教練甲'],
    members: 4,
  };
}

function makeViewer(uid = 'U-cap', manageAll = false): ClubViewer {
  return {
    uid,
    teamIds: new Set(['tm_test_1']),
    hasPermission: (code) => manageAll && code === 'team.manage_all',
  };
}

function roleInput(overrides: Partial<ChangeMemberRoleInput> = {}): ChangeMemberRoleInput {
  return {
    team: makeTeam(),
    viewer: makeViewer(),
    targetUid: 'U-mem',
    displayName: '隊員甲',
    direction: 'promote',
    ...overrides,
  };
}

function noteInput(overrides: Partial<SaveMemberNoteInput> = {}): SaveMemberNoteInput {
  return {
    team: makeTeam(),
    viewer: makeViewer(),
    memberKey: 'U-mem',
    notes: '  穩定出席  ',
    now: new Date('2026-10-23T01:02:03.000Z'),
    ...overrides,
  };
}

function expectNoWrites(): void {
  expect(mocks.saveTeamRoleChange).not.toHaveBeenCalled(); // 測試同步更新
  expect(mocks.saveTeamMemberNote).not.toHaveBeenCalled();
  expect(mocks.callFn).not.toHaveBeenCalled();
  expect(mocks.deliverInboxMessage).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  // 測試同步更新：預設模擬交易成功，實際交易讀最新資料另由寫入層測試。
  mocks.saveTeamRoleChange.mockImplementation(async (team, uid, key, name, guard) => {
    const fresh = team as TeamDoc;
    if (guard && !guard(fresh)) return null;
    return buildMemberRoleUpdates(fresh, uid, key, name);
  });
  mocks.saveTeamMemberNote.mockResolvedValue(undefined);
  mocks.callFn.mockResolvedValue({});
  mocks.deliverInboxMessage.mockResolvedValue({});
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('變更成員職務', () => {
  // 測試同步更新：legacy 領隊可降為教練，交易 guard 與稽核採相同角色判定。
  it('只有 legacy 領隊時降級成功，寫入 coach 並稽核原角色 leader', async () => {
    const team = makeTeam();
    delete team.leaderUids;
    team.leaderUid = 'U-lead';
    const input = roleInput({
      team,
      targetUid: 'U-lead',
      displayName: '領隊甲',
      direction: 'demote',
    });

    await expect(changeMemberRole(input)).resolves.toEqual({
      ok: true,
      target: { key: 'coach', level: 1, direction: 'demote' },
    });
    expect(mocks.saveTeamRoleChange).toHaveBeenCalledExactlyOnceWith(
      team, 'U-lead', 'coach', '領隊甲', expect.any(Function),
    );
    await expect(mocks.saveTeamRoleChange.mock.results[0]?.value)
      .resolves.toMatchObject({
        leaderUids: [],
        leaderUid: null,
        coachUids: ['U-coach', 'U-lead'],
      });
    expect(mocks.callFn).toHaveBeenCalledWith(
      'writeAuditLog',
      expect.objectContaining({
        meta: {
          teamId: 'tm_test_1',
          statusFrom: 'leader',
          statusTo: 'coach',
        },
      }),
    );
  });
  it('主要寫入採真的政策計算結果，逐欄投遞通知、重算與稽核', async () => {
    const input = roleInput();
    const expectedUpdates = buildMemberRoleUpdates(
      input.team, 'U-mem', 'coach', '隊員甲',
    );

    await expect(changeMemberRole(input)).resolves.toEqual({
      ok: true,
      target: { key: 'coach', level: 1, direction: 'promote' },
    });

    // 測試同步更新：action 傳入目標與 guard，由交易計算角色欄位。
    expect(mocks.saveTeamRoleChange).toHaveBeenCalledExactlyOnceWith(
      input.team, 'U-mem', 'coach', '隊員甲', expect.any(Function),
    );
    await expect(mocks.saveTeamRoleChange.mock.results[0]?.value)
      .resolves.toEqual(expectedUpdates);
    expect(mocks.callFn).toHaveBeenCalledWith('autoPromoteTeamRole', {
      targetUid: 'U-mem',
      teamId: 'tm_test_1',
    });
    expect(mocks.deliverInboxMessage).toHaveBeenCalledExactlyOnceWith({
      title: '俱樂部層級調整',
      body: '您在「測試俱樂部」的俱樂部層級已調整為教練。',
      category: 'system',
      categoryName: '系統',
      targetUid: 'U-mem',
      senderName: '系統',
      senderUid: 'U-cap',
    });
    expect(mocks.callFn).toHaveBeenCalledWith('enqueuePrivilegedLineNotification', {
      uid: 'U-mem',
      title: '俱樂部層級調整',
      body: '您在「測試俱樂部」的俱樂部層級已調整為教練。',
      category: 'system',
      source: 'team_role_assignment:coach',
    });
    expect(mocks.callFn).toHaveBeenCalledWith('writeAuditLog', {
      action: 'role_change',
      targetType: 'team',
      targetId: 'tm_test_1',
      targetLabel: '測試俱樂部',
      result: 'success',
      source: 'web',
      meta: {
        teamId: 'tm_test_1',
        statusFrom: 'member',
        statusTo: 'coach',
      },
    });
    expect(mocks.callFn).toHaveBeenCalledTimes(3);
    expect(mocks.saveTeamMemberNote).not.toHaveBeenCalled();

    const savedUpdates: unknown = await mocks.saveTeamRoleChange.mock.results[0]?.value;
    expect(savedUpdates).not.toHaveProperty('members');
    expect(savedUpdates).not.toHaveProperty('captainUid');
  });

  // 測試同步更新：以真的政策驗證交易中的權限與目標守衛。
  it.each(['目標已晉升', '操作者已失去權限'] as const)(
    '最新資料%s時回 no-target 且沒有副作用',
    async (scenario) => {
      const fresh: TeamDoc = scenario === '目標已晉升'
        ? {
            ...makeTeam(),
            coachUids: ['U-coach', 'U-mem'],
            coaches: ['教練甲', '隊員甲'],
          }
        : { ...makeTeam(), captainUid: 'U-new-cap' };
      const transactionWrite = vi.fn();
      mocks.saveTeamRoleChange.mockImplementationOnce(async (_team, uid, key, name, guard) => {
        if (!guard) throw new Error('缺少交易 guard');
        if (!guard(fresh)) return null;
        transactionWrite();
        return buildMemberRoleUpdates(fresh, uid, key, name);
      });

      await expect(changeMemberRole(roleInput())).resolves.toEqual({
        ok: false,
        reason: 'no-target',
      });
      expect(mocks.saveTeamRoleChange).toHaveBeenCalledTimes(1);
      expect(transactionWrite).not.toHaveBeenCalled();
      expect(mocks.callFn).not.toHaveBeenCalled();
      expect(mocks.deliverInboxMessage).not.toHaveBeenCalled();
      expect(mocks.saveTeamMemberNote).not.toHaveBeenCalled();
    },
  );

  it('交易回 null 時沒有任何副作用', async () => {
    mocks.saveTeamRoleChange.mockResolvedValueOnce(null);
    await expect(changeMemberRole(roleInput())).resolves.toEqual({
      ok: false,
      reason: 'no-target',
    });
    expect(mocks.callFn).not.toHaveBeenCalled();
    expect(mocks.deliverInboxMessage).not.toHaveBeenCalled();
    expect(mocks.saveTeamMemberNote).not.toHaveBeenCalled();
  });

  it('領隊操作角色變更被拒絕，沒有任何寫入', async () => {
    await expect(changeMemberRole(roleInput({
      viewer: makeViewer('U-lead'),
    }))).resolves.toEqual({ ok: false, reason: 'forbidden' });
    expectNoWrites();
  });

  it('具全域權限仍不能調整球經', async () => {
    await expect(changeMemberRole(roleInput({
      viewer: makeViewer('U-lead', true),
      targetUid: 'U-cap',
    }))).resolves.toEqual({ ok: false, reason: 'no-target' });
    expectNoWrites();
  });

  it('不能對自己升降職務', async () => {
    await expect(changeMemberRole(roleInput({
      viewer: makeViewer('U-coach', true),
      targetUid: 'U-coach',
    }))).resolves.toEqual({ ok: false, reason: 'no-target' });
    expectNoWrites();
  });

  it('一般隊員無法再降級', async () => {
    await expect(changeMemberRole(roleInput({
      direction: 'demote',
    }))).resolves.toEqual({ ok: false, reason: 'no-target' });
    expectNoWrites();
  });

  // 測試同步更新
  it('saveTeamRoleChange 失敗往外拋，不呼叫任何副作用', async () => {
    const error = new Error('主要寫入失敗');
    mocks.saveTeamRoleChange.mockRejectedValueOnce(error);
    await expect(changeMemberRole(roleInput())).rejects.toBe(error);
    expect(mocks.saveTeamRoleChange).toHaveBeenCalledTimes(1);
    expect(mocks.callFn).not.toHaveBeenCalled();
    expect(mocks.deliverInboxMessage).not.toHaveBeenCalled();
    expect(mocks.saveTeamMemberNote).not.toHaveBeenCalled();
  });

  it('主要寫入完成之前不啟動副作用', async () => {
    let finish: () => void = () => {
      throw new Error('尚未建立寫入 Promise');
    };
    // 測試同步更新：交易完成時回傳更新內容。
    mocks.saveTeamRoleChange.mockImplementationOnce((team, uid, key, name) =>
      new Promise<MemberRoleUpdates | null>((resolve) => {
        finish = () => resolve(buildMemberRoleUpdates(team as TeamDoc, uid, key, name));
      }));

    const pending = changeMemberRole(roleInput());
    expect(mocks.callFn).not.toHaveBeenCalled();
    expect(mocks.deliverInboxMessage).not.toHaveBeenCalled();

    finish();
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(mocks.callFn).toHaveBeenCalledTimes(3);
  });

  it.each([
    'internal',
    'functions/internal',
    'unavailable',
    'functions/unavailable',
    'deadline-exceeded',
    'functions/deadline-exceeded',
  ])('重算首次遇到暫時性錯誤 %s 時只重試一次', async (code) => {
    let attempts = 0;
    mocks.callFn.mockImplementation(async (name: string) => {
      if (name === 'autoPromoteTeamRole') {
        attempts += 1;
        if (attempts === 1) throw { code };
      }
      return {};
    });

    await expect(changeMemberRole(roleInput())).resolves.toMatchObject({ ok: true });
    expect(attempts).toBe(2);
    expect(mocks.callFn.mock.calls.filter(
      ([name]) => name === 'autoPromoteTeamRole',
    )).toHaveLength(2);
  });

  it.each(['permission-denied', 'functions/permission-denied', 'unknown'])(
    '重算遇到不可重試錯誤 %s 時只呼叫一次且主結果成功',
    async (code) => {
      mocks.callFn.mockImplementation(async (name: string) => {
        if (name === 'autoPromoteTeamRole') throw { code };
        return {};
      });
      await expect(changeMemberRole(roleInput())).resolves.toMatchObject({ ok: true });
      expect(mocks.callFn.mock.calls.filter(
        ([name]) => name === 'autoPromoteTeamRole',
      )).toHaveLength(1);
      expect(console.warn).toHaveBeenCalled();
    },
  );

  it('重算連續失敗最多兩次，記錄警告後仍成功', async () => {
    mocks.callFn.mockImplementation(async (name: string) => {
      if (name === 'autoPromoteTeamRole') throw { code: 'internal' };
      return {};
    });

    await expect(changeMemberRole(roleInput())).resolves.toMatchObject({ ok: true });
    expect(mocks.callFn.mock.calls.filter(
      ([name]) => name === 'autoPromoteTeamRole',
    )).toHaveLength(2);
    expect(console.warn).toHaveBeenCalled();
    expect(mocks.deliverInboxMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    'deliverInboxMessage',
    'enqueuePrivilegedLineNotification',
    'writeAuditLog',
  ])('%s 失敗不影響主結果或其他副作用', async (failingAction) => {
    if (failingAction === 'deliverInboxMessage') {
      mocks.deliverInboxMessage.mockRejectedValueOnce(new Error('站內信失敗'));
    }
    mocks.callFn.mockImplementation(async (name: string) => {
      if (name === failingAction) throw new Error('副作用失敗');
      return {};
    });

    await expect(changeMemberRole(roleInput())).resolves.toMatchObject({ ok: true });
    expect(console.warn).toHaveBeenCalled();
    expect(mocks.deliverInboxMessage).toHaveBeenCalledTimes(1);
    expect(mocks.callFn.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'autoPromoteTeamRole',
        'enqueuePrivilegedLineNotification',
        'writeAuditLog',
      ]),
    );
  });

  it('空名稱使用 UID 快取，缺少業務 ID 與隊名時使用指定回退', async () => {
    const input = roleInput({
      team: {
        _docId: 'tm_test_1',
        captainUid: 'U-cap',
        name: '',
      },
      displayName: '   ',
    });
    await changeMemberRole(input);
    // 測試同步更新
    expect(mocks.saveTeamRoleChange).toHaveBeenCalledWith(
      input.team, 'U-mem', 'coach', 'U-mem', expect.any(Function),
    );
    expect(mocks.callFn).toHaveBeenCalledWith('autoPromoteTeamRole', {
      targetUid: 'U-mem',
      teamId: 'tm_test_1',
    });
    expect(mocks.deliverInboxMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: '您在「俱樂部」的俱樂部層級已調整為教練。',
    }));
  });

  it('教練降為隊員時通知來源與稽核保存正確前後角色', async () => {
    await expect(changeMemberRole(roleInput({
      targetUid: 'U-coach',
      displayName: '教練甲',
      direction: 'demote',
    }))).resolves.toEqual({
      ok: true,
      target: { key: 'member', level: 0, direction: 'demote' },
    });
    expect(mocks.callFn).toHaveBeenCalledWith(
      'enqueuePrivilegedLineNotification',
      expect.objectContaining({ source: 'team_role_assignment:member' }),
    );
    expect(mocks.callFn).toHaveBeenCalledWith(
      'writeAuditLog',
      expect.objectContaining({
        meta: {
          teamId: 'tm_test_1',
          statusFrom: 'coach',
          statusTo: 'member',
        },
      }),
    );
  });
});

describe('儲存活動備註', () => {
  it('修剪備註與成員鍵，沿用既有資料並保存注入的 ISO 時間', async () => {
    const existing = { attendance: 8, notes: '舊備註' };
    const input = noteInput({ memberKey: ' U-mem ', existingRecord: existing });

    await expect(saveMemberActivityNote(input)).resolves.toEqual({ ok: true });
    expect(mocks.saveTeamMemberNote).toHaveBeenCalledExactlyOnceWith(
      input.team,
      'activity',
      'U-mem',
      { notes: '穩定出席', updatedAt: '2026-10-23T01:02:03.000Z' },
      existing,
    );
    expect(mocks.callFn).not.toHaveBeenCalled();
    expect(mocks.deliverInboxMessage).not.toHaveBeenCalled();
    expect(mocks.saveTeamRoleChange).not.toHaveBeenCalled(); // 測試同步更新
  });

  it.each(['U-cap', 'U-lead', 'U-coach'])('%s 可編輯活動備註', async (uid) => {
    await expect(saveMemberActivityNote(noteInput({
      viewer: makeViewer(uid),
    }))).resolves.toEqual({ ok: true });
    expect(mocks.saveTeamMemberNote).toHaveBeenCalledTimes(1);
  });

  it('一般成員被拒絕且沒有寫入', async () => {
    await expect(saveMemberActivityNote(noteInput({
      viewer: makeViewer('U-mem'),
    }))).resolves.toEqual({ ok: false, reason: 'forbidden' });
    expectNoWrites();
  });

  it.each([
    { notes: '字'.repeat(121) },
    { memberKey: ' \n ' },
    { notes: 123 as unknown as string },
  ])('拒絕超長備註、空成員鍵或非字串備註：%j', async (overrides) => {
    await expect(saveMemberActivityNote(noteInput(overrides))).resolves.toEqual({
      ok: false, reason: 'invalid',
    });
    expectNoWrites();
  });

  it('修剪後正好 120 字可儲存，缺少既有資料時傳 null', async () => {
    const input = noteInput({ notes: ` ${'字'.repeat(120)} ` });
    await expect(saveMemberActivityNote(input)).resolves.toEqual({ ok: true });
    expect(mocks.saveTeamMemberNote).toHaveBeenCalledWith(
      input.team,
      'activity',
      'U-mem',
      { notes: '字'.repeat(120), updatedAt: '2026-10-23T01:02:03.000Z' },
      null,
    );
  });

  it.each(['', ' \n '])('允許以空備註清除：%j', async (notes) => {
    const input = noteInput({ notes });
    await expect(saveMemberActivityNote(input)).resolves.toEqual({ ok: true });
    expect(mocks.saveTeamMemberNote).toHaveBeenCalledWith(
      input.team,
      'activity',
      'U-mem',
      { notes: '', updatedAt: '2026-10-23T01:02:03.000Z' },
      null,
    );
  });

  it('寫入失敗原樣往外拋', async () => {
    const error = new Error('備註寫入失敗');
    mocks.saveTeamMemberNote.mockRejectedValueOnce(error);
    await expect(saveMemberActivityNote(noteInput())).rejects.toBe(error);
    expect(mocks.callFn).not.toHaveBeenCalled();
  });
});

describe('角色文字與 UID 角色辨識', () => {
  const labelCases: Array<{
    target: MemberRoleTarget;
    actionText: '晉升' | '降級';
    roleName: '教練' | '領隊' | '隊員';
  }> = [
    {
      target: { key: 'coach', level: 1, direction: 'promote' },
      actionText: '晉升', roleName: '教練',
    },
    {
      target: { key: 'leader', level: 2, direction: 'promote' },
      actionText: '晉升', roleName: '領隊',
    },
    {
      target: { key: 'coach', level: 1, direction: 'demote' },
      actionText: '降級', roleName: '教練',
    },
    {
      target: { key: 'member', level: 0, direction: 'demote' },
      actionText: '降級', roleName: '隊員',
    },
  ];

  it.each(labelCases)('產生 $actionText 為 $roleName 的文字', ({
    target, actionText, roleName,
  }) => {
    expect(getRoleChangeLabels(target)).toEqual({ actionText, roleName });
  });

  it.each([
    ['U-cap', 'captain'],
    ['U-lead', 'leader'],
    ['U-coach', 'coach'],
    ['U-mem', 'member'],
    ['', 'member'],
  ])('依 UID 將 %s 判定為 %s', (uid, role) => {
    expect(getTeamRoleOfMember(makeTeam(), uid)).toBe(role);
  });

  it('同時具領隊及教練 UID 時優先領隊，球經優先所有角色', () => {
    const team: TeamDoc = {
      captainUid: 'U-cap',
      leaderUids: ['U-cap', 'U-lead'],
      coachUids: ['U-cap', 'U-lead'],
    };
    expect(getTeamRoleOfMember(team, 'U-lead')).toBe('leader');
    expect(getTeamRoleOfMember(team, 'U-cap')).toBe('captain');
  });

  // 測試同步更新：只有 legacy 領隊時回退，與教練重疊仍優先領隊。
  it('缺少或非陣列領隊欄位時採 legacy 單值', () => {
    expect(getTeamRoleOfMember({
      leaderUid: ' U-lead ',
    }, ' U-lead ')).toBe('leader');
    expect(getTeamRoleOfMember({
      leaderUid: 'U-lead',
      leaderUids: null,
      coachUids: ['U-lead'],
    }, 'U-lead')).toBe('leader');
  });

  // 測試同步更新：空陣列與非空陣列均優先於 legacy 單值。
  it('領隊陣列存在時不回退 legacy', () => {
    for (const leaderUids of [[], ['U-other']]) {
      expect(getTeamRoleOfMember({
        leaderUids,
        leaderUid: 'U-lead',
      }, 'U-lead')).toBe('member');
      expect(getTeamRoleOfMember({
        leaderUids,
        leaderUid: 'U-lead',
        coachUids: ['U-lead'],
      }, 'U-lead')).toBe('coach');
    }
  });

  // 測試同步更新：保留非陣列教練、名稱欄位與空 UID 的既有語意。
  it('忽略非陣列教練與顯示名稱，沒有 UID 不判作球經', () => {
    const team: TeamDoc = {
      coachUids: 'U-coach',
      captain: 'U-mem',
      leaders: ['U-mem'],
    };
    expect(getTeamRoleOfMember(team, 'U-coach')).toBe('member');
    expect(getTeamRoleOfMember(team, 'U-mem')).toBe('member');
    expect(getTeamRoleOfMember({}, '')).toBe('member');
  });

  it('UID 比對與政策一致，修剪前後空白', () => {
    expect(getTeamRoleOfMember({
      leaderUids: [' U-lead '],
    }, ' U-lead ')).toBe('leader');
  });
});
