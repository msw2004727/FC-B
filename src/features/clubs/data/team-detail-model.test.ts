/**
 * `team-detail-model` 純函式測試。
 *
 * 覆蓋：
 *   - getTeamStaffIdentity：captainUid、leaderUids 陣列優先於 leaderUid（含空陣列強制覆蓋）
 *   - buildTeamRoster：幹部排前、名稱相同但 uid 不同不合併、幹部缺 user doc 仍出現
 *   - getTeamDetailVisibility / isTeamDetailSectionVisible
 *   - isTeamEventForTeam / isTeamEventInFuture / getTeamFutureEvents
 *   - getTeamPrimaryAction 各狀態
 *   - canEditTeamByRoleOrCaptain / canManageTeamMembers
 *   - getTeamMemberCount 讀 team.members，不自算
 */

import { describe, expect, it } from 'vitest';
import type { EventDoc } from '@/features/events/data/types';

import {
  buildTeamRoster,
  canEditTeamByRoleOrCaptain,
  canManageTeamMembers,
  getTeamDetailVisibility,
  getTeamFutureEvents,
  getTeamMemberCount,
  getTeamPrimaryAction,
  getTeamStaffIdentity,
  isTeamDetailSectionVisible,
  isTeamEventForTeam,
  isTeamEventInFuture,
} from './team-detail-model';
import type { ClubViewer, TeamDoc, TeamMember } from './types';

function makeViewer(partial: Partial<ClubViewer> = {}): ClubViewer {
  return {
    uid: 'me',
    teamIds: new Set<string>(),
    hasPermission: () => false,
    ...partial,
  };
}

describe('getTeamStaffIdentity', () => {
  it('captainUid / coachUids 為集合', () => {
    const staff = getTeamStaffIdentity({
      captainUid: 'cap',
      coachUids: ['co1', 'co2', 42],
    });
    expect([...staff.captainUids]).toEqual(['cap']);
    expect([...staff.coachUids]).toEqual(['co1', 'co2', '42']);
    expect([...staff.leaderUids]).toEqual([]);
  });

  it('leaderUids 陣列優先於 leaderUid（不聯集）', () => {
    const staff = getTeamStaffIdentity({
      leaderUid: 'old',
      leaderUids: ['a', 'b'],
    });
    expect([...staff.leaderUids].sort()).toEqual(['a', 'b']);
  });

  it('leaderUids 為空陣列時仍不退回 leaderUid', () => {
    const staff = getTeamStaffIdentity({ leaderUid: 'old', leaderUids: [] });
    expect(staff.leaderUids.size).toBe(0);
  });

  it('leaderUids 未設定時退回 leaderUid', () => {
    const staff = getTeamStaffIdentity({ leaderUid: 'legacy' });
    expect([...staff.leaderUids]).toEqual(['legacy']);
  });

  it('trim 空白、忽略空字串', () => {
    const staff = getTeamStaffIdentity({
      captainUid: '  cap  ',
      coachUids: ['  ', 'co'],
    });
    expect([...staff.captainUids]).toEqual(['cap']);
    expect([...staff.coachUids]).toEqual(['co']);
  });

  it('null team 回空集合', () => {
    const staff = getTeamStaffIdentity(null);
    expect(staff.captainUids.size).toBe(0);
    expect(staff.leaderUids.size).toBe(0);
    expect(staff.coachUids.size).toBe(0);
  });
});

