import { BUILTIN_ROLE_KEYS, getRoleLevel, type CustomRole } from '@/features/profile/data/permissions';
import { BUILTIN_CATALOG } from './permission-catalog';

export type RoleDocument = Record<string, unknown>;

/**
 * Q10：A js/config.js#getDefaultRolePermissions 的逐步翻譯。
 * 只作 A ApiService.getRolePermissionDefaults 的最後 fallback；不能取代保存的 defaultPermissions。
 * 不呼叫 B 靜態 getDefaultRolePermissions，避免省略 A 的 meta 優先序。
 */
function aBuiltinDefaults(role: string, customRoles: readonly CustomRole[]): string[] | null {
  if (!BUILTIN_ROLE_KEYS.some(key => key === role)) return null;
  if (role === 'user') return [];
  const level = getRoleLevel(role, customRoles);
  const defaults: string[] = [];
  for (const category of BUILTIN_CATALOG) {
    if (category.minRole && level >= getRoleLevel(category.minRole, customRoles)) {
      const entry = category.items[0];
      if (entry) defaults.push(entry.code);
    }
  }
  if (level >= getRoleLevel('coach', customRoles)) defaults.push('activity.view_noshow');
  if (level >= getRoleLevel('admin', customRoles)) {
    defaults.push('team.create', 'team.manage_all', 'event.edit_all',
      'admin.tournaments.manage_all', 'admin.tournaments.end',
      'admin.tournaments.reopen', 'admin.tournaments.delete');
  }
  if (level >= getRoleLevel('super_admin', customRoles)) defaults.push('admin.notif.toggle');
  return [...new Set(defaults)];
}

/** A api-service.js#getRolePermissionDefaults：user → meta 陣列／物件 → A 內建 fallback → null。 */
export function getARolePermissionDefaults(
  role: string,
  meta: Record<string, RoleDocument> | RoleDocument[],
  customRoles: readonly CustomRole[] = [],
): unknown[] | null {
  if (role === 'user') return [];
  const entry = Array.isArray(meta)
    ? meta.find(item => String(item['_docId'] || item['roleKey'] || item['role'] || item['id'] || '') === role)
    : meta[role];
  const savedDefaults = entry?.['defaultPermissions'];
  if (Array.isArray(savedDefaults)) return [...savedDefaults];
  const builtInDefaults = aBuiltinDefaults(role, customRoles);
  return Array.isArray(builtInDefaults) ? [...builtInDefaults] : null;
}

/** 原始文件欄位狀態（不套用 fallback）：確認框必須區分「無預設」與空陣列。 */
export function savedDefaults(doc: RoleDocument | null): unknown[] | null {
  return Array.isArray(doc?.['defaultPermissions']) ? [...doc['defaultPermissions']] : null;
}
