import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { RouteAccessContext } from '@/core/feature-types';
import { DRAWER_MENUS, canAccessDrawerItem } from '@/ui/drawer-menu';
import { ALL_FEATURES } from '@/features.config';

import { manifest } from './index';

function access(role: string, perms: readonly string[] | 'all'): RouteAccessContext {
  return {
    uid: 'me',
    role,
    roleLevel: 0,
    capabilities: [],
    hasPermission: (code) => perms === 'all' || perms.includes(code),
  };
}

describe('admin-users manifest', () => {
  it('登記在 features.config，路由 /admin/users，標題 key 在自己的語系檔', () => {
    expect(ALL_FEATURES).toContain(manifest);
    expect(manifest.id).toBe('admin-users');
    expect(manifest.status).toBe('enabled');
    expect(manifest.routes).toHaveLength(1);
    expect(manifest.routes[0]).toMatchObject({ path: '/admin/users', titleKey: 'admin-users.title' });
  });

  it('側邊選單入口只看 admin.users.entry（四身分）', () => {
    const visible = manifest.routes[0]!.drawerVisibleIf!;
    expect(visible(access('user', []))).toBe(false);
    expect(visible(access('coach', []))).toBe(false);
    expect(visible(access('captain', []))).toBe(false);
    expect(visible(access('admin', []))).toBe(false);
    expect(visible(access('admin', ['admin.users.entry']))).toBe(true);
    expect(visible(access('super_admin', 'all'))).toBe(true);
    // 權限碼是唯一依據：即使是 admin，缺入口碼也看不到（照 A DRAWER_MENUS）。
    expect(visible(access('admin', ['admin.users.edit_profile', 'admin.users.change_role', 'admin.users.restrict']))).toBe(false);
  });

  it('F11：中文語系的訊息不含英文角色代號（super_admin、admin、user、coach…）', () => {
    const flatten = (obj: Record<string, unknown>, prefix = ''): [string, string][] =>
      Object.entries(obj).flatMap(([key, value]) =>
        value && typeof value === 'object'
          ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
          : [[`${prefix}${key}`, String(value)] as [string, string]]);
    for (const locale of ['zh-TW', 'zh-CN']) {
      const raw = JSON.parse(readFileSync(resolve(__dirname, 'locales', `${locale}.json`), 'utf8')) as Record<string, unknown>;
      for (const [key, text] of flatten(raw)) {
        expect(text, `${locale} ${key}`).not.toMatch(/(super_admin|admin|user|coach|captain|venue_owner)/i);
      }
    }
  });

  it('抽屜「用戶管理」指向 /admin/users，權限碼與 A 一致', () => {
    const entry = DRAWER_MENUS.find((item) => item.page === 'page-admin-users');
    expect(entry).toMatchObject({
      routePath: '/admin/users',
      permissionCode: 'admin.users.entry',
      minRole: 'admin',
      i18nKey: 'admin.userManage',
    });
    expect(canAccessDrawerItem(entry, access('admin', ['admin.users.entry']))).toBe(true);
    expect(canAccessDrawerItem(entry, access('admin', []))).toBe(false);
    expect(canAccessDrawerItem(entry, access('coach', []))).toBe(false);
  });
});
