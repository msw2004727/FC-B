// 記分邀請連結（顧問裁定：代碼不得放查詢字串）。
// 格式：{origin}/competitions/{cid}/invite#i={ivId}&c={code}。# 之後不會送到伺服器、不進 Cloudflare 紀錄。
// 接受頁讀到後立刻用 history.replaceState 拿掉 #；未登入時把 {cid, ivId, code} 暫存在 sessionStorage，
// LINE 登入回跳帶不了 #，回來後從這裡接續。成功、失敗或離開頁面都要清掉。
// 本檔不得把代碼寫進 console、錯誤訊息或任何回報。

export interface InviteTicket {
  cid: string;
  ivId: string;
  code: string;
}

const IV_RE = /^iv_[A-Za-z0-9]{1,64}$/;
const CODE_RE = /^[A-Za-z0-9_-]{22}$/;
const CID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** sessionStorage 鍵。fcb: 前綴，不和舊站 A 的鍵衝突。 */
export const INVITE_STORE_KEY = 'fcb:cp-invite-pending';

/** 連結網址。origin 由呼叫端給（正式頁用 location.origin，換站不必改）。 */
export function buildInviteUrl(origin: string, cid: string, ivId: string, code: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/competitions/${encodeURIComponent(cid)}/invite#i=${encodeURIComponent(ivId)}&c=${encodeURIComponent(code)}`;
}

/** 讀 # 之後的 i 與 c。形狀不對回 null（不丟錯，避免錯誤訊息帶出代碼）。 */
export function parseInviteHash(hash: string): { ivId: string; code: string } | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const ivId = params.get('i') ?? '';
  const code = params.get('c') ?? '';
  if (!IV_RE.test(ivId) || !CODE_RE.test(code)) return null;
  return { ivId, code };
}

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveInviteTicket(ticket: InviteTicket): void {
  try {
    store()?.setItem(INVITE_STORE_KEY, JSON.stringify(ticket));
  } catch {
    // 寫不進去（無痕、停用）：這次只能靠畫面上的狀態，登入回來要重開連結。
  }
}

/** 只回同一個賽事的暫存。形狀不對當沒有並清掉。 */
export function readInviteTicket(cid: string): InviteTicket | null {
  let raw: string | null = null;
  try {
    raw = store()?.getItem(INVITE_STORE_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<InviteTicket>;
    if (
      typeof value.cid === 'string' && CID_RE.test(value.cid)
      && typeof value.ivId === 'string' && IV_RE.test(value.ivId)
      && typeof value.code === 'string' && CODE_RE.test(value.code)
    ) {
      return value.cid === cid ? { cid: value.cid, ivId: value.ivId, code: value.code } : null;
    }
  } catch {
    // 落到下面清掉
  }
  clearInviteTicket();
  return null;
}

export function clearInviteTicket(): void {
  try {
    store()?.removeItem(INVITE_STORE_KEY);
  } catch {
    // 忽略
  }
}

/** 把 # 從網址列拿掉，路徑與查詢字串不動（preact-iso 路由不受影響）。 */
export function stripLocationHash(): void {
  if (typeof window === 'undefined' || !window.location.hash) return;
  try {
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, '', `${pathname}${search}`);
  } catch {
    // 忽略
  }
}
