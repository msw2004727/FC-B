// 示範頁用的登入者（取代 features/profile/data/viewer 的 useViewer）。
import type { ViewerView } from '@/features/profile/data/viewer';
import { cplState } from './state';

export function useViewer(): ViewerView {
  return cplState().viewer;
}
