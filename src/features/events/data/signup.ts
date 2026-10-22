/**
 * 活動報名／取消資料層；僅呼叫既有 Callable，沒有 Firestore 寫入或 fallback。
 *
 * 核實依據：
 * - A07：本人報名、早鳥、開始時間、本人重複報名守衛。
 * - A09：依選取順序送出 participants，可只選同行者；不支援早鳥。
 * - A08：本人取消有狀態／開始時間守衛，目標去空值後最多 20 筆。
 * - A10：直接送出 checked；沒有 A08 的時間守衛或 slice(0, 20)。
 * - Functions：報名 1～10 人，首筆 userId 必須是 caller；
 *   只有「第一筆且沒有 companionId」會被判為本人。
 *
 * 整合契約：
 * - 保留既有函式名稱、必要參數及回傳型別；新參數全部 optional。
 * - 正式操作入口必須提供 context，省略時拒絕，避免沿用無守衛的寫入路徑。
 * - context.load 必須在每次操作讀取最新資料，完成 A 的有效狀態、早鳥、
 *   個人資料、性別／年齡及隊伍選擇判定；不得把 UI 開頁時的結果直接重用。
 * - getAuth 必須讀取即時認證狀態；generation 在每次認證身分切換時遞增，
 *   包括 A → B → A，不能只使用 UID。
 * - context 的介面在本檔定義；沒有臆造附件未提供的 Firebase／profile API。
 *
 * 驗證狀態：依附件靜態核對；工作區命令工具無法啟動，未執行 TS／vitest。
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

export type SignupParticipant =
  | { type: 'self' }
  | { type: 'companion'; companionId: string; companionName: string };

export interface BuildRegisterPayloadInput {
  eventId: string;
  user: { uid: string; displayName?: string | null; name?: string | null };
  /** 舊介面：省略 participants 時，維持「本人 + companions」。 */
  companions?: { companionId: string; companionName: string }[];
  /**
   * A09 實際選取內容及順序；可只有同行者。
   * 不得同時提供 companions。
   * Functions 只有第一筆可判為本人，因此本人若有選取，必須位於第一筆。
   */
  participants?: readonly SignupParticipant[];
  earlyBirdAccepted?: boolean;
  earlyBirdExpectedCost?: number;
  teamKey?: string;
  preferredTeamReservationTeamId?: string;
  /** 照 A _confirmCompanionRegisterUnlocked 的 requestId 與名稱 fallback。 */
  companionToggle?: boolean;
  now?: number;
  randomSuffix?: string;
}

export interface BuildCancelPayloadInput {
  eventId: string;
  userId: string;
  registrationIds: string[];
  kind: 'self' | 'companion';
  /** 照 A _confirmCompanionRegisterUnlocked 的 reason 與 requestId。 */
  companionToggle?: boolean;
  now?: number;
  randomSuffix?: string;
}

export class SignupError extends Error {
  readonly code: string;
  readonly originalCode: string;
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

function operationError(
  scope: 'signup' | 'cancel',
  originalCode: string,
  message: string,
  code = 'failed-precondition',
): SignupError {
  return new SignupError({
    code,
    originalCode,
    messageKey: `event.${scope}.error.${originalCode.toLowerCase()}`,
    message,
  });
}

function requireIdentifier(value: string, field: string, scope: 'signup' | 'cancel'): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw operationError(scope, 'INVALID_ARGUMENT', `${field} is required`, 'invalid-argument');
  }
}

