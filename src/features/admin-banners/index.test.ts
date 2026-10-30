import { afterEach, describe, expect, it } from 'vitest';
import type { RouteAccessContext } from '@/core/feature-types';
import { ALL_FEATURES } from '@/features.config';
import {
  BANNERS_SNAPSHOT_KEY,
  SPORTS_SNAPSHOT_KEY,
  invalidateBannersSnapshot,
  readBannersSnapshot,
  toPublicBanners,
  writeBannersSnapshot,
} from '@/features/home/data/home-snapshot';
import { DRAWER_MENUS } from '@/ui/drawer-menu';
import { manifest } from './index';

function access(code: string | null): RouteAccessContext {
  return {
    uid: 'u1',
    role: 'admin',
    roleLevel: 3,
    capabilities: [],
    hasPermission: (c) => code !== null && c === code,
  };
}

describe('admin-banners manifest', () => {
  it('登記在 ALL_FEATURES，路由 /admin/banners', () => {
    expect(ALL_FEATURES).toContain(manifest);
    expect(manifest.id).toBe('admin-banners');
    expect(manifest.status).toBe('enabled');
    expect(manifest.routes.map((r) => r.path)).toEqual(['/admin/banners']);
  });

  it('側邊選單只給有 admin.banners.entry 的人', () => {
    const visible = manifest.routes[0]!.drawerVisibleIf!;
    expect(visible(access('admin.banners.entry'))).toBe(true);
    expect(visible(access('admin.users.entry'))).toBe(false);
    expect(visible(access(null))).toBe(false);
  });

  it('DRAWER_MENUS「首頁管理」指向 /admin/banners，守衛 minRole=admin＋admin.banners.entry', () => {
    const item = DRAWER_MENUS.find((entry) => 'page' in entry && entry.page === 'page-admin-banners');
    expect(item).toMatchObject({
      routePath: '/admin/banners',
      minRole: 'admin',
      permissionCode: 'admin.banners.entry',
    });
  });

  it('頁面以動態 import 載入（隨路由延遲，不進首頁）', () => {
    expect(typeof manifest.routes[0]!.load).toBe('function');
  });
});

describe('invalidateBannersSnapshot（儲存後同一用戶端首頁快照失效）', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('只清橫幅一段，運動統計快照不動', () => {
    const list = toPublicBanners([
      { id: 'ban1', _docId: 'ban1', status: 'active', title: 'T', image: 'https://example.com/a.webp' },
    ]);
    writeBannersSnapshot(list);
    localStorage.setItem(SPORTS_SNAPSHOT_KEY, '{"keep":true}');
    expect(readBannersSnapshot()).not.toBeNull();

    invalidateBannersSnapshot();

    expect(localStorage.getItem(BANNERS_SNAPSHOT_KEY)).toBeNull();
    expect(readBannersSnapshot()).toBeNull();
    expect(localStorage.getItem(SPORTS_SNAPSHOT_KEY)).toBe('{"keep":true}');
  });

  it('沒有快照時呼叫也安全', () => {
    expect(() => invalidateBannersSnapshot()).not.toThrow();
  });

  it('localStorage 丟錯時吞掉（私密模式）', () => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = () => {
      throw new Error('denied');
    };
    try {
      expect(() => invalidateBannersSnapshot()).not.toThrow();
    } finally {
      Storage.prototype.removeItem = original;
    }
  });
});
