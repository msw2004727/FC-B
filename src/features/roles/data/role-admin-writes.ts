import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import { writeOpLog } from '@/data/op-log';
import { requestViewerRefresh } from '@/features/profile/data/viewer';
import { BASE_ROLES } from '@/ui/drawer-menu';
import { requireRoleAdmin, requireSameRoleActor } from './role-auth';
import { RoleAdminGuardError } from './role-errors';
import { permissionName } from './permission-catalog';
import {
  assertOnlyTopLevelFields, canonical, capabilitySource, prepareRoleChange, type RolePreview, type RolesData,
} from './role-model';
import type { RoleDocument } from './role-defaults';

export const ENABLE_ROLES_OPLOG = true;
/** 只控制呈現，永遠不能關閉確認內容與最新文件守衛。 */
export const ROLES_WRITE_CONFIRM_ENABLED = true;

export interface RoleWriteResult {
  document: RoleDocument;
  /** 已寫入但重讀失敗，畫面保留已提交值並提示重新進頁。 */
  refreshFailed: boolean;
}
export interface RoleWriteOptions { opLogEnabled?: boolean }

/** 每個公開寫入函式都自行取得 viewer；不得接受元件提供的 actor。 */
export async function saveRolePermissions(
  data: RolesData, preview: RolePreview, confirmedDiff: string | null, options: RoleWriteOptions = {},
): Promise<RoleWriteResult> {
  const actor = await requireRoleAdmin();
  if (preview.action.kind !== 'toggle') throw new RoleAdminGuardError('invalid-argument');
  return commitRoleChange(data, preview, confirmedDiff, actor, options);
}
export async function saveRolePermissionDefaults(
  data: RolesData, preview: RolePreview, confirmedDiff: string | null, options: RoleWriteOptions = {},
): Promise<RoleWriteResult> {
  const actor = await requireRoleAdmin();
  if (preview.action.kind !== 'save-defaults') throw new RoleAdminGuardError('invalid-argument');
  return commitRoleChange(data, preview, confirmedDiff, actor, options);
}
export async function resetRolePermissions(
  data: RolesData, preview: RolePreview, confirmedDiff: string | null, options: RoleWriteOptions = {},
): Promise<RoleWriteResult> {
  const actor = await requireRoleAdmin();
  if (preview.action.kind !== 'restore-defaults') throw new RoleAdminGuardError('invalid-argument');
  return commitRoleChange(data, preview, confirmedDiff, actor, options);
}
export async function saveRoleActivityCapabilities(
  data: RolesData, preview: RolePreview, confirmedDiff: string | null, options: RoleWriteOptions = {},
): Promise<RoleWriteResult> {
  const actor = await requireRoleAdmin();
  if (preview.action.kind !== 'capability') throw new RoleAdminGuardError('invalid-argument');
  return commitRoleChange(data, preview, confirmedDiff, actor, options);
}

async function commitRoleChange(
  data: RolesData, preview: RolePreview, confirmedDiff: string | null,
  actor: Awaited<ReturnType<typeof requireRoleAdmin>>, options: RoleWriteOptions,
): Promise<RoleWriteResult> {
  // 即使呈現旗標關閉，未經確認仍不取得 Firestore／不寫入。
  if (!confirmedDiff || confirmedDiff !== preview.fingerprint || preview.actorUid !== actor.uid) {
    throw new RoleAdminGuardError('confirmation-required');
  }
  const initial = prepareRoleChange(data, preview.role, preview.action, actor.uid);
  if (initial.fingerprint !== confirmedDiff || canonical(initial.payload) !== canonical(preview.payload)) {
    throw new RoleAdminGuardError('confirmation-required');
  }
  const { db } = await getFirebase();
  requireSameRoleActor(actor.uid);
  const ref = doc(db, initial.collection, initial.role);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    requireSameRoleActor(actor.uid);
    const before = snap.exists() ? snap.data() : null;
    if (canonical(before) !== canonical(initial.before)) throw new RoleAdminGuardError('stale-document');
    const latest: RolesData = initial.collection === 'rolePermissions'
      ? { ...data, rolePermissions: { ...data.rolePermissions, [initial.role]: before ?? {} } }
      : { ...data, roleActivityDocuments: { ...data.roleActivityDocuments, [initial.role]: before ?? {} } };
    // 缺文件與空文件不同，保留原始存在狀態。
    if (before === null) {
      if (initial.collection === 'rolePermissions') delete latest.rolePermissions[initial.role];
      else delete latest.roleActivityDocuments[initial.role];
    }
    const recalculated = prepareRoleChange(latest, initial.role, initial.action, actor.uid);
    if (recalculated.fingerprint !== confirmedDiff) throw new RoleAdminGuardError('stale-document');
    const payload = { ...recalculated.payload };
    const fields = initial.action.kind === 'capability'
      ? ['capabilities', 'updatedAt', 'updatedBy']
      : initial.action.kind === 'save-defaults' ? ['defaultPermissions'] : ['permissions'];
    assertOnlyTopLevelFields(payload, fields);
    if ('updatedAt' in payload) payload.updatedAt = serverTimestamp();
    // Q1：不帶 catalogVersion；同文件的 defaultPermissions／其他 meta 必須保留。
    tx.set(ref, payload, { merge: true });
  });

  if (options.opLogEnabled ?? ENABLE_ROLES_OPLOG) {
    try {
      requireSameRoleActor(actor.uid);
      const cap = initial.action.kind === 'capability';
      const label = initial.role === 'captain' ? '領隊 / 經理' : BASE_ROLES[initial.role]?.label ?? initial.role;
      const names = (codes: string[]): string => codes.map(code => permissionName(code, data.permissions)).join('、') || '無';
      const action = initial.action.kind === 'save-defaults' ? '儲存成預設'
        : initial.action.kind === 'restore-defaults' ? '復原預設' : cap ? '活動能力' : '權限開關';
      await writeOpLog({
        type: cap ? 'role_cap_edit' : 'role_perm_edit',
        typeName: cap ? '活動能力變更' : '角色權限變更',
        content: label + '／' + action + '；新增：' + names(initial.added) + '；移除：' + names(initial.removed),
        actorUid: actor.uid, operator: actor.displayName?.trim() || '總管',
      });
    } catch {
      // 不印原始錯誤，避免文件或 UID 被帶入日誌。
      console.warn('[roles] operation log failed');
    }
  }
  requestViewerRefresh();
  try {
    requireSameRoleActor(actor.uid);
    const updated = await getDocFromServer(ref);
    if (!updated.exists()) throw new Error('roles-readback-missing');
    const document = updated.data();
    if (initial.collection === 'roleActivityCapabilities') capabilitySource(document);
    return { document, refreshFailed: false };
  } catch {
    // 寫入已提交：不能把重讀失敗誤報為寫入失敗並復原舊畫面。
    return { document: initial.after, refreshFailed: true };
  }
}
