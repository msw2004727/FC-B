// 營運儀表板 W6 截圖台：useViewer 固定給一位權限已載完、什麼都有的管理員（不登入、不讀資料）。其他匯出照原模組。
import type { ViewerView } from '../features/profile/data/viewer';

export * from '../features/profile/data/viewer';

const VIEWER = {
  uid: 'harness-admin',
  displayName: '管理員',
  pictureUrl: null,
  role: 'super_admin',
  roleLevel: 0,
  teamIds: new Set<string>(),
  capabilities: [],
  hasPermission: () => true,
} as unknown as ViewerView;

export function useViewer(): ViewerView {
  return VIEWER;
}
