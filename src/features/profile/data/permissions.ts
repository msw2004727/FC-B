/**
 * 純函式權限層，依附件 A config.js / api-service.js 移植。
 * 缺少角色文件與 permissions: [] 不同：前者使用 defaults，後者明確關閉。
 * 本次未執行編譯或測試；驗證狀態不得視為通過。
 */

export const INHERENT_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    coach: [],
    captain: [],
    venue_owner: [],
    super_admin: ['admin.repair.event_blocklist', 'admin.seo.entry'],
  });

export const BASE_ROLE_LEVEL_MAP: Readonly<Record<string, number>> = Object.freeze({
  user: 0,
  coach: 1,
  captain: 2,
  venue_owner: 3,
  admin: 4,
  super_admin: 5,
});

const BUILTIN_ROLE_KEYS = [
  'user', 'coach', 'captain', 'venue_owner', 'admin', 'super_admin',
] as const;

const DISABLED_PERMISSION_CODES: ReadonlySet<string> = new Set(['admin.roles.entry']);
const LEGACY_PERMISSION_CODE_REPLACEMENTS: Readonly<Record<string, string>> =
  Object.freeze({
    'event.edit_own': 'event.edit_self',
    'event.delete_own': 'event.delete_self',
    'event.scan_qr': 'event.scan',
    'event.view_participants': 'event.view_registrations',
    'team.manage_own': 'team.manage_self',
    'team.approve_join': 'team.review_join',
    'team.create_team_event': 'team.create_event',
    'team.toggle_event_public': 'team.toggle_event_visibility',
    'admin.teams.entry': 'team.manage.entry',
    'admin.scoreboard.entry': '',
  });

export interface CustomRole {
  key: string;
  label?: string;
  color?: string;
  afterRole?: string;
}

function normalizeCustomRoles(roles?: readonly CustomRole[] | null): CustomRole[] {
  return (roles ?? [])
    .filter(role => role && typeof role.key === 'string' && role.key.trim())
    .map(role => ({
      key: role.key,
      label: role.label || role.key,
      color: role.color || '#6366f1',
      afterRole: role.afterRole || 'captain',
    }));
}

function buildRoleSequence(roles: readonly CustomRole[]): string[] {
  const children = new Map<string, CustomRole[]>();
  for (const role of roles) {
    const parent = role.afterRole || 'captain';
    const list = children.get(parent);
    if (list) list.push(role);
    else children.set(parent, [role]);
  }

  const result: string[] = [];
  const visited = new Set<string>();
  const appendRole = (key: string): void => {
    result.push(key);
    for (const child of children.get(key) ?? []) {
      if (visited.has(child.key)) continue;
      visited.add(child.key);
      appendRole(child.key);
    }
  };

  for (const key of BUILTIN_ROLE_KEYS) appendRole(key);
  for (const role of roles) {
    if (visited.has(role.key)) continue;
    visited.add(role.key);
    result.push(role.key);
  }
  return result;
}

function buildRoleLevelMap(roles: readonly CustomRole[]): Record<string, number> {
  const levels: Record<string, number> = { ...BASE_ROLE_LEVEL_MAP };
  const sequence = buildRoleSequence(roles);

  for (let i = 0; i < BUILTIN_ROLE_KEYS.length - 1; i += 1) {
    const startKey = BUILTIN_ROLE_KEYS[i];
    const endKey = BUILTIN_ROLE_KEYS[i + 1];
    if (startKey === undefined || endKey === undefined) continue;
    const startIndex = sequence.indexOf(startKey);
    const endIndex = sequence.indexOf(endKey);
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex + 1) continue;

    const between = sequence.slice(startIndex + 1, endIndex);
    const startLevel = BASE_ROLE_LEVEL_MAP[startKey] ?? 0;
    const endLevel = BASE_ROLE_LEVEL_MAP[endKey] ?? 0;
    const step = (endLevel - startLevel) / (between.length + 1);
    between.forEach((key, index) => {
      levels[key] = startLevel + step * (index + 1);
    });
  }

  const superIndex = sequence.indexOf('super_admin');
  if (superIndex >= 0 && superIndex < sequence.length - 1) {
    const deferred = sequence.slice(superIndex + 1);
    const admin = BASE_ROLE_LEVEL_MAP.admin ?? 0;
    const superAdmin = BASE_ROLE_LEVEL_MAP.super_admin ?? 0;
    const step = (superAdmin - admin) / (deferred.length + 1);
    deferred.forEach((key, index) => {
      levels[key] = admin + step * (index + 1);
    });
  }
  return levels;
}

/** A getRuntimeRoleLevel；與 ROLE_LEVEL_MAP Proxy 的內建角色優先序分開。 */
export function getRoleLevel(
  role: string | null | undefined,
  customRoles?: readonly CustomRole[] | null,
): number {
  if (!role) return 0;
  return buildRoleLevelMap(normalizeCustomRoles(customRoles))[role] ?? 0;
}

