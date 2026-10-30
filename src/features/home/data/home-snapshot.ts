/**
 * 首頁首屏的本機快照（T-042，A5 擴大版）：橫幅清單（含第一張圖網址）＋運動分類統計。
 *
 * 目的：回訪（暖啟動）時第一次 render 就能畫出橫幅文字與運動入口，不必等 Firestore；背景照常向伺服器更新後再換。
 * 刻意獨立於 `events-snapshot-cache`（那份掛在登入帳號底下、要等登入確認才能用）。
 *
 * 帳號語意（顧問裁定，P1-1 採 A）：**快照為訪客視角的公開資料，沒有帳號歸屬可言；登入者的最終畫面一律以正式資料取代快照。**
 * 因為只放訪客可見的資料，所以不需要、也不看登入狀態；換帳號、登出都不需要清。這個保證由「寫入守門」提供，不靠讀取時比對帳號，
 * 守門分三道：
 * 1. 型別：寫入函式的簽章只收 `GuestSportRows`（只能由 `computeGuestSportRows()` 產生）與 `PublicBannerList`
 *    （只能由 `toPublicBanners()` 產生）；其他來源編譯不過，執行期也拒絕沒登記過的輸入。
 * 2. 凍結：上述兩種清單與裡面的每個元素都凍結，建構後不能再被改寫。
 * 3. **寫入當下逐欄重新投影**（`projectBanner`／`projectSportItem`）：序列化的唯一來源是「寫入當下重新建立的純量物件」，
 *    不直接序列化元素物件——每個欄位檢查型別與長度上限，連結／漸層用同一組驗證函式，巢狀物件與多餘欄位一律丟掉。
 *    讀取時也用同一個投影——這是格式與白名單驗證，**不是資料真實性驗證**：合法形狀的竄改內容（例如改過的標題文字）仍可能顯示。
 * - 橫幅：banners 集合本來就是公開讀取，欄位只留畫面用得到的（不含 Timestamp 等無法 JSON 還原的欄位）。
 *   A 的橫幅沒有時間區間（只看 status === 'active'，見 `banners.ts#isHomeCarouselBanner`），所以不需要保存排程。
 * - 運動統計：用訪客視角算（不含私密／俱樂部限定／黑名單判斷），不帶任何帳號資料。
 * - 已知且已接受：被某活動黑名單擋住的登入者，在活動讀回之前會短暫看到訪客視角的統計（與 T-041 P3-4 同一件事）。
 *
 * 新鮮度守門（顧問 2026-10-26 加的第四條原則）：每段快照都帶 `appVersion` 與 `savedAt`；
 * 讀取時版本和 `APP_VERSION` 不同、或寫入超過 30 分鐘（沿用 A 的 `publicBootSnapshotMaxAgeMs` 語意），
 * 一律視為沒有快照——畫面維持原本的骨架／空白，**不拿舊資料顯示任何活動狀態文字**（例如「N 活動」）。
 * 讀取結果帶 `expiresAt`（寫入時間＋30 分鐘），頁面掛載後要自己在到期時撤掉（見 `use-snapshot-expiry.ts`），
 * 選用快照當下也要再檢查一次期限，不能只在第一次讀取時檢查。
 *
 * 只有「確認向伺服器新取得」的資料才可以寫快照／更新 `savedAt`（呼叫端以 Firestore 的 `fromCache === false`，
 * 並且確定是這一次呼叫自己成功、沒有被較新的請求取代，來判斷）。
 *
 * 關於 `isFirebaseDegraded()`（設計判斷）：這份快照是 localStorage，與 Firestore 的快取（持久快取或降級後的純記憶體快取）完全獨立，
 * 也不假設 Firestore 有離線快取——有快照也永遠發背景讀取。降級（memory 快取）時 `fromCache` 的結果一樣不算新取得；
 * 「能不能更新新鮮度」只看這一次呼叫的來源 metadata（`fromCache === false`），不看降級旗標。所以快照路徑不讀 `isFirebaseDegraded()`
 * （降級與否都不會改變任何行為；`HomePage.snapshot.test.tsx` 的組合測試鎖住這點）。
 * 兩段各有自己的 key 和時間戳，避免只更新其中一段時把另一段的舊資料重新蓋成「剛寫入」。
 *
 * 讀寫失敗（私密模式、容量滿、被停用）一律忽略，退回等伺服器；寫入失敗時盡量刪掉舊的，免得留著比剛取得的資料還舊的快照。
 */
import { SPORTS } from '@/features/events/data/sports';
import { APP_VERSION } from '@/version';
import { isHomeCarouselBanner, safeBannerGradient, safeBannerLinkUrl, sanitizeHttpUrl, type BannerDoc } from './banners';
import { isGuestSportRows, type GuestSportRows, type SportRow } from './sport-rows';

