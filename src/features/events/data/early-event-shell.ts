/**
 * 把 `window.__fcbEarlyEvent` 的原始 Firestore REST 文件收成兩種純資料：
 * 載入外殼的四個字串，以及首屏用的完整活動文件。
 *
 * 只做顯示用的純資料：不動載入狀態機、不寫入頁面 snapshot、不進任何寫入路徑、不寫 storage。
 * 文件 `name` 的最後兩段必須是 `events` 與精確的 publicId（後綴碰撞不算；不認 `fields.id`）。
 * 完整文件任一層解不開就整份丟棄，呼叫端改走 SDK，避免先畫半份再換掉。
 */
import { decodeValue } from '@/features/home/data/banners-rest';
import { safeImageUrl } from './detail-model';
import type { EventDoc, ViewerContext } from './types';
import { isEventVisibleToUser } from './visibility';

/** 與 `loadEventDetail` 同形，給首屏直接當這次活動文件。型別只依賴 EventDoc，不從 event-detail 引執行期。 */
export interface EarlyEventDetail {
  event: EventDoc;
  eventDocId: string;
}

export interface EarlyEventShellText {
  title?: string;
  date?: string;
  location?: string;
  image?: string;
}

declare global {
  interface Window {
    /** 內嵌 script 掛上的原始文件 Promise。失敗是 resolve `null`。消費端不刪掉，重新掛載還能再讀。 */
    __fcbEarlyEvent?: Promise<unknown> | null;
  }
}

/** 不是 Promise（沒發、或被塞了別的值）就當作沒有提早讀取。 */
export function readEarlyEventPromise(): Promise<unknown> | null {
  if (typeof window === 'undefined') return null;
  const early = window.__fcbEarlyEvent;
  if (!early || typeof (early as { then?: unknown }).then !== 'function') return null;
  return early;
}

/** 已有結果的提早讀取（只在記憶體）：uid 改變重新掛載外殼時同步取用，不再閃佔位（Opus 終審 P2-1）。 */
let settledEarly: { promise: Promise<unknown>; value: unknown } | null = null;

export function rememberEarlyEventResult(promise: Promise<unknown>, value: unknown): void {
  settledEarly = { promise, value };
}

/** 同一個 Promise 已有結果才回傳，否則 null。 */
export function readSettledEarlyEvent(promise: Promise<unknown>): { value: unknown } | null {
  return settledEarly?.promise === promise ? { value: settledEarly.value } : null;
}

/**
 * `name` 最後兩段是 `events` 與 publicId 才算同一份文件。
 * `…/events/abc` 對 `bc` 是後綴碰撞，不算；不看 `fields.id`。
 */
export function earlyEventDocumentNameMatches(name: unknown, publicId: string): boolean {
  if (typeof name !== 'string' || publicId.length === 0) return false;
  const parts = name.split('/');
  const id = parts[parts.length - 1];
  const collection = parts[parts.length - 2];
  return collection === 'events' && id === publicId;
}

function displayString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function field(fields: Record<string, unknown>, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(fields, key)) return undefined;
  return decodeValue(fields[key], 0);
}

/**
 * 原始 REST 文件 → 外殼四欄。不符合、沒有可顯示字串、或黑名單還不能判斷時回 `null`（外殼維持佔位）。
 * 登入線索為真且 `blockedUids` 非空、uid 尚未確定：先不畫，也不呼叫可見性（沒有 uid 時可見性會放行）。
 * uid 確定後用 `isEventVisibleToUser(candidate, viewer, [])`，與外殼快取同一條規則。
 */
export function selectEarlyEventShellText(
  raw: unknown,
  publicId: string,
  viewer: ViewerContext,
  authHint: boolean,
): EarlyEventShellText | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const doc = raw as { name?: unknown; fields?: unknown };
  if (!earlyEventDocumentNameMatches(doc.name, publicId)) return null;
  const fields = doc.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const bag = fields as Record<string, unknown>;

  const blockedRaw = field(bag, 'blockedUids');
  // 欄位在但解不出陣列（超過解碼器 100 筆上限或型別不符）一律不畫，不能當成空黑名單放行（Opus 終審 P1-1）。
  if (Object.prototype.hasOwnProperty.call(bag, 'blockedUids') && !Array.isArray(blockedRaw)) return null;
  const blocked = Array.isArray(blockedRaw) ? blockedRaw : [];
  if (!viewer.uid) {
    if (authHint && blocked.length > 0) return null;
  } else if (!isEventVisibleToUser({ id: publicId, blockedUids: blocked }, viewer, [])) {
    return null;
  }

  const variants = field(bag, 'imageVariants');
  const cover = variants && typeof variants === 'object' && !Array.isArray(variants)
    ? displayString((variants as { cover?: unknown }).cover)
    : undefined;
  const text: EarlyEventShellText = {
    title: displayString(field(bag, 'title')),
    date: displayString(field(bag, 'date')),
    location: displayString(field(bag, 'location')),
    image: safeImageUrl(cover) || safeImageUrl(displayString(field(bag, 'image'))),
  };
  if (!text.title && !text.date && !text.location && !text.image) return null;
  return text;
}

