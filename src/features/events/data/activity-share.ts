// M-073：分享當前活動分類網址，照 A `js/modules/event/event-list-helpers.js:672-692`（`_composeActivityRoutePath`／`_getCurrentActivityShareUrl`／`_getActivityShareOrigin`）
// 與 A `app.js:1661-1676`（`_copyToClipboard`）。
// 說明：ActivitiesPage 內已有的 helper（normalizeActivityUrlRegion 等）為避免撞到其他派工單暫不共用，這裡自帶一份正規化邏輯（資料同源）。
import { normalizeActiveSport } from '@/core/sport-filter';

export const SHARE_TITLE = 'ToosterX 活動';
export const SHARED_TOAST_OK = '分享連結已複製';
export const SHARED_TOAST_FAIL = '複製失敗，請手動複製';
export const NEARBY_DISABLED_MSG = '附近活動地圖尚未開啟';
export const SHARE_ORIGIN = 'https://toosterx.com';
export const SHARE_BASE_PATH = '/activities';

const REGION_SLUGS: Readonly<Record<string, string>> = {
  all: '全部',
  north: '北部',
  central: '中部',
  south: '南部',
  'east-islands': '東部&外島',
};

const ACTIVITY_URL_TYPES = ['play', 'camp', 'watch', 'external'] as const;

export interface ActivityShareFilters {
  region: string;
  sport: string;
  tab: string;
  type: string;
}

// 照 A `_normalizeActivityUrlRegion`
export function normalizeShareRegion(value: string | null | undefined): string {
  const raw = String(value ?? '').trim().replace(/&amp;/g, '&');
  if (!raw) return '全部';
  const lower = raw.toLowerCase();
  const bySlug = REGION_SLUGS[lower];
  if (bySlug) return bySlug;
  return Object.values(REGION_SLUGS).includes(raw) ? raw : '全部';
}

// 照 A `_getActivityRegionSlug`
export function getShareRegionSlug(region: string): string {
  const normalized = normalizeShareRegion(region);
  const found = Object.entries(REGION_SLUGS).find(([, label]) => label === normalized);
  return found ? found[0] : 'all';
}

// 照 A `_normalizeActivityUrlType`
export function normalizeShareType(value: string): string {
  const raw = String(value ?? '').trim();
  return (ACTIVITY_URL_TYPES as readonly string[]).includes(raw) ? raw : '';
}

// 照 A `_normalizeActivityTab`（hidden tab 收斂回 normal）；calendar 照原值保留
export function normalizeShareTab(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw === 'ended') return 'normal';
  return raw;
}

// 照 A `_composeActivityRoutePath`（preserveExisting: false，不帶既有 query）
export function composeActivityRoutePath(
  filters: ActivityShareFilters,
  basePath: string = SHARE_BASE_PATH,
): string {
  const region = normalizeShareRegion(filters.region);
  const sport = normalizeActiveSport(filters.sport || 'all') || 'all';
  const tab = normalizeShareTab(filters.tab);
  const type = normalizeShareType(filters.type);

  const hasSharedFilter =
    region !== '全部' || sport !== 'all' || tab !== 'normal' || !!type;

  const params = new URLSearchParams();
  if (hasSharedFilter) {
    params.set('region', getShareRegionSlug(region));
    params.set('sport', sport);
    if (tab !== 'normal') params.set('tab', tab);
    if (type) params.set('type', type);
  }
  const query = params.toString();
  return (basePath || SHARE_BASE_PATH) + (query ? '?' + query : '');
}

// 照 A `_getActivityShareOrigin`：本地開發用當前 origin，其他一律 toosterx.com
export function getActivityShareOrigin(): string {
  try {
    if (typeof window === 'undefined') return SHARE_ORIGIN;
    const loc = window.location;
    const host = String(loc?.hostname || '').toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return loc?.origin || SHARE_ORIGIN;
    }
    return SHARE_ORIGIN;
  } catch {
    return SHARE_ORIGIN;
  }
}

// 照 A `_getCurrentActivityShareUrl`
export function getCurrentActivityShareUrl(filters: ActivityShareFilters): string {
  const path = composeActivityRoutePath(filters);
  return new URL(path, getActivityShareOrigin()).toString();
}

// 照 A `_copyToClipboard`
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    try {
      ta.select();
      // B 改良：A 不看回傳值一律當成功；回傳 false 時改顯示 A 的「複製失敗，請手動複製」。
      return Boolean(document.execCommand('copy'));
    } finally {
      document.body.removeChild(ta);
    }
  } catch {
    return false;
  }
}

export type ShowToastFn = (message: string) => void;

// 照 A `shareCurrentActivityUrl`：先系統分享，AbortError 結束、其他錯誤改走複製；無 navigator.share 直接複製
export async function shareCurrentActivityUrl(
  filters: ActivityShareFilters,
  options: { showToast?: ShowToastFn } = {},
): Promise<boolean> {
  const url = getCurrentActivityShareUrl(filters);

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: SHARE_TITLE, url });
      return true;
    } catch (err) {
      const name = (() => {
        if (err && typeof err === 'object' && 'name' in err) {
          const raw = (err as { name?: unknown }).name;
          return typeof raw === 'string' ? raw : '';
        }
        return '';
      })();
      if (name === 'AbortError') return false;
      // 其他錯誤 fall through 到複製
    }
  }

  const ok = await copyToClipboard(url);
  options.showToast?.(ok ? SHARED_TOAST_OK : SHARED_TOAST_FAIL);
  return ok;
}
