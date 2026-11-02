import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RouteAccessContext } from '@/core/feature-types';
import {
  buildDrawerRenderNodes,
  canAccessDrawerItem,
  DRAWER_MENUS,
  DRAWER_PLACEHOLDER_ROUTES,
  drawerItemStatus,
  getDrawerItemBgClass,
  resolveDrawerRoleInfo,
  type CustomRoleInput,
} from './drawer-menu';

function makeAccess(overrides: Partial<RouteAccessContext> = {}): RouteAccessContext {
  return {
    uid: 'u1',
    role: 'user',
    roleLevel: 0,
    capabilities: [],
    hasPermission: () => false,
    ...overrides,
  };
}

describe('黑名單管理入口', () => {
  const repair = DRAWER_MENUS.find((item) => item.page === 'page-admin-repair');
  const code = 'admin.repair.event_blocklist';
  const admin = (overrides: Partial<RouteAccessContext>) => makeAccess({ role: 'admin', roleLevel: 4, ...overrides });
  it('無角色層級持碼時不顯示，即使 hasPermission 全開', () => {
    expect(canAccessDrawerItem(repair, admin({ hasPermission: () => true }))).toBe(false);
    expect(canAccessDrawerItem(repair, admin({ hasPermission: () => true, permissionSources: { rolePermissions: ['admin.repair.entry'] } }))).toBe(false);
  });
  it('角色層級持碼且有入口碼才顯示；缺入口碼不顯示', () => {
    const permissionSources = { rolePermissions: [code, 'admin.repair.entry'] };
    expect(canAccessDrawerItem(repair, admin({ permissionSources, hasPermission: (c) => c === 'admin.repair.entry' }))).toBe(true);
    expect(canAccessDrawerItem(repair, admin({ permissionSources, hasPermission: () => false }))).toBe(false);
  });
  it('super_admin 有入口碼時顯示', () => {
    expect(canAccessDrawerItem(repair, makeAccess({ role: 'super_admin', roleLevel: 5, hasPermission: () => true }))).toBe(true);
  });
});

