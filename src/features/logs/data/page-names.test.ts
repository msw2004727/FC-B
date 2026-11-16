import { describe, expect, it } from 'vitest';

import { pageLabel } from './page-names';

describe('pageLabel - 舊站頁面代碼', () => {
  it('page-xxx 對照', () => {
    expect(pageLabel('page-home')).toBe('首頁');
    expect(pageLabel('page-activities')).toBe('活動');
    expect(pageLabel('page-activity-detail')).toBe('活動詳情');
    expect(pageLabel('page-team-manage')).toBe('俱樂部管理');
    expect(pageLabel('page-leaderboard')).toBe('排行榜');
  });

  it('page-admin-* 個別對照', () => {
    expect(pageLabel('page-admin-users')).toBe('用戶管理');
    expect(pageLabel('page-admin-logs')).toBe('日誌中心');
  });

  it('未知的 page-admin-* 一律顯示「後台」', () => {
    expect(pageLabel('page-admin-foo')).toBe('後台');
  });

  it('短名 activity 與 home', () => {
    expect(pageLabel('activity')).toBe('活動');
    expect(pageLabel('home')).toBe('首頁');
  });
});

describe('pageLabel - 新站路徑', () => {
  it('根路徑', () => {
    expect(pageLabel('/')).toBe('首頁');
  });

  it('活動詳情', () => {
    expect(pageLabel('/events/abc')).toBe('活動詳情');
  });

  it('俱樂部詳情', () => {
    expect(pageLabel('/teams/x')).toBe('俱樂部詳情');
  });

  it('admin ops 顯示數據儀表板', () => {
    expect(pageLabel('/admin/ops/members')).toBe('數據儀表板');
  });

  it('未知 admin 路徑顯示「後台」', () => {
    expect(pageLabel('/admin/xxx')).toBe('後台');
  });

  it('帶 query、hash 或結尾斜線', () => {
    expect(pageLabel('/events/abc?x=1')).toBe('活動詳情');
    expect(pageLabel('/events/abc#top')).toBe('活動詳情');
    expect(pageLabel('/events/abc/')).toBe('活動詳情');
    expect(pageLabel('/teams/')).toBe('俱樂部');
  });
});

describe('pageLabel - 未知與空字串', () => {
  it('未知回原字', () => {
    expect(pageLabel('other-page')).toBe('other-page');
    expect(pageLabel('/unknown/path')).toBe('/unknown/path');
  });

  it('空字串回「未標示」', () => {
    expect(pageLabel('')).toBe('未標示');
    expect(pageLabel('   ')).toBe('未標示');
  });

  it('unknown 回「未標示」', () => {
    expect(pageLabel('unknown')).toBe('未標示');
  });
});
