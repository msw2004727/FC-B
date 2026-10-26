// Firestore SDK 只在查詢當下動態載入（T-041 A2）：HomeBannerCarousel 只用到本檔的純函式，
// 靜態 import SDK 會讓首頁路由的靜態相依多帶約 160 KB gz。
import type { DocumentData, Firestore } from 'firebase/firestore';
import { loadFirestoreSdk } from '@/data/firestore-sdk';
import { getFirebase as defaultGetFirebase } from '@/data/firebase';

export const BANNERS_COLLECTION = 'banners';

export interface BannerDoc {
  id: string;
  _docId: string;
  status: string;
  type?: string;
  title?: string;
  subtitle?: string;
  titleColor?: string;
  subtitleColor?: string;
  image?: string;
  linkUrl?: string;
  slotName?: string;
  slot?: number | string;
  sortOrder?: number | string;
  gradient?: string;
  startAt?: unknown;
  endAt?: unknown;
  publishAt?: unknown;
  unpublishAt?: unknown;
}

export interface BannerDeps {
  getFirebase?: () => Promise<{ db: Firestore }>;
  logger?: { warn: (...args: unknown[]) => void };
  now?: () => number;
  /**
   * 讀取成功時呼叫（回傳前；失敗不會呼叫，失敗仍回傳空陣列）。`fromCache === false` 才是「確認向伺服器新取得」，
   * 呼叫端可以拿來更新首屏快照的新鮮度，並藉此分辨「查詢失敗（沒有回報）」和「伺服器確認真的沒有橫幅（回報 false 且清單為空）」；
   * `true`（離線時的持久快取）或 `undefined`（讀不到 metadata）都不算。callback 丟錯會被吞掉，不影響回傳。
   */
  onResult?: (meta: { fromCache: boolean | undefined }) => void;
}

/** 呼叫端提供的通知 callback 丟錯不能破壞 loadActiveBanners 的契約（成功回橫幅）。 */
function notifyCallback(call: () => void): void {
  try {
    call();
  } catch {
    /* 忽略 */
  }
}

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return 0;
    const slash = raw.match(
      /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
    );
    if (slash) {
      return new Date(
        Number(slash[1]),
        Number(slash[2]) - 1,
        Number(slash[3]),
        Number(slash[4] || 0),
        Number(slash[5] || 0),
        Number(slash[6] || 0),
      ).getTime();
    }
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object') {
    const v = value as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
      nanoseconds?: number;
      _nanoseconds?: number;
    };
    if (typeof v.toMillis === 'function') {
      try {
        return v.toMillis();
      } catch {
        return 0;
      }
    }
    if (typeof v.toDate === 'function') {
      try {
        const d = v.toDate();
        return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
      } catch {
        return 0;
      }
    }
    const sec = typeof v.seconds === 'number' ? v.seconds : v._seconds;
    if (typeof sec === 'number' && Number.isFinite(sec)) {
      const nano = typeof v.nanoseconds === 'number' ? v.nanoseconds : (v._nanoseconds ?? 0);
      return sec * 1000 + Math.floor(nano / 1_000_000);
    }
  }
  return 0;
}

/** 只接受 http/https，防止 javascript: 等協定注入（且不附帶任何 UID，遵守 R-SHARE-013）。 */
export function sanitizeHttpUrl(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : '';
}

/**
 * 橫幅連結白名單——**儲存（首屏快照）與使用（輪播點擊開啟）共用同一個契約**：只收 http/https，
 * 不含控制字元、長度上限 2000。其他（`javascript:`、`data:`、`//…`、站內路徑、相對網址、任意字串）一律回空字串。
 * 契約以上線版輪播實際能開啟的連結為準（a924c7b 的 `sanitizeHttpUrl`＋`window.open`，只支援 http/https）；
 * 顧問提到的「站內路徑」是上限、不是要求新增行為，所以快照不收站內路徑（收了也沒有 handler 能開，會變成存了用不到的字串）。
 */
export function safeBannerLinkUrl(value: unknown): string {
  const raw = sanitizeHttpUrl(value);
  if (!raw || raw.length > 2000 || /[\u0000-\u001f\u007f]/.test(raw)) return '';
  return raw;
}

export function safeBannerColor(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
}

