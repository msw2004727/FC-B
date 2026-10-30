/** 名單狀態調整：不把伺服器原始訊息顯示給使用者。 */
export const ROSTER_STATUS_ERROR_KEYS: Readonly<Record<string, string>> = {
  UNAUTHENTICATED: 'loginRequired',
  INVALID_ARGUMENT: 'statusFailed',
  EVENT_NOT_FOUND: 'eventMissing',
  REG_NOT_FOUND: 'regMissing',
  PERMISSION_DENIED: 'noPermission',
  COURSE_LINKED_USE_MANAGE_CALLABLE: 'useLegacyForCourse',
  REGISTRATION_NOT_CONFIRMED: 'statusFailed',
  REGISTRATION_NOT_WAITLISTED: 'statusFailed',
  WAITLIST_DISABLED: 'noWaitlistCap',
  COMPANION_CANNOT_DEMOTE_ALONE: 'companionDemoteAlone',
  CAPACITY_EXCEEDED: 'overCapacityRejected',
  FORCE_DEMOTE_FAILED: 'statusFailed',
  FORCE_PROMOTE_FAILED: 'statusFailed',
};
export function rosterStatusErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const e = error as { details?: { code?: unknown }; message?: unknown; code?: unknown };
  if (typeof e.details?.code === 'string' && e.details.code.trim()) return e.details.code.trim();
  const message = typeof e.message === 'string' ? e.message : '';
  for (const code of Object.keys(ROSTER_STATUS_ERROR_KEYS)) {
    if (message.includes(code)) return code;
  }
  const code = typeof e.code === 'string' ? e.code.replace(/^functions\//, '').toUpperCase().replace(/-/g, '_') : '';
  if (code in ROSTER_STATUS_ERROR_KEYS) return code;
  if (['UNAVAILABLE', 'DEADLINE_EXCEEDED'].includes(code)
    || /timeout|network|fetch|逾時/i.test(message)) return 'TIMEOUT';
  return code;
}