describe('drawer-menu (M-002 ~ M-008, M-014 ~ M-015)', () => {
  it('訪客與一般用戶只看到前 5 個基本入口（含 2 個上鎖入口與 3 個動作入口；二手商品區已移除），不畫多餘分隔線與後台標題', () => {
    const guestNodes = buildDrawerRenderNodes(null);
    const labels = guestNodes.filter((n) => n.kind === 'item').map((n) => n.label);
    expect(labels).toEqual([
      '個人數據',
      '排行榜',
      '使用手冊',
      '分享網頁',
      '申請（俱樂部/場主/教練）',
    ]);
    expect(guestNodes.some((n) => n.kind === 'divider')).toBe(false);
    expect(guestNodes.some((n) => n.kind === 'section')).toBe(false);

    const lockedItems = guestNodes.filter(
      (n): n is Extract<typeof n, { kind: 'item' }> => n.kind === 'item' && n.locked === true,
    );
    expect(lockedItems.map((n) => n.label)).toEqual(['個人數據', '排行榜']);
  });

  it('活動管理入口遵循 _canAccessOwnActivityManageEntry：coach 以上或具 own_manage_entry 能力的一般用戶可見', () => {
    const userNoCap = makeAccess({ role: 'user', roleLevel: 0, capabilities: [] });
    const userWithCap = makeAccess({
      role: 'user',
      roleLevel: 0,
      capabilities: ['user.activity.own_manage_entry'],
    });
    const coachAccess = makeAccess({ role: 'coach', roleLevel: 1 });

    const activityEntry = DRAWER_MENUS.find((m) => m.page === 'page-my-activities')!;
    expect(canAccessDrawerItem(activityEntry, userNoCap)).toBe(false);
    expect(canAccessDrawerItem(activityEntry, userWithCap)).toBe(true);
    expect(canAccessDrawerItem(activityEntry, coachAccess)).toBe(true);
  });

  it('有 permissionCode 的入口只看 hasPermission，無 permissionCode 的入口（如權限管理）比對 minRole 等級', () => {
    const adminNoPerms = makeAccess({
      role: 'admin',
      roleLevel: 4,
      hasPermission: () => false,
    });
    const usersEntry = DRAWER_MENUS.find((m) => m.page === 'page-admin-users')!;
    const rolesEntry = DRAWER_MENUS.find((m) => m.page === 'page-admin-roles')!;

    expect(canAccessDrawerItem(usersEntry, adminNoPerms)).toBe(false);
    expect(canAccessDrawerItem(rolesEntry, adminNoPerms)).toBe(false);

    const adminWithUsers = makeAccess({
      role: 'admin',
      roleLevel: 4,
      hasPermission: (code) => code === 'admin.users.entry',
    });
    expect(canAccessDrawerItem(usersEntry, adminWithUsers)).toBe(true);

    const superAdmin = makeAccess({
      role: 'super_admin',
      roleLevel: 5,
      hasPermission: () => true,
    });
    expect(canAccessDrawerItem(rolesEntry, superAdmin)).toBe(true);
  });

  it('總管（super_admin）看到完整選單、後台管理分組標題、權限底色（藍／紅）與跨段分隔線', () => {
    const superAdmin = makeAccess({
      role: 'super_admin',
      roleLevel: 5,
      hasPermission: () => true,
    });
    const nodes = buildDrawerRenderNodes(superAdmin);

    const sections = nodes.filter((n) => n.kind === 'section');
    expect(sections.map((s) => s.label)).toEqual(['後台管理']);

    const byLabel = new Map(
      nodes.filter((n): n is Extract<typeof n, { kind: 'item' }> => n.kind === 'item').map((n) => [n.label, n]),
    );
    // admin 入口為藍底
    expect(byLabel.get('用戶管理')?.bgClass).toBe('drawer-role-admin');
    expect(byLabel.get('首頁管理')?.bgClass).toBe('drawer-role-admin');
    // super_admin 入口與 highlight: 'red'（黑名單管理）為紅底
    expect(byLabel.get('數據儀表板')?.bgClass).toBe('drawer-role-super');
    expect(byLabel.get('黑名單管理')?.bgClass).toBe('drawer-role-super');
    expect(byLabel.get('權限管理')?.bgClass).toBe('drawer-role-super');

    const repairEntry = DRAWER_MENUS.find((m) => m.page === 'page-admin-repair')!;
    expect(getDrawerItemBgClass(repairEntry)).toBe('drawer-role-super');
  });

  it('resolveDrawerRoleInfo 照 A ROLES 與自訂角色回傳標籤文字與顏色', () => {
    expect(resolveDrawerRoleInfo(null, false)).toEqual({
      level: 0,
      label: '未登入',
      color: '#6b7280',
    });
    expect(resolveDrawerRoleInfo(null, false, null, true)).toEqual({
      level: 0,
      label: '確認中',
      color: '#6b7280',
    });
    expect(resolveDrawerRoleInfo('coach', true)).toEqual({
      level: 1,
      label: '教練',
      color: '#0d9488',
    });
    expect(resolveDrawerRoleInfo('super_admin', true)).toEqual({
      level: 5,
      label: '總管',
      color: '#dc2626',
    });

    const customRoles: CustomRoleInput[] = [
      { key: 'vip_host', label: '特約主揪', color: '#ec4899', afterRole: 'coach' },
    ];
    const customInfo = resolveDrawerRoleInfo('vip_host', true, customRoles);
    expect(customInfo.label).toBe('特約主揪');
    expect(customInfo.color).toBe('#ec4899');
    expect(customInfo.level).toBeGreaterThan(1);
    expect(customInfo.level).toBeLessThan(2);
  });
});

