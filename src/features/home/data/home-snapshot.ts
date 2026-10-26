/**
 * 首頁首屏的本機快照（T-042，A5 擴大版）：橫幅清單（含第一張圖網址）＋運動分類統計。
 *
 * 目的：回訪（暖啟動）時第一次 render 就能畫出橫幅文字與運動入口，不必等 Firestore；背景照常向伺服器更新後再換。
 * 刻意獨立於 `events-snapshot-cache`（那份掛在登入帳號底下、要等登入確認才能用）。
 *
 * 帳號語意（顧問裁定，P1-1 採 A）：**快照為訪客視角的公開資料，沒有帳號歸屬可言；登入者的最終畫面一律以正式資料取代快照。**
 * 因為只放訪客可見的資料，所以不需要、也不看登入狀態；換帳號、登出都不需要清。這個保證由「寫入守門」提供，不靠讀取時比對帳號：
 * - 寫入函式的簽章只收兩種型別——`GuestSportRows`（只能由 `computeGuestSportRows()` 產生）與 `PublicBannerList`
 *   （只能由 `toPublicBanners()` 的白名單映射產生）；其他來源編譯不過，執行期也拒絕沒登記過的輸入。
 * - 橫幅：banners 集合本來就是公開讀取，欄位只留畫面用得到的（不含 Timestamp 等無法 JSON 還原的欄位）；
 *   圖片與連結再過白名單。A 的橫幅沒有時間區間（只看 status === 'active'，見 `banners.ts#isHomeCarouselBanner`），所以不需要保存排程。
 * - 運動統計：用訪客視角算（不含私密／俱樂部限定／黑名單判斷），不帶任何帳號資料。
 * - 已知且已接受：被某活動黑名單擋住的登入者，在活動讀回之前會短暫看到訪客視角的統計（與 T-041 P3-4 同一件事）。
 *
 * 新鮮度守門（顧問 2026-10-26 加的第四條原則）：每段快照都帶 `appVersion` 與 `savedAt`；
 * 讀取時版本和 `APP_VERSION` 不同、或寫入超過 30 分鐘（沿用 A 的 `publicBootSnapshotMaxAgeMs` 語意），
 * 一律視為沒有快照——畫面維持原本的骨架／空白，**不拿舊資料顯示任何活動狀態文字**（例如「N 活動」）。
 * 讀取結果帶 `expiresAt`（寫入時間＋30 分鐘），頁面掛載後要自己在到期時撤掉（見 `use-snapshot-expiry.ts`），
 * 不能只在第一次讀取時檢查。
 *
 * 只有「確認向伺服器新取得」的資料才可以寫快照／更新 `savedAt`（呼叫端以 Firestore 的 `fromCache === false` 判斷）；
 * 快照只是「先畫一版」，不取代也不跳過背景更新，所以不假設 Firestore 有離線快取（降級與否都不影響這份 localStorage）。
 * 兩段各有自己的 key 和時間戳，避免只更新其中一段時把另一段的舊資料重新蓋成「剛寫入」。
 *
 * 讀寫失敗（私密模式、容量滿、被停用）一律忽略，退回等伺服器。
 */
import { SPORTS } from '@/features/events/data/sports';
import { APP_VERSION } from '@/version';
import { safeBannerGradient, safeBannerLinkUrl, sanitizeHttpUrl, type BannerDoc } from './banners';
import { isGuestSportRows, type GuestSportRows, type SportRow } from './sport-rows';

export const BANNERS_SNAPSHOT_KEY = 'fcb:home-banners:v1';
export const SPORTS_SNAPSHOT_KEY = 'fcb:home-sports:v1';
export const HOME_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
/** 單段快照字數上限（LINE WebView 的 localStorage 額度小）；寫入超過就不存並刪掉舊的，讀取時超過也直接不用（解析前先擋）。 */
export const HOME_SNAPSHOT_MAX_CHARS = 100_000;
const MAX_ITEMS = 50;
/** 允許的時鐘偏差：寫入時間比現在晚超過這個值，視為不可信。 */
const FUTURE_SKEW_MS = 60_000;

