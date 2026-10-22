import type { CustomRole } from '@/features/profile/data/permissions';
import { describe, expect, it } from 'vitest';

import oracle from './__fixtures__/operate-oracle.json';
import {
  canEditOwnActivityBasic,
  canCancelOwnActivity,
  canReopenOrRelistActivity,
  canDeleteActivity,
  canOperateEventSite,
  canRemoveConfirmedParticipant,
  hasActivityManageEntry,
  canManageEvent,
  hasUserActivityCapability,
  type OperateContext,
  type OperateEvent,
} from './operate-permissions';
import {
  ACTIVITY_CAPABILITY_CODES,
  type ActivityCapabilityCode,
} from '../../profile/data/permissions';

const ACTIONS = {
  canEditOwnActivityBasic,
  canCancelOwnActivity,
  canReopenOrRelistActivity,
  canDeleteActivity,
  canOperateEventSite,
  canRemoveConfirmedParticipant,
  canManageEvent,
} as const;

const EXPECTED_FIELDS = [
  ...Object.keys(ACTIONS),
  'hasActivityManageEntry',
  'capabilities',
  // T-005b（M-089）：fixture 新增兩欄，由上方 M-089 案例另行逐案比對。
  'canViewEventOperationLog',
  'canManageTeamOnlyVisibility',
].sort();

