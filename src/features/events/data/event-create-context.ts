/**
 * 把畫面上的登入者（useViewer）轉成建立／編輯活動資料層需要的 CreateEventContext。
 * 未登入或還沒載入完成時回傳 null，畫面應不顯示建立入口。
 */
import { generateId } from '@/data/ids';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { CreateEventContext } from './event-create';

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
