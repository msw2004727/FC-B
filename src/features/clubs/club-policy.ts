/** M-119：俱樂部詳情是否要求登入（照 A js/modules/team/team-detail.js:997-1000）；改成 false 即開放訪客。 */
export const CLUB_DETAIL_REQUIRES_LOGIN = true;

/** M-117：加入申請「審核中」與「被拒絕」冷卻毫秒數（照 A js/modules/team/team-form-join.js _TEAM_JOIN_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000）。 */
export const JOIN_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** 只取判斷需要的最小欄位，與 useViewer() 的 ViewerView 相容（uid 為 null 代表訪客）。 */
export interface ClubViewer {
  readonly uid: string | null;
}

/**
 * 訪客是否可開啟俱樂部詳情。
 * - requiresLogin 預設取 CLUB_DETAIL_REQUIRES_LOGIN；參數存在只為了單元測試可覆蓋兩種設定。
 * - requiresLogin 為 false：任何人（含訪客）可看。
 * - requiresLogin 為 true：uid 為非空字串（trim 後長度 > 0）才可看；null、undefined、空字串、純空白都視為訪客。
 * - 身分只看 uid（R-ID-002），不看 displayName。
 */
export function canViewClubDetail(
  viewer: ClubViewer | null | undefined,
  requiresLogin: boolean = CLUB_DETAIL_REQUIRES_LOGIN,
): boolean {
  if (!requiresLogin) {
    return true;
  }

  const uid = viewer?.uid;
  return typeof uid === 'string' && uid.trim().length > 0;
}

/** 詳情存取判定：allowed＝可載入並顯示；pending＝登入狀態尚未到位，只顯示載入中、不載入資料也不要求登入；login-required＝已確定是訪客且政策要求登入，顯示閘門。 */
export type ClubDetailAccess = 'allowed' | 'pending' | 'login-required';

/**
 * @param viewer useViewer() 的目前值（只看 uid）。
 * @param authUid 登入狀態的同步讀值：undefined＝尚未確定、null＝確定是訪客、字串＝確定已登入（來源 getLastKnownAuthUid()，本檔不 import 它，由呼叫端傳入）。
 * @param requiresLogin 預設取 CLUB_DETAIL_REQUIRES_LOGIN，參數只為了測試可覆蓋。
 */
export function resolveClubDetailAccess(
  viewer: ClubViewer | null | undefined,
  authUid: string | null | undefined,
  requiresLogin: boolean = CLUB_DETAIL_REQUIRES_LOGIN,
): ClubDetailAccess {
  if (canViewClubDetail(viewer, requiresLogin)) {
    return 'allowed';
  }

  return authUid === null ? 'login-required' : 'pending';
}

/** 申請是否仍在「審核中」冷卻期內（照 A：now - sentAt < 冷卻）。sentAt 非有限正數、或比 now 晚超過一個冷卻期（時鐘錯亂／損毀資料）視為否。 */
export function isJoinRequestPending(sentAtMs: number, nowMs: number = Date.now()): boolean {
  return Number.isFinite(sentAtMs)
    && sentAtMs > 0
    && nowMs - sentAtMs < JOIN_REQUEST_COOLDOWN_MS
    && sentAtMs - nowMs <= JOIN_REQUEST_COOLDOWN_MS;
}

/** 剩餘小時，照 A：Math.max(1, Math.ceil((冷卻 - (now - sentAt)) / 3600000))。 */
export function getJoinRequestHoursLeft(sentAtMs: number, nowMs: number = Date.now()): number {
  return Math.max(1, Math.ceil((JOIN_REQUEST_COOLDOWN_MS - (nowMs - sentAtMs)) / 3600000));
}
