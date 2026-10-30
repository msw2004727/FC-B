import { collection, doc, getDocFromServer, serverTimestamp, writeBatch } from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import { requestViewerRefresh } from '@/features/profile/data/viewer';
import { requireRoleAdmin, requireSameRoleActor } from './role-auth';
import { RoleAdminGuardError } from './role-errors';
import { assertOnlyTopLevelFields, canonical } from './role-model';
import type { RoleWriteResult } from './role-admin-writes';
import {
  GRANT_AUDIT_FIELDS, GRANT_FIELDS, grantState, prepareUserGrantChange,
  type UserGrantAuditEntry, type UserGrantPreview, type UserGrantSnapshot, type UserGrantWrite,
} from './user-grant-model';

export async function toggleUserGrantPermission(
  original: UserGrantSnapshot, preview: UserGrantPreview, confirmedDiff: string | null,
): Promise<RoleWriteResult> {
  const actor = await requireRoleAdmin();
  requireSameRoleActor(actor.uid);
  if (preview.action.kind !== 'toggle_permission') throw new RoleAdminGuardError('invalid-argument');
  return commitUserGrant(original, preview, confirmedDiff, actor.uid);
}
export async function toggleUserGrantEnabled(
  original: UserGrantSnapshot, preview: UserGrantPreview, confirmedDiff: string | null,
): Promise<RoleWriteResult> {
  const actor = await requireRoleAdmin();
  requireSameRoleActor(actor.uid);
  if (preview.action.kind !== 'update_enabled') throw new RoleAdminGuardError('invalid-argument');
  return commitUserGrant(original, preview, confirmedDiff, actor.uid);
}

async function commitUserGrant(
  original: UserGrantSnapshot, preview: UserGrantPreview, confirmedDiff: string | null, actorUid: string,
): Promise<RoleWriteResult> {
  if (!confirmedDiff || preview.fingerprint !== confirmedDiff || preview.actorUid !== actorUid) {
    throw new RoleAdminGuardError('confirmation-required');
  }
  const initial = prepareUserGrantChange(original, preview.action, actorUid);
  // 比對全部呈現欄位，避免畫面與確認內容不同；不信任元件傳來的 payload。
  if (initial.fingerprint !== confirmedDiff || canonical(initial) !== canonical(preview)) {
    throw new RoleAdminGuardError('confirmation-required');
  }
  const { db } = await getFirebase();
  requireSameRoleActor(actorUid);
  const ref = doc(db, 'userPermissionGrants', initial.uid);
  const snap = await getDocFromServer(ref);
  requireSameRoleActor(actorUid);
  const before = snap.exists() ? snap.data() : null;
  if (canonical(before) !== canonical(initial.before)) throw new RoleAdminGuardError('stale-document');
  const latest = { ...original, document: before };
  const recalculated = prepareUserGrantChange(latest, initial.action, actorUid);
  if (recalculated.fingerprint !== confirmedDiff) throw new RoleAdminGuardError('stale-document');
  const previous = grantState(latest);
  const payload: UserGrantWrite = { ...recalculated.payload, updatedAt: serverTimestamp() };
  const audit: UserGrantAuditEntry = {
    targetUid: initial.uid, targetName: initial.targetName, actorUid,
    action: initial.action.kind,
    changedPermission: initial.action.kind === 'toggle_permission' ? initial.action.code : '',
    enabled: payload.enabled, previousEnabled: previous.enabled,
    permissions: [...payload.permissions], previousPermissions: [...previous.permissions], at: serverTimestamp(),
  };
  assertOnlyTopLevelFields(payload, GRANT_FIELDS);
  assertOnlyTopLevelFields(audit, GRANT_AUDIT_FIELDS);
  // Q2／M10：主文件與稽核只用同一 batch；不可拆寫，也不另記操作日誌。
  const batch = writeBatch(db);
  batch.set(ref, payload);
  batch.set(doc(collection(db, 'userPermissionGrantAudit', initial.uid, 'entries')), audit);
  await batch.commit();
  try {
    // 提交後才換帳號／重讀失敗不能假報主寫入失敗，也不能回復已提交的舊值。
    requireSameRoleActor(actorUid);
    requestViewerRefresh();
    const updated = await getDocFromServer(ref);
    requireSameRoleActor(actorUid);
    if (!updated.exists()) throw new Error('grant-readback-missing');
    const document = updated.data();
    grantState({ ...original, document });
    return { document, refreshFailed: false };
  } catch {
    return { document: recalculated.after, refreshFailed: true };
  }
}
