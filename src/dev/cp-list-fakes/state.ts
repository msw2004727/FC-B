// 清單頁示範頁（dev-harness/cp-step3-list.html）的假資料狀態：示範頁在畫之前寫進 window.__CPL，
// 下面幾支假模組在被呼叫時才讀。只給本機截圖用（dev-harness/vite.cp-list.config.ts 把正式模組換成這幾支）。
import type { ViewerView } from '@/features/profile/data/viewer';
import type { TournamentCard } from '@/features/tournaments/data/card-model';

export interface CplState {
  viewer: ViewerView;
  cards: TournamentCard[];
  ext: 'ready' | 'loading' | 'error';
}

export function cplState(): CplState {
  return (window as unknown as { __CPL: CplState }).__CPL;
}
