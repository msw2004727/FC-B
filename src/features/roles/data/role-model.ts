import {
  ACTIVITY_CAPABILITY_CODES, BUILTIN_ROLE_KEYS, INHERENT_ROLE_PERMISSIONS,
  createPermissionChecker, getAllPermissionCodes, getDefaultRoleActivityCapabilities,
  normalizePermissionCode, sanitizePermissionCodeList, type CustomRole,
} from '@/features/profile/data/permissions';
import { assertAllowedFields } from '@/data/write-guard';
import { getARolePermissionDefaults, type RoleDocument } from './role-defaults';
import type { CatalogCategory } from './permission-catalog';
import { RoleAdminGuardError } from './role-errors';

export interface RolesData {
  rolePermissions: Record<string, RoleDocument>;
  roleActivityDocuments: Record<string, RoleDocument>;
  /** R-CAP-006：正規化讀取 shape；[] 不回填預設。 */
  roleActivityCapabilities: { user: string[] };
  customRoles: CustomRole[];
  permissions: CatalogCategory[];
  counts: Record<string, number>;
}
export type RoleAction =
  | { kind: 'toggle'; code: string }
  | { kind: 'save-defaults' }
  | { kind: 'restore-defaults' }
  | { kind: 'capability'; code: string };
export interface RolePermissionsWrite { permissions: string[] }
export interface RolePermissionDefaultsWrite { defaultPermissions: string[] }
export interface RoleActivityCapabilitiesWrite {
  capabilities: string[];
  updatedAt: unknown;
  updatedBy: string;
}
export type RoleWrite = RolePermissionsWrite | RolePermissionDefaultsWrite | RoleActivityCapabilitiesWrite;
export interface RolePreview {
  role: string;
  actorUid: string;
  action: RoleAction;
  collection: 'rolePermissions' | 'roleActivityCapabilities';
  before: RoleDocument | null;
  after: RoleDocument;
  payload: RoleWrite;
  added: string[];
  removed: string[];
  /** 完整文件前後與動作的規範化序列；只作確認比對，絕不輸出日誌。 */
  fingerprint: string;
}
export function canManageRoles(viewer: { uid: string | null; role: string }): boolean {
  return !!viewer.uid && viewer.role === 'super_admin';
}
export function isLockedRole(role: string): boolean {
  return role === 'user' || role === 'super_admin';
}
export function canEditRole(role: string): boolean {
  return BUILTIN_ROLE_KEYS.some(key => key === role) && !isLockedRole(role);
}

/** 保留陣列順序、型別與缺欄位狀態；不能只比較本次按下的碼。 */
export function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'number:' + String(value);
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonical((value as RoleDocument)[key])).join(',') + '}';
}

/** 只檢查「不得出現 allowed 以外的頂層欄位」，不要求必填欄位都在。 */
export function assertOnlyTopLevelFields(payload: object, allowed: readonly string[]): void {
  assertAllowedFields('roles', { ...payload }, allowed);
  // 共用 helper 接受 dotted field；本功能契約只接受精確頂層欄位。
  if (Object.keys(payload).some(key => !allowed.includes(key))) {
    throw new RoleAdminGuardError('invalid-argument');
  }
}
export function validatePermissions(raw: unknown, role: string, remote: readonly CatalogCategory[]): string[] {
  if (!Array.isArray(raw) || raw.length > 500 || raw.some(code => typeof code !== 'string')) {
    throw new RoleAdminGuardError('invalid-argument');
  }
  // 停用碼必須明確拒絕；舊碼替換則由完整 diff 告知。
  if (raw.some(code => code.trim() === 'admin.roles.entry')) throw new RoleAdminGuardError('invalid-argument');
  const allowed = new Set(getAllPermissionCodes(remote));
  const permissions = sanitizePermissionCodeList(raw);
  if (raw.some(code => !code.trim()) || permissions.some(code => !allowed.has(code))) {
    throw new RoleAdminGuardError('invalid-argument');
  }
  if ((INHERENT_ROLE_PERMISSIONS[role] ?? []).some(code => !permissions.includes(code))) {
    throw new RoleAdminGuardError('invalid-argument');
  }
  return permissions;
}
export function normalizeCapabilities(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.some(code =>
    typeof code !== 'string' || !ACTIVITY_CAPABILITY_CODES.some(allowed => allowed === code))) {
    throw new RoleAdminGuardError('invalid-argument');
  }
  return [...new Set(raw)] as string[];
}
export function currentPermissions(data: RolesData, role: string): string[] {
  const doc = data.rolePermissions[role];
  const stored = Array.isArray(doc?.['permissions']) ? doc['permissions'] as string[] : [];
  const hasPermission = createPermissionChecker({
    role, customRoles: data.customRoles, permissionCatalog: data.permissions,
    rolePermissions: doc ? { [role]: stored } : {},
  });
  return getAllPermissionCodes(data.permissions).filter(hasPermission);
}
export function capabilitySource(doc: RoleDocument | null): { user: string[] } {
  if (doc && Object.prototype.hasOwnProperty.call(doc, 'capabilities') && !Array.isArray(doc['capabilities'])) {
    throw new RoleAdminGuardError('invalid-argument');
  }
  return { user: doc && Array.isArray(doc['capabilities'])
    ? normalizeCapabilities(doc['capabilities'])
    : getDefaultRoleActivityCapabilities('user') };
}

