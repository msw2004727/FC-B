import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import source from './__fixtures__/roster-status-server.json';
import predicates from './__fixtures__/roster-status-predicates.json';
import { matrix, matrixInput } from './__fixtures__/roster-status-matrix';
import {
  canAdjustRosterStatus, isRosterStatusCourseEvent, isRosterStatusCourseRegistration, isRosterStatusCourseTarget,
} from './roster-status-policy';
type Access = { role: string; isSuperAdmin: boolean; hasPermission: (code: string) => boolean; hasActivityCapability: (code: string) => boolean };
type Server = {
  canRemoveConfirmedParticipantForAccess: (access: Access, event: object, uid: string) => boolean;
  canOperateEventSiteForAccess: (access: Access, event: object, uid: string) => boolean;
  isCourseLinkedEventData: (event: object) => boolean;
  isCourseLinkedRegistrationData: (reg: object) => boolean;
};
const server = runInNewContext(source.code + ';({ canRemoveConfirmedParticipantForAccess, canOperateEventSiteForAccess, isCourseLinkedEventData, isCourseLinkedRegistrationData })') as Server;
describe('名單狀態調整固定矩陣', () => {
  it('來源快照完整', () => {
    expect(createHash('sha256').update(source.code).digest('hex')).toBe(source.sha256);
  });
  it.each(matrix)('$id：來源 helper 與 B 每格對照', row => {
    const { context, event } = matrixInput(row);
    const access: Access = {
      role: row.role, isSuperAdmin: row.role === 'super_admin',
      hasPermission: code => row.role === 'super_admin' || row.permissions.includes(code),
      hasActivityCapability: code => row.role === 'user' && row.site && code === 'user.activity.site_operate',
    };
    const actual = [
      server.canRemoveConfirmedParticipantForAccess(access, event, 'uidA'),
      server.canOperateEventSiteForAccess(access, event, 'uidA'),
    ];
    expect(actual).toEqual([row.demote, row.promote]);
    expect([canAdjustRosterStatus('demote', context, event), canAdjustRosterStatus('promote', context, event)])
      .toEqual(actual);
    for (const status of ['ended', 'cancelled']) {
      const terminal = { ...event, status };
      expect(canAdjustRosterStatus('demote', context, terminal)).toBe(row.demote);
      expect(canAdjustRosterStatus('promote', context, terminal)).toBe(row.promote);
    }
  });
  it.each(predicates)('報名連動固定夾具 %#', ({ input, expected }) => {
    expect(server.isCourseLinkedRegistrationData(input)).toBe(expected);
    expect(isRosterStatusCourseRegistration(input)).toBe(expected);
  });
  it.each([
    [{}, false],
    [{ courseLinked: true }, false],
    [{ courseLinkSource: 'eduCourseLesson' }, false],
    [{ courseLinked: true, courseLinkSource: ' eduCourseLesson ' }, true],
    [{ courseLinked: 'true', courseLinkSource: 'eduCourseLesson' }, false],
    [{ courseLinked: true, courseLinkSource: 'other' }, false],
  ] as const)('活動連動固定夾具 %#', (input, expected) => {
    expect(server.isCourseLinkedEventData(input)).toBe(expected);
    expect(isRosterStatusCourseEvent(input)).toBe(expected);
  });
  it('同組目標含同行者；其他狀態與其他人不阻擋', () => {
    expect(isRosterStatusCourseTarget('demote', [
      { userId: 'uidB', status: 'confirmed', participantType: 'companion', coursePriority: true },
    ], 'uidB')).toBe(true);
    expect(isRosterStatusCourseTarget('demote', [
      { userId: 'uidB', status: 'cancelled', coursePriority: true },
      { userId: 'uidA', status: 'confirmed', coursePriority: true },
    ], 'uidB')).toBe(false);
  });
});