describe('buildTeamRoster', () => {
  const baseTeam: TeamDoc = {
    id: 't1',
    captainUid: 'cap',
    leaderUids: ['lead'],
    coachUids: ['co'],
  };

  it('幹部即使無 user doc 也出現且標記角色', () => {
    const roster = buildTeamRoster(baseTeam, []);
    const uids = roster.map((r) => r.uid).sort();
    expect(uids).toEqual(['cap', 'co', 'lead']);
    for (const row of roster) expect(row.isMember).toBe(true);
    const cap = roster.find((r) => r.uid === 'cap');
    expect(cap?.roles).toContain('clubs.role.captain');
    expect(cap?.isMissingName).toBe(true);
  });

  it('幹部排前、成員次之；同群組依名稱排序', () => {
    const users: TeamMember[] = [
      { uid: 'm1', name: 'Zoe', teamIds: ['t1'] },
      { uid: 'cap', name: 'Amy', teamIds: ['t1'] },
      { uid: 'm2', name: 'Bob', teamIds: ['t1'] },
    ];
    const roster = buildTeamRoster(baseTeam, users);
    // 幹部群組：cap 有角色；leader/co 為 stub 排在其餘幹部中
    const staffRows = roster.slice(0, 3);
    expect(staffRows.every((r) => r.roles.length > 0)).toBe(true);
    // 成員群組依名稱排序：Bob, Zoe
    const memberRows = roster.slice(3);
    expect(memberRows.map((r) => r.name)).toEqual(['Bob', 'Zoe']);
  });

  it('名稱相同但 uid 不同不得被合併（R-ID-002 drift）', () => {
    const users: TeamMember[] = [
      { uid: 'u1', name: 'Alex', teamIds: ['t1'] },
      { uid: 'u2', name: 'Alex', teamIds: ['t1'] },
    ];
    const team: TeamDoc = { id: 't1' }; // 無幹部
    const roster = buildTeamRoster(team, users);
    expect(roster).toHaveLength(2);
    expect(roster.map((r) => r.uid).sort()).toEqual(['u1', 'u2']);
  });

  it('uid 缺失的 user 被忽略', () => {
    const users: TeamMember[] = [
      { name: 'NoUid', teamIds: ['t1'] },
      { uid: 'u1', name: 'Has', teamIds: ['t1'] },
    ];
    const roster = buildTeamRoster({ id: 't1' }, users);
    expect(roster.map((r) => r.uid)).toEqual(['u1']);
  });

  it('不在 team 且非幹部者不出現', () => {
    const users: TeamMember[] = [
      { uid: 'u1', name: 'Other', teamIds: ['t2'] },
      { uid: 'u2', name: 'Mine', teamIds: ['t1'] },
    ];
    const roster = buildTeamRoster({ id: 't1' }, users);
    expect(roster.map((r) => r.uid)).toEqual(['u2']);
  });

  it('null team 回空陣列', () => {
    expect(buildTeamRoster(null, [])).toEqual([]);
  });

  it('leaderUids 陣列優先於 leaderUid：legacy UID 不成為幹部', () => {
    const team: TeamDoc = { id: 't1', leaderUid: 'old', leaderUids: ['new'] };
    const roster = buildTeamRoster(team, [{ uid: 'old', name: 'Old', teamIds: ['t1'] }]);
    const oldRow = roster.find((r) => r.uid === 'old');
    expect(oldRow?.roles).toEqual([]);
    const newRow = roster.find((r) => r.uid === 'new');
    expect(newRow?.roles).toContain('clubs.role.leader');
  });
});

describe('getTeamDetailVisibility / isTeamDetailSectionVisible', () => {
  it('未設定時全部可見', () => {
    expect(getTeamDetailVisibility(null)).toEqual({
      events: true,
      courses: true,
      matches: true,
      info: true,
      bio: true,
      record: true,
      members: true,
    });
  });

  it('明確 false 才關閉', () => {
    const vis = getTeamDetailVisibility({
      detailVisibility: { events: false, info: false },
    });
    expect(vis.events).toBe(false);
    expect(vis.info).toBe(false);
    expect(vis.courses).toBe(true);
  });

  it('courses 需 teaching 開啟才能顯示', () => {
    expect(isTeamDetailSectionVisible({ type: 'education' }, 'courses')).toBe(true);
    expect(isTeamDetailSectionVisible({ type: 'competitive' }, 'courses')).toBe(false);
    expect(
      isTeamDetailSectionVisible({ type: 'competitive', teachingEnabled: true }, 'courses'),
    ).toBe(true);
    expect(
      isTeamDetailSectionVisible(
        { type: 'education', detailVisibility: { courses: false } },
        'courses',
      ),
    ).toBe(false);
  });

  it('其他 key 只看 detailVisibility', () => {
    expect(
      isTeamDetailSectionVisible({ detailVisibility: { info: false } }, 'info'),
    ).toBe(false);
    expect(
      isTeamDetailSectionVisible({ detailVisibility: { info: false } }, 'events'),
    ).toBe(true);
  });
});

