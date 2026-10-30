/**
 * 後台「首頁管理—Banner 廣告」的純函式模型（M-145）。
 * 對應 A `js/modules/ad-manage/ad-manage-banner.js`、`ad-manage-core.js`；
 * 時間字串一律用 `taipei-time`（台北牆鐘），不用裝置本地時區（A 的 `_formatDT` 是本地時區，B 刻意不同）。
 */
import { formatTaipei, parseTaipei } from '@/core/taipei-time';
import {
  EXCLUDED_KEYS,
  EXCLUDED_TYPES,
  safeBannerColor,
  safeBannerLinkUrl,
  sanitizeHttpUrl,
} from '@/features/home/data/banners';

/** A `hasPermission('admin.banners.entry')`：入口與所有寫入動作共用這一個碼（R-IAM-011）。 */
export const BANNER_PERMISSION = 'admin.banners.entry';

export type BannerStatus = 'active' | 'scheduled' | 'expired' | 'empty';

export interface BannerSlot {
  /** 公開 id（例 ban1）。 */
  id: string;
  /** Firestore 文件 id（寫入用）。 */
  docId: string;
  slot: string;
  slotName: string;
  title: string;
  subtitle: string;
  titleColor: string;
  subtitleColor: string;
  image: string;
  linkUrl: string;
  status: BannerStatus;
  /** `YYYY/MM/DD HH:mm`（台北牆鐘）；沒有為空字串。 */
  publishAt: string;
  unpublishAt: string;
  clicks: number;
}

export const DEFAULT_TITLE_COLOR = '#ffffff';
export const DEFAULT_SUBTITLE_COLOR = '#e5edf8';
export const SLOT_NAME_MAX = 12;
export const TITLE_MAX = 18;
export const SUBTITLE_MAX = 32;
const DAY_MS = 86_400_000;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 寫操作日誌時指向某個廣告位用的最小資料（寫入函式不需要整張卡）。 */
export type BannerRef = Pick<BannerSlot, 'docId' | 'id' | 'slot' | 'slotName'>;

/** 廣告位的顯示名稱：廣告位名稱，沒填就是「廣告位 {slot}」（A `renderBannerManage` 的卡片標題規則；日誌內容固定用中文，同 A）。 */
export function bannerLabel(ref: Pick<BannerSlot, 'slot' | 'slotName'>): string {
  return ref.slotName.trim() || `廣告位 ${ref.slot}`;
}

function normalizeStatus(value: unknown): BannerStatus {
  if (value === 'active' || value === 'scheduled' || value === 'empty') return value;
  return 'expired';
}

/**
 * 預覽／縮圖可以顯示的圖片來源：http(s) 網址，或裁切後還沒上傳的 `data:image/` 預覽；其他值（相對路徑、`javascript:` 等）不顯示。
 * 只影響顯示，儲存時 `image` 欄位維持原值。
 */
export function bannerImageSrc(value: string): string {
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(value)) return value;
  return sanitizeHttpUrl(value);
}

/**
 * 跳轉連結不可含的字元：空白、單雙引號、角括號、反引號、反斜線（F2）。
 * 原因：A 首頁輪播是 `onclick="…window.open('${escapeHTML(url)}'…"`，escapeHTML 的 `&#39;` 在屬性值裡會先被實體解碼成單引號，
 * 連結裡的 `'` 就能跳出字串；其餘字元同理一律不收。`safeBannerLinkUrl` 只擋 scheme 與控制字元，不擋這些。
 */
