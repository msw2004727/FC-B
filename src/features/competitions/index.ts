import type { FeatureManifest } from '@/core/feature-types';

// 賽事第 2 步（建賽與名單）。畫面頁面是下一張卡，這裡先不掛路由。
// 建置期開關在 feature-overrides.ts（competitions: false）。資料層只從 load.ts 動態載入，
// 本檔不得 import 資料層，否則關閉時 asia 程式仍會進首頁入口。
export const manifest: FeatureManifest = {
  id: 'competitions',
  status: 'reserved',
  routes: [],
};
