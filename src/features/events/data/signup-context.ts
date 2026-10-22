import type { EventDoc, ViewerContext } from './types';
import type { SignupProfile } from './signup-profile';
import { getTeamSplit } from './team-split';
import {
  SignupError,
  type CancelOperationContext,
  type SignupOperationContext,
  type SignupParticipant,
  type SignupPrecheckResult,
} from './signup';
import { loadEventDetail } from './event-detail';
import { effectiveEventStatus } from './my-activities-model';
import {
  getEventAgeRestrictionMessage,
  getEventAgeSignupState,
  getEventGenderRestrictionMessage,
  getEventGenderSignupState,
  isEventEarlyBirdWindow,
} from './signup-restrictions';

type SignupEvent = EventDoc & {
  genderRestrictionEnabled?: unknown;
  allowedGender?: unknown;
  minAge?: unknown;
  earlyBirdEnabled?: unknown;
  earlyBirdCost?: unknown;
  regOpenTime?: unknown;
};

export interface DetailSignupContextDeps {
  /** 目前 viewer；卸載後回 null。 */
  getViewer: () => ViewerContext | null;
  /** EventDetailSession 的認證世代。 */
  generation: number;
  /** 最新個人資料。 */
  getProfile: () => SignupProfile | null;
  getCompanionGender?: (companionId: string) => string | undefined;
  now?: () => Date;
}

/** 照 A _canSignupTeamOnlyEvent；不提供管理者或主辦人豁免。 */
export function canDetailTeamSignup(
  event: EventDoc,
  teamIds: ReadonlySet<string>,
): boolean {
  if (!event.teamOnly) return true;
  const eventIds: unknown[] = Array.isArray(event.creatorTeamIds)
    ? [...event.creatorTeamIds, event.creatorTeamId]
    : [event.creatorTeamId];
  return eventIds.some(value => {
    const id = String(value || '').trim();
    return id !== '' && teamIds.has(id);
  });
}

/** 照 A _canEventGenderParticipantSignup。 */
export function canDetailCompanionSignup(
  event: SignupEvent,
  gender: unknown,
): boolean {
  const allowed = event.genderRestrictionEnabled
    && (event.allowedGender === '男' || event.allowedGender === '女')
    ? event.allowedGender : '';
  return !allowed || gender === allowed;
}

/** 照 A _getCompanionGenderRestrictionMessage。 */
export function detailCompanionGenderMessage(
  event: SignupEvent,
  name: string,
): string {
  // 照 A event-list-helpers.js#_getCompanionGenderRestrictionMessage。
  const raw = event.genderRestrictionEnabled ? event.allowedGender : '';
  const allowedGender = raw === '男' || raw === '女' ? raw : '';
  if (!allowedGender) return '';
  const label = allowedGender === '男' ? '男性限制' : '女性限制';
  return name
    ? `${name} 不符合此活動的${label}`
    : `所選同行者不符合此活動的${label}`;
}

/** 照 A handleSignup／_confirmCompanionRegisterUnlocked。 */
function checkParticipants(
  event: SignupEvent,
  participants: readonly SignupParticipant[],
  deps: DetailSignupContextDeps,
  now: Date,
): SignupPrecheckResult {
  for (const participant of participants) {
    if (participant.type === 'companion') {
      if (!canDetailCompanionSignup(
        event, deps.getCompanionGender?.(participant.companionId),
      )) {
        return {
          ok: false,
          reason: 'gender_restricted',
          messageKey: 'event.signup.error.genderRestricted',
          message: detailCompanionGenderMessage(event, participant.companionName),
        };
      }
      continue;
    }

    // ASSUMPTION: 已登入但讀取失敗時視為缺欄位，不將 null 當訪客而放行限制。
    const profile = deps.getProfile() ?? {
      gender: '',
      birthday: '',
      exp: 0,
      lineNotifyBound: false,
    };
    const gender = getEventGenderSignupState(event, profile);
    if (!gender.canSignup) {
      return {
        ok: false,
        reason: 'gender_restricted',
        messageKey: 'event.signup.error.genderRestricted',
        message: getEventGenderRestrictionMessage(event, gender.reason),
      };
    }
    const age = getEventAgeSignupState(event, profile, now);
    if (!age.canSignup) {
      return {
        ok: false,
        reason: 'age_restricted',
        messageKey: 'events.detailPage.actionError',
        message: getEventAgeRestrictionMessage(event, age),
      };
    }
  }
  return { ok: true };
}

export function createDetailSignupContexts(
  deps: DetailSignupContextDeps,
): {
  signup: SignupOperationContext;
  cancel: CancelOperationContext;
} {
  const getAuth = () => ({
    uid: deps.getViewer()?.uid ?? null,
    generation: deps.generation,
  });

  async function loadEvent(eventId: string): Promise<SignupEvent> {
    const detail = await loadEventDetail(eventId);
    if (!detail) {
      throw new SignupError({
        code: 'not-found',
        originalCode: 'EVENT_NOT_FOUND',
        messageKey: 'events.detailPage.notFound',
        message: '找不到此活動',
      });
    }
    const now = deps.now?.() ?? new Date();
    return {
      ...detail.event,
      id: eventId,
      status: effectiveEventStatus(detail.event, now.getTime()),
    };
  }

  return {
    signup: {
      getAuth,
      async load(eventId, participants) {
        const viewer = deps.getViewer();
        if (!viewer?.uid) {
          throw new SignupError({
            code: 'unauthenticated',
            originalCode: 'LOGIN_REQUIRED',
            messageKey: 'event.signup.loginRequired',
            message: '請先登入',
          });
        }
        const event = await loadEvent(eventId);
        // 照 B 既有讀取層；避免新增 Firestore 的靜態依賴鏈。
        const { loadViewerRegistrations } = await import('./viewer-registrations');
        const registrations = await loadViewerRegistrations(viewer.uid);
        const now = deps.now?.() ?? new Date();
        return {
          event,
          viewer,
          registrations,
          // ASSUMPTION: A 首次登入補資料由 B 殼層處理。
          profileComplete: true,
          participantCheck: checkParticipants(event, participants, deps, now),
          earlyBirdWindow: isEventEarlyBirdWindow(event, now),
          teamSignupAllowed: canDetailTeamSignup(event, viewer.teamIds),
          // 照 A handleSignup；由報名 payload 的 teamKey 滿足選隊要求。
          requiresTeamSelection: getTeamSplit(event)?.enabled === true
            && getTeamSplit(event)?.mode === 'self-select',
        };
      },
    },
    cancel: {
      getAuth,
      async load(eventId) {
        return { event: await loadEvent(eventId) };
      },
    },
  };
}
