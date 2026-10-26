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
  /** 讀取失敗時呼叫（失敗仍回傳空陣列）。呼叫端靠它分辨「查詢失敗」和「真的沒有橫幅」。 */
  onFailure?: (err: unknown) => void;
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

export function safeBannerColor(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
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
    return filterAndSortBanners(docs);
  } catch (err) {
    logger.warn('[banners] failed to load banners:', err);
    deps.onFailure?.(err);
    return [];
  }
}
