// 測試用（不進 bundle）：Firestore REST `runQuery` 回應的樣本建構器與 fetch 回應替身。
// 只用來造「假的」伺服器回應；測試一律不得對線上端點發請求（src/test-setup.ts 另有全域守門）。
import { vi } from 'vitest';
import { FIREBASE_CONFIG } from '@/data/firebase-config';

export const restStr = (stringValue: string): Record<string, unknown> => ({ stringValue });
export const restInt = (n: number | string): Record<string, unknown> => ({ integerValue: String(n) });
export const restDouble = (doubleValue: number | string): Record<string, unknown> => ({ doubleValue });
export const restBool = (booleanValue: boolean): Record<string, unknown> => ({ booleanValue });
export const restNull = (): Record<string, unknown> => ({ nullValue: null });
export const restTs = (timestampValue: string): Record<string, unknown> => ({ timestampValue });
export const restMap = (fields: Record<string, unknown>): Record<string, unknown> => ({ mapValue: { fields } });
export const restArray = (values: unknown[]): Record<string, unknown> => ({ arrayValue: { values } });

const READ_TIME = '2026-10-27T00:00:00.000000Z';

export function restDocName(id: string): string {
  return `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/banners/${id}`;
}

/** runQuery 回應的一個元素（含文件）。 */
export function restDoc(id: string, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    document: {
      name: restDocName(id),
      fields,
      createTime: '2026-01-01T00:00:00.000000Z',
      updateTime: '2026-01-02T00:00:00.000000Z',
    },
    readTime: READ_TIME,
  };
}

/** runQuery 回應的「空結果」標記元素（沒有 document）。 */
export function restEmptyMarker(): Record<string, unknown> {
  return { readTime: READ_TIME };
}

/** 一張 active 橫幅的 REST 欄位（常用於 HomePage 整合測試）。 */
export function restActiveFields(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: restStr('active'), ...extra };
}

export interface FakeResponseOptions {
  status?: number;
  /** 回應標頭（鍵不分大小寫）。 */
  headers?: Record<string, string>;
  /** true＝沒有串流本文（`body: null`），讀取端只能走 `text()`。 */
  noStream?: boolean;
}

export interface FakeResponseHandle {
  response: Response;
  /** 串流的 reader.read() 與 reader.cancel() 替身，可檢查「讀了幾次、有沒有取消」。 */
  read: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  text: ReturnType<typeof vi.fn>;
}

/** 把位元組切成固定大小的 chunk（用來模擬串流，也能把多位元組字元切在中間）。 */
export function splitBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
  return chunks;
}

/** fetch 回應替身：只實作讀取端用到的介面（ok／status／headers.get／body.getReader／text）。 */
export function fakeResponse(body: string | Uint8Array[], options: FakeResponseOptions = {}): FakeResponseHandle {
  const chunks = typeof body === 'string' ? [new TextEncoder().encode(body)] : body;
  const status = options.status ?? 200;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.headers ?? {})) headers[key.toLowerCase()] = value;
  let index = 0;
  const read = vi.fn(async () => {
    const value = chunks[index];
    if (value === undefined) return { done: true, value: undefined };
    index += 1;
    return { done: false, value };
  });
  const cancel = vi.fn(async () => undefined);
  const text = vi.fn(async () => chunks.map((chunk) => new TextDecoder().decode(chunk)).join(''));
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: options.noStream ? null : { getReader: () => ({ read, cancel }) },
    text,
  };
  return { response: response as unknown as Response, read, cancel, text };
}

/** 200 回應，本文是 `payload` 的 JSON。 */
export function jsonResponse(payload: unknown, options: FakeResponseOptions = {}): FakeResponseHandle {
  return fakeResponse(JSON.stringify(payload), options);
}
