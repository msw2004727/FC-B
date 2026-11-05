/**
 * T-092 球員卡資料模型（純函式）：卡片 DOM 與 Canvas 產圖共用同一份，避免兩邊數字不一致。
 * 只吃頁面已載入的資料（attendance summary、viewer.teamIds、有效身分名字與頭像），不讀不寫 Firestore。
 */
import type { UserAttendanceSummary } from './attendance-summary';

export type PlayerCardTheme = 'light' | 'dark';

export interface PlayerCardModel {
  name: string;
  /** 已過濾為 http/https 的頭像網址；null＝畫預設頭像。 */
  avatarUrl: string | null;
  /** 0～100 整數；summary 未載入為 null。 */
  attendRate: number | null;
  /** 卡面大數字與三格出席率共用；未載入為 `--`。 */
  attendText: string;
  scheduledText: string;
  completedText: string;
  /** 計量條長度比例 0～1（＝出席率）。 */
  gaugeRatio: number;
  clubCount: number;
  /** 俱樂部數 0 不顯示迷你方塊。 */
  showClubBadge: boolean;
  /** 兩位數以上時方塊加寬。 */
  clubBadgeWide: boolean;
}

export interface PlayerCardModelInput {
  name: string;
  avatarUrl: string | null;
  summary: UserAttendanceSummary | null;
  teamIds?: Iterable<unknown> | null;
}

function toCount(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.trunc(num));
}

/** 出席率四捨五入成 0～100 整數。 */
export function roundAttendRate(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.min(100, Math.max(0, Math.round(num)));
}

/** viewer 已載入的 teamIds 去重後的有效數（空字串、非字串略過）。 */
export function countActiveClubs(teamIds: Iterable<unknown> | null | undefined): number {
  if (!teamIds) return 0;
  const ids = new Set<string>();
  for (const id of teamIds) {
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (trimmed) ids.add(trimmed);
  }
  return ids.size;
}

export function buildPlayerCardModel(input: PlayerCardModelInput): PlayerCardModel {
  const summary = input.summary;
  const attendRate = summary ? roundAttendRate(summary.attendRate) : null;
  const clubCount = countActiveClubs(input.teamIds);
  return {
    name: input.name.trim() || '-',
    avatarUrl: input.avatarUrl,
    attendRate,
    attendText: attendRate === null ? '--' : `${attendRate}%`,
    scheduledText: summary ? String(toCount(summary.expectedCount)) : '--',
    completedText: summary ? String(toCount(summary.completedCount)) : '--',
    gaugeRatio: attendRate === null ? 0 : attendRate / 100,
    clubCount,
    showClubBadge: clubCount > 0,
    clubBadgeWide: clubCount >= 10,
  };
}

/** 卡面英文縮寫固定不翻（站長定案）。 */
export const PLAYER_CARD_ABBR = {
  title: 'PLAYER CARD',
  scheduled: 'SCH',
  completed: 'CMP',
  attend: 'ATT',
} as const;

/** 站長定案色票（DOM 的 player-card.css 用同一組色碼）。 */
export interface PlayerCardPalette {
  base: string;
  stripe: string;
  outerBorder: string;
  innerFrame: string;
  gold: string;
  avatarInnerRing: string;
  text: string;
  subText: string;
  gaugeTrack: string;
  clubBg: string;
  clubText: string;
}

export const PLAYER_CARD_PALETTES: Record<PlayerCardTheme, PlayerCardPalette> = {
  light: {
    base: '#FAEEDA',
    stripe: 'rgba(250, 199, 117, 0.28)',
    outerBorder: '#EF9F27',
    innerFrame: '#BA7517',
    gold: '#BA7517',
    avatarInnerRing: '#FFFFFF',
    text: '#412402',
    subText: '#854F0B',
    gaugeTrack: 'rgba(186, 117, 23, 0.18)',
    clubBg: '#412402',
    clubText: '#FAC775',
  },
  dark: {
    base: '#2C2C2A',
    stripe: 'rgba(68, 68, 65, 0.55)',
    outerBorder: '#854F0B',
    innerFrame: '#FAC775',
    gold: '#FAC775',
    avatarInnerRing: '#2C2C2A',
    text: '#FAEEDA',
    subText: '#FAC775',
    gaugeTrack: 'rgba(250, 199, 117, 0.18)',
    clubBg: '#FAC775',
    clubText: '#2C2C2A',
  },
};

/** 卡面原始尺寸（站長定案 220×324、圓角 18）。 */
export const PLAYER_CARD_SIZE = { width: 220, height: 324, radius: 18 } as const;

/**
 * 運動窄體字：Bebas Neue 已自架於 public/fonts/（player-card.css 的 @font-face，英數子集）；
 * 字型尚未載入或載入失敗時依序退回各平台內建窄體字。
 * （取代原「未自架」註解：2026-11-05 已放入 @fontsource/bebas-neue 5.1.0 latin woff2。）
 */
export const PLAYER_CARD_DISPLAY_FONT =
  "'Bebas Neue', 'DIN Condensed', 'Bahnschrift Condensed', 'Arial Narrow', 'Roboto Condensed', sans-serif-condensed, Impact, sans-serif";

export const PLAYER_CARD_BODY_FONT =
  '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans CJK TC", "Microsoft JhengHei", "Segoe UI", sans-serif';

/** 讀目前解析後的深淺色（`<html data-theme>` 由 core/theme 一律設成 light／dark）。 */
export function resolvePlayerCardTheme(): PlayerCardTheme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark') return 'dark';
    if (attr === 'light') return 'light';
  }
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    /* 忽略 */
  }
  return 'light';
}

export function playerCardLogoUrl(theme: PlayerCardTheme): string {
  return theme === 'dark' ? '/assets/logo-white.webp' : '/assets/logo-black.webp';
}