// 漸層文法（只收這些，其餘一律不收）：
//   linear-gradient( [方向或角度,]? 色標, 色標 [, 色標…] )
//   方向：單一方向（`to top|bottom|left|right`），或角落（一個水平加一個垂直：`to top left`、`to left top`，不收 `to top bottom`、`to top top`），
//         或角度（數字加 deg／grad／rad／turn）
//   色標：顏色 [位置[ 位置]]；位置＝數字加 % 或 px；顏色是下列之一——
//         #hex（剛好 3、4、6 或 8 碼）、rgb()／rgba()（三個 0～255 或百分比數字＋選用的 alpha；逗號式或空白加斜線式）、
//         hsl()／hsla()（色相＋兩個百分比＋選用的 alpha；逗號式或空白加斜線式）、純英文色名
const NUM = '(?:\\d+\\.?\\d*|\\.\\d+)';
const GRADIENT_DIRECTION_KEYWORD = /^to\s+(top|bottom|left|right)(?:\s+(top|bottom|left|right))?$/i;
const GRADIENT_ANGLE = new RegExp(`^-?${NUM}(?:deg|grad|rad|turn)$`, 'i');
const RGB_CHANNEL = `${NUM}%?`;
const COLOR_ALPHA = `${NUM}%?`;
const GRADIENT_COLOR = [
  '#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})',
  `rgba?\\(\\s*${RGB_CHANNEL}\\s*,\\s*${RGB_CHANNEL}\\s*,\\s*${RGB_CHANNEL}\\s*(?:,\\s*${COLOR_ALPHA}\\s*)?\\)`,
  `rgba?\\(\\s*${RGB_CHANNEL}\\s+${RGB_CHANNEL}\\s+${RGB_CHANNEL}\\s*(?:/\\s*${COLOR_ALPHA}\\s*)?\\)`,
  `hsla?\\(\\s*-?${NUM}(?:deg|rad|grad|turn)?\\s*,\\s*${NUM}%\\s*,\\s*${NUM}%\\s*(?:,\\s*${COLOR_ALPHA}\\s*)?\\)`,
  `hsla?\\(\\s*-?${NUM}(?:deg|rad|grad|turn)?\\s+${NUM}%\\s+${NUM}%\\s*(?:/\\s*${COLOR_ALPHA}\\s*)?\\)`,
  '[a-z]{3,20}',
].join('|');
const GRADIENT_POSITION = `-?${NUM}(?:%|px)`;
const GRADIENT_STOP = new RegExp(`^(?:${GRADIENT_COLOR})(?:\\s+${GRADIENT_POSITION}){0,2}$`, 'i');
const GRADIENT_MAX_ARGS = 12;

/** 漸層的第一個參數是不是合法的方向或角度（`to top bottom`、`to left right`、`to top top` 這類無效組合不收）。 */
function isGradientDirection(arg: string): boolean {
  if (GRADIENT_ANGLE.test(arg)) return true;
  const m = GRADIENT_DIRECTION_KEYWORD.exec(arg);
  if (!m) return false;
  const first = (m[1] ?? '').toLowerCase();
  const second = (m[2] ?? '').toLowerCase();
  if (!second) return true;
  const horizontal = (side: string): boolean => side === 'left' || side === 'right';
  return horizontal(first) !== horizontal(second);
}

/** 在最外層（括號深度 0）依逗號切開；括號不平衡（含提早閉合）回 null。 */
function splitTopLevelArgs(inner: string): string[] | null {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return null;
    } else if (ch === ',' && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (depth !== 0) return null;
  args.push(inner.slice(start).trim());
  return args;
}

/**
 * 橫幅漸層底色要寫進 inline style，只接受**單一** `linear-gradient(...)`，且括號平衡、內容符合上面的文法：
 * 顏色（色碼／rgb(a)／hsl(a)／英文色名）、位置（% 或 px）、方向或角度。`url(`、`var(`、分號、引號、反斜線、註解、
 * 額外的背景層（例如 `linear-gradient(red,blue),var(--x)`）、radial／conic 一律不收（避免寫入額外 CSS 宣告或觸發額外資源請求）。
 * 不合格回空字串，呼叫端改用預設底色。
 */
