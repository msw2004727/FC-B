/**
 * 冷啟動橫幅清單的 REST 讀取（T-042c）：沒有有效首屏快照的訪客，hero 不必等「入口 JS → Firestore SDK chunk（約 165 KB gz）→ 查詢」，
 * 改用 Firestore REST `runQuery` 的匿名 POST 直接取 `banners`，與 SDK 載入並行；之後 SDK 的正式資料照舊取代它。
 *
 * 邊界（這個檔案刻意守住的幾件事）：
 * - 只 import `firebase-config.ts` 的 `projectId`（純常數檔，不讀 `apiKey`）；不 import `data/firebase.ts`、不呼叫任何 Firebase 初始化、不 import `firebase/*`。
 *   （`./banners` 本身靜態 import `data/firebase.ts`，但首頁入口本來就有，沒有新增任何模組到入口圖；SDK 只在 banners.ts 動態載入。）
 * - 匿名請求：不帶 `Authorization`、不帶 API key（網址沒有 `key=`、沒有 `x-goog-api-key`）、`credentials: 'omit'`。
 *   `banners` 的 Rules 是 `allow read: if true`（公開讀取），不需要憑證。
 * - 與 SDK 路徑同一個查詢（`collection('banners').limit(200)`）、同一個文件映射（`mapBannerDoc`）、同一個篩選（`filterAndSortBanners`）；
 *   REST 的欄位值（`stringValue`／`integerValue`…）先解成 SDK `data()` 同形的 JS 值，再交給 `mapBannerDoc`，所以映射語意由同一份程式碼保證。
 *   只解碼 `mapBannerDoc` 會讀的欄位，未知欄位一律丟棄；單筆損毀只丟該筆。
 * - 任何失敗（網路、非 2xx、逾時 4 秒、回應超過 256 KB、JSON 損毀、格式不符）都回 `null`，呼叫端靜默退回 SDK 路徑；不重試、不 `console.error`。
 * - 這個模組只回傳「資料」；怎麼畫、寫不寫快照由呼叫端決定（HomePage 走既有的 `toPublicBanners()` 白名單與寫入守門）。
 */
import { FIREBASE_CONFIG } from '@/data/firebase-config';
import { BANNERS_COLLECTION, filterAndSortBanners, mapBannerDoc, type BannerDoc } from './banners';

/** 逾時（毫秒）：超過就放棄，退回 SDK 路徑。 */
export const BANNERS_REST_TIMEOUT_MS = 4000;
/** 回應大小上限（位元組，解壓後實際讀到的量）：超過整個丟棄。 */
export const BANNERS_REST_MAX_BYTES = 256 * 1024;
/** 與 SDK 路徑相同：`collection('banners').limit(200)`（見 `banners.ts#loadActiveBanners`）。 */
const QUERY_LIMIT = 200;
/** 解碼巢狀值的深度與單一容器筆數上限（只有穿透欄位會用到；防敵意回應拖垮解碼）。 */
const MAX_DECODE_DEPTH = 4;
const MAX_CONTAINER_ITEMS = 100;

/** `mapBannerDoc` 會讀的欄位（對照 banners.ts）；其餘欄位一律不解碼、不保留。 */
const MAPPED_FIELDS = [
  'id',
  'status',
  'type',
  'title',
  'subtitle',
  'titleColor',
  'subtitleColor',
  'image',
  'linkUrl',
  'slotName',
  'slot',
  'sortOrder',
  'gradient',
  'startAt',
  'endAt',
  'publishAt',
  'unpublishAt',
] as const;

