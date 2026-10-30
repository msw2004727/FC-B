// 側邊抽屜選單設定、角色資訊與權限判斷（M-002～M-008、M-014～M-015）。
// 完全對齊 A `js/config.js`（ROLES、DRAWER_MENUS）與 `js/modules/role.js`（_canAccessDrawerItem、renderDrawerMenu）。

import type { RouteAccessContext } from '@/core/feature-types';
import { drawerOwnActivityManage } from '@/core/drawer-access';

export interface RoleInfo {
  readonly level: number;
  readonly label: string;
  readonly color: string;
  readonly custom?: boolean;
}

export interface CustomRoleInput {
  readonly key: string;
  readonly label?: string;
  readonly color?: string;
  readonly afterRole?: string;
}

export const BUILTIN_ROLE_KEYS = [
  'user',
  'coach',
  'captain',
  'venue_owner',
  'admin',
  'super_admin',
] as const;

export const BASE_ROLES: Readonly<Record<string, RoleInfo>> = {
  user:        { level: 0, label: '一般用戶', color: '#6b7280' },
  coach:       { level: 1, label: '教練',     color: '#0d9488' },
  captain:     { level: 2, label: '領隊',     color: '#7c3aed' },
  venue_owner: { level: 3, label: '場主',     color: '#d97706' },
  admin:       { level: 4, label: '管理員',   color: '#2563eb' },
  super_admin: { level: 5, label: '總管',     color: '#dc2626' },
};

export const BASE_ROLE_LEVEL_MAP: Readonly<Record<string, number>> = {
  user: 0,
  coach: 1,
  captain: 2,
  venue_owner: 3,
  admin: 4,
  super_admin: 5,
};

function normalizeCustomRoles(customRoles?: readonly CustomRoleInput[] | null): CustomRoleInput[] {
  if (!Array.isArray(customRoles)) return [];
  return customRoles
    .filter((r): r is CustomRoleInput => Boolean(r && typeof r.key === 'string' && r.key.trim()))
    .map((r) => ({
      key: r.key.trim(),
      label: r.label || r.key.trim(),
      color: r.color || '#6366f1',
      afterRole: r.afterRole || 'captain',
    }));
}

export function getRuntimeRoleSequence(customRoles?: readonly CustomRoleInput[] | null): string[] {
  const normalized = normalizeCustomRoles(customRoles);
  const children = new Map<string, CustomRoleInput[]>();

  for (const role of normalized) {
    const parent = role.afterRole || 'captain';
    const list = children.get(parent) ?? [];
    list.push(role);
    children.set(parent, list);
  }

  const result: string[] = [];
  const visited = new Set<string>();

  const appendRole = (roleKey: string): void => {
    result.push(roleKey);
    const childRoles = children.get(roleKey) ?? [];
    for (const child of childRoles) {
      if (visited.has(child.key)) continue;
      visited.add(child.key);
      appendRole(child.key);
    }
  };

  for (const key of BUILTIN_ROLE_KEYS) appendRole(key);

  for (const role of normalized) {
    if (visited.has(role.key)) continue;
    visited.add(role.key);
    result.push(role.key);
  }

  return result;
}

export function buildRuntimeRoleLevelMap(customRoles?: readonly CustomRoleInput[] | null): Record<string, number> {
  const levels: Record<string, number> = { ...BASE_ROLE_LEVEL_MAP };
  const sequence = getRuntimeRoleSequence(customRoles);

  for (let i = 0; i < BUILTIN_ROLE_KEYS.length - 1; i += 1) {
    const startKey = BUILTIN_ROLE_KEYS[i]!;
    const endKey = BUILTIN_ROLE_KEYS[i + 1]!;
    const startIndex = sequence.indexOf(startKey);
    const endIndex = sequence.indexOf(endKey);
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex + 1) continue;

    const between = sequence.slice(startIndex + 1, endIndex);
    const startLv = BASE_ROLE_LEVEL_MAP[startKey] ?? 0;
    const endLv = BASE_ROLE_LEVEL_MAP[endKey] ?? 0;
    const step = (endLv - startLv) / (between.length + 1);
    between.forEach((roleKey, index) => {
      levels[roleKey] = startLv + step * (index + 1);
    });
  }

  const superAdminIndex = sequence.indexOf('super_admin');
  if (superAdminIndex >= 0 && superAdminIndex < sequence.length - 1) {
    const deferredRoles = sequence.slice(superAdminIndex + 1);
    const adminLv = BASE_ROLE_LEVEL_MAP.admin ?? 4;
    const superLv = BASE_ROLE_LEVEL_MAP.super_admin ?? 5;
    const step = (superLv - adminLv) / (deferredRoles.length + 1);
    deferredRoles.forEach((roleKey, index) => {
      levels[roleKey] = adminLv + step * (index + 1);
    });
  }

  return levels;
}

