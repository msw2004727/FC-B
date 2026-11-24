// 推播本機紀錄：localStorage['fcb:webpush:v1']。不存原始 uid、endpoint、金鑰，只存雜湊。
// endpointHash 與伺服器 subscriptionIdOf 同算法（sha256 前 32 碼），方便對照。
// 儲存空間不可用（無痕、被封鎖）時一律當「沒有紀錄」，寫入失敗靜默略過。

export const WEB_PUSH_STORE_KEY = 'fcb:webpush:v1';

export interface WebPushRecord {
  v: 1;
  uidHash: string;
  endpointHash: string;
  keyId: string;
  reportedAt: number;
  /** 開機同步失敗的時間；6 小時內不再試。 */
  failAt?: number;
  /** 伺服器回 failed-precondition（伺服器公鑰比這份前端新）時的 keyId；同一 keyId 不再試。 */
  rejectedKeyId?: string;
}

function isRecord(value: unknown): value is WebPushRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return r.v === 1
    && typeof r.uidHash === 'string'
    && typeof r.endpointHash === 'string'
    && typeof r.keyId === 'string'
    && typeof r.reportedAt === 'number'
    && (r.failAt === undefined || typeof r.failAt === 'number')
    && (r.rejectedKeyId === undefined || typeof r.rejectedKeyId === 'string');
}

export function readWebPushRecord(): WebPushRecord | null {
  try {
    const raw = localStorage.getItem(WEB_PUSH_STORE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeWebPushRecord(record: WebPushRecord): void {
  try {
    localStorage.setItem(WEB_PUSH_STORE_KEY, JSON.stringify(record));
  } catch {
    /* 儲存空間不可用就略過 */
  }
}

export function clearWebPushRecord(): void {
  try {
    localStorage.removeItem(WEB_PUSH_STORE_KEY);
  } catch {
    /* 儲存空間不可用就略過 */
  }
}

/** sha256(value) 十六進位前 32 碼。 */
export async function hash32(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex.slice(0, 32);
}
