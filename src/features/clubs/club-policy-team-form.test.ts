import { describe, expect, it } from 'vitest';

import { canAssignCoach, canCreateTeam, canTransferCaptain } from './club-policy';
import type { ClubCreateTeamViewer } from './club-policy';
import type { TeamDoc } from './data/types';

function viewer(
  uid: string | null = 'u1',
  permissions: readonly string[] = [],
): ClubCreateTeamViewer {
  return { uid, hasPermission: (code) => permissions.includes(code) };
}

describe('canCreateTeam', () => {
  it('有效 UID 與 team.create 同時存在才允許', () => {
    expect(canCreateTeam(viewer('u1', ['team.create']))).toBe(true);
    expect(canCreateTeam(viewer(' u2 ', ['team.create', 'team.manage_all']))).toBe(true);
  });

  it('拒絕訪客、空 UID、空白 UID，即使擁有 permission', () => {
    for (const uid of [null, '', ' \t\n ']) {
      expect(canCreateTeam(viewer(uid, ['team.create']))).toBe(false);
    }
    expect(canCreateTeam(null)).toBe(false);
    expect(canCreateTeam(undefined)).toBe(false);
  });

  it('拒絕無權限；manage_all 不自動替代 team.create', () => {
    expect(canCreateTeam(viewer('u1'))).toBe(false);
    expect(canCreateTeam(viewer('u1', ['team.manage_all']))).toBe(false);
  });
});

describe('canAssignCoach', () => {
  it.each(['team.assign_coach', 'team.manage_all', 'team.manage.entry'])(
    '任一指定權限 %s 即允許',
    (permission) => {
      expect(canAssignCoach(viewer('u1', [permission]))).toBe(true);
    },
  );

  it('拒絕不存在的 viewer、無權限訪客、空白 UID 與無權限登入者', () => {
    expect(canAssignCoach(null)).toBe(false);
    expect(canAssignCoach(undefined)).toBe(false);
    expect(canAssignCoach(viewer(null))).toBe(false);
    expect(canAssignCoach(viewer(' '))).toBe(false);
    expect(canAssignCoach(viewer('u1'))).toBe(false);
    expect(canAssignCoach(viewer('u1', ['team.create']))).toBe(false);
  });

  it('依指定 permission-only 契約，不自行增加 UID 條件', () => {
    expect(canAssignCoach(viewer(null, ['team.assign_coach']))).toBe(true);
    expect(canAssignCoach(viewer(' ', ['team.manage.entry']))).toBe(true);
  });
});

describe('canTransferCaptain', () => {
  it('經理 UID 相同或具有 manage_all 可轉移', () => {
    expect(canTransferCaptain(viewer('captain'), { captainUid: 'captain' })).toBe(true);
    expect(canTransferCaptain(
      viewer('admin', ['team.manage_all']),
      { captainUid: 'captain' },
    )).toBe(true);
    expect(canTransferCaptain(viewer('admin', ['team.manage_all']), {})).toBe(true);
  });

  it('拒絕訪客與空白 UID，即使具有 manage_all', () => {
    for (const uid of [null, '', ' \t ']) {
      expect(canTransferCaptain(viewer(uid, ['team.manage_all']), { captainUid: 'captain' }))
        .toBe(false);
    }
    expect(canTransferCaptain(null, { captainUid: 'captain' })).toBe(false);
    expect(canTransferCaptain(undefined, { captainUid: 'captain' })).toBe(false);
  });

  it('拒絕無 team、無權限及僅有其他管理權限者', () => {
    expect(canTransferCaptain(viewer('admin', ['team.manage_all']), null)).toBe(false);
    expect(canTransferCaptain(viewer('admin', ['team.manage_all']), undefined)).toBe(false);
    expect(canTransferCaptain(viewer('u1'), { captainUid: 'captain' })).toBe(false);
    expect(canTransferCaptain(
      viewer('u1', ['team.create', 'team.manage.entry', 'team.assign_coach']),
      { captainUid: 'captain' },
    )).toBe(false);
  });

  it('只比 UID，不比顯示名稱、建立者、擁有者或領隊', () => {
    const team: TeamDoc = {
      captainUid: 'real-captain',
      captain: '同名',
      creatorUid: 'u1',
      ownerUid: 'u1',
      leaderUids: ['u1'],
    };
    const sameNameViewer = { ...viewer('u1'), displayName: '同名' };
    expect(canTransferCaptain(sameNameViewer, team)).toBe(false);
    expect(canTransferCaptain(viewer('同名'), team)).toBe(false);
    expect(canTransferCaptain(viewer('real-captain'), team)).toBe(true);
  });

  it('UID 非空判斷可 trim，經理身分仍依指定嚴格相等', () => {
    expect(canTransferCaptain(viewer(' captain '), { captainUid: 'captain' })).toBe(false);
    expect(canTransferCaptain(viewer('captain'), { captainUid: ' captain ' })).toBe(false);
  });
});