export const BANNERS_SNAPSHOT_KEY = 'fcb:home-banners:v1';
export const SPORTS_SNAPSHOT_KEY = 'fcb:home-sports:v1';
export const HOME_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
/** 單段快照字數上限（LINE WebView 的 localStorage 額度小）；寫入超過就不存並刪掉舊的，讀取時超過也直接不用（解析前先擋）。 */
export const HOME_SNAPSHOT_MAX_CHARS = 100_000;
const MAX_ITEMS = 50;
/** 允許的時鐘偏差：寫入時間比現在晚超過這個值，視為不可信。 */
const FUTURE_SKEW_MS = 60_000;

/** 欄位長度上限（超過的欄位整個丟掉，不截斷）。 */
const MAX_ID_CHARS = 200;
const MAX_TITLE_CHARS = 500;
const MAX_SUBTITLE_CHARS = 1000;
const MAX_URL_CHARS = 2000;
const MAX_SHORT_CHARS = 100;
const MAX_SPORT_COUNT = 1_000_000;

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
    // 容量滿或停用：不影響主流程。盡量把舊的刪掉，免得留著比剛取得的資料還舊的快照（刪不掉就算了，舊的仍受自己的期限限制）。
    removeSection(key);
  }
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length <= max ? value : undefined;
}

function boundedScalar(value: unknown, max: number): string | number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return boundedString(value, max);
}

/**
 * 橫幅投影（白名單、純量）：寫入與讀取共用。每個欄位檢查型別與長度上限，沒通過的欄位丟掉（`id`／`_docId` 沒過則整筆丟掉）；
 * 巢狀物件、陣列、多餘欄位（uid、email、Timestamp 時間欄位…）一律不會出現在輸出。回傳的是新建的物件，不是輸入的任何參照。
 * 圖片只收 http/https、連結用 `safeBannerLinkUrl`（與輪播點擊同一個契約）、漸層用 `safeBannerGradient`。
 */
export function projectBanner(raw: unknown): BannerDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = boundedString(row.id, MAX_ID_CHARS)?.trim();
  const docId = boundedString(row._docId, MAX_ID_CHARS)?.trim();
  if (!id || !docId) return null;
  // 快照裡只會有通過 isHomeCarouselBanner 的 active 橫幅；欄位缺漏（舊格式）視為 active，其他狀態不收。
  if (row.status !== undefined && row.status !== 'active') return null;
  // 驗證函式內部會把輸入轉成字串（陣列、物件也會被轉），所以先確認是字串型別。
  const image = typeof row.image === 'string' ? sanitizeHttpUrl(row.image) : '';
  const titleColor = boundedString(row.titleColor, 7);
  const subtitleColor = boundedString(row.subtitleColor, 7);
  return {
    id,
    _docId: docId,
    status: 'active',
    type: boundedString(row.type, MAX_SHORT_CHARS),
    title: boundedString(row.title, MAX_TITLE_CHARS),
    subtitle: boundedString(row.subtitle, MAX_SUBTITLE_CHARS),
    titleColor: titleColor && /^#[0-9a-fA-F]{6}$/.test(titleColor) ? titleColor : undefined,
    subtitleColor: subtitleColor && /^#[0-9a-fA-F]{6}$/.test(subtitleColor) ? subtitleColor : undefined,
    image: image.length <= MAX_URL_CHARS ? image : '',
    linkUrl: typeof row.linkUrl === 'string' ? safeBannerLinkUrl(row.linkUrl) : '',
    slotName: boundedString(row.slotName, MAX_SHORT_CHARS),
    slot: boundedScalar(row.slot, MAX_SHORT_CHARS),
    sortOrder: boundedScalar(row.sortOrder, MAX_SHORT_CHARS),
    gradient: typeof row.gradient === 'string' ? safeBannerGradient(row.gradient) || undefined : undefined,
  };
}

/** 運動統計投影：key 必須是 SPORTS 內的運動，count 必須是 1～1,000,000 的整數；否則整筆丟掉。 */
export function projectSportItem(raw: unknown): { key: string; count: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const sport = SPORTS.find((s) => s.key === row.key);
  const count = row.count;
  if (!sport || typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_SPORT_COUNT) return null;
  return { key: sport.key, count };
}

/**
 * 通過白名單映射的橫幅清單：**首屏快照唯一允許的橫幅寫入來源**，只能由 `toPublicBanners()` 產生。
 * `writeBannersSnapshot` 的簽章只收這個型別（編譯期），並在執行期檢查登記（防 `as` 強轉）；
 * 清單與元素都已凍結，建構後不能被改寫。
 */
