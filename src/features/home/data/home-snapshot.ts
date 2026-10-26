/**
 * 首頁首屏的本機快照（T-042，A5 擴大版）：橫幅清單（含第一張圖網址）＋運動分類統計。
 *
 * 目的：回訪（暖啟動）時第一次 render 就能畫出橫幅文字與運動入口，不必等 Firestore；背景照常向伺服器更新後再換。
 * 刻意獨立於 `events-snapshot-cache`（那份掛在登入帳號底下、要等登入確認才能用）：
 * 首屏快照只存「公開可見」資料，所以不需要、也不看登入狀態——
 * - 橫幅：banners 集合本來就是公開讀取，欄位只留畫面用得到的（不含 Timestamp 等無法 JSON 還原的欄位）。
 * - 運動統計：用訪客視角算（`computeGuestSportRows`，不含私密／俱樂部限定／黑名單判斷），不帶任何帳號資料。
 *   因為與帳號無關，換帳號、登出都不需要清；登入者拿到伺服器資料後照常改用自己的視角重算。
 *
 * 新鮮度守門（顧問 2026-10-26 加的第四條原則）：每段快照都帶 `appVersion` 與 `savedAt`；
 * 讀取時版本和 `APP_VERSION` 不同、或寫入超過 30 分鐘（沿用 A 的 `publicBootSnapshotMaxAgeMs` 語意），
 * 一律視為沒有快照——畫面維持原本的骨架／空白，**不拿舊資料顯示任何活動狀態文字**（例如「N 活動」）。
 *
 * 不做離線假設：快照只是「先畫一版」，不取代也不跳過背景更新；
 * 首頁每次開啟都照常向伺服器讀取（Firestore 是否降級成純記憶體快取，對這份 localStorage 快照沒有影響）。
 * 兩段各有自己的 key 和時間戳，避免只更新其中一段時把另一段的舊資料重新蓋成「剛寫入」。
 *
 * 讀寫失敗（私密模式、容量滿、被停用）一律忽略，退回等伺服器。
 */
import { SPORTS } from '@/features/events/data/sports';
import { APP_VERSION } from '@/version';
import { sanitizeHttpUrl, type BannerDoc } from './banners';
import type { SportRow } from './sport-rows';

export const BANNERS_SNAPSHOT_KEY = 'fcb:home-banners:v1';
export const SPORTS_SNAPSHOT_KEY = 'fcb:home-sports:v1';
export const HOME_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
/** 單段快照字數上限（LINE WebView 的 localStorage 額度小）；超過就不存並刪掉舊的。 */
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

function isFresh(entry: Partial<StoredSection<unknown>>, nowMs: number): boolean {
  if (entry.v !== 1) return false;
  if (entry.appVersion !== APP_VERSION) return false;
  if (typeof entry.savedAt !== 'number' || !Number.isFinite(entry.savedAt)) return false;
  if (nowMs - entry.savedAt > HOME_SNAPSHOT_MAX_AGE_MS) return false;
  return entry.savedAt <= nowMs + FUTURE_SKEW_MS;
}

function readSection(key: string, nowMs: number): unknown[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredSection<unknown>> | null;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) return [];
    if (!isFresh(parsed, nowMs)) return [];
    return parsed.items.slice(0, MAX_ITEMS);
  } catch {
    return [];
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

/** 只留首頁橫幅畫面用得到的欄位（不存 startAt／endAt 等時間欄位，那些可能是 Firestore Timestamp，JSON 還原不了）。 */
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
    image: banner.image,
    linkUrl: banner.linkUrl,
    slotName: banner.slotName,
    slot: banner.slot,
    sortOrder: banner.sortOrder,
    gradient: banner.gradient,
  };
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
    // 圖片與連結只接受 http/https，防止本機資料被竄改成 javascript: 等協定。
    image: sanitizeHttpUrl(row.image),
    linkUrl: sanitizeHttpUrl(row.linkUrl),
    slotName: optString(row.slotName),
    slot: typeof row.slot === 'number' || typeof row.slot === 'string' ? row.slot : undefined,
    sortOrder:
      typeof row.sortOrder === 'number' || typeof row.sortOrder === 'string'
        ? row.sortOrder
        : undefined,
    gradient: optString(row.gradient),
  };
}

/** 讀橫幅快照：沒有、過期、版本不同或格式不符都回空陣列。 */
export function readBannersSnapshot(nowMs: number = Date.now()): BannerDoc[] {
  const banners: BannerDoc[] = [];
  for (const item of readSection(BANNERS_SNAPSHOT_KEY, nowMs)) {
    const banner = reviveBanner(item);
    if (banner) banners.push(banner);
  }
  return banners;
}

/** 寫橫幅快照；空清單代表「伺服器說目前沒有橫幅」，把舊快照刪掉。 */
export function writeBannersSnapshot(
  banners: readonly BannerDoc[],
  nowMs: number = Date.now(),
): void {
  writeSection(BANNERS_SNAPSHOT_KEY, banners.map(pickBanner), nowMs);
}

/** 讀運動統計快照：沒有、過期、版本不同或格式不符都回空陣列；未知的運動 key 略過。 */
export function readSportsSnapshot(nowMs: number = Date.now()): SportRow[] {
  const rows: SportRow[] = [];
  for (const item of readSection(SPORTS_SNAPSHOT_KEY, nowMs)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const sport = SPORTS.find((s) => s.key === row.key);
    const count = typeof row.count === 'number' && Number.isFinite(row.count) ? Math.floor(row.count) : 0;
    if (!sport || count <= 0) continue;
    rows.push({ key: sport.key, label: sport.label, symbol: sport.symbol, count });
  }
  return rows;
}

/** 寫運動統計快照（只存 key＋數量；標籤與符號讀取時由 SPORTS 還原）。 */
export function writeSportsSnapshot(rows: readonly SportRow[], nowMs: number = Date.now()): void {
  writeSection(SPORTS_SNAPSHOT_KEY, rows.map((row) => ({ key: row.key, count: row.count })), nowMs);
}

/** 測試用。 */
export function _clearHomeSnapshotForTest(): void {
  removeSection(BANNERS_SNAPSHOT_KEY);
  removeSection(SPORTS_SNAPSHOT_KEY);
}
