import { getUserPermissionGrantAllowedCodes, normalizePermissionCode } from '@/features/profile/data/permissions';
import { assertOnlyTopLevelFields, canonical } from './role-model';
import type { RoleDocument } from './role-defaults';
import { RoleAdminGuardError } from './role-errors';

export interface UserGrantSnapshot { uid: string; targetName: string; document: RoleDocument | null }
export type UserGrantAction = { kind: 'toggle_permission'; code: string } | { kind: 'update_enabled' };
/** 兩動作共用相同的四欄儲存契約，沒有讀取文件的索引簽名。 */
export interface UserGrantWrite { uid: string; permissions: string[]; enabled: boolean; updatedAt: unknown }
export interface UserGrantAuditEntry {
  targetUid: string; targetName: string; actorUid: string;
  action: UserGrantAction['kind']; changedPermission: string;
  enabled: boolean; previousEnabled: boolean;
  permissions: string[]; previousPermissions: string[]; at: unknown;
}
export interface UserGrantPreview {
  uid: string; targetName: string; actorUid: string; action: UserGrantAction;
  before: RoleDocument | null; after: RoleDocument; payload: UserGrantWrite;
  added: string[]; removed: string[]; fingerprint: string;
}
export const GRANT_FIELDS = ['uid', 'permissions', 'enabled', 'updatedAt'] as const;
export const GRANT_AUDIT_FIELDS = ['targetUid', 'targetName', 'actorUid', 'action', 'changedPermission',
  'enabled', 'previousEnabled', 'permissions', 'previousPermissions', 'at'] as const;

export function assertGrantUid(uid: unknown): asserts uid is string {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid !== uid.trim() ||
      /[\\/\x00-\x20\x7f]/.test(uid) || uid === '.' || uid === '..' || /^__.*__$/.test(uid)) {
    throw new RoleAdminGuardError('invalid-argument');
  }
}
export function validateGrantPermissions(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > 500 || raw.some(code => typeof code !== 'string')) {
    throw new RoleAdminGuardError('invalid-argument');
  }
  // normalizePermissionCode 共用 DISABLED_PERMISSION_CODES；不靜默丟棄停用／舊碼。
  if (raw.some(code => !code || normalizePermissionCode(code) !== code)) {
    throw new RoleAdminGuardError('invalid-argument');
  }
  const allowed = new Set(getUserPermissionGrantAllowedCodes());
  if (raw.some(code => !allowed.has(code))) throw new RoleAdminGuardError('invalid-argument');
  return [...new Set(raw)] as string[];
}
export function grantState(snapshot: UserGrantSnapshot): { permissions: string[]; enabled: boolean } {
  assertGrantUid(snapshot.uid);
  const document = snapshot.document;
  if (!document) return { permissions: [], enabled: false };
  if (document['uid'] !== snapshot.uid ||
      ('enabled' in document && typeof document['enabled'] !== 'boolean')) {
    throw new RoleAdminGuardError('invalid-argument');
  }
  return { permissions: validateGrantPermissions(document['permissions']), enabled: document['enabled'] !== false };
}
export function prepareUserGrantChange(
  snapshot: UserGrantSnapshot, action: UserGrantAction, actorUid: string,
): UserGrantPreview {
  const state = grantState(snapshot);
  if (!actorUid || typeof snapshot.targetName !== 'string' || !action ||
      !['toggle_permission', 'update_enabled'].includes(action.kind)) throw new RoleAdminGuardError('invalid-argument');
  assertOnlyTopLevelFields(action, action.kind === 'toggle_permission' ? ['kind', 'code'] : ['kind']);
  let permissions = state.permissions;
  let enabled = state.enabled;
  if (action.kind === 'toggle_permission') {
    validateGrantPermissions([action.code]);
    if (!enabled) throw new RoleAdminGuardError('grant-disabled');
    permissions = permissions.includes(action.code) ? permissions.filter(code => code !== action.code) : [...permissions, action.code];
  } else {
    enabled = !enabled;
  }
  const payload: UserGrantWrite = { uid: snapshot.uid, permissions: validateGrantPermissions(permissions), enabled, updatedAt: 'SERVER_TIMESTAMP' };
  assertOnlyTopLevelFields(payload, GRANT_FIELDS);
  // A 的 batch.set 整份取代；其他既有欄位的移除也必須呈現在 diff。
  const before = snapshot.document;
  const after: RoleDocument = { ...payload };
  const added = permissions.filter(code => !state.permissions.includes(code));
  const removed = state.permissions.filter(code => !permissions.includes(code));
  const fingerprint = canonical({ uid: snapshot.uid, targetName: snapshot.targetName, actorUid, action, before, after });
  return { uid: snapshot.uid, targetName: snapshot.targetName, actorUid, action, before, after, payload, added, removed, fingerprint };
}
