import type { FeatureManifest } from '@/core/feature-types';

// T-089：底部「賽事」分頁改為新站專屬的賽事卡片清單（外部連結卡片），資料在 tournamentCards 集合，
// 與舊站 tournaments 集合完全分開。
export const manifest: FeatureManifest = {
  id: 'tournaments',
  status: 'enabled',
  routes: [
    {
      path: '/tournaments',
      titleKey: 'tournaments.title',
      load: () => import('./pages/TournamentsPage'),
    },
  ],
};