describe('O 階段：A 真實函式 432 案差分 oracle', () => {
  it('M-089：主案例逐案比對 Log 與俱樂部公開權限', async () => {
    const helpers = await import('./operate-permissions');
    const { isTeamStaff, getEventLimitedTeamIds } = await import('./team-staff');
    for (const testCase of oracle.cases) {
      const input = testCase.input;
      const context: OperateContext = {
        uid: input.uid,
        role: input.role,
        rolePermissions: input.rolePermissions,
        userGrants: input.userGrants,
        capabilities: input.capabilities,
        customRoles: input.customRoles.map(role => ({ ...(role as CustomRole) })),
      };
      // ASSUMPTION: PM fixture 的 teams 是 A getTeams() 的原始文件陣列。
      const teams = input.teams as Array<{
        id?: unknown;
        _docId?: unknown;
        docId?: unknown;
        captainUid?: unknown;
        leaderUids?: unknown;
        leaderUid?: unknown;
        coachUids?: unknown;
      }>;
      const staff = new Set(getEventLimitedTeamIds(input.teamEvent).filter(id => {
        const team = teams.find(item => item.id === id)
          ?? teams.find(item => [item.id, item._docId, item.docId]
            .map(value => String(value || '').trim()).filter(Boolean).includes(id));
        return isTeamStaff(input.uid, team);
      }));
      expect(helpers.canViewEventOperationLog(context, input.event), `${testCase.id}: Log`)
        .toBe(testCase.expected.canViewEventOperationLog);
      expect(
        helpers.canManageTeamOnlyVisibility(context, input.teamEvent, staff),
        `${testCase.id}: visibility`,
      ).toBe(testCase.expected.canManageTeamOnlyVisibility);
    }
  });

  it('M-089：540 案 teamVisibilityCases 全量差分', async () => {
    const helpers = await import('./operate-permissions');
    const { isTeamStaff, getEventLimitedTeamIds } = await import('./team-staff');
    expect(oracle.teamVisibilityCases).toHaveLength(540);
    for (const [index, testCase] of oracle.teamVisibilityCases.entries()) {
      const input = testCase.input;
      const context: OperateContext = {
        uid: input.uid,
        role: input.role,
        rolePermissions: input.rolePermissions,
        userGrants: input.userGrants,
        capabilities: input.capabilities,
        customRoles: input.customRoles.map(role => ({ ...(role as CustomRole) })),
      };
      // ASSUMPTION: PM fixture 的 teams 是 A getTeams() 的原始文件陣列。
      const teams = input.teams as Array<{
        id?: unknown;
        _docId?: unknown;
        docId?: unknown;
        captainUid?: unknown;
        leaderUids?: unknown;
        leaderUid?: unknown;
        coachUids?: unknown;
      }>;
      const staff = new Set(getEventLimitedTeamIds(input.teamEvent).filter(id => {
        const team = teams.find(item => item.id === id)
          ?? teams.find(item => [item.id, item._docId, item.docId]
            .map(value => String(value || '').trim()).filter(Boolean).includes(id));
        return isTeamStaff(input.uid, team);
      }));
      expect(helpers.canViewEventOperationLog(context, input.event), `${index}: Log`)
        .toBe(testCase.expected.canViewEventOperationLog);
      expect(
        helpers.canManageTeamOnlyVisibility(context, input.teamEvent, staff),
        `${index}: team`,
      ).toBe(testCase.expected.canManageTeamOnlyVisibility);
      expect(
        helpers.canManageTeamOnlyVisibility(context, input.event, staff),
        `${index}: non-team`,
      ).toBe(testCase.expected.canManageTeamOnlyVisibilityNonTeamEvent);
    }
  });

  it('完整 fixture；禁止以 6 案 sample 代替', () => {
    expect(oracle.meta.caseCount).toBe(432);
    expect(oracle.cases).toHaveLength(432);
    expect(new Set(oracle.cases.map(testCase => testCase.id)).size).toBe(432);
    // T-005b：FC 67114d051 擴充 oracle（新增 Log／活動公開 helper 與 teamVisibilityCases），既有 432 案預期值不變。
    expect(oracle.meta.fcHead).toBe('67114d051a76fc2cb35ef8d8623ccc4959211fa9');
  });

  for (const testCase of oracle.cases) {
    it(testCase.id, () => {
      const input = testCase.input;
      const context: OperateContext = {
        uid: input.uid,
        role: input.role,
        rolePermissions: input.rolePermissions === null
          ? null
          : [...input.rolePermissions],
        userGrants: input.userGrants === null
          ? null
          : {
              uid: input.userGrants.uid,
              enabled: input.userGrants.enabled,
              permissions: [...input.userGrants.permissions],
            },
        capabilities: [...input.capabilities],
        customRoles: input.customRoles.map(role => ({ ...(role as CustomRole) })),
      };
      const event: OperateEvent = {
        ...input.event,
        delegateUids: [...input.event.delegateUids],
      };

      const capabilities = Object.fromEntries(
        ACTIVITY_CAPABILITY_CODES.map(code => [
          code,
          hasUserActivityCapability(context, code),
        ]),
      ) as Record<ActivityCapabilityCode, boolean>;

      const actual = {
        canEditOwnActivityBasic: canEditOwnActivityBasic(context, event),
        canCancelOwnActivity: canCancelOwnActivity(context, event),
        canReopenOrRelistActivity: canReopenOrRelistActivity(context, event),
        canDeleteActivity: canDeleteActivity(context, event),
        canOperateEventSite: canOperateEventSite(context, event),
        canRemoveConfirmedParticipant: canRemoveConfirmedParticipant(context, event),
        hasActivityManageEntry: hasActivityManageEntry(context),
        canManageEvent: canManageEvent(context, event),
        capabilities,
      };

      expect(Object.keys(testCase.expected).sort(), testCase.id).toEqual(EXPECTED_FIELDS);
      expect(
        Object.keys(testCase.expected.capabilities).sort(),
        `${testCase.id}: capability keys`,
      ).toEqual([...ACTIVITY_CAPABILITY_CODES].sort());

      for (const field of Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]) {
        expect(actual[field], `${testCase.id}: ${field}`).toBe(testCase.expected[field]);
      }
      expect(
        actual.hasActivityManageEntry,
        `${testCase.id}: hasActivityManageEntry`,
      ).toBe(testCase.expected.hasActivityManageEntry);

      for (const code of ACTIVITY_CAPABILITY_CODES) {
        expect(actual.capabilities[code], `${testCase.id}: ${code}`)
          .toBe(testCase.expected.capabilities[code]);
      }

      const {
        canViewEventOperationLog: _log,
        canManageTeamOnlyVisibility: _teamVisibility,
        ...baseExpected
      } = testCase.expected;
      expect(actual, `${testCase.id}: complete expected`).toStrictEqual(baseExpected);
    });
  }
});
