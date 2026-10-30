import type { RolesData } from './role-model';

/** 全為合成資料，不使用正式 UID 或用戶文件。 */
export function rolesFixture(): RolesData {
  return {
    rolePermissions: {
      user: { permissions: [] },
      coach: { permissions: ['event.create', 'event.edit_own'], defaultPermissions: ['event.publish'], catalogVersion: '20260506b', meta: { keep: true } },
      captain: { permissions: [] },
      venue_owner: { permissions: [] },
      admin: { permissions: ['admin.users.entry', 'admin.users.edit_profile'], defaultPermissions: [] },
      super_admin: { permissions: [] },
    },
    roleActivityDocuments: { user: { capabilities: ['user.activity.basic_create'], catalogVersion: '20260505a', defaultCapabilities: [] } },
    roleActivityCapabilities: { user: ['user.activity.basic_create'] },
    permissions: [],
    customRoles: [],
    counts: { user: 3, coach: 1, captain: 0, venue_owner: 0, admin: 1, super_admin: 1 },
  };
}
