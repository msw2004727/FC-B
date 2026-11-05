/**
 * T-092 球員卡資料模型（純函式）：卡片 DOM 與 Canvas 產圖共用同一份，避免兩邊數字不一致。
 * 只吃頁面已載入的資料（attendance summary、viewer.teamIds、有效身分名字與頭像），不讀不寫 Firestore。
 */
import type { UserAttendanceSummary } from './attendance-summary';

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
}

export interface PlayerCardModelInput {
  name: string;
  /** 本人 UID：只用來比對名字，不會放進模型。 */
  uid?: string | null;
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

/** 網頁卡面顯示倍率：卡面 220×324 以 242×356 顯示（player-card.css 的 .player-card 寬高）。 */
export const PLAYER_CARD_DOM_SCALE = 1.1;

export interface PlayerCardShineStop {
  /** 光帶內位置 0～1（沿光帶法線方向，0＝靠 from 端）。 */
  at: number;
  color: string;
}

/**
 * 固定斜光唯一參數來源：PNG（player-card-canvas.ts drawShine）與網頁卡面（PlayerCard.tsx 的 .player-card-shine）都由這裡推導，
 * 兩邊位置、角度、寬度、強度完全相同；網頁不做動畫（站長 11-05 定案，取代原本 3 秒掃光——那是另一套更寬更亮、角度不同的光）。
 * - 漸層方向 from→to（卡面座標），光帶佔該漸層的 bandStart～bandEnd。
 * - 光帶本身是斜線：與水平約 20.3 度、由左下往右上；寬約 55 單位。
 * - 深色：暖白光，峰值 0.22。
 * - 淺色：奶油底上白光對比低，改用「淡金暗邊＋白色高光」：兩側極淡金色暗邊（0.08）襯托中央白光（0.4），
 *   讓光帶看得出來但仍柔和（站長：淺色也要看得出反光；11-05 再要求淺色淡 50%，取代原 0.16／0.8）。
 */
export const PLAYER_CARD_SHINE = {
  from: { x: 30, y: 0 },
  to: { x: 150, y: 324 },
  bandStart: 0.42,
  bandEnd: 0.58,
  stops: {
    light: [
      { at: 0, color: 'rgba(186, 117, 23, 0)' },
      { at: 0.2, color: 'rgba(186, 117, 23, 0.08)' },
      { at: 0.5, color: 'rgba(255, 255, 255, 0.4)' },
      { at: 0.8, color: 'rgba(186, 117, 23, 0.08)' },
      { at: 1, color: 'rgba(186, 117, 23, 0)' },
    ],
    dark: [
      { at: 0, color: 'rgba(255, 248, 225, 0)' },
      { at: 0.5, color: 'rgba(255, 248, 225, 0.22)' },
      { at: 1, color: 'rgba(255, 248, 225, 0)' },
    ],
  } as Record<PlayerCardTheme, readonly PlayerCardShineStop[]>,
} as const;

export interface PlayerCardShineGeometry {
  /** 漸層（光帶法線）方向角度，從 x 軸順時針，度。 */
  normalDeg: number;
  /** 光帶本身與水平的夾角（左下往右上），度。 */
  bandAngleDeg: number;
  /** 光帶寬（卡面單位）。 */
  bandWidth: number;
  /** 光帶中心線沿法線方向相對卡面中心的位移（卡面單位）。 */
  offset: number;
  /** 光帶長邊需涵蓋的長度（卡面單位，卡面對角線）。 */
  length: number;
}

export function playerCardShineGeometry(): PlayerCardShineGeometry {
  const { from, to, bandStart, bandEnd } = PLAYER_CARD_SHINE;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const nx = dx / len;
  const ny = dy / len;
  const mid = (bandStart + bandEnd) / 2;
  const cx = PLAYER_CARD_SIZE.width / 2;
  const cy = PLAYER_CARD_SIZE.height / 2;
  const centerX = from.x + dx * mid;
  const centerY = from.y + dy * mid;
  const bandWidth = (bandEnd - bandStart) * len;
  const normalDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    normalDeg,
    bandAngleDeg: 90 - normalDeg,
    bandWidth,
    offset: (centerX - cx) * nx + (centerY - cy) * ny,
    length: Math.hypot(PLAYER_CARD_SIZE.width, PLAYER_CARD_SIZE.height),
  };
}

/** Canvas 漸層停點：光帶外透明，光帶內依主題停點。 */
export function playerCardShineCanvasStops(theme: PlayerCardTheme): Array<[number, string]> {
  const { bandStart, bandEnd } = PLAYER_CARD_SHINE;
  const stops = PLAYER_CARD_SHINE.stops[theme];
  const out: Array<[number, string]> = [[0, stops[0]!.color]];
  for (const stop of stops) out.push([bandStart + stop.at * (bandEnd - bandStart), stop.color]);
  out.push([1, stops[stops.length - 1]!.color]);
  return out;
}

/** 網頁光帶元素的背景：沿元素寬（＝法線方向）同一組停點。 */
export function playerCardShineCssGradient(theme: PlayerCardTheme): string {
  const parts = PLAYER_CARD_SHINE.stops[theme].map((stop) => `${stop.color} ${+(stop.at * 100).toFixed(3)}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

/** 網頁光帶 transform：以卡片中心為原點，轉到法線方向後沿法線平移到與 PNG 相同的位置。 */
export function playerCardShineTransform(): string {
  const g = playerCardShineGeometry();
  const px = +(g.offset * PLAYER_CARD_DOM_SCALE).toFixed(3);
  return `translate(-50%, -50%) rotate(${+g.normalDeg.toFixed(4)}deg) translateX(${px}px)`;
}

export function playerCardLogoUrl(theme: PlayerCardTheme): string {
  return theme === 'dark' ? '/assets/logo-white.webp' : '/assets/logo-black.webp';
}
