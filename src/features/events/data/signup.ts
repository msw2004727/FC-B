/**
 * 活動報名／取消資料層。
 *
 * 契約重點：
 *  - 報名、取消**只能**透過既有 Callable（`registerForEvent`、`cancelRegistration`）；
 *    本檔不得有任何 Firestore 直寫 fallback（p1-data-contract 總則 1）。
 *  - 送出的 payload 與 A 前端相同（A07/A08/A09/A10 的 `cfPayload` 組法）。
 *  - 防連點：同一活動進行中的請求共用同一個 Promise；成功與失敗都清除（L-08）。
 *  - 錯誤一律轉為 `SignupError`，`messageKey` 對應 A 的 cfMsg 文案。
 */

import { CallableError, callFn } from '@/data/callables';
import type {
  CancelRegistrationRequest,
  CancelRegistrationResponse,
  RegisterForEventRequest,
  RegisterForEventResponse,
} from '@/data/contract/callables';
import { emit } from '@/core/events';

import type { EventDoc, RegistrationDoc, ViewerContext } from './types';
import { isEventVisibleToUser } from './visibility';
import { eventStartMs } from './terminal';

// ── Payload 建構（純函式） ─────────────────────────────

export interface BuildRegisterPayloadInput {
  eventId: string;
  /** 目前登入者（uid 為必填）；`userName` 依 A 為 `displayName || name || '用戶'`。 */
  user: { uid: string; displayName?: string | null; name?: string | null };
  /**
   * 同行者（不含本人）。本人永遠是 participants[0]；
   * A09 對同行者每筆也使用主報名人 uid，只多帶 companionId/companionName。
   */
  companions?: { companionId: string; companionName: string }[];
  /** A07 `isEarlyBirdSignup` 為 true 時附帶。 */
  earlyBirdAccepted?: boolean;
  /** A07 `earlyBirdCost`，預設 0。 */
  earlyBirdExpectedCost?: number;
  /** A07/A09 有送 `teamKey`（team-split 自選）；Functions 契約雖未收，仍與 A 保持一致。 */
  teamKey?: string;
  /** A07/A09 `preferredTeamReservationTeamId`。 */
  preferredTeamReservationTeamId?: string;
  /** 測試注入：預設 `Date.now()`。 */
  now?: number;
  /** 測試注入：預設 `Math.random().toString(36).slice(2, 5)`。 */
  randomSuffix?: string;
}

/**
 * 依 A 組 `cfPayload`。
 *
 * 對應 A07 line ~1966：
 *   signupRequestId = `${userId}_${eventId}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
 * 對應 A09 line ~365：requestId 格式同上，participants 組法見 cfParticipants。
 */
export function buildRegisterPayload(input: BuildRegisterPayloadInput): RegisterForEventRequest {
  const uid = input.user.uid;
  const userName = pickUserName(input.user);

  const participants: {
    userId: string;
    userName: string;
    companionId?: string;
    companionName?: string;
  }[] = [{ userId: uid, userName }];

  for (const companion of input.companions ?? []) {
    participants.push({
      userId: uid,
      userName,
      companionId: companion.companionId,
      companionName: companion.companionName,
    });
  }

  const requestId = buildSignupRequestId(input, uid);

  // A07/A09 有將 teamKey 放入 cfPayload（Functions 端目前忽略）。
  // 型別仍標 RegisterForEventRequest，runtime 帶 teamKey 以保持與 A 相同。
  const payload: RegisterForEventRequest & { teamKey?: string } = {
    eventId: input.eventId,
    participants,
    requestId,
  };

  if (input.earlyBirdAccepted === true) {
    payload.earlyBirdAccepted = true;
    payload.earlyBirdExpectedCost = input.earlyBirdExpectedCost ?? 0;
  }
  if (input.preferredTeamReservationTeamId) {
    payload.preferredTeamReservationTeamId = input.preferredTeamReservationTeamId;
  }
  if (input.teamKey) {
    payload.teamKey = input.teamKey;
  }

  return payload;
}

export interface BuildCancelPayloadInput {
  eventId: string;
  userId: string;
  registrationIds: string[];
  /**
   * `self`：單筆本人取消（A08，走 `cancel_${uid}_${eventId}_${ts}_${rand}`）。
   * `companion`：透過同行者 modal 取消（A10，`cancel_companion_${uid}_${eventId}_${ts}`，無 random）。
   */
  kind: 'self' | 'companion';
  now?: number;
  randomSuffix?: string;
}