function selectParticipants(input: BuildRegisterPayloadInput): SignupParticipant[] {
  if (input.participants !== undefined && input.companions !== undefined) {
    throw operationError(
      'signup',
      'INVALID_ARGUMENT',
      'participants 與 companions 不得同時提供',
      'invalid-argument',
    );
  }

  const selected: SignupParticipant[] = input.participants !== undefined
    ? input.participants.map((participant) => ({ ...participant }))
    : [
        { type: 'self' },
        ...(input.companions ?? []).map((companion): SignupParticipant => ({
          type: 'companion',
          companionId: companion.companionId,
          companionName: companion.companionName,
        })),
      ];

  if (selected.length === 0 || selected.length > 10) {
    throw operationError(
      'signup',
      'INVALID_ARGUMENT',
      'participants must be an array (1-10)',
      'invalid-argument',
    );
  }

  selected.forEach((participant, index) => {
    if (participant.type === 'self') {
      if (index !== 0) {
        throw operationError(
          'signup',
          'INVALID_ARGUMENT',
          'Functions 僅將第一筆且沒有 companionId 的參與者視為本人',
          'invalid-argument',
        );
      }
      return;
    }
    if (participant.type !== 'companion') {
      throw operationError('signup', 'INVALID_ARGUMENT', 'Unknown participant type', 'invalid-argument');
    }
    requireIdentifier(participant.companionId, 'companionId', 'signup');
    if (typeof participant.companionName !== 'string') {
      throw operationError('signup', 'INVALID_ARGUMENT', 'Invalid companionName', 'invalid-argument');
    }
  });

  return selected;
}

export function buildRegisterPayload(input: BuildRegisterPayloadInput): RegisterForEventRequest {
  requireIdentifier(input.eventId, 'eventId', 'signup');
  requireIdentifier(input.user.uid, 'user.uid', 'signup');

  const selected = selectParticipants(input);
  // A07/A09 使用 ||，不得自行 trim 顯示名稱。
  const userName = input.user.displayName || input.user.name
    || (input.companionToggle ? '使用者' : '用戶');
  const participants = selected.map((participant) => {
    const operator = { userId: input.user.uid, userName };
    return participant.type === 'self'
      ? operator
      : {
          ...operator,
          companionId: participant.companionId,
          companionName: participant.companionName,
        };
  });

  const payload: RegisterForEventRequest & { teamKey?: string } = {
    eventId: input.eventId,
    participants,
    requestId: `${input.user.uid}_${input.eventId}_${input.companionToggle ? 'companions_' : ''}${input.now ?? Date.now()}_${input.randomSuffix ?? Math.random().toString(36).slice(2, 5)}`,
  };

  if (input.earlyBirdAccepted === true) {
    payload.earlyBirdAccepted = true;
    payload.earlyBirdExpectedCost = input.earlyBirdExpectedCost ?? 0;
  }
  if (input.teamKey) payload.teamKey = input.teamKey;

  // A07 reservationChoice.teamId / A09 opts.preferredTeamReservationTeamId。
  const reservationTeamId = input.preferredTeamReservationTeamId?.trim();
  if (reservationTeamId) payload.preferredTeamReservationTeamId = reservationTeamId;

  return payload;
}

export function buildCancelPayload(input: BuildCancelPayloadInput): CancelRegistrationRequest {
  requireIdentifier(input.eventId, 'eventId', 'cancel');
  requireIdentifier(input.userId, 'userId', 'cancel');

  // A08 已選定 primary + extras；此處接受選取結果，不猜測其他報名目標。
  // A10 checked 原樣送出，超過後端限制時拒絕，不能默默取消其中一部分。
  const registrationIds = input.kind === 'self'
    ? input.registrationIds.filter(Boolean).slice(0, 20)
    : [...input.registrationIds];

  if (registrationIds.length === 0 || registrationIds.length > 20) {
    throw operationError(
      'cancel',
      'INVALID_ARGUMENT',
      'registrationIds must be an array (1-20)',
      'invalid-argument',
    );
  }
  for (const id of registrationIds) requireIdentifier(id, 'registrationId', 'cancel');

  const timestamp = input.now ?? Date.now();
  const requestId = input.kind === 'companion'
    ? `cancel_companion_${input.companionToggle ? 'toggle_' : ''}${input.userId}_${input.eventId}_${timestamp}`
    : `cancel_${input.userId}_${input.eventId}_${timestamp}_${input.randomSuffix ?? Math.random().toString(36).slice(2, 5)}`;

  return {
    eventId: input.eventId,
    registrationIds,
    reason: input.kind === 'companion' && input.companionToggle
      ? 'companion_toggle' : 'user_cancel',
    requestId,
  };
}