export type PublicBannerList = readonly BannerDoc[] & { readonly __publicBannerList: true };

const publicBannerLists = new WeakSet<object>();

export function toPublicBanners(banners: readonly BannerDoc[]): PublicBannerList {
  const items: BannerDoc[] = [];
  for (const banner of banners) {
    // 寫入端：正常輸入一律先通過首頁橫幅資格（active、排除射門遊戲／觀賽／首頁資訊／版面設定這些特殊文件）；
    // 缺 status 或不是 active 的不放行——「缺 status 視為 active」的相容只留在讀取端（舊格式）。
    if (!isHomeCarouselBanner(banner)) continue;
    const projected = projectBanner(banner);
    if (projected) items.push(Object.freeze(projected));
    if (items.length >= MAX_ITEMS) break;
  }
  const list = Object.freeze(items);
  publicBannerLists.add(list);
  return list as PublicBannerList;
}

/** 讀橫幅快照：沒有、過期、版本不同或格式不符都回 null（畫面維持骨架）。 */
export function readBannersSnapshot(nowMs: number = Date.now()): SnapshotRead<BannerDoc> | null {
  const section = readSection(BANNERS_SNAPSHOT_KEY, nowMs);
  if (!section) return null;
  const items: BannerDoc[] = [];
  for (const item of section.items) {
    const banner = projectBanner(item);
    // 讀取端相容舊格式（缺 status 視為 active），但特殊文件仍然要排除。
    if (banner && isHomeCarouselBanner(banner)) items.push(banner);
  }
  return items.length > 0 ? { items, expiresAt: section.expiresAt } : null;
}

/**
 * 寫橫幅快照；空清單代表「伺服器說目前沒有橫幅」，把舊快照刪掉。呼叫端只能在確認向伺服器新取得時呼叫。
 * 只收 `toPublicBanners()` 的輸出；沒登記過的輸入（型別被強轉繞過）在執行期也不寫。
 * 序列化的是**寫入當下重新投影的純量物件**，不是傳進來的元素本身。
 */
export function writeBannersSnapshot(banners: PublicBannerList, nowMs: number = Date.now()): void {
  if (!publicBannerLists.has(banners)) return;
  const items: BannerDoc[] = [];
  for (const banner of banners) {
    const projected = projectBanner(banner);
    if (projected) items.push(projected);
    if (items.length >= MAX_ITEMS) break;
  }
  writeSection(BANNERS_SNAPSHOT_KEY, items, nowMs);
}

/**
 * 後台（M-145）儲存／下架／上架／清空橫幅後，同一用戶端立刻丟掉橫幅快照，下次開首頁改走伺服器。
 * 只清橫幅一段；其他裝置的快照仍受 30 分鐘期限限制（已知）。
 */
export function invalidateBannersSnapshot(): void {
  removeSection(BANNERS_SNAPSHOT_KEY);
}

/** 讀運動統計快照：沒有、過期、版本不同或格式不符都回 null；未知的運動 key 略過。 */
export function readSportsSnapshot(nowMs: number = Date.now()): SnapshotRead<SportRow> | null {
  const section = readSection(SPORTS_SNAPSHOT_KEY, nowMs);
  if (!section) return null;
  const items: SportRow[] = [];
  for (const item of section.items) {
    const projected = projectSportItem(item);
    const sport = projected ? SPORTS.find((s) => s.key === projected.key) : undefined;
    if (projected && sport) items.push({ key: sport.key, label: sport.label, symbol: sport.symbol, count: projected.count });
  }
  return items.length > 0 ? { items, expiresAt: section.expiresAt } : null;
}

/**
 * 寫運動統計快照（只存 key＋數量；標籤與符號讀取時由 SPORTS 還原）。呼叫端只能在確認向伺服器新取得時呼叫。
 * 只收 `computeGuestSportRows()` 的輸出（訪客可見計算）；沒登記過的輸入（型別被強轉繞過）在執行期也不寫。
 * 序列化的是**寫入當下重新投影的 `{ key, count }`**。
 */
export function writeSportsSnapshot(rows: GuestSportRows, nowMs: number = Date.now()): void {
  if (!isGuestSportRows(rows)) return;
  const items: Array<{ key: string; count: number }> = [];
  for (const row of rows) {
    const projected = projectSportItem(row);
    if (projected) items.push(projected);
    if (items.length >= MAX_ITEMS) break;
  }
  writeSection(SPORTS_SNAPSHOT_KEY, items, nowMs);
}

/** 測試用。 */
export function _clearHomeSnapshotForTest(): void {
  removeSection(BANNERS_SNAPSHOT_KEY);
  removeSection(SPORTS_SNAPSHOT_KEY);
}
