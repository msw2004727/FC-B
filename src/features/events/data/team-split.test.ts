import { describe, expect, it } from 'vitest';
import { canManageTeamSplit, type OperateContext } from './operate-permissions';
import {
  applyTeamAssignments,
  buildTeamAssignments,
  countTeamRegistrations,
  getSplitTeams,
  getTeamCap,
  getTeamSplit,
  teamKeyUpdatePayload,
  writableTeamAssignments,
  type TeamRegistration,
} from './team-split';

const teams = [
  { key: 'A', color: '#EF4444' },
  { key: 'B', color: '#3B82F6' },
];

function reg(id: string, teamKey: string | null, status = 'confirmed'): TeamRegistration {
  return { _docId: id, teamKey, status };
}

describe('M-092 分隊純函式', () => {
  it('只計正取有效隊伍，上限照 A ceil，零上限保留為零', () => {
    expect(countTeamRegistrations(teams, [
      reg('1', 'A'),
      reg('2', 'A', 'waitlisted'),
      reg('3', 'B', 'cancelled'),
      reg('4', 'invalid'),
    ])).toEqual({ A: 1, B: 0 });
    const event = { max: 5, teamSplit: { enabled: true, balanceCap: true, teams } };
    expect(getTeamSplit(event)?.enabled).toBe(true);
    expect(getSplitTeams(event)).toEqual(teams);
    expect(getTeamCap(event)).toBe(3);
    expect(getTeamCap({ max: 0, teamSplit: event.teamSplit })).toBe(0);
    expect(getTeamCap({ teamSplit: { teams: [] } })).toBeNull();
    expect(getSplitTeams(null)).toEqual([]);
  });

  it('random 包含候補，結果全相同時輪移一次，且不改原陣列', () => {
    const rows = [reg('1', 'A'), reg('2', 'B', 'waitlisted'), reg('3', 'A', 'cancelled')];
    const result = buildTeamAssignments('random', teams, rows, () => 0.5);
    expect(result.map(item => item.teamKey)).toEqual(['B', 'A']);
    expect(rows[0]?.teamKey).toBe('A');
    expect(result).toHaveLength(2);
  });

  it('fill 將無效 key 視為未分配、候補參與平衡、同數取首隊', () => {
    const rows = [
      reg('1', 'A'),
      reg('2', 'A', 'waitlisted'),
      reg('3', 'invalid'),
      reg('4', null),
      reg('5', null),
      reg('6', null, 'cancelled'),
    ];
    expect(buildTeamAssignments('fill', teams, rows).map(item => [
      item.reg._docId, item.teamKey,
    ])).toEqual([['3', 'B'], ['4', 'B'], ['5', 'A']]);
  });

  it('reset 只清除正取或候補已分配紀錄；無隊伍 random/fill 不分配', () => {
    const rows = [reg('1', 'A'), reg('2', 'B', 'waitlisted'), reg('3', 'A', 'cancelled')];
    expect(buildTeamAssignments('reset', teams, rows).map(item => item.teamKey))
      .toEqual([null, null]);
    expect(buildTeamAssignments('random', [], rows)).toEqual([]);
    expect(buildTeamAssignments('fill', [], rows)).toEqual([]);
  });

  it('只認 _docId，payload allowlist 與不可變套用', () => {
    const original = [reg('doc', 'A')];
    const assignments = [
      { reg: original[0]!, teamKey: 'B' },
      { reg: { id: 'public', status: 'confirmed' }, teamKey: 'A' },
    ];
    expect(writableTeamAssignments(assignments)).toHaveLength(1);
    const next = applyTeamAssignments(original, assignments);
    expect(next[0]?.teamKey).toBe('B');
    expect(original[0]?.teamKey).toBe('A');
    expect(teamKeyUpdatePayload('')).toEqual({ teamKey: null });
    const timestamp = { transform: 'serverTimestamp' };
    expect(teamKeyUpdatePayload('B', timestamp)).toEqual({
      teamKey: 'B', updatedAt: timestamp,
    });
  });
});

describe('M-092 canManageTeamSplit：FC oracle 補充矩陣', () => {
  const event = { creatorUid: 'owner', delegateUids: ['delegate'] };

  function context(uid: string, permissions: string[], capabilities: string[] = []): OperateContext {
    return {
      uid,
      role: 'user',
      rolePermissions: permissions,
      userGrants: null,
      capabilities,
      customRoles: [],
    };
  }

  // PM：manage-all／entry 情境改由 operate-oracle.test.ts 以 A 真實函式 972 案逐案比對 canManageTeamSplit
  // （原手寫案例把 event.edit_all 放在 user 角色，B 的權限碼清洗不允許，與 A 實況不符）。
  it.each([
    ['owner', true],
    ['delegate', false],
    ['other', false],
  ] as const)('user＋addons_use：%s → %s', (uid, expected) => {
    expect(canManageTeamSplit(context(uid, [], ['user.activity.addons_use']), event))
      .toBe(expected);
    expect(canManageTeamSplit(context(uid, []), event)).toBe(false);
  });

  it('coach scope fallback、私密活動與未就緒仍照具體 helper', () => {
    expect(canManageTeamSplit({ ...context('delegate', []), role: 'coach' }, event)).toBe(true);
    expect(canManageTeamSplit(context('other', ['event.edit_all']), {
      ...event, privateEvent: true,
    })).toBe(false);
    expect(canManageTeamSplit({
      ...context('owner', ['event.edit_all']), role: null,
    }, event)).toBe(false);
    expect(canManageTeamSplit(context('owner', ['event.edit_all']), null)).toBe(false);
  });
});
