import { getLastKnownAuthUid } from '@/data/auth';
import { loadViewer, type ViewerView } from '@/features/profile/data/viewer';
import { canManageRoles } from './role-model';
import { RoleAdminGuardError } from './role-errors';

/** 寫入呼叫者由 auth UID 載入 viewer；沒有 actor／role 參數可由元件傳入。 */
export async function requireRoleAdmin(): Promise<ViewerView & { uid: string }> {
  const uid = getLastKnownAuthUid();
  if (!uid) throw new RoleAdminGuardError('permission-denied');
  const viewer = await loadViewer(uid);
  if (getLastKnownAuthUid() !== uid || viewer.uid !== uid || !canManageRoles(viewer)) {
    throw new RoleAdminGuardError('permission-denied');
  }
  return { ...viewer, uid };
}
export function requireSameRoleActor(uid: string): void {
  if (getLastKnownAuthUid() !== uid) throw new RoleAdminGuardError('permission-denied');
}