interface StoredSection<T> {
  v: 1;
  appVersion: string;
  savedAt: number;
  items: T[];
}

/** 讀到的有效快照：`expiresAt`（毫秒時間戳）是寫入時間＋30 分鐘，到期後頁面要撤掉。 */
export interface SnapshotRead<T> {
  items: T[];
  expiresAt: number;
}

function isFresh(entry: Partial<StoredSection<unknown>>, nowMs: number): boolean {
  if (entry.v !== 1) return false;
  if (entry.appVersion !== APP_VERSION) return false;
  if (typeof entry.savedAt !== 'number' || !Number.isFinite(entry.savedAt)) return false;
  if (nowMs - entry.savedAt > HOME_SNAPSHOT_MAX_AGE_MS) return false;
  return entry.savedAt <= nowMs + FUTURE_SKEW_MS;
}

function readSection(key: string, nowMs: number): SnapshotRead<unknown> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > HOME_SNAPSHOT_MAX_CHARS) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSection<unknown>> | null;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) return null;
    if (!isFresh(parsed, nowMs)) return null;
    return {
      items: parsed.items.slice(0, MAX_ITEMS),
      expiresAt: (parsed.savedAt as number) + HOME_SNAPSHOT_MAX_AGE_MS,
    };
  } catch {
    return null;
  }
}

function removeSection(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

function writeSection(key: string, items: readonly unknown[], nowMs: number): void {
  if (items.length === 0) {
    removeSection(key);
    return;
  }
  try {
    const payload: StoredSection<unknown> = {
      v: 1,
      appVersion: APP_VERSION,
      savedAt: nowMs,
      items: [...items],
    };
    const text = JSON.stringify(payload);
    if (text.length > HOME_SNAPSHOT_MAX_CHARS) {
      removeSection(key);
      return;
    }
    localStorage.setItem(key, text);
  } catch {
    /* 容量滿或停用時不影響主流程 */
  }
}

function optString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * 橫幅白名單映射：只留首頁橫幅畫面用得到的欄位（不存 startAt／endAt 等時間欄位，那些可能是 Firestore Timestamp，JSON 還原不了），
 * 圖片只收 http/https、連結只收 http/https 或站內路徑、漸層只收單純 gradient(...)——寫入與讀取共用同一組檢查。
 */
function pickBanner(banner: BannerDoc): BannerDoc {
  return {
    id: banner.id,
    _docId: banner._docId,
    status: banner.status,
    type: banner.type,
    title: banner.title,
    subtitle: banner.subtitle,
    titleColor: banner.titleColor,
    subtitleColor: banner.subtitleColor,
    image: sanitizeHttpUrl(banner.image),
    linkUrl: safeBannerLinkUrl(banner.linkUrl),
    slotName: banner.slotName,
    slot: banner.slot,
    sortOrder: banner.sortOrder,
    gradient: safeBannerGradient(banner.gradient) || undefined,
  };
}

/**
 * 通過白名單映射的橫幅清單：**首屏快照唯一允許的橫幅寫入來源**，只能由 `toPublicBanners()` 產生。
 * `writeBannersSnapshot` 的簽章只收這個型別（編譯期），並在執行期檢查登記（防 `as` 強轉）。
 */
export type PublicBannerList = readonly BannerDoc[] & { readonly __publicBannerList: true };

const publicBannerLists = new WeakSet<object>();

export function toPublicBanners(banners: readonly BannerDoc[]): PublicBannerList {
  const list = Object.freeze(banners.map(pickBanner));
  publicBannerLists.add(list);
  return list as PublicBannerList;
}

function reviveBanner(raw: unknown): BannerDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const docId = typeof row._docId === 'string' ? row._docId.trim() : '';
  if (!id || !docId) return null;
  return {
    id,
    _docId: docId,
    // 存進快照的一定是通過 isHomeCarouselBanner 的 active 橫幅。
    status: 'active',
    type: optString(row.type),
    title: optString(row.title),
    subtitle: optString(row.subtitle),
    titleColor: optString(row.titleColor),
    subtitleColor: optString(row.subtitleColor),
    // 圖片與連結再過一次白名單，防止本機資料被竄改成 javascript: 等協定或任意字串。
    image: sanitizeHttpUrl(row.image),
    linkUrl: safeBannerLinkUrl(row.linkUrl),
    slotName: optString(row.slotName),
    slot: typeof row.slot === 'number' || typeof row.slot === 'string' ? row.slot : undefined,
    sortOrder:
      typeof row.sortOrder === 'number' || typeof row.sortOrder === 'string'
        ? row.sortOrder
        : undefined,
    // 漸層會寫進 inline style：只收單純的 gradient(...)，竄改過的內容丟掉改用預設底色。
    gradient: safeBannerGradient(row.gradient) || undefined,
  };
}