const LINK_UNSAFE_CHARS = /[\s'"<>`\\]/;

export function hasUnsafeLinkChars(url: string): boolean {
  return LINK_UNSAFE_CHARS.test(url);
}

/** 跳轉連結是否可以存：空字串可以；否則必須是 http(s) 且不含不安全字元。寫入層與表單共用。 */
export function isSavableLinkUrl(url: string): boolean {
  return url === '' || (!!safeBannerLinkUrl(url) && !hasUnsafeLinkChars(url));
}

/** A `ApiService.getBanners()`：排除射門遊戲／觀賽／首頁資訊／版面設定這些特殊文件。 */
export function isGeneralBannerDoc(docId: string, raw: Record<string, unknown>): boolean {
  if (EXCLUDED_TYPES.has(text(raw.type))) return false;
  const keys = [text(raw.slot), text(raw.id), docId];
  return !keys.some((key) => EXCLUDED_KEYS.has(key));
}

export function toBannerSlot(docId: string, raw: Record<string, unknown>): BannerSlot {
  const id = text(raw.id).trim() || docId;
  const clicks = Number(raw.clicks);
  return {
    id,
    docId,
    slot: typeof raw.slot === 'number' || typeof raw.slot === 'string' ? String(raw.slot) : '',
    slotName: text(raw.slotName),
    title: text(raw.title),
    subtitle: text(raw.subtitle),
    titleColor: safeBannerColor(raw.titleColor, DEFAULT_TITLE_COLOR),
    subtitleColor: safeBannerColor(raw.subtitleColor, DEFAULT_SUBTITLE_COLOR),
    // F12：保留原值（A 不動它，除非使用者換圖）；要顯示時才用 `bannerImageSrc` 過濾，不安全的值不會被洗成 null 寫回。
    image: text(raw.image),
    linkUrl: text(raw.linkUrl).trim(),
    status: normalizeStatus(raw.status),
    publishAt: text(raw.publishAt),
    unpublishAt: text(raw.unpublishAt),
    clicks: Number.isFinite(clicks) && clicks > 0 ? Math.floor(clicks) : 0,
  };
}

// ── 台北牆鐘 ↔ datetime-local ────────────────────────────

/** `YYYY/MM/DD HH:mm` → `<input type="datetime-local">` 的值；無法解析回空字串。 */
export function toDatetimeLocal(wallClock: string): string {
  const ms = parseTaipei(wallClock);
  return ms === null ? '' : formatTaipei(ms, 'YYYY-MM-DDTHH:mm');
}

/** `<input type="datetime-local">` 的值 → `YYYY/MM/DD HH:mm`；空或無法解析回 null。 */
export function fromDatetimeLocal(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const ms = parseTaipei(raw);
  return ms === null ? null : formatTaipei(ms, 'YYYY/MM/DD HH:mm');
}

/** A `_remainDays`：剩餘天數進位，最少 0；無法解析視為 0。 */
export function remainDays(unpublishAt: string, nowMs: number): number {
  const end = parseTaipei(unpublishAt);
  if (end === null) return 0;
  return Math.max(0, Math.ceil((end - nowMs) / DAY_MS));
}

// ── 卡片按鈕（A `_adActionBtns`，type='banner'）───────────

export type BannerCardAction = 'edit' | 'delist' | 'relist' | 'clear';

export function bannerCardActions(slot: BannerSlot, nowMs: number): BannerCardAction[] {
  if (slot.status === 'empty') return ['edit'];
  if (slot.status === 'active') return ['edit', 'delist', 'clear'];
  if (slot.status === 'scheduled') return ['edit', 'clear'];
  const canRelist = !slot.unpublishAt || remainDays(slot.unpublishAt, nowMs) > 0;
  return canRelist ? ['edit', 'relist', 'clear'] : ['edit', 'clear'];
}

// ── 表單驗證與儲存 payload ───────────────────────────────

export type BannerFormError =
  | 'titleTooLong'
  | 'subtitleTooLong'
  | 'slotNameRequired'
  | 'slotNameTooLong'
  | 'linkInvalid'
  | 'linkChars'
  | 'publishRequired'
  | 'timeInvalid'
  | 'endNotAfterNow'
  | 'endNotAfterStart';

export interface BannerFormInput {
  slotName: string;
  title: string;
  subtitle: string;
  titleColor: string;
  subtitleColor: string;
  linkUrl: string;
  mode: 'now' | 'scheduled';
  publishLocal: string;
  unpublishLocal: string;
  /** 已上傳的網址；尚未上傳的 data URL；或空字串（沒有圖片）。 */
  image: string;
}

/** 儲存時寫入的欄位（allowlist 見 banner-admin.ts 的 SAVE_FIELDS；不含 updatedAt，由寫入層加）。 */
export interface BannerSaveWrite {
  title: string;
  subtitle: string;
  titleColor: string;
  subtitleColor: string;
  slotName: string;
  linkUrl: string;
  image: string | null;
  publishAt: string;
  unpublishAt: string | null;
  status: 'active' | 'scheduled';
}

export type BannerSaveResult =
  | { ok: true; write: BannerSaveWrite }
  | { ok: false; error: BannerFormError };

/**
 * A `saveBanner` 的驗證與組裝（錯誤順序相同）。B 另加：連結必須是 http(s)（A 不驗證，但首頁輪播只會開 http/https，
 * 其他字串存進去也開不了，等於靜默失效）。
 */
export function buildBannerSave(input: BannerFormInput, nowMs: number): BannerSaveResult {
  const title = input.title.trim();
  const subtitle = input.subtitle.trim();
  const slotName = input.slotName.trim();
  if (title.length > TITLE_MAX) return { ok: false, error: 'titleTooLong' };
  if (subtitle.length > SUBTITLE_MAX) return { ok: false, error: 'subtitleTooLong' };
  if (!slotName) return { ok: false, error: 'slotNameRequired' };
  if (slotName.length > SLOT_NAME_MAX) return { ok: false, error: 'slotNameTooLong' };
  const linkUrl = input.linkUrl.trim();
  if (linkUrl && !safeBannerLinkUrl(linkUrl)) return { ok: false, error: 'linkInvalid' };
  if (linkUrl && hasUnsafeLinkChars(linkUrl)) return { ok: false, error: 'linkChars' };

  let unpublishAt: string | null = null;
  if (input.unpublishLocal.trim()) {
    unpublishAt = fromDatetimeLocal(input.unpublishLocal);
    if (unpublishAt === null) return { ok: false, error: 'timeInvalid' };
  }
  let publishAt: string;
  let status: 'active' | 'scheduled';
  if (input.mode === 'scheduled') {
    if (!input.publishLocal.trim()) return { ok: false, error: 'publishRequired' };
    const parsed = fromDatetimeLocal(input.publishLocal);
    if (parsed === null) return { ok: false, error: 'timeInvalid' };
    publishAt = parsed;
    status = 'scheduled';
  } else {
    publishAt = formatTaipei(nowMs, 'YYYY/MM/DD HH:mm');
    status = 'active';
  }
  // F5（B 進化項，A 沒有）：結束時間不得 ≤ 現在、也不得 ≤ 開始時間。否則存下去就是剛上架馬上被惰性轉換下架。
  if (unpublishAt !== null) {
    const endMs = parseTaipei(unpublishAt);
    const startMs = parseTaipei(publishAt);
    if (endMs === null || startMs === null) return { ok: false, error: 'timeInvalid' };
    if (endMs <= nowMs) return { ok: false, error: 'endNotAfterNow' };
    if (endMs <= startMs) return { ok: false, error: 'endNotAfterStart' };
  }
  return {
    ok: true,
    write: {
      title,
      subtitle,
      titleColor: safeBannerColor(input.titleColor, DEFAULT_TITLE_COLOR),
      subtitleColor: safeBannerColor(input.subtitleColor, DEFAULT_SUBTITLE_COLOR),
      slotName,
      linkUrl,
      image: input.image ? input.image : null,
      publishAt,
      unpublishAt,
      status,
    },
  };
}

// ── 惰性狀態轉換（D1 採 (b)）─────────────────────────────

export interface BannerTransition {
  docId: string;
  id: string;
  /** 日誌用的廣告位名稱（`bannerLabel`）。 */
  label: string;
  from: 'scheduled' | 'active';
  to: 'active' | 'expired';
  reason: 'publish_due' | 'unpublish_due';
  /** 判斷當下的時間字串；寫入時用來確認文件沒有被別人改過。 */
  publishAt: string;
  unpublishAt: string;
}

/**
 * 只看「現在」就能決定的轉換：
 * - `active`／`scheduled` 且 `unpublishAt <= 現在` → `expired`（優先；A `_autoExpireAds` 的語意）。
 * - `scheduled` 且 `publishAt <= 現在` → `active`（A 沒有，B 進化項）。
 * 恰好等於現在算到期。時間字串無法解析的一律不動（寧可不寫）。已經正確的狀態不會出現在結果裡（冪等）。
 */
export function planBannerTransitions(
  slots: readonly BannerSlot[],
  nowMs: number,
): BannerTransition[] {
  const result: BannerTransition[] = [];
  for (const slot of slots) {
    if (slot.status !== 'active' && slot.status !== 'scheduled') continue;
    const base = {
      docId: slot.docId,
      id: slot.id,
      label: bannerLabel(slot),
      from: slot.status,
      publishAt: slot.publishAt,
      unpublishAt: slot.unpublishAt,
    } as const;
    const end = slot.unpublishAt ? parseTaipei(slot.unpublishAt) : null;
    if (end !== null && end <= nowMs) {
      result.push({ ...base, to: 'expired', reason: 'unpublish_due' });
      continue;
    }
    if (slot.status === 'scheduled') {
      const start = slot.publishAt ? parseTaipei(slot.publishAt) : null;
      if (start !== null && start <= nowMs) {
        result.push({ ...base, to: 'active', reason: 'publish_due' });
      }
    }
  }
  return result;
}