/** A ROLE_LEVEL_MAP Proxy：內建角色直接取 base，其他角色才計算 runtime。 */
export function getActivityRoleLevel(
  role: string | null | undefined,
  customRoles?: readonly CustomRole[] | null,
): number {
  if (!role) return 0;
  if (Object.prototype.hasOwnProperty.call(BASE_ROLE_LEVEL_MAP, role)) {
    return BASE_ROLE_LEVEL_MAP[role] ?? 0;
  }
  return getRoleLevel(role, customRoles);
}

export function normalizePermissionCode(code: unknown): string {
  if (typeof code !== 'string') return '';
  const trimmed = code.trim();
  if (!trimmed || DISABLED_PERMISSION_CODES.has(trimmed)) return '';
  if (Object.prototype.hasOwnProperty.call(LEGACY_PERMISSION_CODE_REPLACEMENTS, trimmed)) {
    return LEGACY_PERMISSION_CODE_REPLACEMENTS[trimmed] ?? '';
  }
  return trimmed;
}

export function sanitizePermissionCodeList(codes: unknown): string[] {
  if (!Array.isArray(codes)) return [];
  return [...new Set(codes.map(normalizePermissionCode).filter(Boolean))];
}

/**
 * A getAdminDrawerPermissionDefinitions 的權限投影。
 * 僅省略 UI label/page；入口順序、minRole、子權限保持來源順序。
 */
const DRAWER_PERMISSION_DEFINITIONS: readonly {
  entryCode: string;
  minRole: string;
  items: readonly string[];
}[] = [
  {
    entryCode: 'activity.manage.entry',
    minRole: 'coach',
    items: [
      'event.create', 'event.edit_self', 'event.edit_all', 'event.delete_self',
      'event.delete', 'event.publish', 'event.scan', 'event.manual_checkin',
      'event.view_registrations',
    ],
  },
  {
    entryCode: 'admin.tournaments.entry',
    minRole: 'coach',
    items: [
      'admin.tournaments.create', 'admin.tournaments.manage_all',
      'admin.tournaments.review', 'admin.tournaments.end',
      'admin.tournaments.reopen', 'admin.tournaments.delete',
    ],
  },
  {
    entryCode: 'team.manage.entry',
    minRole: 'captain',
    items: [
      'team.create', 'team.manage_all', 'team.manage_self', 'team.review_join',
      'team.assign_coach', 'team.create_event', 'team.toggle_event_visibility',
    ],
  },
  { entryCode: 'admin.games.entry', minRole: 'admin', items: [] },
  {
    entryCode: 'admin.users.entry',
    minRole: 'admin',
    items: [
      'admin.users.edit_profile', 'admin.users.change_role', 'admin.users.restrict',
    ],
  },
  { entryCode: 'admin.banners.entry', minRole: 'admin', items: [] },
  { entryCode: 'admin.shop.entry', minRole: 'admin', items: [] },
  {
    entryCode: 'admin.messages.entry',
    minRole: 'admin',
    items: ['admin.messages.compose', 'admin.messages.delete'],
  },
  { entryCode: 'admin.dashboard.entry', minRole: 'super_admin', items: [] },
  { entryCode: 'admin.seo.entry', minRole: 'admin', items: [] },
  { entryCode: 'admin.themes.entry', minRole: 'super_admin', items: [] },
  { entryCode: 'admin.exp.entry', minRole: 'super_admin', items: [] },
  { entryCode: 'admin.auto_exp.entry', minRole: 'super_admin', items: [] },
  {
    entryCode: 'admin.notif.entry',
    minRole: 'super_admin',
    items: ['admin.notif.toggle'],
  },
  { entryCode: 'admin.announcements.entry', minRole: 'super_admin', items: [] },
  { entryCode: 'admin.achievements.entry', minRole: 'super_admin', items: [] },
  {
    entryCode: 'admin.logs.entry',
    minRole: 'super_admin',
    items: ['admin.logs.error_read', 'admin.logs.error_delete', 'admin.logs.audit_read'],
  },
  {
    entryCode: 'admin.repair.entry',
    minRole: 'admin',
    items: [
      'admin.repair.team_join_repair', 'admin.repair.no_show_adjust',
      'admin.repair.data_sync', 'admin.repair.event_blocklist', 'activity.view_noshow',
    ],
  },
  { entryCode: 'admin.inactive.entry', minRole: 'super_admin', items: [] },
];

export interface PermissionCategory {
  cat?: string;
  items?: readonly { code?: unknown }[];
}

function isPermissionCodeEnabled(code: unknown): code is string {
  if (typeof code !== 'string') return false;
  const trimmed = code.trim();
  return !!trimmed && normalizePermissionCode(trimmed) === trimmed;
}

export function getUserPermissionGrantAllowedCodes(): string[] {
  return sanitizePermissionCodeList([
    ...DRAWER_PERMISSION_DEFINITIONS.flatMap(def => [def.entryCode, ...def.items]),
    'profile.secondary_identity',
  ]).filter(isPermissionCodeEnabled);
}

