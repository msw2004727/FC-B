import { describe, expect, it } from 'vitest';
import { SHOW_ANNOUNCEMENTS, SHOW_FAVORITES } from './hidden-features';

describe('新版隱藏收藏與公告（站長 2026-10-30：只關入口、渲染與讀取）', () => {
  it('預設隱藏收藏', () => {
    expect(SHOW_FAVORITES).toBe(false);
  });

  it('預設隱藏公告', () => {
    expect(SHOW_ANNOUNCEMENTS).toBe(false);
  });
});
