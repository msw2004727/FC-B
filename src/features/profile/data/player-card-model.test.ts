import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { UserAttendanceSummary } from './attendance-summary';
import {
  buildPlayerCardModel,
  countActiveClubs,
  PLAYER_CARD_ABBR,
  PLAYER_CARD_SHINE,
  playerCardLogoUrl,
  playerCardShineCanvasStops,
  playerCardShineCssGradient,
  playerCardShineGeometry,
  playerCardShineLayers,
  resolvePlayerCardName,
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

  // 測試同步更新（站長 11-06 放鴿子／出席率 v2）：「應到」改「參與」、縮寫 SCH 改 APP；沒有 v2 時仍退回舊算法。
  it('沒有 v2 時三格與既有頁首同源：參與＝expectedCount、完成＝completedCount、出席率＝attendRate，不顯示計入場數', () => {
    const m = buildPlayerCardModel({ name: '王小明', avatarUrl: null, summary: summary() });
    expect(m.scheduledText).toBe('26');
    expect(m.countedCount).toBeNull();
    expect(m.completedText).toBe('14');
    expect(m.attendText).toBe('85%');
  });

  it('縮寫：參與 APP（原 SCH）、完成 CMP、出席率 ATT', () => {
    expect(PLAYER_CARD_ABBR.scheduled).toBe('APP');
    expect(PLAYER_CARD_ABBR.completed).toBe('CMP');
    expect(PLAYER_CARD_ABBR.attend).toBe('ATT');
  });

  it.each([
    { counted: 0, completed: 0, attendText: '--', attendRate: null, gauge: 0 },
    { counted: 1, completed: 1, attendText: '1/1', attendRate: null, gauge: 1 },
    { counted: 2, completed: 1, attendText: '1/2', attendRate: null, gauge: 0.5 },
    { counted: 3, completed: 2, attendText: '67%', attendRate: 67, gauge: 2 / 3 },
    { counted: 4, completed: 9, attendText: '100%', attendRate: 100, gauge: 1 },
  ])('v2 計入 $counted 場完成 $completed：出席率 $attendText', ({ counted, completed, attendText, attendRate, gauge }) => {
    const m = buildPlayerCardModel({
      name: '王小明', avatarUrl: null,
      summary: summary({ v2: { since: '2026-11-06', participatedCount: 12, countedCount: counted, countedCompletedCount: completed, countedNoShowCount: 0 } }),
    });
    expect(m.scheduledText).toBe('12');
    expect(m.completedText).toBe(String(Math.min(completed, counted)));
    expect(m.attendText).toBe(attendText);
    expect(m.attendRate).toBe(attendRate);
    expect(m.gaugeRatio).toBeCloseTo(gauge);
    expect(m.countedCount).toBe(counted);
  });

  it('summary 未載入時三格顯示 --、計量條為 0', () => {
    const m = buildPlayerCardModel({ name: '王小明', avatarUrl: null, summary: null });
    expect(m.scheduledText).toBe('--');
    expect(m.completedText).toBe('--');
    expect(m.attendText).toBe('--');
    expect(m.attendRate).toBeNull();
    expect(m.gaugeRatio).toBe(0);
    expect(m.countedCount).toBeNull();
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

  it('名字是資料層預設的 Unknown（不分大小寫、含前後空白）時顯示 -、首字 ?', () => {
    // profile-model.ts mapUserProfileDoc：users 文件沒有 displayName／name 時補 'Unknown'。
    for (const name of ['Unknown', ' unknown ', 'UNKNOWN', '  UnKnOwN  ']) {
      const m = buildPlayerCardModel({ name, uid: 'U-abc', avatarUrl: null, summary: null });
      expect(m.name).toBe('-');
      expect(m.avatarInitial).toBe('?');
    }
    expect(resolvePlayerCardName('Unknown Player', 'U-abc')).toBe('Unknown Player');
  });

  it('P2-1：名字等於 UID（含前後空白）時改顯示 -，首字為 ?；模型不含 UID', () => {
    const m = buildPlayerCardModel({ name: ' U-abc ', uid: 'U-abc', avatarUrl: null, summary: null });
    expect(m.name).toBe('-');
    expect(m.avatarInitial).toBe('?');
    expect(JSON.stringify(m)).not.toContain('U-abc');
    expect(resolvePlayerCardName('U-abc', ' U-abc ')).toBe('-');
    expect(resolvePlayerCardName('王小明', 'U-abc')).toBe('王小明');
    expect(resolvePlayerCardName(' 王小明 ', null)).toBe('王小明');
    expect(buildPlayerCardModel({ name: '王小明', uid: 'U-abc', avatarUrl: null, summary: null }).avatarInitial)
      .toBe('王');
  });

  it('沒傳人氣星等時為 null；有限非負數保留，NaN 與負數不畫', () => {
    expect(buildPlayerCardModel({ name: 'A', avatarUrl: null, summary: null }).popularityStars).toBeNull();
    expect(buildPlayerCardModel({ name: 'A', avatarUrl: null, summary: null, popularityStars: null }).popularityStars).toBeNull();
    expect(buildPlayerCardModel({ name: 'A', avatarUrl: null, summary: null, popularityStars: 0 }).popularityStars).toBe(0);
    expect(buildPlayerCardModel({ name: 'A', avatarUrl: null, summary: null, popularityStars: 3.5 }).popularityStars).toBe(3.5);
    expect(buildPlayerCardModel({ name: 'A', avatarUrl: null, summary: null, popularityStars: Number.NaN }).popularityStars).toBeNull();
    expect(buildPlayerCardModel({ name: 'A', avatarUrl: null, summary: null, popularityStars: -1 }).popularityStars).toBeNull();
  });

  it('深淺色跟 <html data-theme>，logo 淺用黑、深用白', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(resolvePlayerCardTheme()).toBe('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    expect(resolvePlayerCardTheme()).toBe('light');
    expect(playerCardLogoUrl('light')).toBe('/assets/logo-black.webp');
    expect(playerCardLogoUrl('dark')).toBe('/assets/logo-white.webp');
  });

  it('自架字型：@font-face 指向 public/fonts 的 woff2，授權檔一併存在', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/profile/components/player-card.css'), 'utf8');
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*'Bebas Neue'[^}]*font-display:\s*swap[^}]*url\('\/fonts\/bebas-neue-latin-400-normal\.woff2'\)\s*format\('woff2'\)/);
    expect(existsSync(resolve(process.cwd(), 'public/fonts/bebas-neue-latin-400-normal.woff2'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'public/fonts/BebasNeue-OFL.txt'))).toBe(true);
  });

  describe('固定斜光共用常數（網頁與 PNG 同一組）', () => {
    it('角度 115deg：Canvas 漸層線依 CSS 規範換算（L＝|w·sinθ|＋|h·cosθ|、通過卡面中心）', () => {
      expect(PLAYER_CARD_SHINE.angleDeg).toBe(115);
      const g = playerCardShineGeometry();
      const rad = (115 * Math.PI) / 180;
      const L = 220 * Math.sin(rad) + 324 * Math.abs(Math.cos(rad));
      expect(g.angleDeg).toBe(115);
      expect(g.length).toBeCloseTo(L, 9);
      expect(g.length).toBeCloseTo(336.32, 2);
      expect((g.x0 + g.x1) / 2).toBeCloseTo(110, 9);
      expect((g.y0 + g.y1) / 2).toBeCloseTo(162, 9);
      expect(Math.hypot(g.x1 - g.x0, g.y1 - g.y0)).toBeCloseTo(L, 9);
      // 115deg：往右、往下（螢幕座標）
      expect(g.x1 - g.x0).toBeCloseTo(L * Math.sin(rad), 9);
      expect(g.y1 - g.y0).toBeCloseTo(-L * Math.cos(rad), 9);
      expect(g.y1).toBeGreaterThan(g.y0);
    });

    it('網頁 CSS 漸層與 Canvas 停點同一組百分比', () => {
      for (const theme of ['light', 'dark'] as const) {
        for (const face of ['front', 'back'] as const) {
          for (const layer of playerCardShineLayers(theme, face)) {
            const canvas = playerCardShineCanvasStops(layer);
            const css = playerCardShineCssGradient(layer);
            expect(css.startsWith('linear-gradient(115deg, ')).toBe(true);
            const cssStops = css.slice('linear-gradient(115deg, '.length, -1).split(/,\s*(?=rgba)/);
            expect(cssStops).toHaveLength(canvas.length);
            cssStops.forEach((stop, i) => {
              const [offset, color] = canvas[i]!;
              const pct = Number(/([\d.]+)%$/.exec(stop)![1]);
              expect(stop.startsWith(color)).toBe(true);
              expect(pct / 100).toBeCloseTo(offset, 9);
            });
          }
        }
      }
    });

    it('淺色正面兩層（soft-light 高光＋一般柔光）、背面只有柔光層；alpha 為預覽值減半', () => {
      const front = playerCardShineLayers('light', 'front');
      expect(front.map((l) => l.blend)).toEqual(['soft-light', 'normal']);
      expect(playerCardShineCssGradient(front[0]!)).toBe(
        'linear-gradient(115deg, rgba(255, 236, 190, 0) 38%, rgba(255, 236, 190, 0) 42%, rgba(255, 241, 205, 0.375) 49%, '
          + 'rgba(255, 255, 240, 0.425) 50%, rgba(255, 241, 205, 0.375) 51%, rgba(255, 236, 190, 0) 58%, rgba(255, 236, 190, 0) 62%)',
      );
      expect(playerCardShineCssGradient(front[1]!)).toBe(
        'linear-gradient(115deg, rgba(255, 250, 232, 0) 44%, rgba(255, 250, 232, 0.225) 50%, rgba(255, 250, 232, 0) 56%)',
      );
      const back = playerCardShineLayers('light', 'back');
      expect(back).toHaveLength(1);
      expect(back[0]).toBe(front[1]);
      // 預覽原值 .75／.85／.45 減半
      const alphas = front.flatMap((l) => l.stops.map((s) => Number(/,\s*([\d.]+)\)$/.exec(s.color)![1])));
      expect(Math.max(...alphas)).toBe(0.425);
      expect(alphas).toEqual(expect.arrayContaining([0.375, 0.425, 0.225]));
    });

    it('深色正背面同一層白光（預覽原值）', () => {
      const front = playerCardShineLayers('dark', 'front');
      expect(front).toHaveLength(1);
      expect(playerCardShineLayers('dark', 'back')).toEqual(front);
      expect(front[0]!.blend).toBe('normal');
      expect(playerCardShineCssGradient(front[0]!)).toBe(
        'linear-gradient(115deg, rgba(255, 255, 255, 0) 42%, rgba(255, 255, 255, 0.14) 49%, rgba(255, 255, 255, 0.2) 50%, '
          + 'rgba(255, 255, 255, 0.14) 51%, rgba(255, 255, 255, 0) 58%)',
      );
    });
  });
});