export function getRuntimeRoleLevel(
  roleKey: string | null | undefined,
  customRoles?: readonly CustomRoleInput[] | null,
): number {
  if (!roleKey || roleKey === 'guest') return 0;
  const levels = buildRuntimeRoleLevelMap(customRoles);
  return levels[roleKey] ?? 0;
}

/** 照 A `getRuntimeRoleInfo` 與 `_getEffectiveRoleInfo` 解析角色標籤與顏色。 */
export function resolveDrawerRoleInfo(
  roleKey: string | null | undefined,
  signedIn: boolean,
  customRoles?: readonly CustomRoleInput[] | null,
  loginPending = false,
): RoleInfo {
  if (!signedIn) {
    return {
      level: 0,
      label: loginPending ? '確認中' : '未登入',
      color: '#6b7280',
    };
  }
  const key = roleKey && roleKey !== 'guest' ? roleKey : 'user';
  if (Object.prototype.hasOwnProperty.call(BASE_ROLES, key)) {
    return BASE_ROLES[key]!;
  }
  const custom = normalizeCustomRoles(customRoles).find((r) => r.key === key);
  if (custom) {
    return {
      level: getRuntimeRoleLevel(key, customRoles),
      label: custom.label || custom.key,
      color: custom.color || '#6366f1',
      custom: true,
    };
  }
  return BASE_ROLES.user!;
}

export type DrawerActionType = 'coming-soon' | 'manual' | 'share' | 'apply-role';

export interface DrawerMenuEntry {
  readonly divider?: boolean;
  readonly sectionLabel?: string;
  readonly icon?: string;
  readonly label?: string;
  readonly i18nKey?: string;
  readonly page?: string;
  /** B 已開放並可導向的路由；null 表示 B 尚未開放該頁（點擊提示「此功能尚未開放，請先使用舊版」）。 */
  readonly routePath?: string | null;
  readonly action?: DrawerActionType;
  readonly minRole?: string;
  readonly permissionCode?: string;
  readonly locked?: boolean;
  readonly highlight?: 'red' | 'yellow';
}

/**
 * 照 A `js/config.js#DRAWER_MENUS` 完整順序與設定。
 * routePath 對照 `b_routes-summary.txt`（B 已註冊的後台／管理路由）：
 * - page-my-activities → /my-activities
 * - page-admin-dashboard → /admin/ops
 * - page-admin-seo → /admin/seo
 * - page-admin-themes → /admin/theme
 * - page-admin-roles → /admin/roles
 * - page-admin-logs → /admin/logs
 * - page-admin-repair → /admin/repair
 * 其餘後台／管理頁（賽事管理、俱樂部管理、小遊戲管理、用戶管理、首頁管理、二手商品管理、站內信管理、手動/自動 EXP、推播、公告、成就、無效資料查詢）B 尚未有對應管理路由，設為 null。
 */
