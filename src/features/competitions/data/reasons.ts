// reason → i18n 鍵。契約 §5 全部列出；未知 reason 回通用失敗鍵。
// 畫面不得顯示英文代碼，呼叫端用這個鍵拿繁中文案。
//
// ASSUMPTION: 契約只逐字指定「俱樂部資料同步中」、「名稱包含不允許的字詞」、
// 「名單已鎖定，不能再修改」與其他一律「操作失敗，請稍後再試」。
// 其餘 reason 的句子依代碼語意撰寫，七語先放同一份繁中。
// BIRTHDAY_REQUIRED 的「導去補生日」是下一張卡的畫面行為，文案用「請先補上生日」。

export const CP_REASON_CODES = [
  'INTERNAL_PERIOD',
  'INTERNAL_COMPETITION',
  'NOT_HOST',
  'NOT_CREATOR',
  'NOT_PRIMARY_HOST',
  'NOT_CLUB_REP',
  'NOT_CLUB_MEMBER',
  'CLUB_SYNC_PENDING',
  'BANNED_WORD',
  'HOST_QUOTA_ACTIVE',
  'HOST_QUOTA_30D',
  'FEE_NOT_ALLOWED',
  'PAYMENT_NOT_ALLOWED',
  'CLUB_QUOTA_ACTIVE',
  'REG_NOT_OPEN',
  'REG_CLOSED',
  'ENTRY_EXISTS',
  'ENTRY_RETRY_LIMIT',
  'DIVISION_FULL',
  'DIVISION_APPROVED_FULL',
  'ROSTER_FULL',
  'ROSTER_SIZE',
  'ROSTERS_LOCKED',
  'COMPETITION_STARTED',
  'BIRTHDAY_REQUIRED',
  'BIRTHDAY_INVALID',
  'AGE_NOT_ELIGIBLE',
  'REAL_NAME_REQUIRED',
  'GUARDIAN_CONSENT_REQUIRED',
  'MINOR_PUBLIC_NAME',
  'PRIVACY_ACK_REQUIRED',
  'ALREADY_IN_ROSTER',
  'NUMBER_TAKEN',
  'PLAYER_DUPLICATE',
  'TEAM_NAME_MISMATCH',
  'REPORT_RATE_LIMITED',
  'SCHEDULE_ORDER',
  'SCHEDULE_PAST',
  'FIELD_REQUIRED',
  'FIELD_LENGTH',
  'FIELD_RANGE',
  // 第 3 步（契約 §2）。UNKNOWN_FIELD 仍走通用失敗鍵，不另列。
  'SCHEDULE_UNPLACED',
  'REV_CONFLICT',
  'COMPETITION_ENDED',
  'SCHEDULE_EXISTS',
  'SCORE_MISMATCH',
] as const;

export type CpReasonCode = (typeof CP_REASON_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(CP_REASON_CODES);

/** 未知 reason（含 Callable 轉出來的 UNKNOWN）用的鍵。 */
export const CP_REASON_FALLBACK_KEY = 'competitions.reason.UNKNOWN';

/** 已知 reason 回 competitions.reason.<CODE>；其他回通用失敗鍵。 */
export function cpReasonKey(reason: string): string {
  if (CODE_SET.has(reason)) return `competitions.reason.${reason}`;
  return CP_REASON_FALLBACK_KEY;
}
