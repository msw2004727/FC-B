import { afterEach, describe, expect, it } from 'vitest';

import type { UserAttendanceSummary } from './attendance-summary';
import {
  buildPlayerCardModel,
  countActiveClubs,
  playerCardLogoUrl,
  resolvePlayerCardTheme,
  roundAttendRate,
} from './player-card-model';

function summary(overrides: Partial<UserAttendanceSummary> = {}): UserAttendanceSummary {
  return {
    uid: 'U-me',
    exists: true,
    sourceVersion: 1,
    expectedCount: 26,
    attendedCount: 22,
    completedCount: 14,
    attendRate: 85,
    updatedAt: null,
    ...overrides,
  };
}

describe('T-092 球員卡資料模型', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('出席率四捨五入並夾在 0～100', () => {
    expect(roundAttendRate(84.5)).toBe(85);
    expect(roundAttendRate(84.49)).toBe(84);
    expect(roundAttendRate(-3)).toBe(0);
    expect(roundAttendRate(130)).toBe(100);
    expect(roundAttendRate('x')).toBe(0);
    const m = buildPlayerCardModel({ name: 'A', avatarUrl: null, summary: summary({ attendRate: 66.6 }) });
    expect(m.attendRate).toBe(67);
    expect(m.attendText).toBe('67%');
    expect(m.gaugeRatio).toBeCloseTo(0.67);
  });

  it('三格與既有頁首同源：應到＝expectedCount、完成＝completedCount、出席率＝attendRate', () => {
    const m = buildPlayerCardModel({ name: '王小明', avatarUrl: null, summary: summary() });
    expect(m.scheduledText).toBe('26');
    expect(m.completedText).toBe('14');
    expect(m.attendText).toBe('85%');
  });

  it('summary 未載入時三格顯示 --、計量條為 0', () => {
    const m = buildPlayerCardModel({ name: '王小明', avatarUrl: null, summary: null });
    expect(m.scheduledText).toBe('--');
    expect(m.completedText).toBe('--');
    expect(m.attendText).toBe('--');
    expect(m.attendRate).toBeNull();
    expect(m.gaugeRatio).toBe(0);
  });

  it('俱樂部數 0 時不顯示方塊', () => {
    const m = buildPlayerCardModel({ name: 'A', avatarUrl: null, summary: null, teamIds: new Set() });
    expect(m.clubCount).toBe(0);
    expect(m.showClubBadge).toBe(false);
    expect(buildPlayerCardModel({ name: 'A', avatarUrl: null, summary: null }).showClubBadge).toBe(false);
  });

  it('俱樂部數取 teamIds 去重有效數；兩位數時加寬', () => {
    expect(countActiveClubs(['t1', 't1', ' t1 ', '', '  ', null, 3, 't2'])).toBe(2);
    const one = buildPlayerCardModel({ name: 'A', avatarUrl: null, summary: null, teamIds: new Set(['t1']) });
    expect(one.showClubBadge).toBe(true);
    expect(one.clubBadgeWide).toBe(false);
    const nine = buildPlayerCardModel({
      name: 'A', avatarUrl: null, summary: null, teamIds: Array.from({ length: 9 }, (_, i) => `t${i}`),
    });
    expect(nine.clubBadgeWide).toBe(false);
    const ten = buildPlayerCardModel({
      name: 'A', avatarUrl: null, summary: null, teamIds: Array.from({ length: 10 }, (_, i) => `t${i}`),
    });
    expect(ten.clubCount).toBe(10);
    expect(ten.clubBadgeWide).toBe(true);
  });

  it('名字空白時顯示 -', () => {
    expect(buildPlayerCardModel({ name: '  ', avatarUrl: null, summary: null }).name).toBe('-');
  });

  it('深淺色跟 <html data-theme>，logo 淺用黑、深用白', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(resolvePlayerCardTheme()).toBe('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    expect(resolvePlayerCardTheme()).toBe('light');
    expect(playerCardLogoUrl('light')).toBe('/assets/logo-black.webp');
    expect(playerCardLogoUrl('dark')).toBe('/assets/logo-white.webp');
  });
});
