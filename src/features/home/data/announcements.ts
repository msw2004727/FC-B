// Firestore SDK 只在查詢當下動態載入（T-041 A2）：本檔會被首頁路由引用，靜態 import 會把約 160 KB gz 的 SDK 帶進首頁的靜態相依。
import type { DocumentData, Firestore } from 'firebase/firestore';
import { loadFirestoreSdk } from '@/data/firestore-sdk';
// 公告是公開唯讀資料，只需要 app＋firestore，不等 auth／functions（T-041）。
import { getFirebaseCore as defaultGetFirebase } from '@/data/firebase';

export const ANNOUNCEMENTS_COLLECTION = 'announcements';

/**
 * 公告查詢上限：與 A 的 `_buildCollectionQuery`（一般集合 limit(200)）及 banners.ts 一致。
 * 公告只有少數幾則會同時有效，這是防止歷史公告無限累積的保險，不改變顯示結果（有效公告仍依狀態與排序篩出）。
 */
export const ANNOUNCEMENTS_QUERY_LIMIT = 200;

export interface AnnouncementDoc {
  id: string;
  _docId: string;
  title: string;
  content: string;
  status: string;
  sortOrder?: number | string;
  publishAt?: string;
  unpublishAt?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  /** 原始 publishAt（Timestamp 或字串），狀態判斷用（A _parseAnnouncementTime）。 */
  rawPublishAt?: unknown;
}

export interface AnnouncementDeps {
  getFirebase?: () => Promise<{ db: Firestore }>;
  logger?: { warn: (...args: unknown[]) => void };
  now?: () => number;
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

function formatPublishAt(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  const ms = toMillis(value);
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `api-service.js#_parseAnnouncementTime`：Timestamp／Date／'YYYY/MM/DD HH:mm' 字串。 */
function parseAnnouncementTime(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\//g, '-').replace(' ', 'T');
    const ms = new Date(normalized).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  return toMillis(value);
}

/** A `_getAnnouncementEffectiveStatus`。 */
export function getAnnouncementEffectiveStatus(
  ann: AnnouncementDoc,
  nowMs: number = Date.now(),
): string {
  const stored = String(ann.status || '') || 'active';
  const publishAt = parseAnnouncementTime(ann.rawPublishAt);
  const unpublishAt = parseAnnouncementTime(ann.unpublishAt);
  if (stored === 'expired') return 'expired';
  if (unpublishAt && unpublishAt <= nowMs) return 'expired';
  if (stored === 'scheduled') return publishAt && publishAt <= nowMs ? 'active' : 'scheduled';
  return stored;
}

/** A `getActiveAnnouncements`（sortOrder||99）＋`renderAnnouncement` 再依 Number(sortOrder)||0 排序（穩定排序）。 */
export function filterAndSortAnnouncements(
  items: readonly AnnouncementDoc[] | null | undefined,
  nowMs: number = Date.now(),
): AnnouncementDoc[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((a) => getAnnouncementEffectiveStatus(a, nowMs) === 'active')
    .sort((a, b) => (Number(a.sortOrder) || 99) - (Number(b.sortOrder) || 99))
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
}

export function computeMarqueeDurationSeconds(items: readonly AnnouncementDoc[]): number {
  const totalChars = items.reduce(
    (sum, a) => sum + String((a.title || '') + (a.content || '')).length,
    0,
  );
  return Math.max(10, totalChars * 0.35);
}

function mapAnnouncementDoc(docSnap: { id: string; data: () => DocumentData }): AnnouncementDoc {
  const raw = (docSnap.data() ?? {}) as Record<string, unknown>;
  const id = String(raw.id ?? docSnap.id).trim() || docSnap.id;
  return {
    id,
    _docId: docSnap.id,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : '公告',
    content: typeof raw.content === 'string' ? raw.content : '',
    status: String(raw.status ?? '').trim(),
    // 狀態判斷用原始值；畫面顯示用 publishAt（格式化字串）。
    rawPublishAt: raw.publishAt,
    sortOrder:
      typeof raw.sortOrder === 'number' || typeof raw.sortOrder === 'string'
        ? raw.sortOrder
        : 0,
    publishAt: formatPublishAt(raw.publishAt),
    unpublishAt: raw.unpublishAt,
    startAt: raw.startAt,
    endAt: raw.endAt,
  };
}

export async function loadActiveAnnouncements(
  deps: AnnouncementDeps = {},
): Promise<AnnouncementDoc[]> {
  const getFB = deps.getFirebase ?? defaultGetFirebase;
  const logger = deps.logger ?? console;
  const nowMs = deps.now?.() ?? Date.now();
  try {
    const [{ db }, { collection, getDocs, limit, query }] = await Promise.all([
      getFB(),
      loadFirestoreSdk(),
    ]);
    const snap = await getDocs(
      query(collection(db, ANNOUNCEMENTS_COLLECTION), limit(ANNOUNCEMENTS_QUERY_LIMIT)),
    );
    const docs = snap.docs.map((d) => mapAnnouncementDoc(d));
    return filterAndSortAnnouncements(docs, nowMs);
  } catch (err) {
    logger.warn('[announcements] failed to load announcements:', err);
    return [];
  }
}
