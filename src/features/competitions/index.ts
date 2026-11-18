import type { FeatureManifest, FeatureRoute } from '@/core/feature-types';
import { COMPETITIONS_ENABLED } from '@/feature-overrides';

// 賽事第 2 步（建賽與名單）。status 維持 reserved，開關在 feature-overrides.ts。
// 關閉時 getActiveRoutes 不會交出這些路徑，頁面 chunk 也不會被載入。
// 本檔只動態 import 頁面入口，不得靜態 import 資料層。
type PageName = 'NewCompetitionPage' | 'CompetitionManagePage' | 'JoinRosterPage' | 'AddRosterPage' | 'RosterPage' | 'CompetitionDetailPage';

function loadPages() {
  return import('./pages/entry');
}

function route(path: string, page: PageName, titleKey: string): FeatureRoute {
  return {
    path,
    titleKey,
    load: () => loadPages().then((mod) => ({ default: mod[page] })),
  };
}

/** 六條路由（/competitions/new 要排在 :cid 前面）。開關打開時才會被 manifest 使用。 */
export function competitionRoutes(): FeatureRoute[] {
  return [
    route('/competitions/new', 'NewCompetitionPage', 'competitions.createTitle'),
    route('/competitions/:cid/manage', 'CompetitionManagePage', 'competitions.manageTitle'),
    route('/competitions/:cid/entries/:enId/join', 'JoinRosterPage', 'competitions.joinTitle'),
    route('/competitions/:cid/entries/:enId/add', 'AddRosterPage', 'competitions.addTitle'),
    route('/competitions/:cid/entries/:enId', 'RosterPage', 'competitions.rosterTitle'),
    route('/competitions/:cid', 'CompetitionDetailPage', 'competitions.detailTitle'),
  ];
}

export const manifest: FeatureManifest = {
  id: 'competitions',
  status: 'reserved',
  // 關閉時是字面 false，打包器把整段路由連同路徑字串刪掉（首頁入口包預算）
  routes: COMPETITIONS_ENABLED ? competitionRoutes() : [],
};
