import { describe, expect, it } from 'vitest';

import {
  buildMemberRoleUpdates,
  canChangeMemberRole,
  canEditMemberNote,
  canEditTeamSettings,
  canKickMember,
  canManageMembers,
  canShowInviteQr,
  canViewMemberNote,
  getMemberRoleChangeTarget,
} from './club-policy';
import type {
  MemberRoleDirection,
  MemberRoleKey,
  MemberRoleTarget,
} from './club-policy';
import type { ClubViewer as ClubMemberViewer, TeamDoc } from './data/types';

function makeViewer(
  uid: string | null,
  {
    teamIds = new Set<string>(),
    perms = new Set<string>(),
  }: {
    teamIds?: ReadonlySet<string>;
    perms?: ReadonlySet<string>;
  } = {},
): ClubMemberViewer {
  return {
    uid,
    teamIds,
    hasPermission: (code) => perms.has(code),
  };
}

function makeTeam(overrides: Partial<TeamDoc> = {}): TeamDoc {
  return {
    id: 'T-club',
    captainUid: 'U-cap',
    captain: 'Alice',
    creatorUid: 'U-creator',
    ownerUid: 'U-owner',
    leaderUids: ['U-lead'],
    leaders: ['Leader'],
    leaderUid: 'U-legacy',
    leader: 'Leader',
    coachUids: ['U-coach'],
    coaches: ['Coach'],
    ...overrides,
  };
}

type BooleanPolicy = (
  viewer: ClubMemberViewer | null | undefined,
  team: TeamDoc | null | undefined,
) => boolean;

const booleanPolicies: ReadonlyArray<readonly [string, BooleanPolicy]> = [
  ['成員管理', canManageMembers],
  ['角色調整', canChangeMemberRole],
  ['設定編輯', canEditTeamSettings],
  ['備註編輯', canEditMemberNote],
  ['備註檢視', canViewMemberNote],
  ['邀請 QR', canShowInviteQr],
  ['剔除成員', (viewer, team) => canKickMember(viewer, team, 'U-mem')],
];

describe('成員權限共同守衛', () => {
  for (const [label, policy] of booleanPolicies) {
    it(`${label}拒絕缺少檢視者或隊伍`, () => {
      for (const missing of [null, undefined]) {
        expect(policy(missing, makeTeam())).toBe(false);
        expect(policy(makeViewer('U-cap'), missing)).toBe(false);
      }
    });

    it(`${label}拒絕未登入、空字串及純空白 UID，即使具有全域權限`, () => {
      for (const uid of [null, '', ' \t\n ']) {
        const viewer = makeViewer(uid, {
          teamIds: new Set(['T-club']),
          perms: new Set(['team.manage_all']),
        });
        const team = makeTeam({
          captainUid: uid ?? '',
          creatorUid: uid ?? '',
          ownerUid: uid ?? '',
          leaderUids: [uid],
          coachUids: [uid],
        });
        expect(policy(viewer, team)).toBe(false);
      }
    });

    it(`${label}允許球經並拒絕陌生人`, () => {
      expect(policy(makeViewer('U-cap'), makeTeam())).toBe(true);
      expect(policy(makeViewer('U-stranger'), makeTeam())).toBe(false);
    });
  }
});

