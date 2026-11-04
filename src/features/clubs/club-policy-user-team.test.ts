// T-090：一般用戶建立俱樂部能力開關與自建俱樂部（createdVia === 'user_capability'）的入口政策。
//
// 修正前應失敗的理由：
// - canCreateTeam 修正前只看 team.create，role=user＋user.activity.team_create 會回 false（入口不出現）；
// - isUserCapabilityTeamCreator／isUserCapabilityTeam 修正前不存在；
// - canTransferCaptain 修正前對自建俱樂部經理回 true（Rules 不允許，送出必失敗）；
// - canDeleteTeam 修正前要求教練以上，自建俱樂部的一般用戶擁有者看不到刪除。
import { describe, expect, it } from 'vitest';

import {
  canCreateTeam,
  canDeleteTeam,
  canTransferCaptain,
  isUserCapabilityTeam,
  isUserCapabilityTeamCreator,
} from './club-policy';
import type { ClubCreateTeamViewer, TeamDeleteViewer } from './club-policy';
import type { TeamDoc } from './data/types';

function viewer(
  role: string,
  capabilities: readonly string[],
  permissions: readonly string[] = [],
  uid: string | null = 'u1',
): ClubCreateTeamViewer {
  return { uid, role, capabilities, hasPermission: (code) => permissions.includes(code) };
}

describe('canCreateTeam／isUserCapabilityTeamCreator（T-090）', () => {
  it('一般用戶有 user.activity.team_create 時可建立，且判定走能力開關路徑', () => {
    const v = viewer('user', ['user.activity.team_create']);
    expect(canCreateTeam(v)).toBe(true);
    expect(isUserCapabilityTeamCreator(v)).toBe(true);
  });

  it('一般用戶沒有能力碼不可建立', () => {
    expect(canCreateTeam(viewer('user', ['user.activity.basic_create']))).toBe(false);
  });

  it('教練以上不走能力開關（顧問裁定），只看 team.create', () => {
    expect(isUserCapabilityTeamCreator(viewer('coach', ['user.activity.team_create']))).toBe(false);
    expect(canCreateTeam(viewer('coach', ['user.activity.team_create']))).toBe(false);
    expect(canCreateTeam(viewer('coach', [], ['team.create']))).toBe(true);
  });

  it('訪客或空 UID 一律不可', () => {
    expect(canCreateTeam(viewer('user', ['user.activity.team_create'], [], null))).toBe(false);
    expect(canCreateTeam(viewer('user', ['user.activity.team_create'], [], '  '))).toBe(false);
  });

  it('未提供 role／capabilities 的舊呼叫端行為不變', () => {
    expect(canCreateTeam({ uid: 'u1', hasPermission: () => false })).toBe(false);
    expect(canCreateTeam({ uid: 'u1', hasPermission: (c) => c === 'team.create' })).toBe(true);
  });
});

describe('自建俱樂部政策（T-090）', () => {
  const own: TeamDoc = {
    id: 'tm_1', _docId: 'tm_1', captainUid: 'u1', creatorUid: 'u1', createdVia: 'user_capability',
  };
  const legacy: TeamDoc = { id: 'tm_2', _docId: 'tm_2', captainUid: 'u1', creatorUid: 'u1' };

  it('isUserCapabilityTeam 只認 createdVia === user_capability', () => {
    expect(isUserCapabilityTeam(own)).toBe(true);
    expect(isUserCapabilityTeam(legacy)).toBe(false);
    expect(isUserCapabilityTeam({ createdVia: 'admin' })).toBe(false);
    expect(isUserCapabilityTeam(null)).toBe(false);
  });

  it('自建俱樂部不開放經理轉移（含 manage_all）；既有俱樂部不變', () => {
    expect(canTransferCaptain(viewer('user', []), own)).toBe(false);
    expect(canTransferCaptain(viewer('admin', [], ['team.manage_all']), own)).toBe(false);
    expect(canTransferCaptain(viewer('user', []), legacy)).toBe(true);
  });

  function deleter(uid: string, role: string, roleLevel: number): TeamDeleteViewer {
    return { uid, role, roleLevel, teamIds: new Set<string>(), hasPermission: () => false };
  }

  it('自建俱樂部的一般用戶擁有者可刪；非擁有者不可；既有俱樂部仍要教練以上', () => {
    expect(canDeleteTeam(deleter('u1', 'user', 0), own)).toBe(true);
    expect(canDeleteTeam(deleter('u9', 'user', 0), own)).toBe(false);
    expect(canDeleteTeam(deleter('u1', 'user', 0), legacy)).toBe(false);
  });
});