describe('isTeamEventForTeam / isTeamEventInFuture / getTeamFutureEvents', () => {
  it('照 A：只有 teamOnly 的活動才算該隊活動', () => {
    expect(isTeamEventForTeam({ teamOnly: true, creatorTeamId: 't1' }, 't1')).toBe(true);
    expect(isTeamEventForTeam({ creatorTeamId: 't1' }, 't1')).toBe(false);
    expect(isTeamEventForTeam({ teamOnly: false, creatorTeamIds: ['t1'] }, 't1')).toBe(false);
  });

  it('creatorTeamId 精確比對；creatorTeamIds 陣列任一命中即可', () => {
    expect(isTeamEventForTeam({ teamOnly: true, creatorTeamId: 't1' }, 't2')).toBe(false);
    expect(isTeamEventForTeam({ teamOnly: true, creatorTeamIds: ['x', 't1'] }, 't1')).toBe(true);
    expect(isTeamEventForTeam({ teamOnly: true, creatorTeamIds: 't1' } as never, 't1')).toBe(false);
  });

  it('null teamId/event 一律 false', () => {
    expect(isTeamEventForTeam(null, 't1')).toBe(false);
    expect(isTeamEventForTeam({ creatorTeamId: 't1' }, null)).toBe(false);
  });

  it('isTeamEventInFuture 照 A：ended／cancelled 否；start（無則 end）>= now；無法解析視為未來', () => {
    const now = new Date(Date.parse('2026-01-01T00:00:00+08:00'));
    expect(isTeamEventInFuture({ date: '2026/05/09 15:00~17:00' }, now)).toBe(true);
    expect(isTeamEventInFuture({ date: '2025/01/01 10:00~12:00' }, now)).toBe(false);
    expect(isTeamEventInFuture({ date: 'bad' }, now)).toBe(true);
    expect(isTeamEventInFuture({ date: '2026/05/09 15:00~17:00', status: 'ended' }, now)).toBe(false);
    expect(isTeamEventInFuture({ date: '2026/05/09 15:00~17:00', status: 'cancelled' }, now)).toBe(false);
    expect(isTeamEventInFuture(null, now)).toBe(false);
  });

  it('getTeamFutureEvents 過濾 team + future，依起始時間升冪', () => {
    const now = new Date(Date.parse('2026-01-01T00:00:00+08:00'));
    const events = [
      { id: 'e-later', date: '2026/06/01 10:00~12:00', teamOnly: true, creatorTeamId: 't1' },
      { id: 'e-past', date: '2025/12/01 10:00~12:00', teamOnly: true, creatorTeamId: 't1' },
      { id: 'e-other', date: '2026/06/01 10:00~12:00', teamOnly: true, creatorTeamId: 't2' },
      { id: 'e-soon', date: '2026/02/01 09:00~10:00', teamOnly: true, creatorTeamIds: ['t1'] },
      { id: 'e-public', date: '2026/03/01 09:00~10:00', creatorTeamId: 't1' },
    ];
    const result = getTeamFutureEvents('t1', events, now);
    expect(result.map((e) => e.id)).toEqual(['e-soon', 'e-later']);
  });

  it('非 t1 隊伍時回空陣列', () => {
    expect(getTeamFutureEvents('', [{}, {}], new Date())).toEqual([]);
  });
});

describe('getTeamPrimaryAction（照 A 三態）', () => {
  const team: TeamDoc = { id: 't1', captainUid: 'cap' };

  it('訪客與 team 為 null → join（按下後由 handler 要求登入）', () => {
    expect(getTeamPrimaryAction(team, { uid: null, teamIds: new Set(), hasPermission: () => false }, null)).toBe('join');
    expect(getTeamPrimaryAction(null, makeViewer(), null)).toBe('join');
  });

  it('非成員且 pending → pending', () => {
    expect(getTeamPrimaryAction(team, makeViewer(), { status: 'pending' })).toBe('pending');
  });

  it('成員 → leave；成員即使有舊 pending 也顯示 leave', () => {
    const viewer = makeViewer({ teamIds: new Set(['t1']) });
    expect(getTeamPrimaryAction(team, viewer, null)).toBe('leave');
    expect(getTeamPrimaryAction(team, viewer, { status: 'pending' })).toBe('leave');
  });

  it('隊長仍是 leave（管理入口另外判斷，不取代退出）', () => {
    const viewer = makeViewer({ uid: 'cap', teamIds: new Set(['t1']) });
    expect(getTeamPrimaryAction(team, viewer, null)).toBe('leave');
  });

  it('team.manage_all 但非成員 → join', () => {
    const viewer = makeViewer({ hasPermission: (code) => code === 'team.manage_all' });
    expect(getTeamPrimaryAction(team, viewer, null)).toBe('join');
  });
});