describe('成員管理與備註編輯', () => {
  for (const [label, policy] of [
    ['成員管理', canManageMembers],
    ['備註編輯', canEditMemberNote],
  ] as const) {
    it(`${label}允許球經、領隊與教練`, () => {
      for (const uid of ['U-cap', 'U-lead', 'U-coach']) {
        expect(policy(makeViewer(uid), makeTeam())).toBe(true);
      }
    });

    it(`${label}拒絕一般成員、僅建立者、僅擁有者及僅全域管理者`, () => {
      expect(policy(makeViewer('U-mem', {
        teamIds: new Set(['T-club']),
      }), makeTeam())).toBe(false);
      expect(policy(makeViewer('U-creator'), makeTeam())).toBe(false);
      expect(policy(makeViewer('U-owner'), makeTeam())).toBe(false);
      expect(policy(makeViewer('U-admin', {
        perms: new Set(['team.manage_all']),
      }), makeTeam())).toBe(false);
    });

    it(`${label}不退回 legacy 領隊也不以同名辨識身分`, () => {
      expect(policy(makeViewer('U-legacy'), makeTeam())).toBe(false);
      expect(policy(makeViewer('U-legacy'), makeTeam({
        leaderUids: undefined,
      }))).toBe(false);
      const sameNameViewer = {
        ...makeViewer('U-other'),
        displayName: 'Alice',
      };
      expect(policy(sameNameViewer, makeTeam())).toBe(false);
    });
  }
});

describe('角色與設定編輯權限', () => {
  for (const [label, policy] of [
    ['角色調整', canChangeMemberRole],
    ['設定編輯', canEditTeamSettings],
  ] as const) {
    it(`${label}允許球經、建立者、擁有者及全域管理者`, () => {
      for (const uid of ['U-cap', 'U-creator', 'U-owner']) {
        expect(policy(makeViewer(uid), makeTeam())).toBe(true);
      }
      expect(policy(makeViewer('U-admin', {
        perms: new Set(['team.manage_all']),
      }), makeTeam())).toBe(true);
    });

    it(`${label}比成員管理嚴格，領隊與教練不可操作`, () => {
      for (const uid of ['U-lead', 'U-coach']) {
        const viewer = makeViewer(uid);
        expect(canManageMembers(viewer, makeTeam())).toBe(true);
        expect(policy(viewer, makeTeam())).toBe(false);
      }
    });

    it(`${label}沿用資料層對擁有者欄位的空白處理`, () => {
      expect(policy(makeViewer('U-owner'), makeTeam({
        ownerUid: ' U-owner ',
      }))).toBe(true);
    });
  }
});

describe('私人備註檢視', () => {
  it('允許三種幹部、建立者與擁有者', () => {
    for (const uid of ['U-cap', 'U-lead', 'U-coach', 'U-creator', 'U-owner']) {
      expect(canViewMemberNote(makeViewer(uid), makeTeam())).toBe(true);
    }
  });

  it('建立者與擁有者採用去除前後空白的 UID 比對', () => {
    expect(canViewMemberNote(makeViewer(' U-creator '), makeTeam({
      creatorUid: ' U-creator ',
    }))).toBe(true);
    expect(canViewMemberNote(makeViewer(' U-owner '), makeTeam({
      ownerUid: ' U-owner ',
    }))).toBe(true);
  });

  it('拒絕一般成員、legacy 領隊、僅全域管理者及同名陌生人', () => {
    expect(canViewMemberNote(makeViewer('U-mem', {
      teamIds: new Set(['T-club']),
    }), makeTeam())).toBe(false);
    expect(canViewMemberNote(makeViewer('U-legacy'), makeTeam())).toBe(false);
    expect(canViewMemberNote(makeViewer('U-legacy'), makeTeam({
      leaderUids: undefined,
    }))).toBe(false);
    expect(canViewMemberNote(makeViewer('U-admin', {
      perms: new Set(['team.manage_all']),
    }), makeTeam())).toBe(false);
    const viewer = { ...makeViewer('U-other'), displayName: 'Alice' };
    expect(canViewMemberNote(viewer, makeTeam())).toBe(false);
  });
});

