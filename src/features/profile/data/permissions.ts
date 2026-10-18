/**
 * FC-B 目前使用者身分與權限資料層（純函式）。
 *
 * 規則對照：
 *  - R-IAM-008：INHERENT_ROLE_PERMISSIONS 必須逐字與 A 的 js/config.js、functions/index.js 同步。
 *  - R-CAP-006～008：capabilities 儲存格式不得改寫；本檔只負責正規化結果，不寫回 storage。
 *
 * 邏輯與 A 的 js/config.js#hasPermission 逐條對齊：
 *  1. 空字串 code 一律 false。
 *  2. 有效權限集合 = inherent[role] ∪ rolePermissions[role] ∪ userPermissionGrants effective。
 *  3. 判斷方式比對 normalize 後的 code。
 */

/** A 版 INHERENT_ROLE_PERMISSIONS 之逐字鏡像（含鍵順序）。 */
export const INHERENT_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  coach: [],
  captain: [],
  venue_owner: [],
  super_admin: ['admin.repair.event_blocklist', 'admin.seo.entry'],
});

/** A 版 _BASE_ROLE_LEVEL_MAP 之逐字鏡像。 */
export const BASE_ROLE_LEVEL_MAP: Readonly<Record<string, number>> = Object.freeze({
  user: 0,
  coach: 1,
  captain: 2,
  venue_owner: 3,
  admin: 4,
  super_admin: 5,
});

const BUILTIN_ROLE_KEYS = Object.freeze([
  'user',
  'coach',
  'captain',
  'venue_owner',
  'admin',
  'super_admin',
] as const);

export interface CustomRole {
  key: string;
  label?: string;
  color?: string;
  /** 預設為 'captain'（沿用 A 的行為）。 */
  afterRole?: string;
}

function normalizeCustomRoles(customRoles?: readonly CustomRole[] | null): CustomRole[] {
  if (!customRoles || customRoles.length === 0) return [];
  const result: CustomRole[] = [];
  for (const role of customRoles) {
    if (!role || typeof role.key !== 'string') continue;
    const key = role.key.trim();
    if (!key) continue;
    result.push({
      key,
      label: role.label || key,
      color: role.color || '#6366f1',
      afterRole: role.afterRole || 'captain',
    });
  }
  return result;
}

/** 建立角色序列（DFS，與 A getRuntimeRoleSequence 一致）。 */
function buildRoleSequence(customRoles: readonly CustomRole[]): string[] {
  const children = new Map<string, CustomRole[]>();
  for (const role of customRoles) {
    const parent = role.afterRole || 'captain';
    const list = children.get(parent);
    if (list) list.push(role);
    else children.set(parent, [role]);
  }

  const result: string[] = [];
  const visited = new Set<string>();

  const appendRole = (roleKey: string): void => {
    result.push(roleKey);
    const childRoles = children.get(roleKey) || [];
    for (const child of childRoles) {
      if (visited.has(child.key)) continue;
      visited.add(child.key);
      appendRole(child.key);
    }
  };

  for (const builtin of BUILTIN_ROLE_KEYS) appendRole(builtin);

  for (const role of customRoles) {
    if (visited.has(role.key)) continue;
    visited.add(role.key);
    result.push(role.key);
  }

  return result;
}

/** 建立完整 level map（基準 + 自訂角色插值，逐條照 A _buildRuntimeRoleLevelMap）。 */
function buildRoleLevelMap(customRoles: readonly CustomRole[]): Record<string, number> {
  const levels: Record<string, number> = { ...BASE_ROLE_LEVEL_MAP };
  const sequence = buildRoleSequence(customRoles);

  for (let i = 0; i < BUILTIN_ROLE_KEYS.length - 1; i += 1) {
    const startKey = BUILTIN_ROLE_KEYS[i];
    const endKey = BUILTIN_ROLE_KEYS[i + 1];
    if (!startKey || !endKey) continue;
    const startIndex = sequence.indexOf(startKey);
    const endIndex = sequence.indexOf(endKey);
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex + 1) continue;

    const between = sequence.slice(startIndex + 1, endIndex);
    const startLevel = BASE_ROLE_LEVEL_MAP[startKey] ?? 0;
    const endLevel = BASE_ROLE_LEVEL_MAP[endKey] ?? 0;
    const step = (endLevel - startLevel) / (between.length + 1);
    between.forEach((roleKey, index) => {
      levels[roleKey] = startLevel + step * (index + 1);
    });
  }

  const superAdminIndex = sequence.indexOf('super_admin');
  if (superAdminIndex >= 0 && superAdminIndex < sequence.length - 1) {
    const deferredRoles = sequence.slice(superAdminIndex + 1);
    const adminLevel = BASE_ROLE_LEVEL_MAP.admin ?? 0;
    const superLevel = BASE_ROLE_LEVEL_MAP.super_admin ?? 0;
    const step = (superLevel - adminLevel) / (deferredRoles.length + 1);
    deferredRoles.forEach((roleKey, index) => {
      levels[roleKey] = adminLevel + step * (index + 1);
    });
  }

  return levels;
}

/**
 * 取得角色 level。與 A getRuntimeRoleLevel 等價：預設回 0。
 * customRoles 為 A 的 `App._getCustomRoles()` 正規化結果（key / afterRole 用於插值）。
 */
export function getRoleLevel(
  role: string | null | undefined,
  customRoles?: readonly CustomRole[] | null,
): number {
  if (!role) return 0;
  const levels = buildRoleLevelMap(normalizeCustomRoles(customRoles));
  return levels[role] ?? 0;
}

function normalizePermissionCode(code: string): string {
  return String(code).trim();
}

export interface PermissionCheckerInput {
  /** 目前角色；null/undefined 代表未登入，一律 false。 */
  role: string | null | undefined;
  /** rolePermissions 文件（docId -> code 陣列）；索引未命中視為空。 */
  rolePermissions?: Record<string, readonly string[]> | null;
  /** userPermissionGrants 的 effective code 陣列（已由資料層正規化）。 */
  userGrants?: readonly string[] | null;
  /** 供將來使用；permission 判定本身不需要 level。 */
  customRoles?: readonly CustomRole[] | null;
}

/**
 * 建立權限檢查函式。回傳的 `(code) => boolean` 與 A `hasPermission(code, role)` 等價。
 *
 * 有效權限集合 = INHERENT_ROLE_PERMISSIONS[role] ∪ rolePermissions[role] ∪ userGrants。
 */
export function createPermissionChecker(input: PermissionCheckerInput): (code: string) => boolean {
  const role = input.role;
  const rolePermissions = input.rolePermissions ?? {};
  const grants = input.userGrants ?? [];

  const inherentList: readonly string[] = role
    ? INHERENT_ROLE_PERMISSIONS[role] ?? []
    : [];
  const rolePermList: readonly string[] = role ? rolePermissions[role] ?? [] : [];

  const inherentSet = new Set<string>();
  for (const c of inherentList) inherentSet.add(normalizePermissionCode(c));
  const roleSet = new Set<string>();
  for (const c of rolePermList) roleSet.add(normalizePermissionCode(c));
  const grantSet = new Set<string>();
  for (const c of grants) grantSet.add(normalizePermissionCode(String(c)));

  return (code: string): boolean => {
    if (!code) return false;
    const normalized = normalizePermissionCode(code);
    if (!normalized) return false;
    if (!role) return false;
    if (inherentSet.has(normalized)) return true;
    if (roleSet.has(normalized)) return true;
    if (grantSet.has(normalized)) return true;
    return false;
  };
}
