import { describe, expect, it } from 'vitest';
import type { RouteAccessContext } from '@/core/feature-types';
import { ALL_FEATURES } from '@/features.config';
import { DRAWER_MENUS, drawerItemStatus } from '@/ui/drawer-menu';
import { manifest } from './index';
import { INACTIVE_ENTRY_PERMISSION } from './pages/AdminInactivePage';

function access(code: string | null): RouteAccessContext {
  return { uid: 'u1', role: 'admin', roleLevel: 4, capabilities: [], hasPermission: (c) => code !== null && c === code };
}

describe('admin-inactive manifest', () => {
  it('登記在 ALL_FEATURES，路由 /admin/inactive', () => {
    expect(ALL_FEATURES).toContain(manifest);
    expect(manifest.id).toBe('admin-inactive');
    expect(manifest.status).toBe('enabled');
    expect(manifest.routes.map((r) => r.path)).toEqual(['/admin/inactive']);
  });

  it('選單顯示與頁面用同一個權限碼 admin.inactive.entry', () => {
    const visible = manifest.routes[0]!.drawerVisibleIf!;
    expect(INACTIVE_ENTRY_PERMISSION).toBe('admin.inactive.entry');
    expect(visible(access('admin.inactive.entry'))).toBe(true);
    expect(visible(access('admin.users.entry'))).toBe(false);
    expect(visible(access(null))).toBe(false);
  });

  it('DRAWER_MENUS「無效資料查詢」指向 /admin/inactive、minRole super_admin，進度標 done', () => {
    const entry = DRAWER_MENUS.find((e) => e.label === '無效資料查詢')!;
    expect(entry.routePath).toBe('/admin/inactive');
    expect(entry.minRole).toBe('super_admin');
    expect(entry.permissionCode).toBe('admin.inactive.entry');
    expect(drawerItemStatus(entry)).toBe('done');
  });
});