describe('邀請 QR 權限', () => {
  it('球經與教練不受成員邀請開關限制', () => {
    for (const uid of ['U-cap', 'U-coach']) {
      expect(canShowInviteQr(makeViewer(uid), makeTeam({
        allowMemberInvite: false,
      }))).toBe(true);
    }
  });

  it('一般成員在開關未設定或開啟時可邀請，關閉時不可邀請', () => {
    const viewer = makeViewer('U-mem', { teamIds: new Set(['T-club']) });
    expect(canShowInviteQr(viewer, makeTeam())).toBe(true);
    expect(canShowInviteQr(viewer, makeTeam({ allowMemberInvite: true }))).toBe(true);
    expect(canShowInviteQr(viewer, makeTeam({ allowMemberInvite: false }))).toBe(false);
  });

  it('拒絕非成員、只有領隊身分者及僅全域管理者', () => {
    expect(canShowInviteQr(makeViewer('U-other'), makeTeam())).toBe(false);
    expect(canShowInviteQr(makeViewer('U-lead'), makeTeam())).toBe(false);
    expect(canShowInviteQr(makeViewer('U-admin', {
      perms: new Set(['team.manage_all']),
    }), makeTeam())).toBe(false);
  });

  it('沿用標頭對隊伍 ID 與幹部 UID 的空白處理', () => {
    expect(canShowInviteQr(makeViewer('U-mem', {
      teamIds: new Set(['T-club']),
    }), makeTeam({ id: ' T-club ' }))).toBe(true);
    expect(canShowInviteQr(makeViewer('U-cap'), makeTeam({
      captainUid: ' U-cap ',
    }))).toBe(true);
    expect(canShowInviteQr(makeViewer('U-coach'), makeTeam({
      coachUids: [' U-coach '],
    }))).toBe(true);
  });

  it('空隊伍 ID 不授予一般成員邀請權限', () => {
    expect(canShowInviteQr(makeViewer('U-mem', {
      teamIds: new Set(['']),
    }), makeTeam({ id: ' ' }))).toBe(false);
  });
});

describe('剔除成員純判斷', () => {
  it('球經、領隊與教練可剔除一般隊員', () => {
    for (const uid of ['U-cap', 'U-lead', 'U-coach']) {
      expect(canKickMember(makeViewer(uid), makeTeam(), ' U-mem ')).toBe(true);
    }
  });

  it('不可剔除球經、領隊、教練或自己', () => {
    for (const targetUid of ['U-cap', 'U-lead', 'U-coach']) {
      expect(canKickMember(makeViewer('U-cap'), makeTeam(), targetUid)).toBe(false);
    }
    expect(canKickMember(makeViewer('U-lead'), makeTeam(), ' U-lead ')).toBe(false);
  });

  it('拒絕一般成員操作與空白目標', () => {
    expect(canKickMember(makeViewer('U-mem'), makeTeam(), 'U-other')).toBe(false);
    for (const targetUid of ['', ' \t ']) {
      expect(canKickMember(makeViewer('U-cap'), makeTeam(), targetUid)).toBe(false);
    }
  });

  it('幹部保護採用身分集合的空白處理與 legacy 優先序', () => {
    expect(canKickMember(makeViewer('U-cap'), makeTeam({
      leaderUids: [' U-lead '],
    }), ' U-lead ')).toBe(false);
    expect(canKickMember(makeViewer('U-cap'), makeTeam({
      leaderUids: undefined,
    }), 'U-legacy')).toBe(false);
    expect(canKickMember(makeViewer('U-cap'), makeTeam({
      leaderUids: [],
    }), 'U-legacy')).toBe(true);
  });
});