describe('canEditTeamByRoleOrCaptain / canManageTeamMembers', () => {
  it('owner 欄位任一匹配 → true', () => {
    expect(canEditTeamByRoleOrCaptain({ captainUid: 'me' }, makeViewer())).toBe(true);
    expect(canEditTeamByRoleOrCaptain({ creatorUid: 'me' }, makeViewer())).toBe(true);
    expect(canEditTeamByRoleOrCaptain({ ownerUid: 'me' }, makeViewer())).toBe(true);
  });

  it('team.manage_all 權限 → true', () => {
    const viewer = makeViewer({ hasPermission: () => true });
    expect(canEditTeamByRoleOrCaptain({ id: 't1' }, viewer)).toBe(true);
  });

  it('null viewer 或 null team → false', () => {
    expect(canEditTeamByRoleOrCaptain({ captainUid: 'me' }, null)).toBe(false);
    expect(canEditTeamByRoleOrCaptain(null, makeViewer())).toBe(false);
  });

  it('canManageTeamMembers：captainUid / leaderUids / coachUids', () => {
    expect(canManageTeamMembers({ captainUid: 'me' }, makeViewer())).toBe(true);
    expect(canManageTeamMembers({ leaderUids: ['me'] }, makeViewer())).toBe(true);
    expect(canManageTeamMembers({ coachUids: ['me'] }, makeViewer())).toBe(true);
  });

  it('canManageTeamMembers：leaderUid legacy 不算（A 只看陣列）', () => {
    expect(canManageTeamMembers({ leaderUid: 'me' }, makeViewer())).toBe(false);
  });
});

describe('getTeamMemberCount', () => {
  it('直接顯示 team.members，不自算', () => {
    expect(getTeamMemberCount({ members: 3 })).toBe(3);
    expect(getTeamMemberCount({ members: 0 })).toBe(0);
    expect(getTeamMemberCount({})).toBe(0);
    expect(getTeamMemberCount(null)).toBe(0);
  });

  it('非數值 members 視為 0', () => {
    const team = { members: 'not-a-number' } as unknown as TeamDoc;
    expect(getTeamMemberCount(team)).toBe(0);
  });
});


describe('T-054c C1–C3：俱樂部活動時間', () => {
  it('C1：字串與 Timestamp 依絕對起點排序，無法解析排最後', () => {
    const timestamp = {
      id: 'targetA', teamOnly: true, creatorTeamId: 'targetA',
      date: { seconds: Date.parse('2026-10-19T12:00:00+08:00') / 1000 },
    } as unknown as EventDoc;
    const events: EventDoc[] = [
      { id: 'uidA', teamOnly: true, creatorTeamId: 'targetA', date: 'bad' },
      timestamp,
      { id: 'evtA', teamOnly: true, creatorTeamId: 'targetA', date: '2026/10/19 11:00~13:00' },
    ];
    expect(getTeamFutureEvents('targetA', events, new Date(Date.parse('2026-10-19T00:30:00+08:00')))
      .map((event) => event.id)).toEqual(['evtA', 'targetA', 'uidA']);
  });

  it('C2：起點等於 now 仍是未來，後一毫秒不再是未來', () => {
    const event: EventDoc = { id: 'evtA', date: '2026/10/19 11:00~13:00' };
    expect(isTeamEventInFuture(event, new Date(Date.parse('2026-10-19T11:00:00+08:00')))).toBe(true);
    expect(isTeamEventInFuture(event, new Date(Date.parse('2026-10-19T11:00:00.001+08:00')))).toBe(false);
  });

  it('C3：起訖皆無法解析時仍是未來', () => {
    expect(isTeamEventInFuture({ id: 'evtA', date: 'bad' },
      new Date(Date.parse('2026-10-19T00:30:00+08:00')))).toBe(true);
  });
});
