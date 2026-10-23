import type { TeamJoinState } from '../data/team-detail-model';

/**
 * 本 session 的樂觀申請狀態。
 * JSON tuple 避免 teamId + uid 直接串接時發生碰撞。
 * 不寫入 localStorage，不冒充伺服器審核結果。
 */
const pendingRequests = new Map<string, TeamJoinState>();

function requestKey(teamId: string, uid: string): string {
  return JSON.stringify([teamId, uid]);
}

export function getSessionJoinState(
  teamId: string,
  uid: string | null,
): TeamJoinState | undefined {
  return uid ? pendingRequests.get(requestKey(teamId, uid)) : undefined;
}

export function rememberPendingJoin(teamId: string, uid: string): void {
  pendingRequests.set(requestKey(teamId, uid), { status: 'pending' });
}

export function clearPendingJoin(teamId: string, uid: string): void {
  pendingRequests.delete(requestKey(teamId, uid));
}

/**
 * 進行中的登入。列表與詳情同時再呼叫時回傳同一個 Promise，不再打第二次 `signIn`。
 * 外層不標 async，否則每次呼叫都會包成新的 Promise。
 * 進行中不會被另一個 flight 換掉，結束時直接清掉即可。
 */
let loginInFlight: Promise<void> | null = null;

async function runLoginForClubs(): Promise<void> {
  try {
    const auth = await import('@/data/auth');
    try {
      await auth.signIn();
    } catch (err) {
      if (auth.isLoginRedirectingError(err)) return;
      throw err;
    }
  } finally {
    loginInFlight = null;
  }
}

/** M-119：走 `signIn()`。重導向不是失敗，其餘錯誤交給頁面 toast。 */
export function loginForClubs(): Promise<void> {
  if (loginInFlight) return loginInFlight;
  const pending = runLoginForClubs();
  loginInFlight = pending;
  return pending;
}
