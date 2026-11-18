/**
 * 通知關聯鍵與已知 source。
 * 鍵名與伺服器 `notification-relation-log.js` 的 `relationKeysFromData` 相同（只讀請求頂層）。
 * source 清單與 `notification-fields.js` 的 KNOWN_SOURCE_EXACT／KNOWN_SOURCE_PATTERNS 相同。
 * 鍵只放 Callable 請求頂層，不寫進訊息物件、console、稽核或操作日誌。
 */

export const RELATION_KEY_NAMES = [
  'eventId',
  'teamId',
  'tournamentId',
  'applicantUid',
  'assignmentRole',
] as const;

export type RelationKeyName = (typeof RELATION_KEY_NAMES)[number];

export type NotificationRelationKeys = Partial<Record<RelationKeyName, string>>;

const KNOWN_TEMPLATE_KEYS = [
  'welcome',
  'signup_success',
  'cancel_signup',
  'waitlist_promoted',
  'waitlist_demoted',
  'event_cancelled',
  'role_upgrade',
  'role_application',
  'event_changed',
  'event_relisted',
  'tournament_friendly_host_opened',
  'tournament_friendly_team_apply_host',
  'tournament_friendly_team_approved_applicant',
  'tournament_friendly_team_rejected_applicant',
  'tournament_friendly_team_approved_broadcast',
] as const;

const KNOWN_SOURCE_EXACT = new Set<string>([
  'client:line-push',
  'client:unknown',
  'team_join_request',
  'tournament_register_request',
  'edu_checkin',
  'edu_reminder',
  'edu_report',
  'event_cancel_signup:legacy',
]);

const KNOWN_SOURCE_PATTERNS: readonly RegExp[] = [
  new RegExp(`^template:(${KNOWN_TEMPLATE_KEYS.join('|')})(:admins)?$`),
  /^team_join_review:(approve|reject)$/,
  /^team_join_review:broadcast:(approve|reject)$/,
  /^team_role_assignment:(captain|leader|coach|member)$/,
  /^tournament_review:(approve|reject)$/,
  /^tournament_review:broadcast:(approve|reject)$/,
  /^edu_student_review:(approve|reject)$/,
  /^target:[a-z_]+$/,
];

/** 只留非空字串（trim 後）。非字串、空白、未知名稱都省略，不送空字串。 */
export function pickRelationKeys(
  input: Partial<Record<RelationKeyName, unknown>> | null | undefined,
): NotificationRelationKeys {
  const out: NotificationRelationKeys = {};
  if (!input || typeof input !== 'object') return out;
  for (const name of RELATION_KEY_NAMES) {
    const value = input[name];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    out[name] = trimmed;
  }
  return out;
}

/** 與伺服器 `isKnownSource` 相同：不 trim、不放寬。 */
export function isKnownNotificationSource(source: unknown): boolean {
  if (typeof source !== 'string') return false;
  return KNOWN_SOURCE_EXACT.has(source)
    || KNOWN_SOURCE_PATTERNS.some((pattern) => pattern.test(source));
}
