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
 * ASSUMPTION: 未附 auth 的登入 export；沿用 auth 模組的 login() 入口。
 * 若實際專案入口名稱不同，只需調整此 adapter。
 * 缺少入口時明確失敗，頁面顯示可重試錯誤，不自行建立登入 URL。
 */
export async function loginForClubs(): Promise<void> {
  const auth: unknown = await import('@/data/auth');
  if (
    !auth ||
    typeof auth !== 'object' ||
    !('login' in auth) ||
    typeof auth.login !== 'function'
  ) {
    throw new Error('Club login adapter requires the auth login entry point.');
  }
  await auth.login();
}
