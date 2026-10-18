/**
 * FC-B 目前使用者身分與權限資料層（純函式）。
 *
 * 規則對照：
 *  - R-IAM-008：INHERENT_ROLE_PERMISSIONS 必須逐字與 A 的 js/config.js、functions/index.js 同步。
 *  - R-CAP-006～008：capabilities 儲存格式不得改寫；本檔只負責正規化結果，不寫回 storage。
 *  - R-EVT-018：rolePermissions/user 不得授予 admin.repair.event_blocklist；個別授權可授予。
 *
 * 權限來源逐條照 A：
 *  - getCurrentUserEffectivePermissions：rolePermissions ∪ userPermissionGrants（super_admin 不併入個別授權）。
 *  - getRolePermissions：role === 'user' 時固定回空陣列。
 *  - normalizePermissionCode：type 檢查、trim、停用 code、legacy replacement。
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

/**
 * A 附件未提供 DISABLED_PERMISSION_CODES／LEGACY_PERMISSION_CODE_REPLACEMENTS 的常數內容。
 * 本檔保留 A normalizePermissionCode 的完整結構；若 A 常數有值，必須同步補入，不得另寫一套規則。
 */
const DISABLED_PERMISSION_CODES: ReadonlySet<string> = new Set<string>();
const LEGACY_PERMISSION_CODE_REPLACEMENTS: Readonly<Record<string, string>> = Object.freeze({});

export interface CustomRole {
  key: string;
  label?: string;
  color?: string;
  /** 預設為 'captain'（沿用 A 的行為）。 */
  afterRole?: string;
}

/** 照 A：保留 role.key 原值，不自行 trim。 */
function normalizeCustomRoles(customRoles?: readonly CustomRole[] | null): CustomRole[] {
  if (!customRoles || customRoles.length === 0) return [];
  const result: CustomRole[] = [];
  for (const role of customRoles) {
    if (!role || typeof role.key !== 'string') continue;
    if (!role.key) continue;
    result.push({
      key: role.key,
      label: role.label || role.key,
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

/** 逐條照 A js/config.js#normalizePermissionCode。 */
export function normalizePermissionCode(code: unknown): string {
  if (typeof code !== 'string') return '';
  const trimmed = code.trim();
  if (!trimmed || DISABLED_PERMISSION_CODES.has(trimmed)) return '';
  if (Object.prototype.hasOwnProperty.call(LEGACY_PERMISSION_CODE_REPLACEMENTS, trimmed)) {
    return LEGACY_PERMISSION_CODE_REPLACEMENTS[trimmed] ?? '';
  }
  return trimmed;
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
 * 其中 role === 'user' 時 rolePermissions 固定不納入（A getRolePermissions('user') 回 []）。
 * super_admin 不併入 userGrants（A getCurrentUserEffectivePermissions 的 isCurrentUser && roleKey !== 'super_admin'）。
 */
export function createPermissionChecker(input: PermissionCheckerInput): (code: string) => boolean {
  const role = input.role;
  const rolePermissions = input.rolePermissions ?? {};
  const grants = input.userGrants ?? [];

  const inherentList: readonly string[] = role
    ? INHERENT_ROLE_PERMISSIONS[role] ?? []
    : [];
  const rolePermList: readonly string[] = role && role !== 'user'
    ? rolePermissions[role] ?? []
    : [];
  const grantList: readonly string[] = role && role !== 'super_admin' ? grants : [];

  const inherentSet = new Set<string>();
  for (const c of inherentList) {
    const normalized = normalizePermissionCode(c);
    if (normalized) inherentSet.add(normalized);
  }
  const roleSet = new Set<string>();
  for (const c of rolePermList) {
    const normalized = normalizePermissionCode(c);
    if (normalized) roleSet.add(normalized);
  }
  const grantSet = new Set<string>();
  for (const c of grantList) {
    const normalized = normalizePermissionCode(String(c));
    if (normalized) grantSet.add(normalized);
  }

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
