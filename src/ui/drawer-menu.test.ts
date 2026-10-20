import { describe, expect, it } from 'vitest';
import type { RouteAccessContext } from '@/core/feature-types';
import {
  buildDrawerRenderNodes,
  canAccessDrawerItem,
  DRAWER_MENUS,
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

describe('drawer-menu (M-002 ~ M-008, M-014 ~ M-015)', () => {
  it('訪客與一般用戶只看到前 6 個基本入口（含 3 個上鎖入口與 3 個動作入口），不畫多餘分隔線與後台標題', () => {
    const guestNodes = buildDrawerRenderNodes(null);
    const labels = guestNodes.filter((n) => n.kind === 'item').map((n) => n.label);
    expect(labels).toEqual([
      '個人數據',
      '二手商品區',
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
    expect(lockedItems.map((n) => n.label)).toEqual(['個人數據', '二手商品區', '排行榜']);
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
    const seoEntry = DRAWER_MENUS.find((m) => m.page === 'page-admin-seo')!;
    const rolesEntry = DRAWER_MENUS.find((m) => m.page === 'page-admin-roles')!;

    expect(canAccessDrawerItem(seoEntry, adminNoPerms)).toBe(false);
    expect(canAccessDrawerItem(rolesEntry, adminNoPerms)).toBe(false);

    const adminWithSeo = makeAccess({
      role: 'admin',
      roleLevel: 4,
      hasPermission: (code) => code === 'admin.seo.entry',
    });
    expect(canAccessDrawerItem(seoEntry, adminWithSeo)).toBe(true);

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
    // super_admin 入口與 highlight: 'red'（SEO 儀表板、用戶補正管理）為紅底
    expect(byLabel.get('數據儀表板')?.bgClass).toBe('drawer-role-super');
    expect(byLabel.get('SEO 儀表板')?.bgClass).toBe('drawer-role-super');
    expect(byLabel.get('用戶補正管理')?.bgClass).toBe('drawer-role-super');
    expect(byLabel.get('權限管理')?.bgClass).toBe('drawer-role-super');

    const seoEntry = DRAWER_MENUS.find((m) => m.page === 'page-admin-seo')!;
    expect(getDrawerItemBgClass(seoEntry)).toBe('drawer-role-super');
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