export function sanitizeUserPermissionGrantCodeList(codes: unknown): string[] {
  if (!Array.isArray(codes)) return [];
  const allowed = new Set(getUserPermissionGrantAllowedCodes());
  return [...new Set(
    codes
      .map((code: unknown) => typeof code === 'string' ? code.trim() : '')
      .filter(code => !!code && allowed.has(code) && normalizePermissionCode(code) === code),
  )];
}

/** A merged catalog 的 code 投影；遠端 catalog 不擴張個別 grant allowlist。 */
export function getAllPermissionCodes(
  remoteCategories: readonly PermissionCategory[] = [],
): string[] {
  const codes = getUserPermissionGrantAllowedCodes();
  const assigned = new Set(codes);
  for (const category of remoteCategories) {
    const items = Array.isArray(category.items) ? category.items : [];
    const additional = items.filter(item =>
      item && isPermissionCodeEnabled(item.code) && !assigned.has(item.code),
    );
    for (const item of additional) {
      if (typeof item.code !== 'string') continue;
      assigned.add(item.code);
      codes.push(item.code);
    }
  }
  return codes;
}

export function getDefaultRolePermissions(
  role: string,
  customRoles?: readonly CustomRole[] | null,
): string[] | null {
  if (!BUILTIN_ROLE_KEYS.some(key => key === role)) return null;
  if (role === 'user') return [];

  const level = getRoleLevel(role, customRoles);
  const defaults = DRAWER_PERMISSION_DEFINITIONS
    .filter(def => level >= getRoleLevel(def.minRole, customRoles))
    .map(def => def.entryCode);

  if (level >= getRoleLevel('coach', customRoles)) defaults.push('activity.view_noshow');
  if (level >= getRoleLevel('admin', customRoles)) {
    defaults.push(
      'team.create', 'team.manage_all', 'event.edit_all',
      'admin.tournaments.manage_all', 'admin.tournaments.end',
      'admin.tournaments.reopen', 'admin.tournaments.delete',
    );
  }
  if (level >= getRoleLevel('super_admin', customRoles)) defaults.push('admin.notif.toggle');
  return [...new Set(defaults)];
}

export interface PermissionCheckerInput {
  /** null/undefined 是 B 的未就緒／訪客狀態，一律拒絕。 */
  role: string | null | undefined;
  /** own key 缺失使用 defaults；own key 存在且 [] 表示明確全關。 */
  rolePermissions?: Record<string, readonly string[]> | null;
  /** 已驗證 UID/enabled 的 effective grant；仍套用 A allowlist。 */
  userGrants?: readonly string[] | null;
  customRoles?: readonly CustomRole[] | null;
  /** A permissions cache；oracle 未提供此 cache，因此預設空。 */
  permissionCatalog?: readonly PermissionCategory[];
}

export function createPermissionChecker(
  input: PermissionCheckerInput,
): (code: string) => boolean {
  if (input.role === null || input.role === undefined || input.role === '') {
    return () => false;
  }

  const role = input.role.trim() || 'user';
  const source = input.rolePermissions ?? {};
  const hasStored = Object.prototype.hasOwnProperty.call(source, role);
  const stored = hasStored ? source[role] ?? [] : getDefaultRolePermissions(role, input.customRoles) ?? [];
  const roleCodes = role === 'user'
    ? []
    : [
        ...stored,
        ...(INHERENT_ROLE_PERMISSIONS[role] ?? []),
        ...(role === 'super_admin' ? getAllPermissionCodes(input.permissionCatalog) : []),
      ];
  const grants = role === 'super_admin'
    ? []
    : sanitizeUserPermissionGrantCodeList(input.userGrants);
  const effective = new Set(sanitizePermissionCodeList([...roleCodes, ...grants]));

  return (code: string): boolean => {
    const normalized = normalizePermissionCode(code);
    return !!normalized && effective.has(normalized);
  };
}

export const ACTIVITY_CAPABILITY_CODES = Object.freeze([
  'user.activity.basic_create',
  'user.activity.external_create',
  'user.activity.own_manage_entry',
  'user.activity.own_edit_basic',
  'user.activity.own_cancel',
  'user.activity.site_operate',
  'user.activity.delegate_assign',
  'user.activity.addons_use',
] as const);

export type ActivityCapabilityCode = typeof ACTIVITY_CAPABILITY_CODES[number];

const ACTIVITY_CAPABILITY_SET: ReadonlySet<string> = new Set(ACTIVITY_CAPABILITY_CODES);

export function sanitizeRoleActivityCapabilities(codes: unknown): string[] {
  if (!Array.isArray(codes)) return [];
  return [...new Set(codes.filter(
    (code: unknown): code is string =>
      typeof code === 'string' && ACTIVITY_CAPABILITY_SET.has(code),
  ))];
}

export function getDefaultRoleActivityCapabilities(role: string): string[] {
  return role === 'user'
    ? ACTIVITY_CAPABILITY_CODES.filter(code => code !== 'user.activity.addons_use')
    : [];
}