export type SignupPrecheckReason =
  | 'login_required'
  | 'profile_incomplete'
  | 'event_unavailable'
  | 'event_ended'
  | 'event_started'
  | 'event_not_open'
  | 'event_team_only_restricted'
  | 'team_selection_required'
  | 'gender_restricted'
  | 'age_restricted'
  | 'early_bird_confirm_required'
  | 'early_bird_self_only'
  | 'already_registered';

export type SignupPrecheckResult =
  | { ok: true }
  | { ok: false; reason: SignupPrecheckReason; messageKey: string; message?: string };

export interface SignupPrecheckOptions {
  /** 省略代表 A07 本人報名；提供代表 A09 選人流程。 */
  participants?: readonly SignupParticipant[];
  earlyBirdWindow?: boolean;
  earlyBirdAccepted?: boolean;
  profileComplete?: boolean;
  /** 由最新使用者及選取同行者資料計算；包含 A07/A09 的性別／年齡檢查。 */
  participantCheck?: SignupPrecheckResult;
  /** A _canSignupTeamOnlyEvent 的已核實結果；不能拿可見性權限充當報名資格。 */
  teamSignupAllowed?: boolean;
  requiresTeamSelection?: boolean;
  teamKey?: string;
}

const PRECHECK_MESSAGES: Record<SignupPrecheckReason, string> = {
  login_required: '請先登入',
  profile_incomplete: '請先完善個人資料後再報名',
  event_unavailable: '此活動目前無法報名',
  event_ended: '活動已開始，報名已結束',
  event_started: '活動已於開始時間結束，無法報名',
  event_not_open: '報名尚未開放，請稍後再試',
  event_team_only_restricted: '俱樂部限定活動，僅限該隊成員報名',
  team_selection_required: '請先選擇隊伍',
  gender_restricted: '此活動不符合目前性別限制',
  age_restricted: '此活動有年齡限制',
  early_bird_confirm_required: '請先確認早鳥報名扣點說明',
  early_bird_self_only: '早鳥報名僅支援本人報名',
  already_registered: '你已經報名這場活動',
};

function rejected(reason: SignupPrecheckReason, messageKey: string): SignupPrecheckResult {
  return { ok: false, reason, messageKey };
}

/**
 * 對齊附件 terminal.ts 所列的 A _parseEventStartDate。
 * 只讀 date，保留 split(' ')、斜線日期與 ~ 的原始語意；
 * 不接受首頁 parser 額外支援的 ISO、連字號日期或 startAt/startTime fallback。
 */
