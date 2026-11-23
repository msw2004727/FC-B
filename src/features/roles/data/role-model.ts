import {
  ACTIVITY_CAPABILITY_CODES, BUILTIN_ROLE_KEYS, INHERENT_ROLE_PERMISSIONS,
  createPermissionChecker, getAllPermissionCodes, getDefaultRoleActivityCapabilities,
  normalizePermissionCode, sanitizePermissionCodeList, type CustomRole,
} from '@/features/profile/data/permissions';
import { assertAllowedFields } from '@/data/write-guard';
import {
  COMPETITION_HOST_CODE, USER_COMPETITION_HOST_CODE, isDefaultOnCodeEnabled,
} from '@/features/profile/data/default-on-codes';
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
/** 預設開碼（主辦賽事）只寫 disabledCodes，不碰 permissions／capabilities 陣列（顧問 §3.612）。 */
export interface RoleDisabledCodesWrite { disabledCodes: string[] }
export interface RoleActivityDisabledCodesWrite {
  disabledCodes: string[];
  updatedAt: unknown;
  updatedBy: string;
}
export type RoleWrite = RolePermissionsWrite | RolePermissionDefaultsWrite | RoleActivityCapabilitiesWrite
  | RoleDisabledCodesWrite | RoleActivityDisabledCodesWrite;
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
/** kept：原文件已存在、要原樣保留的未知碼（P2-15）；只有這些碼可以不在目錄裡。 */
export function validatePermissions(
  raw: unknown, role: string, remote: readonly CatalogCategory[], kept: readonly string[] = [],
): string[] {
  if (!Array.isArray(raw) || raw.length > 500 || raw.some(code => typeof code !== 'string')) {
    throw new RoleAdminGuardError('invalid-argument');
  }
  // 停用碼必須明確拒絕；舊碼替換則由完整 diff 告知。
  if (raw.some(code => code.trim() === 'admin.roles.entry')) throw new RoleAdminGuardError('invalid-argument');
  const allowed = new Set([...getAllPermissionCodes(remote), ...kept]);
  const permissions = sanitizePermissionCodeList(raw);
  if (raw.some(code => !code.trim()) || permissions.some(code => !allowed.has(code))) {
    throw new RoleAdminGuardError('invalid-argument');
  }
  if ((INHERENT_ROLE_PERMISSIONS[role] ?? []).some(code => !permissions.includes(code))) {
    throw new RoleAdminGuardError('invalid-argument');
  }
  return permissions;
}
/**
 * P2-15：原文件 permissions 裡目錄沒有的碼（非空字串、正規化後不變、不是 admin.roles.entry）。
 * 這些碼在切換其他開關時原樣保留，恢復預設時才丟掉（列在 removed 讓管理員確認）。
 */
export function existingUnknownCodes(raw: readonly unknown[], remote: readonly CatalogCategory[]): string[] {
  const allowed = new Set(getAllPermissionCodes(remote));
  return [...new Set(raw.filter((code): code is string => typeof code === 'string' && code !== ''
    && normalizePermissionCode(code) === code && code !== 'admin.roles.entry' && !allowed.has(code)))];
}
/**
 * 預設開碼的 disabledCodes 切換：目前開→加入、目前關→移出（判斷照 isDefaultOnCodeEnabled）。
 * 起點：原值是陣列就只留字串並去重；缺欄位當 []；壞值（null、字串、物件…）也當 [] 起算，等於順手修復壞值。
 */
