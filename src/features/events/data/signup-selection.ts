import { CallableError, callFn } from '@/data/callables';
import { InternalTestBlockedError, assertInternalTestEventDocWritable } from '@/data/internal-test';
import { emit } from '@/core/events';
import {
  buildRegisterPayload,
  registerForEvent,
  SignupError,
  type RegisterForEventInput,
} from './signup';

type RegisterResult = Awaited<ReturnType<typeof registerForEvent>>;
type RegisterPayload = ReturnType<typeof buildRegisterPayload>;

const inflight = new Map<string, Promise<RegisterResult>>();

/**
 * A 同行者選擇允許只選同行者；既有 registerForEvent 永遠加入本人，
 * 因此獨立 adapter 處理此缺口，仍走同一 registerForEvent Callable。
 * 不修改既有 registerForEvent 呼叫者的預設語意。
 */
export function registerSelection(
  input: RegisterForEventInput,
  includeSelf: boolean,
): Promise<RegisterResult> {
  if (includeSelf) return registerForEvent(input);

  const existing = inflight.get(input.eventId);
  if (existing) return existing;

  const inner = (async (): Promise<RegisterResult> => {
    const payload: RegisterPayload = buildRegisterPayload(input);
    payload.participants = payload.participants.filter((person) => Boolean(person.companionId));
    if (payload.participants.length === 0) {
      throw new SignupError({
        code: 'invalid-argument',
        originalCode: '',
        messageKey: 'events.detailPage.selectSomeone',
        message: 'No participants selected',
      });
    }

    try {
      // 內測模式：以 public id 讀活動標題；舊活動 docId 與 id 不同時讀不到，一律擋下（安全方向）。
      await assertInternalTestEventDocWritable(input.eventId);
      const result = await callFn('registerForEvent', payload);
      if (!result.deduplicated) {
        emit('registration:created', { eventId: input.eventId, userId: input.user.uid });
      }
      return result;
    } catch (error) {
      if (error instanceof SignupError) throw error;
      if (error instanceof InternalTestBlockedError) {
        throw new SignupError({
          code: 'failed-precondition',
          originalCode: error.code,
          messageKey: 'internalTest.eventOnly',
          message: error.message,
        });
      }
      const originalCode = error instanceof CallableError
        ? typeof error.details === 'string' && error.details
          ? error.details : error.message
        : '';
      const keys: Record<string, string> = {
        ALREADY_REGISTERED: 'alreadyRegistered',
        EVENT_NOT_FOUND: 'eventNotFound',
        EVENT_ENDED: 'eventEnded',
        EVENT_CANCELLED: 'eventCancelled',
        REG_NOT_OPEN: 'regNotOpen',
        EARLY_BIRD_NOT_AVAILABLE: 'earlyBirdNotAvailable',
        EARLY_BIRD_CONFIRM_REQUIRED: 'earlyBirdConfirmRequired',
        EARLY_BIRD_SELF_ONLY: 'earlyBirdSelfOnly',
        EARLY_BIRD_COST_CHANGED: 'earlyBirdCostChanged',
        EARLY_BIRD_INSUFFICIENT_EXP: 'earlyBirdInsufficientExp',
        EARLY_BIRD_FULL: 'earlyBirdFull',
        GENDER_RESTRICTED: 'genderRestricted',
        TEAM_RESTRICTED: 'teamRestricted',
        COURSE_LINKED_EVENT_PRIVATE_REGISTRATION: 'courseLinkedPrivate',
        COURSE_LINKED_EVENT_MANAGED_BY_COURSE: 'courseLinkedManaged',
        COURSE_LINKED_REGISTRATION_MANAGED_BY_COURSE: 'courseLinkedManaged',
        PROFILE_INCOMPLETE: 'profileIncomplete',
        TEAM_RESERVATION_TEAM_DENIED: 'teamReservationDenied',
        TEAM_RESERVATION_TEAM_NOT_AVAILABLE: 'teamReservationUnavailable',
      };
      throw new SignupError({
        code: error instanceof CallableError ? error.code : 'unknown',
        originalCode,
        messageKey: `event.signup.error.${keys[originalCode] ?? 'unknown'}`,
        message: error instanceof Error ? error.message : 'Registration failed',
      });
    }
  })();

  let tracked: Promise<RegisterResult>;
  tracked = inner.finally(() => {
    if (inflight.get(input.eventId) === tracked) inflight.delete(input.eventId);
  });
  inflight.set(input.eventId, tracked);
  return tracked;
}
