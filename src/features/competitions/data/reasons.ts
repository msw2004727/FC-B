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
  // match-host 會丟的代碼。七語文案都先放繁中。
  'RESULTS_EXIST',
  'ROSTERS_NOT_LOCKED',
  'MATCH_STATE',
  'MATCH_NOT_STARTED',
  'MATCH_NOT_SCHEDULED',
  'TEAMS_RANGE',
  'TOO_MANY_MATCHES',
  'SCHEDULE_OUT_OF_RANGE',
  'NOTHING_TO_RESET',
  'SCHEDULE_REQUIRED',
  'STATUS_NOT_EDITABLE',
  'MATCH_NOT_FOUND',
  'DIVISION_NOT_FOUND',
  // Opus 複審 P3：使用者看得到的其餘 match-host 代碼。FIELD_TYPE、FIELD_FORMAT 各自有句子。
  'COMPETITION_HIDDEN',
  'COMPETITION_DELETING',
  // 刪除賽事（host.ts deleteCompetition）。
  'DELETE_AFTER_START',
  'DELETE_FAILED',
  'MATCH_CORRUPT',
  'SCHEDULE_REPLACE_TOO_LARGE',
  'TIMELINE_TOO_LONG',
  // §3.272 F1 取消、結束、恢復。
  'NOT_ADMIN',
  'COMPETITION_NOT_ENDED',
  'RESTORE_NOT_ALLOWED',
  // §3.272 F3 同分裁定與查詢。FIELD_FORMAT 以前走通用文案，契約有列，這裡改對到自己的句子。
  'TIE_NOT_PENDING',
  'TIE_DECISION_EXISTS',
  'TIE_NOT_SAME_POINTS',
  'TIE_NO_DECISION',
  'STANDING_NOT_FOUND',
  'STANDING_CORRUPT',
  'TEAM_NOT_IN_STANDING',
  'BAD_ID',
  'FIELD_ENUM',
  'FIELD_FORMAT',
  // §3.272 F2 賽程彈性、F4 公告與聯絡。對照契約錯誤表。
  'SCHEDULE_CONFLICT',
  'SCHEDULE_DAY_TOO_LARGE',
  'NOTHING_TO_SHIFT',
  'NOTICE_LIMIT',
  'NOTICE_NOT_FOUND',
  'FIELD_TYPE',
  // 第 4 步指派（K2）。COMPETITION_CLOSED 沿用 STATUS_NOT_EDITABLE 的句子。
  'STAFF_NOT_FOUND',
  'STAFF_PROTECTED',
  'FORBIDDEN',
  'COMPETITION_CLOSED',
  // 第 4 步 K11 邀請、K12 下架與檢舉處理。
  'INVITE_LIMIT',
  'INVITE_NOT_FOUND',
  'INVITE_NOT_OPEN',
  'INVITE_INVALID',
  'INVITE_REVOKED',
  'INVITE_USED',
  'INVITE_EXPIRED',
  'NO_CHANGE',
  'REPORT_NOT_FOUND',
  // 賽事封面圖（cpHost create／update 的 cover 欄；field 是 cover、cover.url 或 cover.thumb）。
  'COVER_URL_NOT_ALLOWED',
  // 編輯賽事（host.ts updateCompetition 的組別清單）。
  'DIVISION_HAS_ENTRIES',
  'DIVISION_RULES_LOCKED',
  'DIVISION_BELOW_APPROVED',
  // 主辦賽事開關關閉（host.ts createCompetition，顧問 §3.612）。文案與建賽頁 hostDisabled 同一句。
  'HOST_DISABLED',
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
