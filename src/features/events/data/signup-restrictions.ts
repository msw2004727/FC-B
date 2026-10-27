import { parseTaipei } from '@/core/taipei-time';
import type { SignupProfile } from './signup-profile';

/**
 * 活動報名限制的純函式。
 * 逐字移植 A `event-detail-signup.js`、`event-list-helpers.js`、
 * `firebase-crud.js` 對應 helper；每個函式註解標 A 函式名。
 */

// ── 性別限制 ──────────────────────────────────────────

// A `event-list-helpers.js#_normalizeBinaryGender`（第 153～155 行）
function normalizeBinaryGender(value: unknown): '' | '男' | '女' {
  return value === '男' || value === '女' ? value : '';
}

// A `event-list-helpers.js#_getEventAllowedGender`（第 157～160 行）
function getEventAllowedGender(event: { genderRestrictionEnabled?: unknown; allowedGender?: unknown }): '' | '男' | '女' {
  if (!event?.genderRestrictionEnabled) return '';
  return normalizeBinaryGender(event.allowedGender);
}

export interface GenderSignupState {
  restricted: boolean;
  allowedGender: '' | '男' | '女';
  canSignup: boolean;
  requiresLogin: boolean;
  reason: string;
}

// A `event-list-helpers.js#_getEventGenderSignupState`（第 190～206 行）
// B 對應：profile === null 視同 A 的 `!user?.uid`（B 訪客或 profile 未載入）
export function getEventGenderSignupState(
  event: { genderRestrictionEnabled?: unknown; allowedGender?: unknown },
  profile: SignupProfile | null,
): GenderSignupState {
  const allowedGender = getEventAllowedGender(event);
  if (!allowedGender) {
    return { restricted: false, allowedGender: '', canSignup: true, requiresLogin: false, reason: '' };
  }
  if (!profile) {
    return { restricted: true, allowedGender, canSignup: true, requiresLogin: true, reason: '' };
  }
  const userGender = normalizeBinaryGender(profile.gender);
  if (!userGender) {
    return { restricted: true, allowedGender, canSignup: false, requiresLogin: false, reason: 'missing_gender' };
  }
  if (userGender !== allowedGender) {
    return { restricted: true, allowedGender, canSignup: false, requiresLogin: false, reason: 'gender_mismatch' };
  }
  return { restricted: true, allowedGender, canSignup: true, requiresLogin: false, reason: '' };
}

// A `event-list-helpers.js#_getEventGenderDetailText`（第 178～182 行）
function getEventGenderDetailText(event: { genderRestrictionEnabled?: unknown; allowedGender?: unknown }): string {
  const allowedGender = getEventAllowedGender(event);
  if (!allowedGender) return '';
  return allowedGender === '男' ? '限男性報名' : '限女性報名';
}

// A `event-list-helpers.js#_getEventGenderRestrictionMessage`（第 208～215 行）
export function getEventGenderRestrictionMessage(
  event: { genderRestrictionEnabled?: unknown; allowedGender?: unknown },
  reason: string,
): string {
  const detailText = getEventGenderDetailText(event);
  if (!detailText) return '';
  if (reason === 'missing_gender') return `${detailText}，請先到個人資料填寫性別`;
  return `${detailText}，目前無法報名`;
}

// A `event-list-helpers.js#_getEventGenderRibbonText`（第 166～170 行）
export function getEventGenderRibbonText(
  event: { genderRestrictionEnabled?: unknown; allowedGender?: unknown },
): string {
  const allowedGender = getEventAllowedGender(event);
  if (!allowedGender) return '';
  return allowedGender === '男' ? '男生限定' : '女生限定';
}

// A `event-list-helpers.js#_hasEventGenderRestriction`（第 162～164 行）
export function hasEventGenderRestriction(
  event: { genderRestrictionEnabled?: unknown; allowedGender?: unknown },
): boolean {
  return !!getEventAllowedGender(event);
}

// ── 年齡限制 ──────────────────────────────────────────

// A `event-detail-signup.js#_parseEventSignupBirthday`（第 711～723 行）
function parseEventSignupBirthday(value: unknown): Date | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

// A `event-detail-signup.js#_calculateEventSignupAge`（第 733～744 行）
function calculateEventSignupAge(birthday: Date | null, referenceDate: Date): number | null {
  if (!(birthday instanceof Date) || Number.isNaN(birthday.getTime())) return null;
  const ref = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
    ? referenceDate
    : new Date();
  let age = ref.getFullYear() - birthday.getFullYear();
  if (ref.getMonth() < birthday.getMonth()
    || (ref.getMonth() === birthday.getMonth() && ref.getDate() < birthday.getDate())) {
    age -= 1;
  }
  return age >= 0 && age < 130 ? age : null;
}

