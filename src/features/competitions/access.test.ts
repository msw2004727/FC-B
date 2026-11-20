import { describe, expect, it } from 'vitest';
import { canEndCompetition, canHostOrCo, canManageCompetition, canRegisterClubEntry, canSeeInAppSection, canShowFlexSchedule, canUnlockRosters, isCpAdmin, isCurrentClubRep, rosterFormBlock } from './access';
import type { StaffRole } from './data/types';

const window = { repClubIds: ['club_a'], status: 'published' as const, hidden: false, regOpenAt: 10, regCloseAt: 20, now: 15 };

describe('賽事權限顯示', () => {
  it('管理員是 admin 或 super_admin', () => {
    expect(isCpAdmin('admin')).toBe(true);
    expect(isCpAdmin('super_admin')).toBe(true);
    expect(isCpAdmin('user')).toBe(false);
    expect(isCpAdmin(null)).toBe(false);
  });

  it('站內賽事區：公開給所有人，內部期只給測試者，沒有開賽設定只給管理員', () => {
    expect(canSeeInAppSection({ isPublic: true, isTester: false, isAdmin: false })).toBe(true);
    expect(canSeeInAppSection({ isPublic: false, isTester: true, isAdmin: false })).toBe(true);
    expect(canSeeInAppSection({ isPublic: false, isTester: false, isAdmin: false })).toBe(false);
    expect(canSeeInAppSection({ isPublic: null, isTester: true, isAdmin: false })).toBe(false);
    expect(canSeeInAppSection({ isPublic: null, isTester: false, isAdmin: true })).toBe(true);
  });

  it('審核只給主辦方或管理員，沒有 creator', () => {
    const base = { hostType: 'personal' as const, hostTeamId: null, repClubIds: [] as string[], isAdmin: false };
    expect(canManageCompetition({ ...base, staffRoles: ['host'] })).toBe(true);
    expect(canManageCompetition({ ...base, staffRoles: ['coHost'] })).toBe(true);
    expect(canManageCompetition({ ...base, staffRoles: [], isAdmin: true })).toBe(true);
    expect(canManageCompetition({
      staffRoles: [],
      hostType: 'club',
      hostTeamId: 'club_host',
      repClubIds: ['club_host'],
      isAdmin: false,
    })).toBe(true);
    expect(canManageCompetition({ ...base, staffRoles: [] })).toBe(false);
    expect(canManageCompetition({
      staffRoles: [],
      hostType: 'club',
      hostTeamId: 'club_host',
      repClubIds: ['club_other'],
      isAdmin: false,
    })).toBe(false);
  });

  it('排賽程等主辦入口對齊後端 hostAccess：主辦、共同主辦、管理員、俱樂部目前代表', () => {
    const personal = { staffRoles: [] as StaffRole[], hostType: 'personal' as const, hostTeamId: null, repClubIds: [] as string[], isAdmin: false };
    const club = { staffRoles: [] as StaffRole[], hostType: 'club' as const, hostTeamId: 'club_host', repClubIds: [] as string[], isAdmin: false };
    // 個人主辦：行為不變，只看 staff 與管理員
    expect(canHostOrCo({ ...personal, staffRoles: ['host'] })).toBe(true);
    expect(canHostOrCo({ ...personal, staffRoles: ['coHost'] })).toBe(true);
    expect(canHostOrCo({ ...personal, isAdmin: true })).toBe(true);
    expect(canHostOrCo(personal)).toBe(false);
    // 個人賽事不因為我是某俱樂部代表就算主辦
    expect(canHostOrCo({ ...personal, repClubIds: ['club_host'] })).toBe(false);
    // 俱樂部賽事：目前代表算主辦（沒有 staff 文件）
    expect(canHostOrCo({ ...club, repClubIds: ['club_host'] })).toBe(true);
    expect(isCurrentClubRep({ ...club, repClubIds: ['club_other', 'club_host'] })).toBe(true);
    // 非代表的俱樂部成員、代表別隊、前代表（換人後清單沒有這隊）都不算
    expect(canHostOrCo(club)).toBe(false);
    expect(canHostOrCo({ ...club, repClubIds: ['club_other'] })).toBe(false);
    // hostTeamId 缺值不比對
    expect(canHostOrCo({ ...club, hostTeamId: null, repClubIds: ['club_host'] })).toBe(false);
    // 俱樂部賽事的共同主辦、管理員不變
    expect(canHostOrCo({ ...club, staffRoles: ['coHost'] })).toBe(true);
    expect(canHostOrCo({ ...club, isAdmin: true })).toBe(true);
    // 審核等管理動作與主辦入口同一條（後端都是 assertHostOrCo／isHostOrCo）
    for (const input of [personal, club, { ...club, repClubIds: ['club_host'] }, { ...personal, staffRoles: ['host'] as StaffRole[] }]) {
      expect(canManageCompetition(input)).toBe(canHostOrCo(input));
    }
  });

  it('以俱樂部報隊只給代表，而且要在公開報名期間', () => {
    expect(canRegisterClubEntry(window)).toBe(true);
    expect(canRegisterClubEntry({ ...window, repClubIds: [] })).toBe(false);
    expect(canRegisterClubEntry({ ...window, now: 9 })).toBe(false);
    expect(canRegisterClubEntry({ ...window, now: 21 })).toBe(false);
    expect(canRegisterClubEntry({ ...window, status: 'draft' })).toBe(false);
    expect(canRegisterClubEntry({ ...window, hidden: true })).toBe(false);
  });

  it('結束賽事只在已發布且尚未結束時顯示', () => {
    expect(canEndCompetition({ status: 'published', endedAt: null })).toBe(true);
    expect(canEndCompetition({ status: 'published', endedAt: 1 })).toBe(false);
    expect(canEndCompetition({ status: 'postponed', endedAt: null })).toBe(false);
    expect(canEndCompetition({ status: 'draft', endedAt: null })).toBe(false);
    expect(canEndCompetition({ status: 'cancelled', endedAt: null })).toBe(false);
  });

  it('順延與對調只在已發布、且未結束或是管理員時顯示', () => {
    expect(canShowFlexSchedule({ status: 'published', endedAt: null }, false)).toBe(true);
    expect(canShowFlexSchedule({ status: 'published', endedAt: 1 }, false)).toBe(false);
    expect(canShowFlexSchedule({ status: 'published', endedAt: 1 }, true)).toBe(true);
    expect(canShowFlexSchedule({ status: 'draft', endedAt: null }, true)).toBe(false);
    expect(canShowFlexSchedule({ status: 'postponed', endedAt: null }, false)).toBe(false);
    expect(canShowFlexSchedule({ status: 'cancelled', endedAt: null }, true)).toBe(false);
  });

  it('解鎖：未鎖定不顯示；首場前主辦可解，首場後只留管理員', () => {
    expect(canUnlockRosters({ locked: false, canManage: true, isAdmin: true, firstMatchAt: 100, now: 50 })).toBe(false);
    expect(canUnlockRosters({ locked: true, canManage: true, isAdmin: false, firstMatchAt: 100, now: 50 })).toBe(true);
    expect(canUnlockRosters({ locked: true, canManage: true, isAdmin: false, firstMatchAt: 100, now: 100 })).toBe(false);
    expect(canUnlockRosters({ locked: true, canManage: false, isAdmin: true, firstMatchAt: 100, now: 200 })).toBe(true);
  });

  it('登錄表單：自己要是成員、代填要是代表，而且限 pending 或 approved、未鎖、首場前', () => {
    const open = { isMember: true, isRep: false, status: 'pending' as const, locked: false, started: false };
    expect(rosterFormBlock({ ...open, kind: 'self' })).toBeNull();
    expect(rosterFormBlock({ ...open, kind: 'self', status: 'approved' })).toBeNull();
    expect(rosterFormBlock({ ...open, kind: 'self', isMember: false })).toBe('NOT_CLUB_MEMBER');
    expect(rosterFormBlock({ ...open, kind: 'rep', isRep: true })).toBeNull();
    expect(rosterFormBlock({ ...open, kind: 'rep', isRep: false, isMember: true })).toBe('NOT_CLUB_REP');
    expect(rosterFormBlock({ ...open, kind: 'self', status: 'rejected' })).toBe('ENTRY_STATUS');
    expect(rosterFormBlock({ ...open, kind: 'self', status: null })).toBe('ENTRY_STATUS');
    expect(rosterFormBlock({ ...open, kind: 'self', locked: true })).toBe('ROSTERS_LOCKED');
    expect(rosterFormBlock({ ...open, kind: 'self', started: true })).toBe('COMPETITION_STARTED');
  });
});
