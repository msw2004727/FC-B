import type { EventDoc, RegistrationDoc, ViewerContext } from './types';
import { eventStartMs } from './terminal';
import { precheckSignup } from './signup';
import { count, isActiveRegistration, isCompanion, registrationOwner } from './detail-model';
import type { DetailEvent, DetailRegistration } from './detail-model';

export type SignupButtonKind =
  | 'ended'
  | 'cancelWaitlist'
  | 'cancel'
  | 'notOpen'
  | 'teamOnly'
  | 'restricted'
  | 'waitlist'
  | 'signup';

export interface SignupButtonState {
  kind: SignupButtonKind;
  labelKey: string;
  disabled: boolean;
  action: 'none' | 'cancel' | 'signup' | 'explain';
  tone: 'muted' | 'danger' | 'warning' | 'waitlist' | 'primary';
  messageKey?: string;
}

export interface SignupButtonInput {
  event: DetailEvent;
  viewer: ViewerContext;
  /** 僅此活動的紀錄；包含同行者，但本人狀態優先。 */
  registrations: readonly DetailRegistration[];
  now: Date;
  /**
   * ASSUMPTION: 題目的「8 種」將 A 的性別／年齡分支歸為 restricted。
   * 現有 ViewerContext 不提供性別／生日，不擅自推測資格；
   * 已知限制可注入此欄位，寫入端仍由 Callable 驗證。
   */
  restriction?: { labelKey: string; messageKey: string };
}

export function getSignupButtonState(input: SignupButtonInput): SignupButtonState {
  const { event, viewer, registrations, now } = input;
  const state = (
    kind: SignupButtonKind,
    action: SignupButtonState['action'],
    tone: SignupButtonState['tone'],
    disabled = false,
  ): SignupButtonState => ({
    kind,
    labelKey: `events.detailPage.button.${kind}`,
    action,
    tone,
    disabled,
  });

  if (event.status === 'ended' || event.status === 'cancelled') {
    return state('ended', 'none', 'muted', true);
  }

  const owned = registrations.filter((reg) =>
    isActiveRegistration(reg) && registrationOwner(reg) === viewer.uid,
  );
  const self = owned.find((reg) => !isCompanion(reg));
  if (self?.status === 'waitlisted') return state('cancelWaitlist', 'cancel', 'warning');
  if (self?.status === 'confirmed') return state('cancel', 'cancel', 'danger');

  // 僅同行者仍有報名時，也提供取消入口，不假裝本人已正取。
  if (owned.length > 0) {
    return owned.every((reg) => reg.status === 'waitlisted')
      ? state('cancelWaitlist', 'cancel', 'warning')
      : state('cancel', 'cancel', 'danger');
  }

  const start = eventStartMs(event);
  if (start > 0 && start <= now.getTime()) return state('ended', 'none', 'muted', true);
  if (event.status === 'upcoming') return state('notOpen', 'none', 'muted', true);

  const check = precheckSignup(event as EventDoc, viewer, [] as RegistrationDoc[], now);
  if (!check.ok && check.reason === 'event_team_only_restricted') {
    return state('teamOnly', 'none', 'muted', true);
  }

  if (input.restriction && viewer.uid) {
    return {
      ...state('restricted', 'explain', 'danger'),
      labelKey: input.restriction.labelKey,
      messageKey: input.restriction.messageKey,
    };
  }

  return count(event.max) > 0 && count(event.current) >= count(event.max)
    ? state('waitlist', 'signup', 'waitlist')
    : state('signup', 'signup', 'primary');
}