/** 依 A 組 `cancelRegistration` payload（A08 / A10）。 */
export function buildCancelPayload(input: BuildCancelPayloadInput): CancelRegistrationRequest {
  const requestId =
    input.kind === 'companion'
      ? `cancel_companion_${input.userId}_${input.eventId}_${input.now ?? Date.now()}`
      : `cancel_${input.userId}_${input.eventId}_${input.now ?? Date.now()}_${input.randomSuffix ?? Math.random().toString(36).slice(2, 5)}`;

  return {
    eventId: input.eventId,
    registrationIds: input.registrationIds,
    reason: 'user_cancel',
    requestId,
  };
}

function pickUserName(user: { displayName?: string | null; name?: string | null }): string {
  const displayName = typeof user.displayName === 'string' ? user.displayName.trim() : '';
  if (displayName.length > 0) return displayName;
  const name = typeof user.name === 'string' ? user.name.trim() : '';
  if (name.length > 0) return name;
  return '用戶';
}

function buildSignupRequestId(input: BuildRegisterPayloadInput, uid: string): string {
  const nowMs = input.now ?? Date.now();
  const randomPart = input.randomSuffix ?? Math.random().toString(36).slice(2, 5);
  return `${uid}_${input.eventId}_${nowMs}_${randomPart}`;
}

// ── 報名前檢查 ────────────────────────────────────────

export type SignupPrecheckReason =
  | 'event_unavailable'
  | 'event_ended'
  | 'event_not_open'
  | 'event_team_only_restricted'
  | 'already_registered';

export type SignupPrecheckResult =
  | { ok: true }
  | { ok: false; reason: SignupPrecheckReason; messageKey: string };

/**
 * 依 A07/A09 的 `handleSignup` 前端檢查組裝報名前阻擋條件。
 *
 * 對應原始碼：
 *  - A07 line ~1802：黑名單 / 私密（以 `_isEventVisibleToUser` 為守衛）→「此活動目前無法報名」。
 *  - A07 line ~1810：`status` 為 `ended`／`cancelled` →「活動已開始，報名已結束」。
 *  - A07 line ~1820：`status === 'upcoming' && !earlyBirdWindow` →「報名尚未開放，請稍後再試」。
 *  - A07 line ~1823：`teamOnly` 且非該隊成員 →「俱樂部限定活動，僅限該隊成員報名」。
 *  - A07 line ~1858：`_parseEventStartDate(e.date)` 已過且非 ended/cancelled → 阻擋報名。
 *  - A07 line ~1878：已有 active self registration →「你已經報名這場活動」。
 *
 * 注意：A07 另有性別／年齡限制檢查，但依賴 `EventDoc` 的性別／年齡欄位與使用者 profile，
 * B 目前 `EventDoc` / `ViewerContext` 型別未涵蓋；待型別擴充後於此處補上（不在本層擅讀未宣告欄位）。
 */
export function precheckSignup(
  event: EventDoc,
  viewer: ViewerContext,
  viewerRegistrations: readonly RegistrationDoc[],
  now: Date,
): SignupPrecheckResult {
  if (!isEventVisibleToUser(event, viewer, viewerRegistrations)) {
    return {
      ok: false,
      reason: 'event_unavailable',
      messageKey: 'event.signup.unavailable',
    };
  }

  if (event.status === 'ended' || event.status === 'cancelled') {
    return {
      ok: false,
      reason: 'event_ended',
      messageKey: 'event.signup.ended',
    };
  }

  if (event.status === 'upcoming') {
    return {
      ok: false,
      reason: 'event_not_open',
      messageKey: 'event.signup.notOpen',
    };
  }

  if (!canSignupTeamOnly(event, viewer)) {
    return {
      ok: false,
      reason: 'event_team_only_restricted',
      messageKey: 'event.signup.teamOnlyRestricted',
    };
  }

  // A07 line ~1858：`_parseEventStartDate(e.date)` 已過且非 ended/cancelled → 阻止報名。
  const startMs = eventStartMs(event);
  if (
    startMs > 0
    && startMs <= now.getTime()
    && event.status !== 'ended'
    && event.status !== 'cancelled'
  ) {
    return {
      ok: false,
      reason: 'event_ended',
      messageKey: 'event.signup.ended',
    };
  }

  if (viewer.uid && hasActiveSelfRegistration(viewerRegistrations, viewer.uid)) {
    return {
      ok: false,
      reason: 'already_registered',
      messageKey: 'event.signup.alreadyRegistered',
    };
  }

  return { ok: true };
}

function canSignupTeamOnly(event: EventDoc, viewer: ViewerContext): boolean {
  if (!event.teamOnly) return true;
  const teamIds = collectEventTeamIds(event);
  if (teamIds.length === 0) return true;

  const uid = viewer.uid;
  if (uid) {
    if (event.creatorUid === uid || event.ownerUid === uid) return true;
    if (Array.isArray(event.delegateUids) && event.delegateUids.includes(uid)) return true;
  }
  if (viewer.hasPermission('event.edit_all')) return true;
  if (viewer.roleLevel >= 4) return true;

  for (const teamId of teamIds) {
    if (viewer.teamIds.has(teamId)) return true;
  }
  return false;
}