describe('角色升降目標', () => {
  const cases: ReadonlyArray<{
    name: string;
    targetUid: string;
    direction: MemberRoleDirection;
    expected: MemberRoleTarget | null;
  }> = [
    {
      name: '一般隊員晉升為教練',
      targetUid: 'U-mem',
      direction: 'promote',
      expected: { key: 'coach', level: 1, direction: 'promote' },
    },
    {
      name: '教練晉升為領隊',
      targetUid: 'U-coach',
      direction: 'promote',
      expected: { key: 'leader', level: 2, direction: 'promote' },
    },
    {
      name: '領隊不可繼續晉升',
      targetUid: 'U-lead',
      direction: 'promote',
      expected: null,
    },
    {
      name: '領隊降級為教練',
      targetUid: 'U-lead',
      direction: 'demote',
      expected: { key: 'coach', level: 1, direction: 'demote' },
    },
    {
      name: '教練降級為一般隊員',
      targetUid: 'U-coach',
      direction: 'demote',
      expected: { key: 'member', level: 0, direction: 'demote' },
    },
    {
      name: '一般隊員不可繼續降級',
      targetUid: 'U-mem',
      direction: 'demote',
      expected: null,
    },
  ];

  for (const entry of cases) {
    it(entry.name, () => {
      expect(getMemberRoleChangeTarget(
        makeViewer('U-cap'),
        makeTeam(),
        entry.targetUid,
        entry.direction,
      )).toEqual(entry.expected);
    });
  }

  it('缺少檢視者、隊伍或登入 UID 時回傳空值', () => {
    for (const missing of [null, undefined]) {
      expect(getMemberRoleChangeTarget(missing, makeTeam(), 'U-mem', 'promote'))
        .toBeNull();
      expect(getMemberRoleChangeTarget(makeViewer('U-cap'), missing, 'U-mem', 'promote'))
        .toBeNull();
    }
    for (const uid of [null, '', ' \t ']) {
      expect(getMemberRoleChangeTarget(makeViewer(uid, {
        perms: new Set(['team.manage_all']),
      }), makeTeam(), 'U-mem', 'promote')).toBeNull();
    }
  });

  it('球經目標不可升降，即使操作者具有全域管理權限', () => {
    const viewer = makeViewer('U-admin', { perms: new Set(['team.manage_all']) });
    for (const direction of ['promote', 'demote'] as const) {
      expect(getMemberRoleChangeTarget(viewer, makeTeam(), ' U-cap ', direction))
        .toBeNull();
    }
  });

  it('不可自我升降，包括具有全域管理權限的教練', () => {
    const viewer = makeViewer('U-coach', { perms: new Set(['team.manage_all']) });
    for (const direction of ['promote', 'demote'] as const) {
      expect(getMemberRoleChangeTarget(viewer, makeTeam(), ' U-coach ', direction))
        .toBeNull();
    }
  });

  it('領隊與教練沒有全域權限時不可調整他人角色', () => {
    for (const uid of ['U-lead', 'U-coach']) {
      expect(getMemberRoleChangeTarget(makeViewer(uid), makeTeam(), 'U-mem', 'promote'))
        .toBeNull();
    }
  });

  it('非擁有者的全域管理者仍可晉升一般隊員', () => {
    expect(getMemberRoleChangeTarget(makeViewer('U-admin', {
      perms: new Set(['team.manage_all']),
    }), makeTeam(), 'U-mem', 'promote')).toEqual({
      key: 'coach',
      level: 1,
      direction: 'promote',
    });
  });

  it('建立者與擁有者可調整角色', () => {
    for (const uid of ['U-creator', 'U-owner']) {
      expect(getMemberRoleChangeTarget(makeViewer(uid), makeTeam(), 'U-coach', 'promote'))
        .toEqual({ key: 'leader', level: 2, direction: 'promote' });
    }
  });

  it('拒絕空白目標與執行期未知方向', () => {
    for (const targetUid of ['', ' \t ']) {
      expect(getMemberRoleChangeTarget(makeViewer('U-cap'), makeTeam(), targetUid, 'promote'))
        .toBeNull();
    }
    expect(getMemberRoleChangeTarget(
      makeViewer('U-cap'),
      makeTeam(),
      'U-mem',
      'unknown' as MemberRoleDirection,
    )).toBeNull();
  });

  it('同時是領隊與教練時採用較高層級', () => {
    const team = makeTeam({ coachUids: ['U-coach', 'U-lead'] });
    expect(getMemberRoleChangeTarget(makeViewer('U-cap'), team, 'U-lead', 'promote'))
      .toBeNull();
    expect(getMemberRoleChangeTarget(makeViewer('U-cap'), team, 'U-lead', 'demote'))
      .toEqual({ key: 'coach', level: 1, direction: 'demote' });
  });

  it('角色由 UID 陣列決定，不採 legacy 領隊或名稱欄位', () => {
    const team = makeTeam({
      leaderUids: undefined,
      leaders: ['U-mem'],
      coachUids: [' U-coach '],
    });
    expect(getMemberRoleChangeTarget(makeViewer('U-cap'), team, 'U-legacy', 'promote'))
      .toEqual({ key: 'coach', level: 1, direction: 'promote' });
    expect(getMemberRoleChangeTarget(makeViewer('U-cap'), team, 'U-mem', 'promote'))
      .toEqual({ key: 'coach', level: 1, direction: 'promote' });
    expect(getMemberRoleChangeTarget(makeViewer('U-cap'), team, ' U-coach ', 'promote'))
      .toEqual({ key: 'leader', level: 2, direction: 'promote' });
  });

  it('所有允許的目標層級均嚴格低於操作者層級', () => {
    // 公開契約中操作者至少為 3、目標最高為 2，無法合法建構等級拒絕分支。
    // 此測試驗證所有可達轉換皆維持嚴格小於，而不偽造資料層權限。
    const actors = [
      { viewer: makeViewer('U-cap'), level: 3 },
      { viewer: makeViewer('U-creator'), level: 3 },
      { viewer: makeViewer('U-owner'), level: 3 },
      {
        viewer: makeViewer('U-admin', { perms: new Set(['team.manage_all']) }),
        level: 4,
      },
    ];
    for (const actor of actors) {
      for (const entry of cases) {
        const result = getMemberRoleChangeTarget(
          actor.viewer,
          makeTeam(),
          entry.targetUid,
          entry.direction,
        );
        expect(result).toEqual(entry.expected);
        if (result) expect(result.level).toBeLessThan(actor.level);
      }
    }
  });
});

