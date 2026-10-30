import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_FEATURES } from '@/features.config';
import { DRAWER_MENUS } from '@/ui/drawer-menu';
import { manifest } from './index';
import { getAllPermissionCodes } from '@/features/profile/data/permissions';

describe('T-079a 登記與七語系', () => {
  it('已登記角色頁，抽屜維持既有 super_admin-only 契約', () => {
    expect(ALL_FEATURES).toContain(manifest);
    expect(manifest.routes[0]?.path).toBe('/admin/roles');
    const item = DRAWER_MENUS.find(entry => 'page' in entry && entry.page === 'page-admin-roles');
    expect(item).toMatchObject({ routePath: '/admin/roles', minRole: 'super_admin' });
    expect(item).not.toHaveProperty('permissionCode');
  });
  it.each(['user', 'coach', 'captain', 'venue_owner', 'admin', 'super_admin'])('抽屜 %s 不受權限碼偽裝影響', role => {
    expect(manifest.routes[0]!.drawerVisibleIf!({
      uid: 'test-actor', role, roleLevel: 100, capabilities: [], hasPermission: () => true,
    })).toBe(role === 'super_admin');
  });
  it('七語系鍵一致，58 條權限＋8 條活動說明完整且為純文字', () => {
    const flatten = (value: unknown, prefix = ''): string[] => {
      if (!value || typeof value !== 'object') return [prefix];
      return Object.entries(value).flatMap(([key, val]) => flatten(val, prefix + '.' + key)).sort();
    };
    const read = (locale: string) => JSON.parse(readFileSync(resolve(__dirname, 'locales', locale + '.json'), 'utf8')) as {
      info: Record<string, { title: string; body: string }>;
    };
    const baseline = read('zh-TW');
    expect(Object.keys(baseline.info)).toHaveLength(66);
    for (const code of getAllPermissionCodes()) expect(baseline.info[code]?.body).toBeTruthy();
    for (const locale of ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'th', 'vi']) {
      const dict = read(locale);
      expect(flatten(dict)).toEqual(flatten(baseline));
      expect(dict.info).toEqual(baseline.info);
      for (const item of Object.values(dict.info)) {
        expect(item.title).toBeTruthy();
        expect(item.body).toBeTruthy();
        expect(item.body).not.toMatch(/<\/?[a-z][^>]*>/i);
      }
    }
  });
});
