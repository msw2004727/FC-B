// 刪除賽事的顯示條件（對齊後端 host.ts deleteCompetition 與 context.ts isPrimaryHost）。
import { describe, expect, it } from 'vitest';
import { canDeleteCompetition, isPrimaryHostView, type DeleteAccessInput } from './delete-access';

const FIRST = 2_000_000;
const BEFORE = FIRST - 1;

function input(partial: Partial<DeleteAccessInput> = {}): DeleteAccessInput {
  return {
    uid: 'uid_x',
    role: 'user',
    hostType: 'personal',
    hostTeamId: null,
    staffRoles: [],
    repClubIds: [],
    hidden: false,
    deletingAt: null,
    endedAt: null,
    firstMatchAt: FIRST,
    now: BEFORE,
    ...partial,
  };
}

describe('canDeleteCompetition 各身分', () => {
  it('管理員（admin、super_admin）顯示', () => {
    expect(canDeleteCompetition(input({ role: 'admin' }))).toBe(true);
    expect(canDeleteCompetition(input({ role: 'super_admin', hostType: 'club', hostTeamId: 'club_a' }))).toBe(true);
  });

  it('個人主辦（staff host）顯示', () => {
    expect(canDeleteCompetition(input({ staffRoles: ['host'] }))).toBe(true);
  });

  it('俱樂部主辦的目前代表顯示（不必是 staff）', () => {
    expect(canDeleteCompetition(input({ hostType: 'club', hostTeamId: 'club_a', repClubIds: ['club_b', 'club_a'] }))).toBe(true);
  });

  it('前代表：俱樂部賽事上的 staff host 不算主辦（context.ts isPrimaryHost 只認目前代表）', () => {
    expect(canDeleteCompetition(input({ hostType: 'club', hostTeamId: 'club_a', staffRoles: ['host'], repClubIds: [] }))).toBe(false);
    expect(canDeleteCompetition(input({ hostType: 'club', hostTeamId: 'club_a', repClubIds: ['club_b'] }))).toBe(false);
  });

  it('共同主辦不顯示（個人與俱樂部賽事都一樣）', () => {
    expect(canDeleteCompetition(input({ staffRoles: ['coHost'] }))).toBe(false);
    expect(canDeleteCompetition(input({ hostType: 'club', hostTeamId: 'club_a', staffRoles: ['coHost'] }))).toBe(false);
  });

  it('一般用戶不顯示；代表清單還在讀（空陣列）也不顯示', () => {
    expect(canDeleteCompetition(input())).toBe(false);
    expect(canDeleteCompetition(input({ hostType: 'club', hostTeamId: 'club_a' }))).toBe(false);
  });

  it('未登入不顯示，就算 role 寫著 admin', () => {
    expect(canDeleteCompetition(input({ uid: null }))).toBe(false);
    expect(canDeleteCompetition(input({ uid: null, role: 'admin' }))).toBe(false);
  });

  it('俱樂部賽事沒有 hostTeamId 時不算代表', () => {
    expect(isPrimaryHostView({ hostType: 'club', hostTeamId: null, staffRoles: ['host'], repClubIds: [''] })).toBe(false);
    expect(isPrimaryHostView({ hostType: 'club', hostTeamId: '', staffRoles: [], repClubIds: [''] })).toBe(false);
  });
});

describe('canDeleteCompetition 時間與下架', () => {
  it('首場開始後（含剛好開始）主辦看不到，管理員仍看得到', () => {
    for (const now of [FIRST, FIRST + 1]) {
      expect(canDeleteCompetition(input({ staffRoles: ['host'], now }))).toBe(false);
      expect(canDeleteCompetition(input({ hostType: 'club', hostTeamId: 'club_a', repClubIds: ['club_a'], now }))).toBe(false);
      expect(canDeleteCompetition(input({ role: 'admin', now }))).toBe(true);
    }
  });

  it('被下架（沒有 deletingAt）主辦看不到，管理員仍看得到', () => {
    expect(canDeleteCompetition(input({ staffRoles: ['host'], hidden: true }))).toBe(false);
    expect(canDeleteCompetition(input({ hostType: 'club', hostTeamId: 'club_a', repClubIds: ['club_a'], hidden: true }))).toBe(false);
    expect(canDeleteCompetition(input({ role: 'admin', hidden: true }))).toBe(true);
  });

  it('刪到一半（hidden＋deletingAt）：首場前主辦可續刪；首場後只剩管理員；共同主辦仍不行', () => {
    const stuck = { hidden: true, deletingAt: BEFORE - 10 };
    expect(canDeleteCompetition(input({ ...stuck, staffRoles: ['host'] }))).toBe(true);
    expect(canDeleteCompetition(input({ ...stuck, hostType: 'club', hostTeamId: 'club_a', repClubIds: ['club_a'] }))).toBe(true);
    expect(canDeleteCompetition(input({ ...stuck, staffRoles: ['host'], now: FIRST }))).toBe(false);
    expect(canDeleteCompetition(input({ ...stuck, role: 'admin', now: FIRST + 1 }))).toBe(true);
    expect(canDeleteCompetition(input({ ...stuck, staffRoles: ['coHost'] }))).toBe(false);
  });
});