function collectEventTeamIds(event: EventDoc): string[] {
  const out: string[] = [];
  if (typeof event.creatorTeamId === 'string' && event.creatorTeamId.length > 0) {
    out.push(event.creatorTeamId);
  }
  if (Array.isArray(event.creatorTeamIds)) {
    for (const value of event.creatorTeamIds) {
      if (typeof value === 'string' && value.length > 0 && !out.includes(value)) {
        out.push(value);
      }
    }
  }
  return out;
}

function hasActiveSelfRegistration(regs: readonly RegistrationDoc[], uid: string): boolean {
  for (const reg of regs) {
    if (reg.status === 'cancelled' || reg.status === 'removed') continue;
    if (reg.participantType === 'companion') continue;
    const regUid = reg.userId ?? reg.uid;
    if (regUid !== uid) continue;
    return true;
  }
  return false;
}

// ── SignupError ──────────────────────────────────────

export class SignupError extends Error {
  /** Firebase Functions 錯誤碼（CallableError.code，例如 `failed-precondition`）。 */
  readonly code: string;
  /** A 前端使用的業務錯誤碼（`details` 內字串，例如 `PROFILE_INCOMPLETE`）。 */
  readonly originalCode: string;
  /** i18n messageKey；對應 A07/A08/A09/A10 的 `cfMsg`。 */
  readonly messageKey: string;

  constructor(params: {
    code: string;
    originalCode: string;
    messageKey: string;
    message: string;
  }) {
    super(params.message);
    this.name = 'SignupError';
    this.code = params.code;
    this.originalCode = params.originalCode;
    this.messageKey = params.messageKey;
  }
}

// A07 line ~2064 cfMsg; A09 line ~420 cfMsg（合併）
const REGISTER_ERROR_MESSAGE_KEYS: Record<string, string> = {
  ALREADY_REGISTERED: 'event.signup.error.alreadyRegistered',
  EVENT_NOT_FOUND: 'event.signup.error.eventNotFound',
  EVENT_ENDED: 'event.signup.error.eventEnded',
  EVENT_CANCELLED: 'event.signup.error.eventCancelled',
  REG_NOT_OPEN: 'event.signup.error.regNotOpen',
  EARLY_BIRD_NOT_AVAILABLE: 'event.signup.error.earlyBirdNotAvailable',
  EARLY_BIRD_CONFIRM_REQUIRED: 'event.signup.error.earlyBirdConfirmRequired',
  EARLY_BIRD_SELF_ONLY: 'event.signup.error.earlyBirdSelfOnly',
  EARLY_BIRD_COST_CHANGED: 'event.signup.error.earlyBirdCostChanged',
  EARLY_BIRD_INSUFFICIENT_EXP: 'event.signup.error.earlyBirdInsufficientExp',
  EARLY_BIRD_FULL: 'event.signup.error.earlyBirdFull',
  GENDER_RESTRICTED: 'event.signup.error.genderRestricted',
  TEAM_RESTRICTED: 'event.signup.error.teamRestricted',
  COURSE_LINKED_EVENT_PRIVATE_REGISTRATION: 'event.signup.error.courseLinkedPrivate',
  COURSE_LINKED_EVENT_MANAGED_BY_COURSE: 'event.signup.error.courseLinkedManaged',
  COURSE_LINKED_REGISTRATION_MANAGED_BY_COURSE: 'event.signup.error.courseLinkedManaged',
  PROFILE_INCOMPLETE: 'event.signup.error.profileIncomplete',
  TEAM_RESERVATION_TEAM_DENIED: 'event.signup.error.teamReservationDenied',
  TEAM_RESERVATION_TEAM_NOT_AVAILABLE: 'event.signup.error.teamReservationUnavailable',
};

// A08 line ~2718 cfMsg; A10 line ~737 cfMsg
const CANCEL_ERROR_MESSAGE_KEYS: Record<string, string> = {
  ALREADY_CANCELLED: 'event.cancel.error.alreadyCancelled',
  REG_NOT_FOUND: 'event.cancel.error.regNotFound',
  EVENT_NOT_FOUND: 'event.cancel.error.eventNotFound',
  PERMISSION_DENIED: 'event.cancel.error.permissionDenied',
};

function extractOriginalCode(err: CallableError): string {
  if (typeof err.details === 'string' && err.details.length > 0) return err.details;
  if (typeof err.message === 'string' && err.message.length > 0) return err.message;
  return err.code;
}