export function bannersRestUrl(projectId: string = FIREBASE_CONFIG.projectId): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`;
}

export function bannersRestBody(): string {
  return JSON.stringify({ structuredQuery: { from: [{ collectionId: BANNERS_COLLECTION }], limit: QUERY_LIMIT } });
}

// ── 欄位值解碼（Firestore REST Value → 與 SDK `data()` 同形的 JS 值）──────────────────────────

/** `timestampValue`（RFC 3339，最多 9 位小數）→ `{ seconds, nanoseconds }`（與 SDK Timestamp 的資料欄位相同）。 */
function decodeTimestamp(text: string): { seconds: number; nanoseconds: number } | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!m) return undefined;
  const date = new Date(0);
  date.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  date.setUTCHours(Number(m[4]), Number(m[5]), Number(m[6]), 0);
  let seconds = date.getTime() / 1000;
  const zone = m[8] ?? 'Z';
  if (zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    seconds -= sign * (Number(zone.slice(1, 3)) * 3600 + Number(zone.slice(4, 6)) * 60);
  }
  if (!Number.isFinite(seconds)) return undefined;
  return { seconds, nanoseconds: Number((m[7] ?? '').padEnd(9, '0')) };
}

/**
 * 解一個 Firestore REST Value。不認得或格式不符的型別（bytes、reference、geoPoint、損毀）回 `undefined`＝當作沒有這個欄位。
 * `integerValue` 是十進位字串；`doubleValue` 可能是數字或 `NaN`／`Infinity`／`-Infinity` 字串。
 */
function decodeValue(value: unknown, depth: number): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > MAX_DECODE_DEPTH) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.stringValue === 'string') return v.stringValue;
  if (typeof v.integerValue === 'string') {
    return /^-?\d{1,19}$/.test(v.integerValue) ? Number(v.integerValue) : undefined;
  }
  if (typeof v.integerValue === 'number') return Number.isFinite(v.integerValue) ? v.integerValue : undefined;
  if (typeof v.doubleValue === 'number') return Number.isFinite(v.doubleValue) ? v.doubleValue : undefined;
  if (v.doubleValue === 'NaN') return Number.NaN;
  if (v.doubleValue === 'Infinity') return Number.POSITIVE_INFINITY;
  if (v.doubleValue === '-Infinity') return Number.NEGATIVE_INFINITY;
  if (typeof v.booleanValue === 'boolean') return v.booleanValue;
  if ('nullValue' in v) return null;
  if (typeof v.timestampValue === 'string') return decodeTimestamp(v.timestampValue);
  if (v.mapValue && typeof v.mapValue === 'object') {
    const fields = (v.mapValue as { fields?: unknown }).fields;
    const out: Record<string, unknown> = {};
    if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
      let count = 0;
      for (const [key, child] of Object.entries(fields as Record<string, unknown>)) {
        count += 1;
        if (count > MAX_CONTAINER_ITEMS) return undefined;
        if (key === '__proto__') continue;
        const decoded = decodeValue(child, depth + 1);
        if (decoded !== undefined) out[key] = decoded;
      }
    }
    return out;
  }
  if (v.arrayValue && typeof v.arrayValue === 'object') {
    const values = (v.arrayValue as { values?: unknown }).values;
    if (values === undefined) return [];
    if (!Array.isArray(values) || values.length > MAX_CONTAINER_ITEMS) return undefined;
    return values.map((child) => decodeValue(child, depth + 1));
  }
  return undefined;
}

/** 文件名稱 `projects/{p}/databases/(default)/documents/banners/{id}` → `{id}`；不是 banners 的直接子文件回 `null`。 */
function docIdFromName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const parts = name.split('/');
  if (parts.length !== 7 || parts[2] !== 'databases' || parts[4] !== 'documents' || parts[5] !== BANNERS_COLLECTION) return null;
  const id = parts[6];
  return id ? id : null;
}

function mapRestDocument(document: unknown): BannerDoc | null {
  if (!document || typeof document !== 'object') return null;
  const { name, fields } = document as { name?: unknown; fields?: unknown };
  const id = docIdFromName(name);
  if (!id) return null;
  const data: Record<string, unknown> = {};
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    for (const key of MAPPED_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
      const decoded = decodeValue((fields as Record<string, unknown>)[key], 0);
      if (decoded !== undefined) data[key] = decoded;
    }
  }
  return mapBannerDoc({ id, data: () => data });
}

/**
 * `runQuery` 回應（陣列，每個元素 `{ document?, readTime?, skippedResults? }`）→ 橫幅清單（已過 `filterAndSortBanners`，與 SDK 路徑的 `loadActiveBanners` 同形）。
 * 沒有 `document` 的元素（空結果標記）略過；單筆損毀只丟該筆；整體不是陣列、或含 `error` 元素回 `null`。
 */
export function parseRunQueryResponse(payload: unknown): BannerDoc[] | null {
  if (!Array.isArray(payload)) return null;
  const docs: BannerDoc[] = [];
  let seen = 0;
  for (const element of payload) {
    if (!element || typeof element !== 'object') continue;
    if ('error' in element) return null;
    const document = (element as { document?: unknown }).document;
    if (document === undefined || document === null) continue;
    seen += 1;
    if (seen > QUERY_LIMIT) break;
    try {
      const mapped = mapRestDocument(document);
      if (mapped) docs.push(mapped);
    } catch {
      /* 單筆損毀只丟該筆 */
    }
  }
  return filterAndSortBanners(docs);
}

// ── 讀取（逾時、大小上限、匿名）──────────────────────────────────────────────────────────

/** 讀回應本文；超過上限回 null（宣告的 Content-Length 超過就不讀，串流讀到超過就取消）。 */
async function readTextWithLimit(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers?.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = res.body?.getReader?.();
  if (!reader) {
    // 沒有串流介面（舊 WebView、測試替身）：整段讀進來再量位元組。
    const whole = await res.text();
    return new TextEncoder().encode(whole).length > maxBytes ? null : whole;
  }
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => undefined);
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function requestBanners(fetchImpl: typeof fetch, signal: AbortSignal | undefined): Promise<BannerDoc[] | null> {
  const res = await fetchImpl(bannersRestUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bannersRestBody(),
    // 匿名公開讀取：不帶 cookie／憑證；沒有 Authorization、沒有 API key。
    credentials: 'omit',
    signal,
  });
  if (!res.ok) return null;
  const text = await readTextWithLimit(res, BANNERS_REST_MAX_BYTES);
  if (!text) return null;
  return parseRunQueryResponse(JSON.parse(text));
}

/** 固定文字，不帶錯誤內容；呼叫端靜默退回 SDK 路徑（不 console.error、不重試）。 */
function logFallback(): void {
  console.debug('[banners-rest] fallback to SDK');
}

export interface BannersRestOptions {
  /** 呼叫端取消（例如畫面卸載）。 */
  signal?: AbortSignal;
  /** 測試注入；預設用全域 fetch。 */
  fetchImpl?: typeof fetch;
}

/**
 * 以 REST 匿名讀取橫幅清單。成功回清單（可能是空陣列＝回應有效但沒有可顯示的橫幅）；任何失敗回 `null`（絕不丟錯）。
 * 4 秒內沒完成、回應超過 256 KB、被取消都算失敗。
 */
export async function fetchBannersViaRest(options: BannersRestOptions = {}): Promise<BannerDoc[] | null> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const onExternalAbort = (): void => controller?.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (options.signal?.aborted) return null;
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller?.abort();
        resolve(null);
      }, BANNERS_REST_TIMEOUT_MS);
    });
    const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const result = await Promise.race([requestBanners(fetchImpl, controller?.signal), timedOut]);
    if (result === null) logFallback();
    return result;
  } catch {
    logFallback();
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
    // 收掉還沒結束的請求／讀取（成功時已讀完，等同沒有動作）。
    controller?.abort();
  }
}

/** 一次進行中的 REST 讀取：`result` 永遠 resolve（失敗＝`null`）；`cancel()` 取消。 */
export interface BannersRestRequest {
  result: Promise<BannerDoc[] | null>;
  cancel: () => void;
}

/** 立刻發出請求（HomePage 第一次 render 呼叫，與 SDK 載入並行）。 */
export function startBannersRestFetch(options: Pick<BannersRestOptions, 'fetchImpl'> = {}): BannersRestRequest {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const result = fetchBannersViaRest({ ...options, signal: controller?.signal });
  return { result, cancel: () => controller?.abort() };
}
