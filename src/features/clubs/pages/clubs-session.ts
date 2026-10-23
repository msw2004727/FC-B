import type { TeamJoinState } from '../data/team-detail-model';
import { isJoinRequestPending, getJoinRequestHoursLeft } from '../club-policy';

/**
 * 加入申請「審核中」狀態（M-117）：記憶體加本機 localStorage（`club-join-pending:<uid>:<teamId>`），
 * TTL＝JOIN_REQUEST_COOLDOWN_MS；同裝置重新整理仍顯示，換裝置或過期回到「加入」。
 * 照 A：A 的審核中本來就沒有伺服器紀錄；這裡不新增任何伺服器寫入，也不冒充伺服器審核結果。
 * 儲存不可用（隱私模式／被封鎖）時靜默退回記憶體。
 * JSON tuple 避免 teamId + uid 直接串接時發生碰撞。
 */
const pendingRequests = new Map<string, { sentAt: number }>();

function requestKey(teamId: string, uid: string): string {
  return JSON.stringify([teamId, uid]);
}

function storageKey(teamId: string, uid: string): string | undefined {
  if (
    typeof teamId !== 'string' || !teamId || teamId.includes(':')
    || typeof uid !== 'string' || !uid || uid.includes(':')
  ) {
    return undefined;
  }
  return `club-join-pending:${uid}:${teamId}`;
}

function removeStoredPendingJoin(teamId: string, uid: string): void {
  const key = storageKey(teamId, uid);
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 儲存不可用時靜默保留記憶體操作結果。
  }
}

function findPendingJoin(
  teamId: string,
  uid: string | null,
  now: number,
): { sentAt: number } | undefined {
  if (!teamId || !uid) return undefined;

  const key = requestKey(teamId, uid);
  const pending = pendingRequests.get(key);
  if (pending) {
    if (isJoinRequestPending(pending.sentAt, now)) return pending;
    pendingRequests.delete(key);
    removeStoredPendingJoin(teamId, uid);
    return undefined;
  }

  const storedKey = storageKey(teamId, uid);
  if (!storedKey) return undefined;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storedKey);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeStoredPendingJoin(teamId, uid);
    return undefined;
  }

  if (
    typeof parsed !== 'object' || parsed === null
    || !('sentAt' in parsed) || typeof parsed.sentAt !== 'number'
    || !isJoinRequestPending(parsed.sentAt, now)
  ) {
    removeStoredPendingJoin(teamId, uid);
    return undefined;
  }

  const restored = { sentAt: parsed.sentAt };
  pendingRequests.set(key, restored);
  return restored;
}

export function getSessionJoinState(
  teamId: string,
  uid: string | null,
  now: number = Date.now(),
): TeamJoinState | undefined {
  return findPendingJoin(teamId, uid, now) ? { status: 'pending' } : undefined;
}

export function getSessionJoinHoursLeft(
  teamId: string,
  uid: string | null,
  now: number = Date.now(),
): number | undefined {
  const pending = findPendingJoin(teamId, uid, now);
  return pending ? getJoinRequestHoursLeft(pending.sentAt, now) : undefined;
}

export function rememberPendingJoin(
  teamId: string,
  uid: string,
  now: number = Date.now(),
): void {
  const pending = { sentAt: now };
  pendingRequests.set(requestKey(teamId, uid), pending);
  const key = storageKey(teamId, uid);
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(pending));
  } catch {
    // 儲存不可用時仍以記憶體保留申請狀態。
  }
}

export function clearPendingJoin(teamId: string, uid: string): void {
  pendingRequests.delete(requestKey(teamId, uid));
  removeStoredPendingJoin(teamId, uid);
}

export function _resetClubsSessionForTest(): void {
  pendingRequests.clear();
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