function parseSignupStartDate(dateStr: unknown): Date | null {
  if (typeof dateStr !== 'string' || !dateStr) return null;
  const parts = dateStr.split(' ');
  const dateParts = (parts[0] ?? '').split('/');
  if (dateParts.length < 3) return null;
  const year = parseInt(dateParts[0] ?? '', 10);
  const month = parseInt(dateParts[1] ?? '', 10) - 1;
  const day = parseInt(dateParts[2] ?? '', 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const timePartRaw = parts[1];
  if (timePartRaw) {
    const timePart = timePartRaw.split('~')[0] ?? '';
    const [hour, minute] = timePart.split(':').map(Number);
    return new Date(year, month, day, hour || 0, minute || 0);
  }
  return new Date(year, month, day);
}

function hasStarted(event: EventDoc, now: Date): boolean {
  const start = parseSignupStartDate(event.date);
  return start !== null && start.getTime() <= now.getTime();
}

function hasActiveSelfRegistration(
  registrations: readonly RegistrationDoc[],
  eventId: string | undefined,
  uid: string,
): boolean {
  if (!eventId) return false;
  return registrations.some((registration) => {
    if (registration.eventId !== eventId) return false;
    if (registration.status === 'cancelled' || registration.status === 'removed') return false;
    // 歷史資料可能只有 companionId，沒有 participantType。
    const companionId: unknown = (
      registration as RegistrationDoc & { companionId?: unknown }
    ).companionId;
    if (registration.participantType === 'companion' || companionId) return false;
    return (registration.userId ?? registration.uid) === uid;
  });
}

export function precheckSignup(
  event: EventDoc,
  viewer: ViewerContext,
  viewerRegistrations: readonly RegistrationDoc[],
  now: Date,
  options: SignupPrecheckOptions = {},
): SignupPrecheckResult {
  if (!viewer.uid) return rejected('login_required', 'event.signup.loginRequired');
  if (options.profileComplete === false) {
    return rejected('profile_incomplete', 'event.signup.error.profileIncomplete');
  }

  const eventRegistrations = viewerRegistrations.filter((registration) => (
    !!event.id && registration.eventId === event.id
  ));
  if (!isEventVisibleToUser(event, viewer, eventRegistrations)) {
    return rejected('event_unavailable', 'event.signup.unavailable');
  }
  if (event.status === 'ended' || event.status === 'cancelled') {
    return rejected('event_ended', 'event.signup.ended');
  }

  const selected = options.participants ?? [{ type: 'self' as const }];
  const companionFlow = options.participants !== undefined;
  const selfOnly = selected.length === 1 && selected[0]?.type === 'self';

  // A09 即使只勾本人仍是選人流程，不提供 A07 的早鳥入口。
  if (event.status === 'upcoming') {
    if (companionFlow || options.earlyBirdWindow !== true) {
      return rejected('event_not_open', 'event.signup.notOpen');
    }
    if (options.earlyBirdAccepted !== true) {
      return rejected('early_bird_confirm_required', 'event.signup.error.earlyBirdConfirmRequired');
    }
  }
  if (options.earlyBirdAccepted === true && (companionFlow || !selfOnly)) {
    return rejected('early_bird_self_only', 'event.signup.error.earlyBirdSelfOnly');
  }

  // 附件未提供 A helper 實作；缺少核實結果時不能自行授予 owner/admin 豁免。
  if (event.teamOnly && options.teamSignupAllowed !== true) {
    return rejected('event_team_only_restricted', 'event.signup.teamOnlyRestricted');
  }

  if (options.participantCheck?.ok === false) return options.participantCheck;

  if (hasStarted(event, now)) {
    return rejected('event_started', 'event.signup.started');
  }
  if (options.requiresTeamSelection && !options.teamKey) {
    return rejected('team_selection_required', 'teamSplit.select.required');
  }

  if (
    selected.some((participant) => participant.type === 'self')
    && hasActiveSelfRegistration(eventRegistrations, event.id, viewer.uid)
  ) {
    return rejected('already_registered', 'event.signup.alreadyRegistered');
  }
  return { ok: true };
}

export interface OperationAuth {
  uid: string | null;
  /** 認證事件世代；同一 UID 重新登入仍須改變。 */
  generation: number;
}

export interface SignupSnapshot {
  /** 已依 A _syncEventEffectiveStatus 同步的最新活動；id 必須是 public eventId。 */
  event: EventDoc;
  viewer: ViewerContext;
  registrations: readonly RegistrationDoc[];
  profileComplete: boolean;
  /** 依此次 participants 檢查 operator 及參與者；同行者黑名單不在此檢查。 */
  participantCheck: SignupPrecheckResult;
  earlyBirdWindow: boolean;
  teamSignupAllowed: boolean;
  requiresTeamSelection: boolean;
}

export interface SignupOperationContext {
  getAuth(): OperationAuth;
  load(eventId: string, participants: readonly SignupParticipant[]): Promise<SignupSnapshot>;
}

export interface CancelOperationContext {
  getAuth(): OperationAuth;
  /** 回傳最新且已同步有效狀態的活動。 */
  load(eventId: string): Promise<{ event: EventDoc }>;
}

export interface RegisterForEventInput extends BuildRegisterPayloadInput {
  context?: SignupOperationContext;
}

export interface CancelRegistrationInput extends BuildCancelPayloadInput {
  context?: CancelOperationContext;
}

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

const CANCEL_ERROR_MESSAGE_KEYS: Record<string, string> = {
  ALREADY_CANCELLED: 'event.cancel.error.alreadyCancelled',
  REG_NOT_FOUND: 'event.cancel.error.regNotFound',
  EVENT_NOT_FOUND: 'event.cancel.error.eventNotFound',
  PERMISSION_DENIED: 'event.cancel.error.permissionDenied',
};

function extractOriginalCode(error: CallableError): string {
  if (typeof error.details === 'string' && error.details.length > 0) return error.details;
  if (typeof error.message === 'string' && error.message.length > 0) return error.message;
  return error.code;
}

function toSignupError(
  error: unknown,
  map: Record<string, string>,
  scope: 'register' | 'cancel',
): SignupError {
  if (error instanceof SignupError) return error;
  const fallbackKey = scope === 'register' ? 'event.signup.error.unknown' : 'event.cancel.error.unknown';
  if (error instanceof CallableError) {
    const originalCode = extractOriginalCode(error);
    return new SignupError({
      code: error.code,
      originalCode,
      messageKey: map[originalCode] ?? fallbackKey,
      message: error.message,
    });
  }
  return new SignupError({
    code: 'unknown',
    originalCode: '',
    messageKey: fallbackKey,
    message: error instanceof Error ? error.message : String(error),
  });
}

function assertPrecheck(result: SignupPrecheckResult): void {
  if (result.ok) return;
  throw new SignupError({
    code: 'failed-precondition',
    originalCode: result.reason,
    messageKey: result.messageKey,
    message: result.message ?? PRECHECK_MESSAGES[result.reason],
  });
}

type AuthContext = Pick<SignupOperationContext, 'getAuth'>;

function captureAuth(context: AuthContext, uid: string, scope: 'signup' | 'cancel'): OperationAuth {
  const auth = context.getAuth();
  if (!auth.uid) {
    throw operationError(scope, 'LOGIN_REQUIRED', '請先登入', 'unauthenticated');
  }
  if (auth.uid !== uid || !Number.isSafeInteger(auth.generation)) {
    throw operationError(scope, 'AUTH_CHANGED', '登入狀態已變更，請重新操作');
  }
  return { uid: auth.uid, generation: auth.generation };
}

function assertCurrentAuth(context: AuthContext, captured: OperationAuth, scope: 'signup' | 'cancel'): void {
  const current = context.getAuth();
  if (current.uid !== captured.uid || current.generation !== captured.generation) {
    throw operationError(scope, 'AUTH_CHANGED', '登入狀態已變更，請重新操作');
  }
}

function assertEventId(event: EventDoc, eventId: string, scope: 'signup' | 'cancel'): void {
  if (event.id !== eventId) {
    throw operationError(scope, 'EVENT_CONTEXT_MISMATCH', '活動資料已變更，請重新載入');
  }
}

function assertSnapshot(snapshot: SignupSnapshot): void {
  if (
    typeof snapshot.profileComplete !== 'boolean'
    || typeof snapshot.earlyBirdWindow !== 'boolean'
    || typeof snapshot.teamSignupAllowed !== 'boolean'
    || typeof snapshot.requiresTeamSelection !== 'boolean'
    || typeof snapshot.participantCheck?.ok !== 'boolean'
  ) {
    throw operationError('signup', 'CONTEXT_INCOMPLETE', '報名前檢查資料尚未完整，請重新載入');
  }
}

function assertSelfCancellationTime(event: EventDoc, now: Date): void {
  if (event.status === 'ended' || event.status === 'cancelled') {
    throw new SignupError({
      code: 'failed-precondition',
      originalCode: 'EVENT_ENDED',
      messageKey: 'event.cancel.ended',
      message: '活動已開始，無法再取消報名',
    });
  }
  if (hasStarted(event, now)) {
    throw new SignupError({
      code: 'failed-precondition',
      originalCode: 'EVENT_STARTED',
      messageKey: 'event.cancel.started',
      message: '活動已於開始時間結束，無法取消報名',
    });
  }
}

const inflightRegister = new Map<string, Promise<RegisterForEventResponse>>();
const inflightCancel = new Map<string, Promise<CancelRegistrationResponse>>();
const contextIds = new WeakMap<object, number>();
let nextContextId = 0;

function contextId(context: object): number {
  const existing = contextIds.get(context);
  if (existing !== undefined) return existing;
  nextContextId += 1;
  contextIds.set(context, nextContextId);
  return nextContextId;
}

/**
 * A10 requestId 沒有 random 尾碼；不同操作若同毫秒送出，後端會誤判重複。
 * 保留 A 的格式，在本模組內為每個已送出操作配置單調遞增的毫秒值。
 * 純 payload builder 仍完全遵守傳入的 now。
 */
let lastRequestTimestamp = Number.NEGATIVE_INFINITY;

function requestTimestamp(now: number): number {
  const timestamp = Math.max(now, lastRequestTimestamp + 1);
  if (!Number.isSafeInteger(timestamp)) {
    throw new Error('Invalid request timestamp');
  }
  lastRequestTimestamp = timestamp;
  return timestamp;
}

function operationNow(now: number | undefined): number {
  const value = now ?? Date.now();
  if (!Number.isFinite(value) || Number.isNaN(new Date(value).getTime())) {
    throw new Error('Invalid operation time');
  }
  return value;
}

/**
 * 不把 requestId／測試時鐘放入防連點鍵。
 * 同內容、同身分世代、同資料來源的進行中操作才共用 Promise。
 */
export function registerForEvent(input: RegisterForEventInput): Promise<RegisterForEventResponse> {
  try {
    const context = input.context;
    if (!context) {
      throw operationError('signup', 'CONTEXT_REQUIRED', '報名需要最新活動、使用者及認證資料');
    }

    const captured = captureAuth(context, input.user.uid, 'signup');
    const selected = selectParticipants(input);
    const companionFlow = input.participants !== undefined || (input.companions?.length ?? 0) > 0;

    // 在 await 前複製操作內容，避免呼叫端修改陣列造成 key 與實際送出內容不同。
    const frozenInput: BuildRegisterPayloadInput = {
      ...input,
      user: { ...input.user },
      companions: undefined,
      participants: selected,
    };
    const semanticPayload = buildRegisterPayload({ ...frozenInput, now: 0, randomSuffix: '' });
    const key = JSON.stringify([
      contextId(context),
      captured.uid,
      captured.generation,
      companionFlow,
      semanticPayload,
    ]);
    const existing = inflightRegister.get(key);
    if (existing !== undefined) return existing;

    // 延到 microtask 才執行 load，確保 Map 已先保存 Promise。
    const inner = Promise.resolve().then(async (): Promise<RegisterForEventResponse> => {
      assertCurrentAuth(context, captured, 'signup');
      const snapshot = await context.load(
        frozenInput.eventId,
        selected.map((participant) => ({ ...participant })),
      );
      assertCurrentAuth(context, captured, 'signup');
      assertEventId(snapshot.event, frozenInput.eventId, 'signup');
      assertSnapshot(snapshot);
      if (snapshot.viewer.uid !== captured.uid) {
        throw operationError('signup', 'AUTH_CHANGED', '使用者資料與登入身分不符');
      }

      assertPrecheck(precheckSignup(
        snapshot.event,
        snapshot.viewer,
        snapshot.registrations,
        new Date(operationNow(frozenInput.now)),
        {
          participants: companionFlow ? selected : undefined,
          earlyBirdAccepted: frozenInput.earlyBirdAccepted,
          earlyBirdWindow: snapshot.earlyBirdWindow,
          profileComplete: snapshot.profileComplete,
          participantCheck: snapshot.participantCheck,
          teamSignupAllowed: snapshot.teamSignupAllowed,
          requiresTeamSelection: snapshot.requiresTeamSelection,
          teamKey: frozenInput.teamKey,
        },
      ));

      assertCurrentAuth(context, captured, 'signup');
      const payload = buildRegisterPayload({
        ...frozenInput,
        now: requestTimestamp(operationNow(frozenInput.now)),
      });
      const response = await callFn('registerForEvent', payload);

      // Callable 可能已在伺服器完成；身分改變時拒絕沿用結果，也不發布舊身分事件。
      assertCurrentAuth(context, captured, 'signup');
      if (!response.deduplicated) {
        emit('registration:created', { eventId: frozenInput.eventId, userId: frozenInput.user.uid });
      }
      return response;
    });

    let tracked: Promise<RegisterForEventResponse>;
    tracked = inner
      .catch((error: unknown) => {
        throw toSignupError(error, REGISTER_ERROR_MESSAGE_KEYS, 'register');
      })
      .finally(() => {
        if (inflightRegister.get(key) === tracked) inflightRegister.delete(key);
      });
    inflightRegister.set(key, tracked);
    return tracked;
  } catch (error) {
    return Promise.reject(toSignupError(error, REGISTER_ERROR_MESSAGE_KEYS, 'register'));
  }
}

export function cancelRegistration(input: CancelRegistrationInput): Promise<CancelRegistrationResponse> {
  try {
    const context = input.context;
    if (!context) {
      throw operationError('cancel', 'CONTEXT_REQUIRED', '取消需要最新活動及認證資料');
    }
    const captured = captureAuth(context, input.userId, 'cancel');
    const frozenInput: BuildCancelPayloadInput = {
      ...input,
      registrationIds: [...input.registrationIds],
    };
    const semanticPayload = buildCancelPayload({ ...frozenInput, now: 0, randomSuffix: '' });
    const key = JSON.stringify([
      contextId(context),
      captured.uid,
      captured.generation,
      frozenInput.kind,
      semanticPayload,
    ]);
    const existing = inflightCancel.get(key);
    if (existing !== undefined) return existing;

    const inner = Promise.resolve().then(async (): Promise<CancelRegistrationResponse> => {
      assertCurrentAuth(context, captured, 'cancel');
      const snapshot = await context.load(frozenInput.eventId);
      assertCurrentAuth(context, captured, 'cancel');
      assertEventId(snapshot.event, frozenInput.eventId, 'cancel');

      // A08 有此守衛；A10 沒有，不能以審查建議代替來源契約。
      if (frozenInput.kind === 'self') {
        assertSelfCancellationTime(snapshot.event, new Date(operationNow(frozenInput.now)));
      }

      assertCurrentAuth(context, captured, 'cancel');
      const payload = buildCancelPayload({
        ...frozenInput,
        now: requestTimestamp(operationNow(frozenInput.now)),
      });
      const response = await callFn('cancelRegistration', payload);
      assertCurrentAuth(context, captured, 'cancel');
      if (!response.deduplicated) {
        emit('registration:cancelled', { eventId: frozenInput.eventId, userId: frozenInput.userId });
      }
      return response;
    });

    let tracked: Promise<CancelRegistrationResponse>;
    tracked = inner
      .catch((error: unknown) => {
        throw toSignupError(error, CANCEL_ERROR_MESSAGE_KEYS, 'cancel');
      })
      .finally(() => {
        if (inflightCancel.get(key) === tracked) inflightCancel.delete(key);
      });
    inflightCancel.set(key, tracked);
    return tracked;
  } catch (error) {
    return Promise.reject(toSignupError(error, CANCEL_ERROR_MESSAGE_KEYS, 'cancel'));
  }
}
