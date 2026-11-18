// 六個頁面同一個 chunk。入口只留一次動態 import，避免每條路由各帶一份預載清單。
export { default as NewCompetitionPage } from './NewCompetitionPage';
export { default as CompetitionManagePage } from './CompetitionManagePage';
export { default as JoinRosterPage } from './JoinRosterPage';
export { default as AddRosterPage } from './AddRosterPage';
export { default as RosterPage } from './RosterPage';
export { default as CompetitionDetailPage } from './CompetitionDetailPage';