export const DRAWER_MENUS: readonly DrawerMenuEntry[] = [
  { icon: '', label: '個人數據', i18nKey: 'drawer.personalData', page: 'page-personal-dashboard', routePath: '/me/dashboard', minRole: 'user', locked: true },
  { icon: '', label: '二手商品區', i18nKey: 'drawer.shop', page: 'page-shop', routePath: '/shop', minRole: 'user', locked: true },
  { icon: '', label: '排行榜', i18nKey: 'drawer.leaderboard', action: 'coming-soon', minRole: 'user', locked: true },
  { icon: '', label: '使用手冊', i18nKey: 'drawer.manual', action: 'manual', minRole: 'user' },
  { icon: '', label: '分享網頁', i18nKey: 'drawer.share', action: 'share', minRole: 'user' },
  { icon: '', label: '申請（俱樂部/場主/教練）', i18nKey: 'drawer.applyRole', action: 'apply-role', minRole: 'user' },
  { divider: true },
  { icon: '', label: '活動管理', i18nKey: 'drawer.activityManage', page: 'page-my-activities', routePath: '/my-activities', minRole: 'coach', permissionCode: 'activity.manage.entry' },
  { icon: '', label: '賽事管理', i18nKey: 'drawer.tournamentManage', page: 'page-admin-tournaments', routePath: null, minRole: 'coach', permissionCode: 'admin.tournaments.entry' },
  { icon: '', label: '俱樂部管理', i18nKey: 'drawer.teamManage', page: 'page-team-manage', routePath: null, minRole: 'captain', permissionCode: 'team.manage.entry' },
  { divider: true, minRole: 'admin' },
  { sectionLabel: '後台管理', i18nKey: 'drawer.backendManage', minRole: 'admin' },
  { icon: '', label: '小遊戲管理', i18nKey: 'admin.gameManage', page: 'page-admin-games', routePath: null, minRole: 'admin', permissionCode: 'admin.games.entry' },
  { icon: '', label: '用戶管理', i18nKey: 'admin.userManage', page: 'page-admin-users', routePath: '/admin/users', minRole: 'admin', permissionCode: 'admin.users.entry' },
  { icon: '', label: '首頁管理', i18nKey: 'admin.adManage', page: 'page-admin-banners', routePath: '/admin/banners', minRole: 'admin', permissionCode: 'admin.banners.entry' },
  { icon: '', label: '二手商品管理', i18nKey: 'admin.shopManage', page: 'page-admin-shop', routePath: null, minRole: 'admin', permissionCode: 'admin.shop.entry' },
  { icon: '', label: '站內信管理', i18nKey: 'admin.messageManage', page: 'page-admin-messages', routePath: null, minRole: 'admin', permissionCode: 'admin.messages.entry' },
  { icon: '', label: '數據儀表板', i18nKey: 'admin.dashboard', page: 'page-admin-dashboard', routePath: '/admin/ops', minRole: 'super_admin', permissionCode: 'admin.dashboard.entry' },
  { icon: '', label: 'SEO 儀表板', i18nKey: 'admin.seo', page: 'page-admin-seo', routePath: '/admin/seo', minRole: 'admin', permissionCode: 'admin.seo.entry', highlight: 'red' },
  { icon: '', label: '佈景主題', i18nKey: 'admin.themes', page: 'page-admin-themes', routePath: '/admin/theme', minRole: 'super_admin', permissionCode: 'admin.themes.entry' },
  { icon: '', label: '手動 EXP 管理', i18nKey: 'admin.expManage', page: 'page-admin-exp', routePath: null, minRole: 'super_admin', permissionCode: 'admin.exp.entry' },
  { icon: '', label: '自動 EXP 管理', i18nKey: 'drawer.autoExpManage', page: 'page-admin-auto-exp', routePath: null, minRole: 'super_admin', permissionCode: 'admin.auto_exp.entry' },
  { icon: '', label: '推播通知設定', i18nKey: 'admin.notifSettings', page: 'page-admin-notif', routePath: null, minRole: 'super_admin', permissionCode: 'admin.notif.entry' },
  { icon: '', label: '系統公告管理', i18nKey: 'admin.announcements', page: 'page-admin-announcements', routePath: null, minRole: 'super_admin', permissionCode: 'admin.announcements.entry' },
  { icon: '', label: '成就/徽章管理', i18nKey: 'admin.achievements', page: 'page-admin-achievements', routePath: null, minRole: 'super_admin', permissionCode: 'admin.achievements.entry' },
  { icon: '', label: '權限管理', i18nKey: 'admin.roles', page: 'page-admin-roles', routePath: '/admin/roles', minRole: 'super_admin' },
  { icon: '', label: '日誌中心', i18nKey: 'admin.logs', page: 'page-admin-logs', routePath: '/admin/logs', minRole: 'super_admin', permissionCode: 'admin.logs.entry' },
  { icon: '', label: '用戶補正管理', i18nKey: 'admin.repair', page: 'page-admin-repair', routePath: '/admin/repair', minRole: 'admin', permissionCode: 'admin.repair.entry', highlight: 'red' },
  { icon: '', label: '無效資料查詢', i18nKey: 'admin.inactive', page: 'page-admin-inactive', routePath: null, minRole: 'super_admin', permissionCode: 'admin.inactive.entry' },
];

function effectiveAccess(access?: RouteAccessContext | null): RouteAccessContext {
  if (access) return access;
  return {
    uid: null,
    role: 'user',
    roleLevel: 0,
    capabilities: [],
    hasPermission: () => false,
  };
}

/**
 * 照 A `js/modules/role.js#_canAccessDrawerItem`：
 * - divider / sectionLabel 回傳 true（實際是否畫出由 buildDrawerRenderNodes 依前後有無可見項目決定）
 * - page === 'page-my-activities' 走 `_canAccessOwnActivityManageEntry`（drawerOwnActivityManage）
 * - 有 permissionCode 時只看 `hasPermission(item.permissionCode)`
 * - 否則比對 `roleLevel >= ROLE_LEVEL_MAP[item.minRole || 'user']`
 */
