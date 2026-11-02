/**
 * 新站「賽事」卡片清單的純函式（T-089，新站專屬功能，舊站不改）。
 *
 * 資料：`tournamentCards/{id}`，與舊站 `tournaments` 集合完全分開。
 * 欄位：name, type, startDate, endDate, url, image（下載網址）, imagePath（Storage 路徑）,
 * createdBy, createdAt, updatedAt。日期一律 `YYYY-MM-DD`（台北日期）。
 */
import { formatTaipei } from '@/core/taipei-time';

export const TOURNAMENT_CARDS_COLLECTION = 'tournamentCards';
/** 進頁只發這一個查詢的筆數上限（顧問讀取預算硬規則：1 個查詢、limit 100）。 */
export const TOURNAMENT_CARDS_LIMIT = 100;
/** 管理按鈕與所有寫入共用的權限碼（不新增權限碼）。 */
export const TOURNAMENT_CARD_PERMISSION = 'admin.tournaments.entry';
export const TOURNAMENT_CARD_ID_PREFIX = 'tc_';

export const TOURNAMENT_CARD_TYPES = ['league', 'cup', 'friendly'] as const;
export type TournamentCardType = (typeof TOURNAMENT_CARD_TYPES)[number];
export type TournamentCardTab = 'all' | TournamentCardType;
export const TOURNAMENT_CARD_TABS: readonly TournamentCardTab[] = ['all', ...TOURNAMENT_CARD_TYPES];

export const NAME_MAX = 80;
export const URL_MAX = 500;

export interface TournamentCard {
  id: string;
  name: string;
  type: TournamentCardType;
  startDate: string;
  endDate: string;
  url: string;
  image: string;
  imagePath: string;
}

/** 表單送出、寫入 Firestore 的業務欄位（createdBy／createdAt／updatedAt 由寫入層加）。 */
export interface TournamentCardWrite {
  name: string;
  type: TournamentCardType;
  startDate: string;
  endDate: string;
  url: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function isTournamentCardType(value: unknown): value is TournamentCardType {
  return typeof value === 'string' && (TOURNAMENT_CARD_TYPES as readonly string[]).includes(value);
}

/** `YYYY-MM-DD` 且是真的日期（2026-02-30 不算）。 */
export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * 連結只收 `https://`：用 URL 解析後取正規化結果（中文等字元會轉成百分比編碼），
 * 不含空白、控制字元與非 ASCII，長度上限 500。不合格回空字串。
 * 與 Rules 的 `url.matches('https://[!-~]+')` 一致。
 */
export function normalizeHttpsUrl(value: unknown): string {
  const raw = text(value).trim();
  if (!/^https:\/\//i.test(raw)) return '';
  let href: string;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || !parsed.hostname) return '';
    href = parsed.href;
  } catch {
    return '';
  }
  if (href.length > URL_MAX || !/^https:\/\/[!-~]+$/.test(href)) return '';
  return href;
}

/** 顯示圖片只用 http(s) 網址（emulator 的下載網址是 http://127.0.0.1）。 */
export function safeImageSrc(value: unknown): string {
  const raw = text(value).trim();
  return /^https?:\/\//i.test(raw) ? raw : '';
}

/** Firestore 文件轉卡片；欄位不合格（類型、日期、連結）的文件不顯示。 */
export function toTournamentCard(id: string, raw: Record<string, unknown>): TournamentCard | null {
  const type = raw.type;
  const startDate = raw.startDate;
  const endDate = raw.endDate;
  const url = normalizeHttpsUrl(raw.url);
  if (!isTournamentCardType(type) || !isValidDateKey(startDate) || !isValidDateKey(endDate) || !url) {
    return null;
  }
  return {
    id,
    name: text(raw.name).trim(),
    type,
    startDate,
    endDate,
    url,
    image: safeImageSrc(raw.image),
    imagePath: text(raw.imagePath),
  };
}

/** 開始日新→舊；同一天維持原順序。 */
export function sortTournamentCards(cards: readonly TournamentCard[]): TournamentCard[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) =>
      a.card.startDate === b.card.startDate
        ? a.index - b.index
        : a.card.startDate < b.card.startDate ? 1 : -1,
    )
    .map(({ card }) => card);
}

/** 今天（台北）的 `YYYY-MM-DD`。 */
export function taipeiTodayKey(nowMs: number): string {
  return formatTaipei(nowMs, 'YYYY-MM-DD');
}

/** 已結束＝結束日 < 今天（台北）。 */
export function isTournamentCardEnded(card: Pick<TournamentCard, 'endDate'>, todayKey: string): boolean {
  return card.endDate < todayKey;
}

/** 頁籤與「顯示已結束」都在前端篩，不重讀。 */
export function filterTournamentCards(
  cards: readonly TournamentCard[],
  tab: TournamentCardTab,
  showEnded: boolean,
  todayKey: string,
): TournamentCard[] {
  return cards.filter(
    (card) =>
      (tab === 'all' || card.type === tab) &&
      (showEnded || !isTournamentCardEnded(card, todayKey)),
  );
}

/** 卡片日期：`YYYY/MM/DD～YYYY/MM/DD`；同一天只顯示一次。 */
export function formatCardDates(card: Pick<TournamentCard, 'startDate' | 'endDate'>): string {
  const start = card.startDate.replace(/-/g, '/');
  const end = card.endDate.replace(/-/g, '/');
  return start === end ? start : `${start}～${end}`;
}

export interface TournamentCardFormInput {
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  url: string;
}

export type TournamentCardFormError = 'name' | 'type' | 'date' | 'dateOrder' | 'url';

export type BuildTournamentCardResult =
  | { ok: true; write: TournamentCardWrite }
  | { ok: false; error: TournamentCardFormError };

/** 表單驗證；寫入層與表單共用同一套規則。 */
export function buildTournamentCardWrite(input: TournamentCardFormInput): BuildTournamentCardResult {
  const name = input.name.trim();
  if (!name || name.length > NAME_MAX) return { ok: false, error: 'name' };
  if (!isTournamentCardType(input.type)) return { ok: false, error: 'type' };
  if (!isValidDateKey(input.startDate) || !isValidDateKey(input.endDate)) {
    return { ok: false, error: 'date' };
  }
  if (input.startDate > input.endDate) return { ok: false, error: 'dateOrder' };
  const url = normalizeHttpsUrl(input.url);
  if (!url) return { ok: false, error: 'url' };
  return {
    ok: true,
    write: { name, type: input.type, startDate: input.startDate, endDate: input.endDate, url },
  };
}

export interface TournamentCardActor {
  uid: string | null;
  role?: string;
  hasPermission(code: string): boolean;
}

/**
 * 「＋ 新增賽事」、卡片鉛筆與所有寫入共用這一個判斷（R-IAM-011）：
 * 總管，或持有 `admin.tournaments.entry`（hasPermission 已含角色權限與個別授權）。
 * 與 Rules `isSuperAdmin() || hasEffectivePerm('admin.tournaments.entry')` 對應。
 */
export function canManageTournamentCards(actor: TournamentCardActor | null | undefined): boolean {
  if (!actor || typeof actor.uid !== 'string' || actor.uid.length === 0) return false;
  return actor.role === 'super_admin' || actor.hasPermission(TOURNAMENT_CARD_PERMISSION) === true;
}
