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
].sort();

describe('O 階段：A 真實函式 432 案差分 oracle', () => {
  it('完整 fixture；禁止以 6 案 sample 代替', () => {
    expect(oracle.meta.caseCount).toBe(432);
    expect(oracle.cases).toHaveLength(432);
    expect(new Set(oracle.cases.map(testCase => testCase.id)).size).toBe(432);
    expect(oracle.meta.fcHead).toBe('5ba42ed5c96afded5e3dfdb0d3ef447d65e35185');
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

      expect(actual, `${testCase.id}: complete expected`).toStrictEqual(testCase.expected);
    });
  }
});
