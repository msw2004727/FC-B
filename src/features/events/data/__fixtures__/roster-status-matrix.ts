import type { OperateContext } from '../operate-permissions';
import type { RosterStatusEvent } from '../roster-status-policy';
import matrix from './roster-status-matrix.json';
export { matrix };
export function matrixInput(row: typeof matrix[number]): { context: OperateContext; event: RosterStatusEvent } {
  return {
    context: {
      uid: 'uidA', role: row.role, rolePermissions: row.permissions,
      userGrants: { uid: 'uidA', enabled: true, permissions: row.permissions },
      capabilities: row.site ? ['user.activity.site_operate'] : [], customRoles: [],
    },
    event: {
      id: 'evtA', max: 2, creatorUid: row.scope === 'owner' ? 'uidA' : 'uidB',
      delegateUids: row.scope === 'delegate' ? ['uidA'] : [], privateEvent: row.privateEvent,
    },
  };
}