/** 載入快照產生預覽；寫入層必須用伺服器文件再次呼叫。 */
export function prepareRoleChange(
  data: RolesData, role: string, action: RoleAction, actorUid: string,
): RolePreview {
  if (!actorUid || ![...BUILTIN_ROLE_KEYS, ...data.customRoles.map(item => item.key)].includes(role)) {
    throw new RoleAdminGuardError('invalid-argument');
  }
  if (!action || !['toggle', 'save-defaults', 'restore-defaults', 'capability'].includes(action.kind)) {
    throw new RoleAdminGuardError('invalid-argument');
  }
  assertOnlyTopLevelFields(action, action.kind === 'toggle' || action.kind === 'capability' ? ['kind', 'code'] : ['kind']);
  const isCap = action.kind === 'capability';
  if (isCap ? role !== 'user' : !canEditRole(role)) throw new RoleAdminGuardError('locked-role');
  const collection = isCap ? 'roleActivityCapabilities' : 'rolePermissions';
  const before = (isCap ? data.roleActivityDocuments[role] : data.rolePermissions[role]) ?? null;
  let payload: RoleWrite;
  let field: 'permissions' | 'defaultPermissions' | 'capabilities';
  if (action.kind === 'capability') {
    if (!ACTIVITY_CAPABILITY_CODES.some(code => code === action.code)) throw new RoleAdminGuardError('invalid-argument');
    const current = capabilitySource(before).user;
    const next = current.includes(action.code) ? current.filter(code => code !== action.code) : [...current, action.code];
    payload = { capabilities: normalizeCapabilities(next), updatedAt: 'SERVER_TIMESTAMP', updatedBy: actorUid };
    field = 'capabilities';
    assertOnlyTopLevelFields(payload, ['capabilities', 'updatedAt', 'updatedBy']);
  } else {
    const raw = before?.['permissions'];
    if (raw !== undefined && !Array.isArray(raw)) throw new RoleAdminGuardError('invalid-argument');
    // 先驗原始值，避免 currentPermissions 的顯示過濾偷偷洗掉未知碼。
    if (raw !== undefined) validatePermissions(raw, role, data.permissions);
    let next: unknown[] = currentPermissions(data, role);
    if (action.kind === 'toggle') {
      if (normalizePermissionCode(action.code) !== action.code ||
          !getAllPermissionCodes(data.permissions).includes(action.code) ||
          (INHERENT_ROLE_PERMISSIONS[role] ?? []).includes(action.code)) {
        throw new RoleAdminGuardError('invalid-argument');
      }
      next = next.includes(action.code) ? next.filter(code => code !== action.code) : [...next, action.code];
    }
    if (action.kind === 'restore-defaults') {
      const defaults = getARolePermissionDefaults(role, data.rolePermissions, data.customRoles);
      if (defaults === null) throw new RoleAdminGuardError('no-defaults');
      next = defaults;
    }
    const permissions = validatePermissions(next, role, data.permissions);
    field = action.kind === 'save-defaults' ? 'defaultPermissions' : 'permissions';
    payload = field === 'defaultPermissions' ? { defaultPermissions: permissions } : { permissions };
    assertOnlyTopLevelFields(payload, [field]);
  }
  const after: RoleDocument = { ...before, ...payload };
  const old = Array.isArray(before?.[field]) ? before[field] as unknown[] : [];
  const next = after[field] as string[];
  const added = next.filter(code => !old.includes(code));
  const removed = old.filter((code): code is string => typeof code === 'string' && !next.includes(code));
  const fingerprint = canonical({ role, actorUid, action, collection, before, after });
  return { role, actorUid, action, collection, before, after, payload, added, removed, fingerprint };
}