describe('drawerItemStatus（內測站功能進度標記）', () => {
  const byLabel = (label: string) => DRAWER_MENUS.find((e) => e.label === label)!;

  it('鎖定／coming-soon 是 closed、有路由是 done、沒有路由是 wip、動作入口是 done', () => {
    expect(drawerItemStatus(byLabel('個人數據'))).toBe('closed');
    expect(drawerItemStatus(byLabel('排行榜'))).toBe('closed');
    expect(drawerItemStatus(byLabel('活動管理'))).toBe('done');
    // 測試同步更新：K1a 起俱樂部管理接上 /team-manage。
    expect(drawerItemStatus(byLabel('俱樂部管理'))).toBe('done');
    expect(drawerItemStatus(byLabel('分享網頁'))).toBe('done');
  });

  // 測試同步更新：W1C-M 補上 public/manual.html，使用手冊改為 done（由下方「public/manual.html 存在才能標 done」把關）。
  it('佔位頁路由不得標成 done（點開只會看到「即將推出」）', () => {
    expect(drawerItemStatus(byLabel('數據儀表板'))).toBe('wip');
    expect(drawerItemStatus(byLabel('用戶管理'))).toBe('done');
  });

  it('DRAWER_PLACEHOLDER_ROUTES 與 src/features 實際使用 PlaceholderPage 的抽屜路由逐一對帳', () => {
    const featuresDir = join(process.cwd(), 'src/features');
    const placeholderPaths: string[] = [];
    for (const dir of readdirSync(featuresDir, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const file = join(featuresDir, dir.name, 'index.ts');
      if (!existsSync(file)) continue;
      const source = readFileSync(file, 'utf-8');
      if (!source.includes('PlaceholderPage')) continue;
      for (const match of source.matchAll(/path:\s*'([^']+)'/g)) placeholderPaths.push(match[1]!);
    }
    // 鎖定入口（個人數據）本來就是 closed，不需列入佔位清單。
    const drawerRoutes = new Set(DRAWER_MENUS.filter((e) => !e.locked).map((e) => e.routePath).filter((p): p is string => Boolean(p)));
    const expected = placeholderPaths.filter((p) => drawerRoutes.has(p)).sort();
    expect([...DRAWER_PLACEHOLDER_ROUTES].sort()).toEqual(expected);
  });

  it('使用手冊：public/manual.html 存在才能標 done', () => {
    const exists = existsSync(join(process.cwd(), 'public/manual.html'));
    expect(drawerItemStatus(byLabel('使用手冊'))).toBe(exists ? 'done' : 'wip');
  });

  it('有路由、非佔位、非鎖定的入口一定是 done；其餘每項都判得出狀態', () => {
    for (const entry of DRAWER_MENUS) {
      if (entry.divider || entry.sectionLabel) continue;
      const status = drawerItemStatus(entry);
      expect(['done', 'closed', 'wip']).toContain(status);
      if (entry.routePath && !entry.locked && !DRAWER_PLACEHOLDER_ROUTES.includes(entry.routePath)) expect(status).toBe('done');
    }
  });
});

describe('新站不做的入口不出現在抽屜', () => {
  it('SEO 儀表板、佈景主題、EXP 管理、成就/徽章管理、二手商品、賽事管理不在 DRAWER_MENUS', () => {
    const labels = DRAWER_MENUS.map((e) => e.label);
    for (const label of ['SEO 儀表板', '佈景主題', '手動 EXP 管理', '自動 EXP 管理', '成就/徽章管理', '二手商品區', '二手商品管理', '賽事管理', '小遊戲管理']) {
      expect(labels).not.toContain(label);
    }
    const removedPages = ['page-admin-seo', 'page-admin-themes', 'page-admin-exp', 'page-admin-auto-exp', 'page-admin-achievements', 'page-shop', 'page-admin-shop', 'page-admin-tournaments', 'page-admin-games'];
    expect(DRAWER_MENUS.some((e) => removedPages.includes(e.page ?? ''))).toBe(false);
  });
});
