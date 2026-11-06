/**
 * T-092 球員卡資料模型（純函式）：卡片 DOM 與 Canvas 產圖共用同一份，避免兩邊數字不一致。
 * 只吃頁面已載入的資料（attendance summary、viewer.teamIds、有效身分名字與頭像），不讀不寫 Firestore。
 */
import type { UserAttendanceSummary } from './attendance-summary';
import { resolvePlayerCardMotif, type PlayerCardMotif } from './player-card-motifs';

export type PlayerCardTheme = 'light' | 'dark';

export interface PlayerCardModel {
  /** 顯示名字；空白或等於 UID 時為 `-`（卡面與 PNG 不得出現 UID）。 */
  name: string;
  /** 沒有頭像（或頭像載入失敗）時畫的首字，DOM 與 PNG 一致；名字被遮掉時為 `?`。 */
  avatarInitial: string;
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
  /** 卡面右下身分圖案（player-card-motifs.ts）；null＝不畫。 */
  motif: PlayerCardMotif | null;
}

export interface PlayerCardModelInput {
  name: string;
  /** 本人 UID：只用來比對名字，不會放進模型。 */
  uid?: string | null;
  avatarUrl: string | null;
  summary: UserAttendanceSummary | null;
  teamIds?: Iterable<unknown> | null;
  /** 有效身分（resolveEffectiveRole 結果，隱身管理員已回 user）；決定身分圖案。 */
  role?: string | null;
  /** profile.gender；只認 trim 後等於「女」。 */
  gender?: unknown;
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

/**
 * 卡面名字：getMainIdentity 在使用者沒有 displayName／name 時會退回 UID 當名字（A 舊行為，不改），
 * 球員卡與 PNG 不得印出 UID，所以名字等於 UID（前後空白不計）或空白時一律顯示 `-`；
 * 名字是資料層預設的 'Unknown'（不分大小寫、前後空白不計）也同樣顯示 `-`。
 */
/** 資料層（profile-model.ts mapUserProfileDoc）缺名字時補的預設值。 */
const PROFILE_UNKNOWN_NAME = 'Unknown';

export function resolvePlayerCardName(name: unknown, uid?: string | null): string {
  const text = typeof name === 'string' ? name.trim() : '';
  if (!text || text === '-') return '-';
  // profile-model.ts mapUserProfileDoc：users 文件沒有 displayName／name 時資料層補 'Unknown'，不是真名。
  if (text.toLowerCase() === PROFILE_UNKNOWN_NAME.toLowerCase()) return '-';
  const cleanUid = typeof uid === 'string' ? uid.trim() : '';
  if (cleanUid && text === cleanUid) return '-';
  return text;
}

export function buildPlayerCardModel(input: PlayerCardModelInput): PlayerCardModel {
  const summary = input.summary;
  const name = resolvePlayerCardName(input.name, input.uid);
  const attendRate = summary ? roundAttendRate(summary.attendRate) : null;
  const clubCount = countActiveClubs(input.teamIds);
  return {
    name,
    avatarInitial: name === '-' ? '?' : name.charAt(0),
    avatarUrl: input.avatarUrl,
    attendRate,
    attendText: attendRate === null ? '--' : `${attendRate}%`,
    scheduledText: summary ? String(toCount(summary.expectedCount)) : '--',
    completedText: summary ? String(toCount(summary.completedCount)) : '--',
    gaugeRatio: attendRate === null ? 0 : attendRate / 100,
    clubCount,
    showClubBadge: clubCount > 0,
    clubBadgeWide: clubCount >= 10,
    motif: resolvePlayerCardMotif(input.role, input.gender),
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
  /** PNG 左下 QR 的 quiet zone 底色與碼色（只在 PNG，網頁卡面不畫 QR）。 */
  qrBg: string;
  qrFg: string;
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
    qrBg: '#FFFFFF',
    qrFg: '#412402',
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
    qrBg: '#FAEEDA',
    qrFg: '#2C2C2A',
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

/**
 * 網頁卡面退路倍率：不支援容器查詢單位（cqw）的瀏覽器以 220×324 ×1.1＝242×356 顯示（player-card.css 的 --pcu 預設值）。
 * 支援的瀏覽器改依容器寬度等比例縮放（--pcu＝卡寬／220，桌機上限 360px）；取代原本固定 1.1 倍（站長 11-06 要求卡片放大）。
 */
export const PLAYER_CARD_DOM_SCALE = 1.1;

export interface PlayerCardShineStop {
  /** 沿 CSS 漸層線的位置 0～1（＝CSS 百分比 / 100）。 */
  at: number;
  color: string;
}

export type PlayerCardShineBlend = 'normal' | 'soft-light';

export interface PlayerCardShineLayer {
  /** 網頁 mix-blend-mode／Canvas globalCompositeOperation（normal＝source-over）。 */
  blend: PlayerCardShineBlend;
  stops: readonly PlayerCardShineStop[];
}

export type PlayerCardShineFace = 'front' | 'back';

/**
 * 固定斜光唯一參數來源：PNG（player-card-canvas.ts drawShine）與網頁卡面（PlayerCard.tsx 的 .player-card-shine）都由這裡推導，
 * 兩邊角度、停點、強度、疊加方式完全相同；網頁不做動畫。
 * 取代 11-05 先前 20.3° 柔光帶（from／to＋bandStart／bandEnd 那一套），改回站長預覽的 115deg 雙層光；淺色 alpha 減半為站長要求。
 * - 角度：CSS linear-gradient 115deg，漸層線通過卡面中心、長度依 CSS 規範 L＝|w·sinθ|＋|h·cosθ|，停點為該線上的百分比。
 * - 淺色正面兩層：①金白高光帶（soft-light 疊加）＋②奶白柔光（一般疊加）；淺色背面只有第②層。
 *   預覽原值 ①.75／.85／.75、②.45，站長 11-05 要求淺色再淡 50%，全部 alpha ×0.5。
 * - 深色正背面同一層白光（預覽原值不變）。
 * - 預覽的 `transparent` 一律寫成相鄰顏色的 alpha 0：CSS 以預乘 alpha 內插兩者看起來相同，
 *   Canvas 部分瀏覽器不預乘、用透明黑會在光帶兩側拉出灰邊。
 */
const SHINE_LIGHT_SOFT: PlayerCardShineLayer = {
  blend: 'soft-light',
  stops: [
    { at: 0.38, color: 'rgba(255, 236, 190, 0)' },
    { at: 0.42, color: 'rgba(255, 236, 190, 0)' },
    { at: 0.49, color: 'rgba(255, 241, 205, 0.375)' },
    { at: 0.5, color: 'rgba(255, 255, 240, 0.425)' },
    { at: 0.51, color: 'rgba(255, 241, 205, 0.375)' },
    { at: 0.58, color: 'rgba(255, 236, 190, 0)' },
    { at: 0.62, color: 'rgba(255, 236, 190, 0)' },
  ],
};

const SHINE_LIGHT_GLOW: PlayerCardShineLayer = {
  blend: 'normal',
  stops: [
    { at: 0.44, color: 'rgba(255, 250, 232, 0)' },
    { at: 0.5, color: 'rgba(255, 250, 232, 0.225)' },
    { at: 0.56, color: 'rgba(255, 250, 232, 0)' },
  ],
};

const SHINE_DARK: PlayerCardShineLayer = {
  blend: 'normal',
  stops: [
    { at: 0.42, color: 'rgba(255, 255, 255, 0)' },
    { at: 0.49, color: 'rgba(255, 255, 255, 0.14)' },
    { at: 0.5, color: 'rgba(255, 255, 255, 0.2)' },
    { at: 0.51, color: 'rgba(255, 255, 255, 0.14)' },
    { at: 0.58, color: 'rgba(255, 255, 255, 0)' },
  ],
};

export const PLAYER_CARD_SHINE = {
  /** CSS linear-gradient 角度（0deg 朝上、順時針）。 */
  angleDeg: 115,
  /** 由下往上疊：陣列前面的先畫。 */
  layers: {
    light: { front: [SHINE_LIGHT_SOFT, SHINE_LIGHT_GLOW], back: [SHINE_LIGHT_GLOW] },
    dark: { front: [SHINE_DARK], back: [SHINE_DARK] },
  } as Record<PlayerCardTheme, Record<PlayerCardShineFace, readonly PlayerCardShineLayer[]>>,
} as const;

/** 某主題某一面的光層（PNG 只畫正面）。 */
export function playerCardShineLayers(
  theme: PlayerCardTheme,
  face: PlayerCardShineFace = 'front',
): readonly PlayerCardShineLayer[] {
  return PLAYER_CARD_SHINE.layers[theme][face];
}

export interface PlayerCardShineGeometry {
  /** CSS 漸層角度（度）。 */
  angleDeg: number;
  /** CSS 規範漸層線長度 L＝|w·sinθ|＋|h·cosθ|。 */
  length: number;
  /** 漸層線起點（0%）與終點（100%），通過卡面中心。 */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 依 CSS linear-gradient 規範把 115deg 換成 Canvas createLinearGradient 的起訖點（預設卡面原始尺寸）。 */
export function playerCardShineGeometry(
  width: number = PLAYER_CARD_SIZE.width,
  height: number = PLAYER_CARD_SIZE.height,
): PlayerCardShineGeometry {
  const rad = (PLAYER_CARD_SHINE.angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad); // 螢幕座標 y 向下
  const length = Math.abs(width * Math.sin(rad)) + Math.abs(height * Math.cos(rad));
  const cx = width / 2;
  const cy = height / 2;
  const half = length / 2;
  return {
    angleDeg: PLAYER_CARD_SHINE.angleDeg,
    length,
    x0: cx - dx * half,
    y0: cy - dy * half,
    x1: cx + dx * half,
    y1: cy + dy * half,
  };
}

/** Canvas 漸層停點：與 CSS 同一組百分比（CSS 首尾停點之外延伸首尾色，Canvas 行為相同）。 */
export function playerCardShineCanvasStops(layer: PlayerCardShineLayer): Array<[number, string]> {
  return layer.stops.map((stop) => [stop.at, stop.color]);
}

/** 網頁光層背景：`linear-gradient(115deg, …)`，停點百分比與 Canvas 相同。 */
export function playerCardShineCssGradient(layer: PlayerCardShineLayer): string {
  const parts = layer.stops.map((stop) => `${stop.color} ${+(stop.at * 100).toFixed(3)}%`);
  return `linear-gradient(${PLAYER_CARD_SHINE.angleDeg}deg, ${parts.join(', ')})`;
}

export function playerCardLogoUrl(theme: PlayerCardTheme): string {
  return theme === 'dark' ? '/assets/logo-white.webp' : '/assets/logo-black.webp';
}
