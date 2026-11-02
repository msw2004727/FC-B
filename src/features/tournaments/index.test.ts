import { describe, expect, it } from 'vitest';
import { ALL_FEATURES } from '@/features.config';
import { manifest } from './index';

describe('tournaments manifest（T-089）', () => {
  it('正常啟用（不再是 external），路由 /tournaments 指向賽事卡片清單頁', async () => {
    expect(ALL_FEATURES).toContain(manifest);
    expect(manifest.status).toBe('enabled');
    expect(manifest.externalUrl).toBeUndefined();
    expect(manifest.routes.map((r) => r.path)).toEqual(['/tournaments']);
    const mod = await manifest.routes[0]!.load();
    expect(mod.default.name).toBe('TournamentsPage');
  });
});