/** 讀橫幅快照：沒有、過期、版本不同或格式不符都回 null（畫面維持骨架）。 */
export function readBannersSnapshot(nowMs: number = Date.now()): SnapshotRead<BannerDoc> | null {
  const section = readSection(BANNERS_SNAPSHOT_KEY, nowMs);
  if (!section) return null;
  const items: BannerDoc[] = [];
  for (const item of section.items) {
    const banner = reviveBanner(item);
    if (banner) items.push(banner);
  }
  return items.length > 0 ? { items, expiresAt: section.expiresAt } : null;
}

/**
 * 寫橫幅快照；空清單代表「伺服器說目前沒有橫幅」，把舊快照刪掉。呼叫端只能在確認向伺服器新取得時呼叫。
 * 只收 `toPublicBanners()` 的輸出；沒登記過的輸入（型別被強轉繞過）在執行期也不寫。
 */
export function writeBannersSnapshot(banners: PublicBannerList, nowMs: number = Date.now()): void {
  if (!publicBannerLists.has(banners)) return;
  writeSection(BANNERS_SNAPSHOT_KEY, banners, nowMs);
}

/** 讀運動統計快照：沒有、過期、版本不同或格式不符都回 null；未知的運動 key 略過。 */
export function readSportsSnapshot(nowMs: number = Date.now()): SnapshotRead<SportRow> | null {
  const section = readSection(SPORTS_SNAPSHOT_KEY, nowMs);
  if (!section) return null;
  const items: SportRow[] = [];
  for (const item of section.items) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const sport = SPORTS.find((s) => s.key === row.key);
    const count = typeof row.count === 'number' && Number.isFinite(row.count) ? Math.floor(row.count) : 0;
    if (!sport || count <= 0) continue;
    items.push({ key: sport.key, label: sport.label, symbol: sport.symbol, count });
  }
  return items.length > 0 ? { items, expiresAt: section.expiresAt } : null;
}

/**
 * 寫運動統計快照（只存 key＋數量；標籤與符號讀取時由 SPORTS 還原）。呼叫端只能在確認向伺服器新取得時呼叫。
 * 只收 `computeGuestSportRows()` 的輸出（訪客可見計算）；沒登記過的輸入（型別被強轉繞過）在執行期也不寫。
 */
export function writeSportsSnapshot(rows: GuestSportRows, nowMs: number = Date.now()): void {
  if (!isGuestSportRows(rows)) return;
  writeSection(SPORTS_SNAPSHOT_KEY, rows.map((row) => ({ key: row.key, count: row.count })), nowMs);
}

/** 測試用。 */
export function _clearHomeSnapshotForTest(): void {
  removeSection(BANNERS_SNAPSHOT_KEY);
  removeSection(SPORTS_SNAPSHOT_KEY);
}