export function safeBannerGradient(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 300) return '';
  const head = /^linear-gradient\(/i.exec(raw);
  if (!head || !raw.endsWith(')')) return '';
  const args = splitTopLevelArgs(raw.slice(head[0].length, -1));
  if (!args || args.length < 2 || args.length > GRADIENT_MAX_ARGS) return '';
  const stops = isGradientDirection(args[0] ?? '') ? args.slice(1) : args;
  if (stops.length < 2) return '';
  return stops.every((stop) => GRADIENT_STOP.test(stop)) ? raw : '';
}

/**
 * A `api-service.js#getBanners`＋`banner.js#renderBannerCarousel`：
 * 排除射門遊戲／觀賽／首頁資訊／版面設定這些特殊文件，再只留 status === 'active'。
 * A 沒有時間區間判斷，也沒有另外排序（順序＝查詢結果，即文件 ID 升冪）。
 */
const EXCLUDED_TYPES: ReadonlySet<string> = new Set(['shotgame', 'watchParty', 'homeInfo', 'homeLayout']);
const EXCLUDED_KEYS: ReadonlySet<string> = new Set(['home-info', 'home-layout']);

export function isHomeCarouselBanner(banner: BannerDoc | null | undefined): boolean {
  if (!banner) return false;
  const raw = banner as BannerDoc & { type?: unknown };
  if (EXCLUDED_TYPES.has(String(raw.type ?? ''))) return false;
  const slot = String(banner.slot ?? '');
  if (EXCLUDED_KEYS.has(slot) || EXCLUDED_KEYS.has(String(banner.id ?? '')) || EXCLUDED_KEYS.has(String(banner._docId ?? ''))) {
    return false;
  }
  return String(banner.status ?? '') === 'active';
}

export function filterAndSortBanners(banners: readonly BannerDoc[] | null | undefined): BannerDoc[] {
  if (!Array.isArray(banners)) return [];
  return banners.filter((b) => isHomeCarouselBanner(b));
}

function mapBannerDoc(docSnap: { id: string; data: () => DocumentData }): BannerDoc {
  const raw = (docSnap.data() ?? {}) as Record<string, unknown>;
  const id = String(raw.id ?? docSnap.id).trim() || docSnap.id;
  return {
    id,
    _docId: docSnap.id,
    status: String(raw.status ?? '').trim(),
    type: typeof raw.type === 'string' ? raw.type : undefined,
    title: typeof raw.title === 'string' ? raw.title : undefined,
    subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : undefined,
    titleColor: typeof raw.titleColor === 'string' ? raw.titleColor : undefined,
    subtitleColor: typeof raw.subtitleColor === 'string' ? raw.subtitleColor : undefined,
    image: sanitizeHttpUrl(raw.image),
    linkUrl: sanitizeHttpUrl(raw.linkUrl),
    slotName: typeof raw.slotName === 'string' ? raw.slotName : undefined,
    slot: typeof raw.slot === 'number' || typeof raw.slot === 'string' ? raw.slot : undefined,
    sortOrder:
      typeof raw.sortOrder === 'number' || typeof raw.sortOrder === 'string'
        ? raw.sortOrder
        : undefined,
    gradient: typeof raw.gradient === 'string' ? raw.gradient : undefined,
    startAt: raw.startAt,
    endAt: raw.endAt,
    publishAt: raw.publishAt,
    unpublishAt: raw.unpublishAt,
  };
}

export async function loadActiveBanners(deps: BannerDeps = {}): Promise<BannerDoc[]> {
  const getFB = deps.getFirebase ?? defaultGetFirebase;
  const logger = deps.logger ?? console;
  try {
    const [{ db }, { collection, getDocs, limit, query }] = await Promise.all([
      getFB(),
      loadFirestoreSdk(),
    ]);
    // A `_buildCollectionQuery`：banners 沒有特別排序，db.collection(name).limit(200)。
    const snap = await getDocs(query(collection(db, BANNERS_COLLECTION), limit(200)));
    const docs = snap.docs.map((d) => mapBannerDoc(d));
    const banners = filterAndSortBanners(docs);
    // 回報這份結果是不是「確認向伺服器新取得」：離線時 getDocs 會回持久快取（fromCache=true）；沒有 metadata（例如測試替身）回 undefined。
    notifyCallback(() => deps.onResult?.({ fromCache: (snap as { metadata?: { fromCache?: boolean } }).metadata?.fromCache }));
    return banners;
  } catch (err) {
    logger.warn('[banners] failed to load banners:', err);
    return [];
  }
}
