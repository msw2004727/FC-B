import { describe, expect, it } from 'vitest';
import { canHostOrCo, canManageCompetition, canRegisterClubEntry, canSeeInAppSection, canUnlockRosters, isCpAdmin, rosterFormBlock } from './access';

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

  it('排賽程只給主辦、共同主辦、管理員，俱樂部代表不算', () => {
    expect(canHostOrCo({ staffRoles: ['host'], isAdmin: false })).toBe(true);
    expect(canHostOrCo({ staffRoles: ['coHost'], isAdmin: false })).toBe(true);
    expect(canHostOrCo({ staffRoles: [], isAdmin: true })).toBe(true);
    expect(canHostOrCo({ staffRoles: [], isAdmin: false })).toBe(false);
  });

  it('以俱樂部報隊只給代表，而且要在公開報名期間', () => {
    expect(canRegisterClubEntry(window)).toBe(true);
    expect(canRegisterClubEntry({ ...window, repClubIds: [] })).toBe(false);
    expect(canRegisterClubEntry({ ...window, now: 9 })).toBe(false);
    expect(canRegisterClubEntry({ ...window, now: 21 })).toBe(false);
    expect(canRegisterClubEntry({ ...window, status: 'draft' })).toBe(false);
    expect(canRegisterClubEntry({ ...window, hidden: true })).toBe(false);
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
