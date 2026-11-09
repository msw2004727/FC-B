// K1a／K2／K5／K6 權限判斷：四身分（user／captain(擁有者)／coach(幹部)／admin）對照 A。
import { describe, expect, it } from 'vitest';
import {
  canAccessTeamManagePage,
  canAccessTeamManageRecord,
  canDeleteTeam,
  canEditMemberMatchData,
  canManageAllTeams,
} from './club-policy';
import type { TeamDeleteViewer } from './club-policy';
import type { ClubViewer, TeamDoc } from './data/types';

function viewer(uid: string | null, perms: readonly string[] = []): ClubViewer {
  return { uid, teamIds: new Set<string>(), hasPermission: (code) => perms.includes(code) };
}

const team: TeamDoc = {
  id: 'tm_1',
  captainUid: 'U-cap',
  creatorUid: 'U-creator',
  ownerUid: ' U-owner ',
  leaderUids: ['U-lead'],
  coachUids: ['U-coach'],
};

const identities = {
  user: viewer('U-user'),
  captain: viewer('U-cap', ['team.manage.entry']),
  coach: viewer('U-coach'),
  admin: viewer('U-admin', ['team.manage.entry', 'team.manage_all', 'team.create']),
};

describe('canAccessTeamManagePage（A _canAccessPage → team.manage.entry）', () => {
  it('只看 team.manage.entry；訪客、無碼者拒絕', () => {
    expect(canAccessTeamManagePage(identities.user)).toBe(false);
    expect(canAccessTeamManagePage(identities.captain)).toBe(true);
    expect(canAccessTeamManagePage(identities.coach)).toBe(false);
    expect(canAccessTeamManagePage(identities.admin)).toBe(true);
    expect(canAccessTeamManagePage(viewer(null, ['team.manage.entry']))).toBe(false);
    expect(canAccessTeamManagePage(viewer('  ', ['team.manage.entry']))).toBe(false);
  });

  it('擁有俱樂部但沒有入口碼的一般用戶看不到（A 只看權限碼）', () => {
    expect(canAccessTeamManagePage(viewer('U-creator'))).toBe(false);
  });

  // C1（P3）：自建俱樂部擁有者（role=user＋user.activity.team_create）也能進管理頁，條件同 canCreateTeam。
  it('一般用戶有建俱樂部能力時放行；教練以上或沒有能力照舊只看權限碼', () => {
    const cap = ['user.activity.team_create'];
    expect(canAccessTeamManagePage({ ...viewer('U-creator'), role: 'user', capabilities: cap })).toBe(true);
    expect(canAccessTeamManagePage({ ...viewer('U-creator'), role: 'coach', capabilities: cap })).toBe(false);
    expect(canAccessTeamManagePage({ ...viewer('U-creator'), role: 'user', capabilities: [] })).toBe(false);
    expect(canAccessTeamManagePage({ ...viewer(null), role: 'user', capabilities: cap })).toBe(false);
  });
});

describe('canManageAllTeams（置頂／上下架／光跡）', () => {
  it('只有 team.manage_all', () => {
    expect(canManageAllTeams(identities.user)).toBe(false);
    expect(canManageAllTeams(identities.captain)).toBe(false);
    expect(canManageAllTeams(identities.coach)).toBe(false);
    expect(canManageAllTeams(identities.admin)).toBe(true);
    expect(canManageAllTeams(viewer(null, ['team.manage_all']))).toBe(false);
  });
});

describe('canAccessTeamManageRecord（A _canEditTeamByRoleOrCaptain ∨ _canManageTeamMembers）', () => {
  it.each([
    ['U-cap', true],
    ['U-creator', true],
    ['U-owner', true],
    ['U-lead', true],
    ['U-coach', true],
    ['U-user', false],
  ])('%s → %s', (uid, expected) => {
    expect(canAccessTeamManageRecord(viewer(uid), team)).toBe(expected);
  });

  it('team.manage_all 看得到任何俱樂部', () => {
    expect(canAccessTeamManageRecord(identities.admin, team)).toBe(true);
  });
});

/**
 * 刪除判斷對齊 Callable deleteTeam：super_admin ∨ ((擁有者 ∨ manage_all) ∧ (教練以上 ∨ team_join_repair))。
 * 已知限制（顧問裁定接受）：Callable 只比對 uid（第二身分不參與擁有權）；rolePermissions 缺文件不套預設
 * （正式三個角色文件都存在）；Callable 角色等級表不含自訂角色（正式 customRoles 為 0，日後與 T-079a 一起開卡）。
 */
describe('canDeleteTeam（對齊 Callable deleteTeam）', () => {
  function deleter(uid: string, role: string, roleLevel: number, perms: readonly string[] = []): TeamDeleteViewer {
    return { ...viewer(uid, perms), role, roleLevel };
  }

  it('角色低於教練的擁有者看不到', () => {
    expect(canDeleteTeam(deleter('U-cap', 'user', 0), team)).toBe(false);
    expect(canDeleteTeam(deleter('U-creator', 'user', 0), team)).toBe(false);
  });

  it('教練以上的擁有者三欄看得到；教練以上的領隊、教練、非擁有者看不到', () => {
    expect(canDeleteTeam(deleter('U-cap', 'captain', 2), team)).toBe(true);
    expect(canDeleteTeam(deleter('U-creator', 'coach', 1), team)).toBe(true);
    expect(canDeleteTeam(deleter('U-owner', 'coach', 1), team)).toBe(true);
    expect(canDeleteTeam(deleter('U-lead', 'coach', 1), team)).toBe(false);
    expect(canDeleteTeam(deleter('U-coach', 'coach', 1), team)).toBe(false);
    expect(canDeleteTeam(deleter('U-user', 'coach', 1), team)).toBe(false);
  });

  it('教練以上有 team.manage_all 看得到任何俱樂部；user 只有 team.manage_all 授權看不到', () => {
    expect(canDeleteTeam(deleter('U-admin', 'admin', 4, ['team.manage_all']), team)).toBe(true);
    expect(canDeleteTeam(deleter('U-user', 'user', 0, ['team.manage_all']), team)).toBe(false);
  });

  it('admin.repair.team_join_repair 可抵教練以上：user 擁有者看得到；非擁有者只有此權限看不到', () => {
    expect(canDeleteTeam(deleter('U-cap', 'user', 0, ['admin.repair.team_join_repair']), team)).toBe(true);
    expect(canDeleteTeam(deleter('U-user', 'user', 0, ['admin.repair.team_join_repair']), team)).toBe(false);
  });

  it('super_admin 一律看得到；訪客一律看不到', () => {
    expect(canDeleteTeam(deleter('U-sa', 'super_admin', 5), team)).toBe(true);
    expect(canDeleteTeam({ ...viewer(null), role: 'super_admin', roleLevel: 5 }, team)).toBe(false);
  });
});

describe('canEditMemberMatchData（A editTeamMemberMatchData 守衛＝_canManageTeamMembers）', () => {
  it('球經、領隊、教練可；建立者／擁有者欄位與只有 manage_all 的管理員不可', () => {
    expect(canEditMemberMatchData(viewer('U-cap'), team)).toBe(true);
    expect(canEditMemberMatchData(viewer('U-lead'), team)).toBe(true);
    expect(canEditMemberMatchData(viewer('U-coach'), team)).toBe(true);
    expect(canEditMemberMatchData(viewer('U-creator'), team)).toBe(false);
    expect(canEditMemberMatchData(identities.admin, team)).toBe(false);
    expect(canEditMemberMatchData(identities.user, team)).toBe(false);
  });
});
