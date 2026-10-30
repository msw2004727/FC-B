import { createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';

/**
 * `useViewer()` 先給「只有 uid、權限一律 false」的最小 viewer（`createMinimalViewer`），完整資料讀完才換成真正的 viewer。
 * 權限判斷必須等完整 viewer 到位，否則有權限的管理員會先看到一下「權限不足」（L-43）。
 *
 * 判斷方式：最小 viewer 的 `permissionSources` 是共用的凍結物件；完整 viewer 每次載入都會建一個新物件。
 * 測試替身省略 `permissionSources`（viewer.ts 註明為選填）時視為已到位。
 * 本檔只讀 viewer 的公開 API，不修改共用的 viewer.ts。
 */
export function isViewerPermissionsLoaded(viewer: Pick<ViewerView, 'uid' | 'permissionSources'>): boolean {
  if (!viewer.uid) return false;
  const sources = viewer.permissionSources;
  if (sources === undefined) return true;
  return sources !== createMinimalViewer(viewer.uid).permissionSources;
}
