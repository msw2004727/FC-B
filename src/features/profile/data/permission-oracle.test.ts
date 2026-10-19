import { describe, it, expect } from 'vitest';

import oracleFixture from './__fixtures__/permission-oracle.json';
import {
  buildPermissionCheckerInput,
  createPermissionChecker,
} from './permissions';

interface OracleCase {
  id: string;
  input: {
    currentUser: {
      uid: string;
      role: string;
    };
    rolePermissionsState: string;
    rolePermissionsShape: string;
    rolePermissions: unknown;
    rolePermissionMetaState: string;
    rolePermissionMeta: unknown;
    currentUserPermissionGrantState: string;
    currentUserPermissionGrant: unknown;
    customRoles: unknown;
    code: string;
  };
  expected: {
    hasPermission: boolean;
    hasCurrentUserEffectivePermission: boolean;
  };
}

interface OracleFixture {
  meta?: {
    caseCount?: number;
  };
  cases: OracleCase[];
}

const fixture = oracleFixture as unknown as OracleFixture;

describe('permission-oracle (612 cases)', () => {
  it('fixture 案例數為 612', () => {
    expect(fixture.cases).toHaveLength(612);
    if (fixture.meta?.caseCount !== undefined) {
      expect(fixture.meta.caseCount).toBe(612);
    }
  });

  it('對 612 案逐案與 A 的 expected.hasPermission 一致', () => {
    for (const testCase of fixture.cases) {
      const { id, input, expected } = testCase;
      const checkerInput = buildPermissionCheckerInput({
        role: input.currentUser.role,
        uid: input.currentUser.uid,
        rolePermissionDocs: input.rolePermissions,
        rolePermissionMetaDocs: input.rolePermissionMeta,
        grantDoc: input.currentUserPermissionGrant,
        customRoles: input.customRoles,
      });
      const hasPermission = createPermissionChecker(checkerInput);
      const actual = hasPermission(input.code);

      expect(
        actual,
        `Case ${id} failed: role=${input.currentUser.role}, uid=${input.currentUser.uid}, code=${input.code}, ` +
          `rolePermissionsState=${input.rolePermissionsState}, rolePermissionsShape=${input.rolePermissionsShape}, ` +
          `rolePermissionMetaState=${input.rolePermissionMetaState}, grantState=${input.currentUserPermissionGrantState}`,
      ).toBe(expected.hasPermission);
    }
  });
});