export function canAccessDrawerItem(
  item: DrawerMenuEntry | null | undefined,
  access?: RouteAccessContext | null,
  customRoles?: readonly CustomRoleInput[] | null,
): boolean {
  if (!item || item.divider || item.sectionLabel) return true;
  const ctx = effectiveAccess(access);

  if (item.page === 'page-my-activities') {
    return drawerOwnActivityManage(ctx);
  }

  if (item.permissionCode) {
    return ctx.hasPermission(item.permissionCode);
  }

  const levelMap = buildRuntimeRoleLevelMap(customRoles);
  const roleKey = ctx.role && ctx.role !== 'guest' ? ctx.role : 'user';
  const roleLevel = Number.isFinite(ctx.roleLevel) && ctx.roleLevel >= 0
    ? ctx.roleLevel
    : (levelMap[roleKey] ?? 0);
  const minLevel = levelMap[item.minRole || 'user'] ?? 0;
  return roleLevel >= minLevel;
}

/** 照 A `renderDrawerMenu` 計算權限底色 class。 */
export function getDrawerItemBgClass(
  item: DrawerMenuEntry,
  customRoles?: readonly CustomRoleInput[] | null,
): '' | 'drawer-role-admin' | 'drawer-role-super' | 'drawer-role-yellow' {
  if (item.highlight === 'yellow') return 'drawer-role-yellow';
  if (item.highlight === 'red') return 'drawer-role-super';
  const levelMap = buildRuntimeRoleLevelMap(customRoles);
  const minLevel = levelMap[item.minRole || 'user'] ?? 0;
  if (minLevel >= 5) return 'drawer-role-super';
  if (minLevel >= 4) return 'drawer-role-admin';
  return '';
}

export type DrawerRenderNode =
  | { readonly kind: 'divider'; readonly key: string }
  | { readonly kind: 'section'; readonly key: string; readonly label: string; readonly i18nKey?: string }
  | {
      readonly kind: 'item';
      readonly key: string;
      readonly entry: DrawerMenuEntry;
      readonly label: string;
      readonly i18nKey?: string;
      readonly bgClass: '' | 'drawer-role-admin' | 'drawer-role-super' | 'drawer-role-yellow';
      readonly locked: boolean;
    };

/**
 * 照 A `js/modules/role.js#renderDrawerMenu` 完整演算法產生渲染節點：
 * - 先過濾出可見項目
 * - divider：前面必須已畫過實際項目，且後面還有實際項目才畫
 * - sectionLabel：後面還有實際項目才畫
 * - 後台區跨角色等級（admin ↔ super_admin，minLevel >= 4）且非連續兩個紅底（drawer-role-super）時自動插入分隔線
 */
export function buildDrawerRenderNodes(
  access?: RouteAccessContext | null,
  menus: readonly DrawerMenuEntry[] = DRAWER_MENUS,
  customRoles?: readonly CustomRoleInput[] | null,
): DrawerRenderNode[] {
  const levelMap = buildRuntimeRoleLevelMap(customRoles);
  const visibleMenus = menus.filter(
    (item) => item.divider || item.sectionLabel || canAccessDrawerItem(item, access, customRoles),
  );

  const nodes: DrawerRenderNode[] = [];
  let lastMinRole: string | null = null;
  let lastBgClass = '';
  let hasRenderedActionItem = false;

  visibleMenus.forEach((item, index) => {
    if (item.divider) {
      const hasNextActionItem = visibleMenus
        .slice(index + 1)
        .some((entry) => !entry.divider && !entry.sectionLabel);
      if (!hasRenderedActionItem || !hasNextActionItem) return;
      nodes.push({ kind: 'divider', key: `div-${index}` });
    } else if (item.sectionLabel) {
      const hasNextActionItem = visibleMenus
        .slice(index + 1)
        .some((entry) => !entry.divider && !entry.sectionLabel);
      if (!hasNextActionItem) return;
      nodes.push({
        kind: 'section',
        key: `sec-${index}`,
        label: item.sectionLabel,
        i18nKey: item.i18nKey,
      });
    } else {
      const role = item.minRole || 'user';
      const minLevel = levelMap[role] ?? 0;
      const bgClass = getDrawerItemBgClass(item, customRoles);
      if (lastMinRole !== role && minLevel >= 4) {
        const bothRed = bgClass === 'drawer-role-super' && lastBgClass === 'drawer-role-super';
        if (lastMinRole && (levelMap[lastMinRole] ?? 0) >= 4 && !bothRed) {
          nodes.push({ kind: 'divider', key: `auto-div-${index}` });
        }
        lastMinRole = role;
      }
      lastBgClass = bgClass;
      nodes.push({
        kind: 'item',
        key: item.page || item.action || `item-${index}`,
        entry: item,
        label: item.label || '',
        i18nKey: item.i18nKey,
        bgClass,
        locked: Boolean(item.locked),
      });
      hasRenderedActionItem = true;
    }
  });

  return nodes;
}

/** 取得 Mini App 分享連結（照 A `MINI_APP_BASE_URL`）。 */
export function getMiniAppShareUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const liffId = env?.VITE_LIFF_ID || '';
  return `https://miniapp.line.me/${liffId}`;
}