function toSignupError(
  err: unknown,
  map: Record<string, string>,
  scope: 'register' | 'cancel',
): SignupError {
  if (err instanceof SignupError) return err;

  const fallbackKey = scope === 'register' ? 'event.signup.error.unknown' : 'event.cancel.error.unknown';

  if (err instanceof CallableError) {
    const originalCode = extractOriginalCode(err);
    const messageKey = map[originalCode] ?? fallbackKey;
    return new SignupError({
      code: err.code,
      originalCode,
      messageKey,
      message: err.message,
    });
  }

  const message = err instanceof Error ? err.message : String(err);
  return new SignupError({
    code: 'unknown',
    originalCode: '',
    messageKey: fallbackKey,
    message,
  });
}

// ── 進行中請求（防連點） ─────────────────────────────

const inflightRegister = new Map<string, Promise<RegisterForEventResponse>>();
const inflightCancel = new Map<string, Promise<CancelRegistrationResponse>>();

// ── 對外 API ─────────────────────────────────────────

export interface RegisterForEventInput {
  eventId: string;
  user: { uid: string; displayName?: string | null; name?: string | null };
  companions?: { companionId: string; companionName: string }[];
  earlyBirdAccepted?: boolean;
  earlyBirdExpectedCost?: number;
  teamKey?: string;
  preferredTeamReservationTeamId?: string;
  now?: number;
  randomSuffix?: string;
}

/**
 * 呼叫 `registerForEvent` callable；成功時 emit `registration:created`。
 *
 * 同一 eventId 的進行中請求共用 Promise；成功與失敗都從 Map 移除（L-08）。
 * 本函式**不得**含任何 Firestore 直寫 fallback。
 */
export function registerForEvent(input: RegisterForEventInput): Promise<RegisterForEventResponse> {
  const key = input.eventId;
  const existing = inflightRegister.get(key);
  if (existing !== undefined) return existing;

  const inner = (async (): Promise<RegisterForEventResponse> => {
    const payload = buildRegisterPayload({
      eventId: input.eventId,
      user: input.user,
      companions: input.companions,
      earlyBirdAccepted: input.earlyBirdAccepted,
      earlyBirdExpectedCost: input.earlyBirdExpectedCost,
      teamKey: input.teamKey,
      preferredTeamReservationTeamId: input.preferredTeamReservationTeamId,
      now: input.now,
      randomSuffix: input.randomSuffix,
    });

    let response: RegisterForEventResponse;
    try {
      response = await callFn('registerForEvent', payload);
    } catch (err) {
      throw toSignupError(err, REGISTER_ERROR_MESSAGE_KEYS, 'register');
    }

    if (!response.deduplicated) {
      emit('registration:created', { eventId: input.eventId, userId: input.user.uid });
    }
    return response;
  })();

  let tracked: Promise<RegisterForEventResponse>;
  tracked = inner.finally(() => {
    if (inflightRegister.get(key) === tracked) inflightRegister.delete(key);
  });
  inflightRegister.set(key, tracked);
  return tracked;
}

export interface CancelRegistrationInput {
  eventId: string;
  userId: string;
  registrationIds: string[];
  kind: 'self' | 'companion';
  now?: number;
  randomSuffix?: string;
}

/**
 * 呼叫 `cancelRegistration` callable；成功時 emit `registration:cancelled`。
 *
 * 同一 eventId 的進行中請求共用 Promise；成功與失敗都從 Map 移除（L-08）。
 */
export function cancelRegistration(input: CancelRegistrationInput): Promise<CancelRegistrationResponse> {
  const key = input.eventId;
  const existing = inflightCancel.get(key);
  if (existing !== undefined) return existing;

  const inner = (async (): Promise<CancelRegistrationResponse> => {
    const payload = buildCancelPayload({
      eventId: input.eventId,
      userId: input.userId,
      registrationIds: input.registrationIds,
      kind: input.kind,
      now: input.now,
      randomSuffix: input.randomSuffix,
    });

    let response: CancelRegistrationResponse;
    try {
      response = await callFn('cancelRegistration', payload);
    } catch (err) {
      throw toSignupError(err, CANCEL_ERROR_MESSAGE_KEYS, 'cancel');
    }

    if (!response.deduplicated) {
      emit('registration:cancelled', { eventId: input.eventId, userId: input.userId });
    }
    return response;
  })();

  let tracked: Promise<CancelRegistrationResponse>;
  tracked = inner.finally(() => {
    if (inflightCancel.get(key) === tracked) inflightCancel.delete(key);
  });
  inflightCancel.set(key, tracked);
  return tracked;
}