/** 巢狀任何一層被解碼器丟掉（壞型別、深度＞4、容器＞100、__proto__）都視為解不開，整份退回 SDK（取代：原本只擋頂層）。 */
function fullyDecoded(raw: unknown, decoded: unknown): boolean {
  if (decoded === undefined) return false;
  if (!raw || typeof raw !== 'object') return false;
  const v = raw as { mapValue?: { fields?: unknown }; arrayValue?: { values?: unknown } };
  if (v.mapValue && typeof v.mapValue === 'object' && decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)) {
    const fields = v.mapValue.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return true;
    const out = decoded as Record<string, unknown>;
    return Object.entries(fields as Record<string, unknown>).every(([key, child]) =>
      key !== '__proto__' && Object.prototype.hasOwnProperty.call(out, key) && fullyDecoded(child, out[key]));
  }
  if (v.arrayValue && typeof v.arrayValue === 'object') {
    const values = v.arrayValue.values;
    if (values === undefined) return Array.isArray(decoded) && decoded.length === 0;
    return Array.isArray(values) && Array.isArray(decoded) && decoded.length === values.length
      && values.every((child, i) => fullyDecoded(child, decoded[i]));
  }
  return !v.mapValue;
}

/**
 * 原始 REST 文件 → 活動文件。`name` 不符、任一層解不開、或 `blockedUids` 不是乾淨字串陣列時回 `null`。
 * 不解到一半就拿去畫。不呼叫可見性、不寫 storage、不碰 phase。
 */
export function selectEarlyEventDetail(raw: unknown, publicId: string): EarlyEventDetail | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const doc = raw as { name?: unknown; fields?: unknown };
  if (!earlyEventDocumentNameMatches(doc.name, publicId)) return null;
  const fields = doc.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const bag = fields as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(bag)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const decoded = decodeValue(bag[key], 0);
    if (!fullyDecoded(bag[key], decoded)) return null;
    data[key] = decoded;
  }
  if (Object.prototype.hasOwnProperty.call(bag, 'blockedUids')) {
    const blocked = data.blockedUids;
    if (!Array.isArray(blocked) || blocked.some((item) => typeof item !== 'string')) return null;
  }
  const parts = (doc.name as string).split('/');
  const eventDocId = parts[parts.length - 1] ?? '';
  if (!eventDocId) return null;
  return {
    event: { ...data, _docId: eventDocId } as EventDoc,
    eventDocId,
  };
}

/** 早取完整文件只給開頁後第一次詳情用，且限開頁 30 秒內；之後一律走 SDK（取代：原本整個頁面生命週期都會重用開頁時的文件）。 */
export const EARLY_EVENT_DETAIL_MAX_AGE_MS = 30_000;
let earlyDetailAdopted = false;
export function markEarlyEventDetailAdopted(): void { earlyDetailAdopted = true; }
export function resetEarlyEventDetailForTest(): void { earlyDetailAdopted = false; }
function earlyDetailExpired(): boolean {
  try {
    return typeof performance === 'undefined' || !(performance.now() < EARLY_EVENT_DETAIL_MAX_AGE_MS);
  } catch { return true; }
}

/**
 * 讀已掛上的提早文件。已有結果就同步用記憶體；否則等 Promise。
 * 成功與拒絕都記進記憶體（拒絕記 `null`），這個函式本身不 throw。
 * 已經採用過，或開頁已超過 `EARLY_EVENT_DETAIL_MAX_AGE_MS`，回 `null`（呼叫端改走 SDK）。
 */
export async function readEarlyEventDetail(publicId: string): Promise<EarlyEventDetail | null> {
  if (earlyDetailAdopted || earlyDetailExpired()) return null;
  const promise = readEarlyEventPromise();
  if (!promise) return null;
  const settled = readSettledEarlyEvent(promise);
  let raw: unknown;
  if (settled) {
    raw = settled.value;
  } else {
    try {
      raw = await promise;
    } catch {
      raw = null;
    }
    rememberEarlyEventResult(promise, raw);
  }
  if (earlyDetailExpired()) return null;
  try { return selectEarlyEventDetail(raw, publicId); } catch { return null; }
}