// A `terminal.ts` 的 parseEventStartDate（A `_parseEventStartDate` 移植版，`前後空白容錯`）
function parseEventStartDate(dateStr: unknown): Date | null {
  if (typeof dateStr !== 'string' || !dateStr) return null;
  const parts = dateStr.split(' ');
  const dateParts = (parts[0] ?? '').split('/');
  if (dateParts.length < 3) return null;
  const y = parseInt(dateParts[0] ?? '', 10);
  const m = parseInt(dateParts[1] ?? '', 10) - 1;
  const d = parseInt(dateParts[2] ?? '', 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const timePartRaw = parts[1];
  if (timePartRaw) {
    const timePart = timePartRaw.split('~')[0] ?? '';
    const [hh, mm] = timePart.split(':').map(Number);
    return new Date(y, m, d, hh || 0, mm || 0);
  }
  return new Date(y, m, d);
}

// A `event-detail-signup.js#_getEventSignupReferenceDate`（第 725～731 行）
function getEventSignupReferenceDate(event: { date?: unknown }, now: Date): Date {
  const start = parseEventStartDate(event?.date);
  if (start instanceof Date && !Number.isNaN(start.getTime())) return start;
  return now;
}

export interface AgeSignupState {
  restricted: boolean;
  canSignup: boolean;
  requiresLogin: boolean;
  reason: string;
  minAge: number;
  age: number | null;
  syncing?: boolean;
}

// A `event-detail-signup.js#_getEventAgeSignupState`（第 761～781 行）
// B 對應：`_isEventSignupUserProfileStillSyncing` 由呼叫端的 profileLoading 處理；
// profile === null 走 A 的 `!user` 分支（requiresLogin、canSignup:false）。
export function getEventAgeSignupState(
  event: { minAge?: unknown; date?: unknown },
  profile: SignupProfile | null,
  now: Date,
): AgeSignupState {
  const minAge = Math.floor(Number(event?.minAge || 0));
  if (!Number.isFinite(minAge) || minAge <= 0) {
    return { restricted: false, canSignup: true, requiresLogin: false, reason: '', minAge: 0, age: null };
  }
  if (!profile) {
    return { restricted: true, canSignup: false, requiresLogin: true, reason: 'login-required', minAge, age: null };
  }
  const birthday = parseEventSignupBirthday(profile.birthday);
  const age = calculateEventSignupAge(birthday, getEventSignupReferenceDate(event, now));
  if (age == null) {
    return { restricted: true, canSignup: false, requiresLogin: false, reason: 'birthday-missing', minAge, age: null };
  }
  if (age < minAge) {
    return { restricted: true, canSignup: false, requiresLogin: false, reason: 'underage', minAge, age };
  }
  return { restricted: false, canSignup: true, requiresLogin: false, reason: '', minAge, age };
}

// A `event-detail-signup.js#_getEventAgeRestrictionButtonText`（第 792～797 行）
export function getEventAgeRestrictionButtonText(
  event: { minAge?: unknown },
  state: AgeSignupState,
): string {
  if (state.reason === 'profile-syncing') return '用戶資料同步中';
  if (state.reason === 'birthday-missing') return '補齊生日';
  const minAge = Math.floor(Number(event?.minAge || 0));
  return minAge > 0 ? `${minAge}歲以上` : '年齡限制';
}

// A `event-detail-signup.js#_getEventAgeRestrictionMessage`（第 783～790 行）
export function getEventAgeRestrictionMessage(
  event: { minAge?: unknown },
  state: AgeSignupState,
): string {
  const minAge = Math.floor(Number(state.minAge || event?.minAge || 0));
  if (state.reason === 'profile-syncing') return '用戶資料同步中，請稍後再試';
  if (state.reason === 'birthday-missing') return '請先補齊生日資料後再報名';
  if (minAge > 0) return `此活動限 ${minAge} 歲以上報名`;
  return '此活動有年齡限制';
}

// ── 早鳥 ──────────────────────────────────────────────

// A `event-detail-signup.js#_getEventEarlyBirdCost`（第 1516～1520 行）
export function getEventEarlyBirdCost(event: { earlyBirdEnabled?: unknown; earlyBirdCost?: unknown }): number {
  if (!event?.earlyBirdEnabled) return 0;
  const cost = Math.floor(Number(event.earlyBirdCost || 0));
  return Number.isFinite(cost) && cost >= 10 && cost <= 500 ? cost : 0;
}

// A `event-detail-signup.js#_isEventEarlyBirdWindow`（第 1522～1531 行）
export function isEventEarlyBirdWindow(
  event: {
    status?: unknown;
    date?: unknown;
    regOpenTime?: unknown;
    earlyBirdEnabled?: unknown;
    earlyBirdCost?: unknown;
  },
  now: Date,
): boolean {
  if (!event || event.status === 'ended' || event.status === 'cancelled') return false;
  if (!getEventEarlyBirdCost(event)) return false;
  if (!event.regOpenTime) return false;
  // regOpenTime 是台北牆鐘。取代 new Date(String(...)) 的裝置本地解析，避免非 UTC+8 把早鳥窗口判錯。
  // null 對應舊的 NaN，仍回 false。開始時間的 parseEventStartDate 是 P01，本卡不動。
  const regOpen = parseTaipei(event.regOpenTime);
  if (regOpen === null || regOpen <= now.getTime()) return false;
  const start = parseEventStartDate(event.date);
  if (start && start <= now) return false;
  return true;
}

// ── 俱樂部預留名額 ────────────────────────────────────

interface NormalizedTeamReservationSummary {
  teamId: string;
  teamName: string;
  reservedSlots: number;
  usedSlots: number;
  remainingSlots: number;
}

// A `firebase-crud.js#_normalizeTeamReservationSummaries`（第 1094～1120 行）
function normalizeTeamReservationSummaries(eventOrSummaries: unknown): NormalizedTeamReservationSummary[] {
  const raw = Array.isArray(eventOrSummaries)
    ? (eventOrSummaries as unknown[])
    : (Array.isArray((eventOrSummaries as { teamReservationSummaries?: unknown } | null)?.teamReservationSummaries)
        ? ((eventOrSummaries as { teamReservationSummaries: unknown[] }).teamReservationSummaries)
        : []);
  const seen = new Set<string>();
  return raw
    .map((item: unknown): NormalizedTeamReservationSummary | null => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as {
        teamId?: unknown;
        id?: unknown;
        teamName?: unknown;
        name?: unknown;
        reservedSlots?: unknown;
        slots?: unknown;
        usedSlots?: unknown;
      };
      const teamId = String(obj.teamId || obj.id || '').trim();
      if (!teamId || seen.has(teamId)) return null;
      seen.add(teamId);
      const reservedSlotsRaw = Number(obj.reservedSlots || obj.slots || 0);
      const reservedSlots = Number.isFinite(reservedSlotsRaw) ? Math.max(0, Math.trunc(reservedSlotsRaw)) : 0;
      const usedSlotsRaw = Number(obj.usedSlots || 0);
      const usedSlots = Number.isFinite(usedSlotsRaw) ? Math.max(0, Math.trunc(usedSlotsRaw)) : 0;
      return {
        teamId,
        teamName: String(obj.teamName || obj.name || teamId).trim(),
        reservedSlots,
        usedSlots,
        remainingSlots: Math.max(0, reservedSlots - usedSlots),
      };
    })
    .filter((x): x is NormalizedTeamReservationSummary => x !== null);
}

// A `event-detail-signup.js#_hasAvailableTeamReservationSignup`（第 1303～1306 行）
// B 對應：候選俱樂部 ID 用 viewer.teamIds
export function hasAvailableTeamReservationSignup(
  event: { teamReservationSummaries?: unknown } | null | undefined,
  viewerTeamIds: ReadonlySet<string>,
): boolean {
  if (!event) return false;
  const candidateIds = new Set(
    Array.from(viewerTeamIds).map((id) => String(id || '').trim()).filter(Boolean),
  );
  if (candidateIds.size === 0) return false;
  const summaries = normalizeTeamReservationSummaries(event);
  const seen = new Set<string>();
  const choices = summaries
    .filter((item) => candidateIds.has(item.teamId))
    .filter((item) => item.reservedSlots > 0 || item.usedSlots > 0)
    .map((item) => {
      if (seen.has(item.teamId)) return null;
      seen.add(item.teamId);
      return { teamId: item.teamId, remainingSlots: item.remainingSlots };
    })
    .filter((x): x is { teamId: string; remainingSlots: number } => x !== null);
  return choices.some((item) => item.remainingSlots > 0);
}
