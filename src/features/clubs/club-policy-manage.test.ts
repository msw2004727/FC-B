// K1a／K2／K5／K6 權限判斷：四身分（user／captain(擁有者)／coach(幹部)／admin）對照 A。
import { describe, expect, it } from 'vitest';
import {
  canAccessTeamManagePage,
  canAccessTeamManageRecord,
  canDeleteTeam,
  canEditMemberMatchData,
  canManageAllTeams,
} from './club-policy';
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

describe('canDeleteTeam（A removeTeam 守衛＝_canEditTeamByRoleOrCaptain）', () => {
  it('擁有者三欄與 manage_all 可刪；領隊、教練、一般用戶不可', () => {
    expect(canDeleteTeam(viewer('U-cap'), team)).toBe(true);
    expect(canDeleteTeam(viewer('U-creator'), team)).toBe(true);
    expect(canDeleteTeam(viewer('U-owner'), team)).toBe(true);
    expect(canDeleteTeam(identities.admin, team)).toBe(true);
    expect(canDeleteTeam(viewer('U-lead'), team)).toBe(false);
    expect(canDeleteTeam(identities.coach, team)).toBe(false);
    expect(canDeleteTeam(identities.user, team)).toBe(false);
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
