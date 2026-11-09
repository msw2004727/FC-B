import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_FEATURES } from '@/features.config';
import {
  _resetForTest,
  getActiveRoutes,
  getNavItems,
  isFeatureEnabled,
  registerFeatures,
} from '@/core/feature-registry';
import { manifest } from './index';
import { COURSES_ENABLED, SHOW_COURSES } from './flags';

describe('education manifest（課程 K1：K3 驗收前開關關閉）', () => {
  beforeEach(() => {
    _resetForTest();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('上線開關預設關閉：reserved、不帶任何路由，仍在功能清單內', () => {
    expect(SHOW_COURSES).toBe(false);
    expect(COURSES_ENABLED).toBe(false);
    expect(manifest.status).toBe('reserved');
    expect(manifest.routes).toEqual([]);
    expect(ALL_FEATURES).toContain(manifest);
  });

  it('關閉時註冊後不啟用、課程路由與導覽都不出現', () => {
    registerFeatures(ALL_FEATURES);
    expect(isFeatureEnabled('education')).toBe(false);
    expect(getActiveRoutes().some((r) => r.path.startsWith('/course'))).toBe(false);
    expect(JSON.stringify(getNavItems())).not.toContain('education');
  });

  it('課程孤兒 chunk 不進 Service Worker 預快取（vite.config.ts globIgnores，不寫死 hash）', () => {
    const viteConfig = readFileSync(resolve(__dirname, '../../../vite.config.ts'), 'utf8');
    const ignores = /globIgnores:\s*\[([^\]]*)\]/.exec(viteConfig)?.[1] ?? '';
    expect(ignores).toContain("'**/CourseTab-*.js'");
    expect(ignores).toContain("'**/course-pages-*.js'");
    expect(ignores).toContain("'**/course-actions-*.css'");
    expect(ignores).not.toMatch(/CourseTab-[A-Za-z0-9_-]{8}\.js/);
    expect(ignores).not.toMatch(/course-pages-[A-Za-z0-9_-]{8}\.js/);
    expect(ignores).not.toMatch(/course-actions-[A-Za-z0-9_-]{8}\.css/);
  });

  it('開發／截圖用建置變數打開時：啟用並帶詳情、課堂、管理入口四條路由', async () => {
    vi.stubEnv('VITE_SHOW_COURSES', '1');
    vi.resetModules();
    const mod = await import('./index');
    expect(mod.manifest.status).toBe('enabled');
    expect(mod.manifest.routes.map((r) => r.path)).toEqual([
      '/courses/:teamId/:planId',
      '/courses/:teamId/:planId/lessons',
      '/course-manage/:teamId',
      '/course-manage/:teamId/:planId',
    ]);
  });
});
