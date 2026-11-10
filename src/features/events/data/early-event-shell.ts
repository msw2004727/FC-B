/**
 * 把 `window.__fcbEarlyEvent` 的原始 Firestore REST 文件收成兩種純資料：
 * 載入外殼的四個字串，以及首屏用的完整活動文件。
 *
 * 只做顯示用的純資料：不動載入狀態機、不寫入頁面 snapshot、不進任何寫入路徑、不寫 storage。
 * 文件 `name` 的最後兩段必須是 `events` 與精確的 publicId（後綴碰撞不算；不認 `fields.id`）。
 * 完整文件任一頂層欄位解不開就整份丟棄，呼叫端改走 SDK，避免先畫半份再換掉。
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

function topLevelUndecodable(value: unknown): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) && value.some((item) => item === undefined);
}

/**
 * 原始 REST 文件 → 活動文件。`name` 不符、任一頂層欄位解不開、或 `blockedUids` 不是乾淨字串陣列時回 `null`。
 * 不解到一半就拿去畫。不呼叫可見性、不寫 storage、不碰 phase。巢狀 map 裡被解碼器丟掉的壞鍵不在這裡擋（頂層失敗才整份退回）。
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
    if (topLevelUndecodable(decoded)) return null;
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

/**
 * 讀已掛上的提早文件。已有結果就同步用記憶體；否則等 Promise。
 * 成功與拒絕都記進記憶體（拒絕記 `null`），這個函式本身不 throw。
 */
export async function readEarlyEventDetail(publicId: string): Promise<EarlyEventDetail | null> {
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
  return selectEarlyEventDetail(raw, publicId);
}
