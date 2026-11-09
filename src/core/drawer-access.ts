// 側邊選單入口的權限判斷，照 A `js/modules/role.js#_canAccessDrawerItem` 與 `js/config.js#DRAWER_MENUS`。
// 只決定選單顯示；頁面本身仍要擋權限（A `_canAccessPage`）。
import type { RouteAccessContext } from './feature-types';

/** A：有 permissionCode 的入口一律看 hasPermission（含個別授權）。 */
export function drawerByPermission(code: string): (access: RouteAccessContext) => boolean {
  return (access) => access.hasPermission(code);
}

/** 入口條件照寫入條件：super_admin，或非一般用戶且角色層級持有該權限碼（個別授權不算）。 */
export function drawerByRolePermission(code: string): (access: RouteAccessContext) => boolean {
  return (access) => {
    if (!access.uid) return false;
    if (access.role === 'super_admin') return true;
    if (!access.role || access.role === 'user' || access.role === 'guest') return false;
    return access.permissionSources?.rolePermissions?.includes(code) === true;
  };
}

/** A `_canAccessPage('page-admin-roles')`：權限管理只給 super_admin。 */
export function drawerSuperAdminOnly(access: RouteAccessContext): boolean {
  return access.role === 'super_admin';
}

/** 一般用戶自建俱樂部的前台活動能力碼（與 clubs/club-policy `USER_TEAM_CREATE_CAPABILITY` 同值）。 */
const USER_TEAM_CREATE_CAPABILITY = 'user.activity.team_create';

/**
 * 俱樂部管理入口（抽屜與頁面共用條件）：持 `team.manage.entry`，
 * 或一般用戶（role=user）有建立俱樂部能力（與 `isUserCapabilityTeamCreator` 相同判斷），
 * 讓自建俱樂部的擁有者也找得到管理頁（C1／P3）。頁面內只列自己能管的俱樂部。
 */
export function drawerTeamManage(access: RouteAccessContext): boolean {
  if (!access.uid || !access.uid.trim()) return false;
  return access.hasPermission('team.manage.entry')
    || (access.role === 'user' && access.capabilities.includes(USER_TEAM_CREATE_CAPABILITY));
}

/**
 * A `_canAccessOwnActivityManageEntry`（活動管理入口）：
 * 活動管理入口權限、coach 以上（含自訂角色等級）、跨活動編輯，或一般用戶擁有 own_manage_entry。
 */
export function drawerOwnActivityManage(access: RouteAccessContext): boolean {
  if (!access.uid) return false;
  return access.hasPermission('activity.manage.entry')
    || access.roleLevel >= 1
    || access.hasPermission('event.edit_all')
    || (access.role === 'user' && access.capabilities.includes('user.activity.own_manage_entry'));
}
