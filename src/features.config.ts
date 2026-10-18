// 建置期功能開關。
// 用法範例：
//   FEATURE_OVERRIDES = { 'notifications': false }   // 強制關閉
//   FEATURE_OVERRIDES = { 'shop': true }             // 強制開啟（含 reserved）
// 未列出的功能：預設開啟；reserved 功能預設關閉。

import type { FeatureManifest } from './core/feature-types';
import { manifest as home } from './features/home/index';
import { manifest as events } from './features/events/index';
import { manifest as checkin } from './features/checkin/index';
import { manifest as clubs } from './features/clubs/index';
import { manifest as education } from './features/education/index';
import { manifest as inbox } from './features/inbox/index';
import { manifest as profile } from './features/profile/index';
import { manifest as personalDashboard } from './features/personal-dashboard/index';
import { manifest as notifications } from './features/notifications/index';
import { manifest as roles } from './features/roles/index';
import { manifest as opsDashboard } from './features/ops-dashboard/index';
import { manifest as logs } from './features/logs/index';
import { manifest as dataRepair } from './features/data-repair/index';
import { manifest as seoAdmin } from './features/seo-admin/index';
import { manifest as siteTheme } from './features/site-theme/index';
import { manifest as expAchievements } from './features/exp-achievements/index';
import { manifest as leaderboard } from './features/leaderboard/index';
import { manifest as shop } from './features/shop/index';
import { manifest as miniGames } from './features/mini-games/index';
import { manifest as tournaments } from './features/tournaments/index';

export const FEATURE_OVERRIDES: Record<string, boolean> = {};

export const ALL_FEATURES: FeatureManifest[] = [
  home,
  events,
  checkin,
  clubs,
  education,
  inbox,
  profile,
  personalDashboard,
  notifications,
  roles,
  opsDashboard,
  logs,
  dataRepair,
  seoAdmin,
  siteTheme,
  expAchievements,
  leaderboard,
  shop,
  miniGames,
  tournaments,
];
