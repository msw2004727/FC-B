/**
 * 把畫面上的登入者（useViewer）轉成建立／編輯活動資料層需要的 CreateEventContext。
 * 未登入或還沒載入完成時回傳 null，畫面應不顯示建立入口。
 */
import { generateId } from '@/data/ids';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { CreateEventContext } from './event-create';
import type { OperateContext } from './operate-permissions';

export function createEventContextFromViewer(
  viewer: ViewerView,
  now: Date = new Date(),
): CreateEventContext | null {
  if (!viewer.uid || viewer.role === 'guest') return null;
  const sources = viewer.permissionSources;
  return {
    uid: viewer.uid,
    role: viewer.role,
    capabilities: viewer.capabilities,
    rolePermissions: sources?.rolePermissions ?? null,
    userGrants: { uid: viewer.uid, enabled: true, permissions: [...(sources?.userGrants ?? [])] },
    customRoles: sources?.customRoles ?? [],
    now,
    generateId,
  };
}

/** 把登入者轉成活動操作權限判斷（operate-permissions）用的 context；訪客 role 為 null（所有操作拒絕）。 */
export function operateContextFromViewer(viewer: ViewerView): OperateContext {
  const sources = viewer.permissionSources;
  return {
    uid: viewer.uid,
    role: viewer.uid && viewer.role !== 'guest' ? viewer.role : null,
    rolePermissions: sources?.rolePermissions ?? null,
    userGrants: viewer.uid
      ? { uid: viewer.uid, enabled: true, permissions: [...(sources?.userGrants ?? [])] }
      : null,
    capabilities: viewer.capabilities,
    customRoles: sources?.customRoles ?? [],
  };
}