export function toggleDisabledCodes(raw: unknown, code: string): string[] {
  const start = Array.isArray(raw)
    ? [...new Set(raw.filter((item): item is string => typeof item === 'string'))].filter(item => item !== code)
    : [];
  return isDefaultOnCodeEnabled(raw, code) ? [...start, code] : start;
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
  let field: 'permissions' | 'defaultPermissions' | 'capabilities' | 'disabledCodes';
  if (action.kind === 'capability' && action.code === USER_COMPETITION_HOST_CODE) {
    // 一般用戶主辦賽事：只寫 roleActivityCapabilities/user 的 disabledCodes，不動 capabilities 陣列。
    payload = {
      disabledCodes: toggleDisabledCodes(before?.['disabledCodes'], action.code),
      updatedAt: 'SERVER_TIMESTAMP', updatedBy: actorUid,
    };
    field = 'disabledCodes';
    assertOnlyTopLevelFields(payload, ['disabledCodes', 'updatedAt', 'updatedBy']);
  } else if (action.kind === 'toggle' && action.code === COMPETITION_HOST_CODE) {
    // 教練以上主辦賽事：只寫 rolePermissions/{role} 的 disabledCodes；不進 permissions、不經 validatePermissions。
    if ((INHERENT_ROLE_PERMISSIONS[role] ?? []).includes(action.code)) throw new RoleAdminGuardError('invalid-argument');
    payload = { disabledCodes: toggleDisabledCodes(before?.['disabledCodes'], action.code) };
    field = 'disabledCodes';
    assertOnlyTopLevelFields(payload, ['disabledCodes']);
  } else if (action.kind === 'capability') {
    if (!ACTIVITY_CAPABILITY_CODES.some(code => code === action.code)) throw new RoleAdminGuardError('invalid-argument');
    const current = capabilitySource(before).user;
    const next = current.includes(action.code) ? current.filter(code => code !== action.code) : [...current, action.code];
    payload = { capabilities: normalizeCapabilities(next), updatedAt: 'SERVER_TIMESTAMP', updatedBy: actorUid };
    field = 'capabilities';
    assertOnlyTopLevelFields(payload, ['capabilities', 'updatedAt', 'updatedBy']);
  } else {
    const raw = before?.['permissions'];
    if (raw !== undefined && !Array.isArray(raw)) throw new RoleAdminGuardError('invalid-argument');
    // P2-15：取代原本「先驗原始值、有未知碼就拋錯」的做法。原做法下，原文件只要含一個目錄沒有的碼（例如舊站或後端新增的碼），
    // 這個角色的所有開關都會丟 invalid-argument 而全部壞掉。改成：原文件已存在的未知碼在切換其他開關時原樣保留
    // （currentPermissions 的顯示過濾會濾掉它們，所以要補回），儲存預設時 permissions 欄位本來就不動，恢復預設時丟掉。
    // 只有這次動作新加入的碼必須在目錄裡；admin.roles.entry、非字串、空字串照舊拒絕。
    const kept = Array.isArray(raw) ? existingUnknownCodes(raw, data.permissions) : [];
    if (raw !== undefined) validatePermissions(raw, role, data.permissions, kept);
    let next: unknown[] = currentPermissions(data, role);
    if (action.kind === 'toggle') {
      if (normalizePermissionCode(action.code) !== action.code ||
          !getAllPermissionCodes(data.permissions).includes(action.code) ||
          (INHERENT_ROLE_PERMISSIONS[role] ?? []).includes(action.code)) {
        throw new RoleAdminGuardError('invalid-argument');
      }
      next = next.includes(action.code) ? next.filter(code => code !== action.code) : [...next, action.code];
      next = [...next, ...kept];
    }
    if (action.kind === 'restore-defaults') {
      const defaults = getARolePermissionDefaults(role, data.rolePermissions, data.customRoles);
      if (defaults === null) throw new RoleAdminGuardError('no-defaults');
      // ASSUMPTION: 預設裡若也有原文件已存在的未知碼，一併丟掉（恢復預設＝丟未知碼）；預設裡其他不在目錄的碼照舊拒絕。
      next = defaults.filter(code => typeof code !== 'string' || !kept.includes(code));
    }
    const permissions = validatePermissions(next, role, data.permissions, action.kind === 'toggle' ? kept : []);
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
