/**
 * T-090：Callable createUserTeam／reviewTeamJoin 的錯誤原因碼 → 使用者文案的 i18n key。
 * 伺服器以 HttpsError message 帶原因碼；任何對不上的錯誤一律回通用文案，不得露出原始錯誤。
 */

const REASON_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

/** 從 CallableError／FirebaseError 取出原因碼；取不到回空字串。 */
export function extractCallableReason(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const record = error as { message?: unknown; code?: unknown; details?: unknown };
  const message = typeof record.message === 'string' ? record.message.trim() : '';
  if (REASON_CODE.test(message)) return message;
  const details = record.details;
  if (details && typeof details === 'object') {
    for (const key of ['reason', 'code'] as const) {
      const value = (details as Record<string, unknown>)[key];
      if (typeof value === 'string' && REASON_CODE.test(value.trim())) return value.trim();
    }
  }
  const code = typeof record.code === 'string' ? record.code : '';
  if (code === 'unauthenticated' || code === 'functions/unauthenticated') return 'AUTH_REQUIRED';
  return '';
}

const USER_TEAM_CREATE_KEYS: Readonly<Record<string, string>> = {
  AUTH_REQUIRED: 'clubs.userCreate.error.authRequired',
  INVALID_CALLER_UID: 'clubs.userCreate.error.accountInvalid',
  USER_PROFILE_NOT_FOUND: 'clubs.userCreate.error.accountInvalid',
  USER_IDENTITY_MISMATCH: 'clubs.userCreate.error.accountInvalid',
  INVALID_MEMBERSHIP: 'clubs.userCreate.error.accountInvalid',
  CREATE_USER_TEAM_ROLE_DENIED: 'clubs.userCreate.error.roleDenied',
  CREATE_USER_TEAM_ROLE_UNVERIFIED: 'clubs.userCreate.error.roleUnverified',
  TEAM_CREATE_CAPABILITY_DISABLED: 'clubs.userCreate.error.disabled',
  TEAM_CREATE_CAPABILITY_INVALID: 'clubs.userCreate.error.disabled',
  USER_TEAM_CREATE_LIMIT: 'clubs.userCreate.error.ownLimit',
  TEAM_MEMBERSHIP_LIMIT: 'clubs.userCreate.error.membershipLimit',
  CREATE_USER_TEAM_INVALID_FIELD: 'clubs.userCreate.error.invalid',
  CREATE_USER_TEAM_UNKNOWN_FIELD: 'clubs.userCreate.error.invalid',
  CREATE_USER_TEAM_INVALID_REQUEST_ID: 'clubs.userCreate.error.invalid',
  TEAM_ID_COLLISION: 'clubs.userCreate.error.retry',
  CREATE_USER_TEAM_RETRY: 'clubs.userCreate.error.retry',
};

export const USER_TEAM_CREATE_FALLBACK_KEY = 'clubs.userCreate.error.failed';

/** createUserTeam 錯誤 → i18n key；CREATE_USER_TEAM_FAILED 與未知錯誤都回通用文案。 */
export function userTeamCreateErrorKey(error: unknown): string {
  const reason = extractCallableReason(error);
  return USER_TEAM_CREATE_KEYS[reason] ?? USER_TEAM_CREATE_FALLBACK_KEY;
}

const TEAM_JOIN_REVIEW_KEYS: Readonly<Record<string, string>> = {
  AUTH_REQUIRED: 'clubs.joinReview.error.authRequired',
  INVALID_CALLER_UID: 'clubs.joinReview.error.accountInvalid',
  USER_PROFILE_NOT_FOUND: 'clubs.joinReview.error.accountInvalid',
  USER_IDENTITY_MISMATCH: 'clubs.joinReview.error.accountInvalid',
  INVALID_MEMBERSHIP: 'clubs.joinReview.error.accountInvalid',
  TEAM_JOIN_REVIEW_DENIED: 'clubs.joinReview.error.denied',
  TEAM_JOIN_REQUEST_NOT_FOUND: 'clubs.joinReview.error.notFound',
  TEAM_JOIN_REQUEST_NOT_PENDING: 'clubs.joinReview.error.notPending',
  TEAM_ID_AMBIGUOUS: 'clubs.joinReview.error.teamInvalid',
  TEAM_JOIN_SELF_REVIEW_DENIED: 'clubs.joinReview.error.selfReview',
  TEAM_MEMBERSHIP_LIMIT: 'clubs.joinReview.error.membershipLimit',
};

export const TEAM_JOIN_REVIEW_FALLBACK_KEY = 'clubs.joinReview.error.failed';

/** reviewTeamJoin 錯誤 → i18n key；未知錯誤回通用文案。 */
export function teamJoinReviewErrorKey(error: unknown): string {
  const reason = extractCallableReason(error);
  return TEAM_JOIN_REVIEW_KEYS[reason] ?? TEAM_JOIN_REVIEW_FALLBACK_KEY;
}

/** 帶「可直接顯示給使用者」文案的錯誤；收件匣等呼叫端優先顯示 userMessage。 */
export class UserFacingError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string) {
    super(userMessage);
    this.name = 'UserFacingError';
    this.userMessage = userMessage;
  }
}

export function getUserFacingMessage(error: unknown): string | null {
  return error instanceof UserFacingError && error.userMessage ? error.userMessage : null;
}