describe('角色更新欄位純計算', () => {
  it('一般隊員加入教練陣列，保留領隊欄位並同步名稱', () => {
    expect(buildMemberRoleUpdates(makeTeam(), ' U-mem ', 'coach', ' Bob '))
      .toEqual({
        leaderUids: ['U-lead'],
        leaders: ['Leader'],
        leaderNames: ['Leader'],
        leaderUid: 'U-lead',
        leader: 'Leader',
        coachUids: ['U-coach', 'U-mem'],
        coaches: ['Coach', 'Bob'],
        coachNames: ['Coach', 'Bob'],
      });
  });

  it('教練晉升為領隊時從教練移除並加入領隊', () => {
    expect(buildMemberRoleUpdates(makeTeam(), 'U-coach', 'leader', 'Coach'))
      .toEqual({
        leaderUids: ['U-lead', 'U-coach'],
        leaders: ['Leader', 'Coach'],
        leaderNames: ['Leader', 'Coach'],
        leaderUid: 'U-lead',
        leader: 'Leader',
        coachUids: [],
        coaches: [],
        coachNames: [],
      });
  });

  it('領隊降為一般隊員時從兩邊移除', () => {
    const team = makeTeam({
      coachUids: ['U-coach', 'U-lead'],
      coaches: ['Coach', 'LEADER'],
    });
    expect(buildMemberRoleUpdates(team, 'U-lead', 'member', 'Leader'))
      .toEqual({
        leaderUids: [],
        leaders: [],
        leaderNames: [],
        leaderUid: null,
        leader: '',
        coachUids: ['U-coach'],
        coaches: ['Coach'],
        coachNames: ['Coach'],
      });
  });

  it('領隊改任教練時移除領隊並加入教練', () => {
    expect(buildMemberRoleUpdates(makeTeam(), 'U-lead', 'coach', 'Leader'))
      .toEqual({
        leaderUids: [],
        leaders: [],
        leaderNames: [],
        leaderUid: null,
        leader: '',
        coachUids: ['U-coach', 'U-lead'],
        coaches: ['Coach', 'Leader'],
        coachNames: ['Coach', 'Leader'],
      });
  });

  it('空領隊欄位回傳空陣列、空值與空字串，空名稱使用 UID', () => {
    expect(buildMemberRoleUpdates({}, ' U-mem ', 'coach', ' \t '))
      .toEqual({
        leaderUids: [],
        leaders: [],
        leaderNames: [],
        leaderUid: null,
        leader: '',
        coachUids: ['U-mem'],
        coaches: ['U-mem'],
        coachNames: ['U-mem'],
      });
  });

  it('UID 保序去重、名稱以小寫去重並保留第一次的字串', () => {
    const result = buildMemberRoleUpdates(makeTeam({
      leaderUids: [' U-lead ', 'U-lead', '', 'U-lead2'],
      leaders: [' Bob ', 'bob', '', 'ALICE', 'alice'],
      coachUids: [' U-coach ', 'U-coach', ''],
      coaches: [' Coach ', 'coach', ''],
    }), 'U-mem', 'coach', 'Carol');

    expect(result?.leaderUids).toEqual(['U-lead', 'U-lead2']);
    expect(result?.leaders).toEqual(['Bob', 'ALICE']);
    expect(result?.coachUids).toEqual(['U-coach', 'U-mem']);
    expect(result?.coaches).toEqual(['Coach', 'Carol']);
  });

  it('名稱同步可移除同名快取，但不會移除另一個人的 UID', () => {
    const result = buildMemberRoleUpdates(makeTeam({
      leaderUids: ['U-lead', 'U-other'],
      leaders: ['Bob', 'Other'],
    }), 'U-mem', 'coach', 'bob');

    expect(result?.leaderUids).toEqual(['U-lead', 'U-other']);
    expect(result?.leaders).toEqual(['Other']);
    expect(result?.coachUids).toEqual(['U-coach', 'U-mem']);
    expect(result?.coaches).toEqual(['Coach', 'bob']);
  });

  it('重複指派先移除再加入尾端，不產生重複 UID 或名稱', () => {
    const team = makeTeam({
      leaderUids: ['U-lead', 'U-lead2'],
      leaders: ['Leader', 'Second'],
      coachUids: ['U-coach', 'U-coach2'],
      coaches: ['Coach', 'Other'],
    });
    const leaderResult = buildMemberRoleUpdates(team, 'U-lead', 'leader', 'LEADER');
    expect(leaderResult?.leaderUids).toEqual(['U-lead2', 'U-lead']);
    expect(leaderResult?.leaders).toEqual(['Second', 'LEADER']);
    expect(leaderResult?.leaderUid).toBe('U-lead2');
    expect(leaderResult?.leader).toBe('Second');

    const coachResult = buildMemberRoleUpdates(team, 'U-coach', 'coach', 'COACH');
    expect(coachResult?.coachUids).toEqual(['U-coach2', 'U-coach']);
    expect(coachResult?.coaches).toEqual(['Other', 'COACH']);
  });

  it('領隊 UID 非陣列時帶入 legacy 欄位與名稱備援', () => {
    const result = buildMemberRoleUpdates({
      leaderUids: 'invalid',
      leaderUid: ' U-legacy ',
      leaders: 'invalid',
      leader: ' Legacy ',
      coachNames: [' Coach ', 'coach'],
      coachUids: ['U-coach'],
    }, 'U-mem', 'coach', 'Member');

    expect(result).toEqual({
      leaderUids: ['U-legacy'],
      leaders: ['Legacy'],
      leaderNames: ['Legacy'],
      leaderUid: 'U-legacy',
      leader: 'Legacy',
      coachUids: ['U-coach', 'U-mem'],
      coaches: ['Coach', 'Member'],
      coachNames: ['Coach', 'Member'],
    });
  });

  it('名稱主欄位非陣列時使用名稱陣列備援', () => {
    const result = buildMemberRoleUpdates({
      leaderUid: 'U-legacy',
      leaders: null,
      leaderNames: [' First ', 'first', 'Second'],
      leader: 'Ignored',
      coaches: null,
      coachNames: [' Coach ', 'coach'],
    }, 'U-mem', 'member', 'Member');

    expect(result?.leaders).toEqual(['First', 'Second']);
    expect(result?.leader).toBe('First');
    expect(result?.coaches).toEqual(['Coach']);
  });

  it('既有空陣列優先，不回退 legacy 或名稱備援欄位', () => {
    const result = buildMemberRoleUpdates({
      leaderUids: [],
      leaderUid: 'U-legacy',
      leaders: [],
      leaderNames: ['Ignored'],
      leader: 'Ignored',
      coaches: [],
      coachNames: ['Ignored'],
    }, 'U-mem', 'member', 'Member');

    expect(result?.leaderUids).toEqual([]);
    expect(result?.leaders).toEqual([]);
    expect(result?.leaderUid).toBeNull();
    expect(result?.leader).toBe('');
    expect(result?.coaches).toEqual([]);
  });

  it('回傳欄位只包含契約允許的角色欄位', () => {
    const result = buildMemberRoleUpdates(makeTeam({
      members: 99,
      captainName: 'Alice',
    }), 'U-mem', 'coach', 'Member');

    expect(result).not.toBeNull();
    expect(Object.keys(result ?? {}).sort()).toEqual([
      'leaderUids',
      'leaders',
      'leaderNames',
      'leaderUid',
      'leader',
      'coachUids',
      'coaches',
      'coachNames',
    ].sort());
    expect(result).not.toHaveProperty('members');
    expect(result).not.toHaveProperty('captainUid');
    expect(result).not.toHaveProperty('captainName');
  });

  it('名稱別名陣列內容相等但參考分離，且不修改輸入文件', () => {
    const team = Object.freeze(makeTeam({
      leaderUids: Object.freeze(['U-lead']),
      leaders: Object.freeze(['Leader']),
      coachUids: Object.freeze(['U-coach']),
      coaches: Object.freeze(['Coach']),
    }));
    const result = buildMemberRoleUpdates(team, 'U-mem', 'coach', 'Member');

    expect(result).not.toBeNull();
    if (!result) throw new Error('預期角色更新成功');
    expect(result.leaderNames).toEqual(result.leaders);
    expect(result.leaderNames).not.toBe(result.leaders);
    expect(result.coachNames).toEqual(result.coaches);
    expect(result.coachNames).not.toBe(result.coaches);
    expect(result.leaderUids).not.toBe(team.leaderUids);
    expect(result.coachUids).not.toBe(team.coachUids);
    expect(team.leaderUids).toEqual(['U-lead']);
    expect(team.leaders).toEqual(['Leader']);
    expect(team.coachUids).toEqual(['U-coach']);
    expect(team['coaches']).toEqual(['Coach']);

    result.leaderNames.push('Independent');
    result.coachNames.push('Independent');
    expect(result.leaders).toEqual(['Leader']);
    expect(result.coaches).toEqual(['Coach', 'Member']);
  });

  it('拒絕缺少隊伍、空白目標或未知角色鍵', () => {
    for (const missing of [null, undefined]) {
      expect(buildMemberRoleUpdates(missing, 'U-mem', 'coach', 'Member')).toBeNull();
    }
    for (const targetUid of ['', ' \t ']) {
      expect(buildMemberRoleUpdates(makeTeam(), targetUid, 'coach', 'Member')).toBeNull();
    }
    expect(buildMemberRoleUpdates(
      makeTeam(),
      'U-mem',
      'unknown' as MemberRoleKey,
      'Member',
    )).toBeNull();
  });
});
