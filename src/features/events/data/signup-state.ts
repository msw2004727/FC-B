import type { ViewerContext } from './types';
import { eventStartMs } from './terminal';
import { canDetailTeamSignup } from './signup-context';
import { getEventParticipantStats } from './participant-stats';
import {
  getEventGenderSignupState,
  getEventGenderRestrictionMessage,
  getEventGenderRibbonText,
  getEventAgeSignupState,
  getEventAgeRestrictionButtonText,
  getEventAgeRestrictionMessage,
  isEventEarlyBirdWindow,
  getEventEarlyBirdCost,
  hasAvailableTeamReservationSignup,
} from './signup-restrictions';
import type { SignupProfile } from './signup-profile';
import { isActiveRegistration, isCompanion, registrationOwner } from './detail-model';
import type { DetailEvent, DetailRegistration } from './detail-model';

export type SignupButtonKind =
  | 'guestTeamOnly'
  | 'guestNotOpen'
  | 'guestEarlyBird'
  | 'guestEnded'
  | 'guestWaitlist'
  | 'guestSignup'
  | 'syncing'
  | 'syncIssue'
  | 'ended'
  | 'cancelWaitlist'
  | 'cancel'
  | 'earlyBirdFull'
  | 'earlyBirdNoPoints'
  | 'earlyBird'
  | 'notOpen'
  | 'teamOnly'
  | 'genderRestricted'
  | 'ageRestricted'
  | 'teamReservedSignup'
  | 'waitlist'
  | 'signup';

export interface SignupButtonState {
  kind: SignupButtonKind;
  /** A 的中文原文，元件直接顯示。 */
  label: string;
  /** 保留舊介面：`events.detailPage.button.${kind}`。 */
  labelKey: string;
  disabled: boolean;
  action: 'none' | 'cancel' | 'signup' | 'earlyBird' | 'explain' | 'login';
  tone: 'muted' | 'danger' | 'warning' | 'waitlist' | 'primary';
  variant: 'primary' | 'styled' | 'earlyBird' | 'syncing';
  bg?: string;
  color?: string;
  glow?: string;
  glowLight?: string;
  hint?: string;
  /** A 部分 disabled 按鈕有 opacity，交由元件照抄。 */
  opacity?: number;
  /** 是否包 signup-glow-wrap（A 用 _glowWrap 包的才 true）。 */
  glowWrap: boolean;
  /** 早鳥下方說明。 */
  subtext?: string;
  earlyBirdCost?: number;
  /** action 'explain' 時的 toast 文字。 */
  messageText?: string;
}

export interface SignupButtonInput {
  event: DetailEvent;
  viewer: ViewerContext;
  /** 僅此活動的紀錄；包含同行者，但本人狀態優先。 */
  registrations: readonly DetailRegistration[];
  now: Date;
  profile: SignupProfile | null;
  profileLoading: boolean;
  historyFailed: boolean;
  viewerTeamIds: ReadonlySet<string>;
}

// ASSUMPTION: DetailEvent 未列性別／年齡／早鳥／預留名額欄位，
// 本檔局部擴充唯讀型別，不改 Firestore 格式。
type SignupEvent = DetailEvent & {
  genderRestrictionEnabled?: unknown;
  allowedGender?: unknown;
  minAge?: unknown;
  earlyBirdEnabled?: unknown;
  earlyBirdCost?: unknown;
  teamReservationSummaries?: unknown;
};

// 照 A showEventDetail 的按鈕物件組裝，集中預設值。
function buttonState(
  kind: SignupButtonKind,
  label: string,
  overrides: Partial<SignupButtonState> = {},
): SignupButtonState {
  return {
    kind,
    label,
    labelKey: `events.detailPage.button.${kind}`,
    disabled: false,
    action: 'none',
    tone: 'muted',
    variant: 'styled',
    glowWrap: false,
    ...overrides,
  };
}

/**
 * 照 A `showEventDetail` 第 1324～1386 行分支順序，逐字回傳按鈕狀態。
 * 訪客分支照 A `_buildGuestEventSignupButton`；早鳥照 A `_buildEventEarlyBirdSignupHtml`。
 */
export function getSignupButtonState(input: SignupButtonInput): SignupButtonState {
  const {
    event,
    viewer,
    registrations,
    now,
    profile,
    profileLoading,
    historyFailed,
    viewerTeamIds,
  } = input;
  const signupEvent = event as SignupEvent;
  const isMainFull = getEventParticipantStats(event, registrations).isCapacityFull;
  const startMs = eventStartMs(event);
  const isEnded = event.status === 'ended'
    || event.status === 'cancelled'
    || (startMs > 0 && startMs <= now.getTime());

  // 1. 訪客：照 A `_buildGuestEventSignupButton`（第 926～944 行）。
  const currentUid = viewer.uid;
  if (!currentUid) {
    if (event.teamOnly) {
      return buttonState('guestTeamOnly', '球隊限定', {
        disabled: true,
        bg: '#64748b',
        color: '#fff',
        opacity: 0.7,
      });
    }
    if (event.status === 'upcoming') {
      if (isEventEarlyBirdWindow(signupEvent, now)) {
        const cost = getEventEarlyBirdCost(signupEvent);
        if (isMainFull) {
          return buttonState('guestEarlyBird', '早鳥名額已滿', {
            disabled: true,
            variant: 'earlyBird',
            subtext: '正式開放後可依活動狀態候補報名',
          });
        }
        return buttonState('guestEarlyBird', `早鳥報名 · ${cost} 積分`, {
          action: 'login',
          tone: 'warning',
          variant: 'earlyBird',
          subtext: '登入後確認積分並完成報名',
          earlyBirdCost: cost,
        });
      }
      return buttonState('guestNotOpen', '報名尚未開放', {
        disabled: true,
        bg: '#64748b',
        color: '#fff',
      });
    }
    if (isEnded) {
      return buttonState('guestEnded', '報名已結束', {
        disabled: true,
        bg: '#333',
        color: '#999',
      });
    }
    if (isMainFull) {
      return buttonState('guestWaitlist', '報名候補', {
        action: 'login',
        tone: 'waitlist',
        bg: '#7c3aed',
        color: '#fff',
      });
    }
    return buttonState('guestSignup', '立即報名', {
      action: 'login',
      tone: 'primary',
      variant: 'primary',
    });
  }

  // 2. 用戶資料同步中：照 A `_buildEventSignupLoadingButton`。
  if (profileLoading) {
    return buttonState('syncing', '用戶資料同步中', {
      disabled: true,
      variant: 'syncing',
    });
  }

  // 3. 報名狀態同步中：照派工單 M-084／A `_buildEventSignupSyncIssueButton` 的 disabled 版。
  if (historyFailed) {
    return buttonState('syncIssue', '報名狀態同步中', {
      disabled: true,
      bg: '#64748b',
      color: '#fff',
    });
  }

  // 4. 已結束／已取消／開始時間已過。
  if (isEnded) {
    return buttonState('ended', '已結束', {
      disabled: true,
      bg: '#333',
      color: '#999',
    });
  }

  // 5～6. 本人報名優先；同行者仍有報名時沿用 B 既有規則。
  const owned = registrations.filter((reg) =>
    isActiveRegistration(reg) && registrationOwner(reg) === currentUid);
  const self = owned.find((reg) => !isCompanion(reg));
  if (self?.status === 'waitlisted') {
    return buttonState('cancelWaitlist', '取消候補', {
      action: 'cancel',
      tone: 'warning',
      bg: '#7c3aed',
      color: '#fff',
      glow: '#7c3aed',
      glowLight: '#a78bfa',
      hint: '正在取消候補',
      glowWrap: true,
    });
  }
  if (self?.status === 'confirmed') {
    return buttonState('cancel', '取消報名', {
      action: 'cancel',
      tone: 'danger',
      bg: '#dc2626',
      color: '#fff',
      glow: '#dc2626',
      glowLight: '#f87171',
      hint: '正在取消報名',
      glowWrap: true,
    });
  }
  if (owned.length > 0) {
    const allWaitlisted = owned.every((reg) => reg.status === 'waitlisted');
    if (allWaitlisted) {
      return buttonState('cancelWaitlist', '取消候補', {
        action: 'cancel',
        tone: 'warning',
        bg: '#7c3aed',
        color: '#fff',
        glow: '#7c3aed',
        glowLight: '#a78bfa',
        hint: '正在取消候補',
        glowWrap: true,
      });
    }
    return buttonState('cancel', '取消報名', {
      action: 'cancel',
      tone: 'danger',
      bg: '#dc2626',
      color: '#fff',
      glow: '#dc2626',
      glowLight: '#f87171',
      hint: '正在取消報名',
      glowWrap: true,
    });
  }

  // 7. upcoming：照 A `_buildEventEarlyBirdSignupHtml`。
  if (event.status === 'upcoming') {
    if (isEventEarlyBirdWindow(signupEvent, now)) {
      const cost = getEventEarlyBirdCost(signupEvent);
      if (isMainFull) {
        return buttonState('earlyBirdFull', '早鳥名額已滿', {
          disabled: true,
          variant: 'earlyBird',
          subtext: '正式開放後可依活動狀態候補報名',
        });
      }
      if ((profile?.exp ?? 0) < cost) {
        return buttonState('earlyBirdNoPoints', `積分不足 · 需 ${cost} 分`, {
          disabled: true,
          variant: 'earlyBird',
          subtext: '目前積分不足，可等正式開放後報名',
          earlyBirdCost: cost,
        });
      }
      return buttonState('earlyBird', `早鳥報名 · ${cost} 積分`, {
        action: 'earlyBird',
        tone: 'warning',
        variant: 'earlyBird',
        glow: '#d97706',
        glowLight: '#fbbf24',
        hint: '早鳥報名中',
        glowWrap: true,
        earlyBirdCost: cost,
      });
    }
    return buttonState('notOpen', '報名尚未開放', {
      disabled: true,
      bg: '#64748b',
      color: '#fff',
    });
  }

  // 照 A _canSignupTeamOnlyEvent；顯示與寫入使用同一 helper。
  if (!canDetailTeamSignup(event, viewerTeamIds)) {
    return buttonState('teamOnly', '球隊限定', {
      disabled: true,
      bg: '#64748b',
      color: '#fff',
      opacity: 0.7,
    });
  }

  // 9. 性別限制。
  const genderState = getEventGenderSignupState(signupEvent, profile);
  if (genderState.restricted && !genderState.requiresLogin && !genderState.canSignup) {
    return buttonState('genderRestricted', getEventGenderRibbonText(signupEvent) || '性別限定', {
      action: 'explain',
      tone: 'danger',
      bg: '#dc2626',
      color: '#fff',
      opacity: 0.95,
      messageText: getEventGenderRestrictionMessage(signupEvent, genderState.reason),
    });
  }

  // 10. 年齡限制。
  const ageState = getEventAgeSignupState(signupEvent, profile, now);
  if (ageState.restricted && !ageState.requiresLogin && !ageState.canSignup) {
    return buttonState('ageRestricted', getEventAgeRestrictionButtonText(signupEvent, ageState) || '年齡限制', {
      action: 'explain',
      tone: 'danger',
      bg: '#dc2626',
      color: '#fff',
      opacity: 0.95,
      messageText: getEventAgeRestrictionMessage(signupEvent, ageState),
    });
  }

  // 11. 主名額滿但檢視者有可用俱樂部預留名額。
  if (isMainFull && hasAvailableTeamReservationSignup(signupEvent, viewerTeamIds)) {
    return buttonState('teamReservedSignup', '立即報名', {
      action: 'signup',
      tone: 'primary',
      variant: 'primary',
      glow: 'var(--accent)',
      glowLight: 'var(--accent-hover)',
      hint: '報名中',
      glowWrap: true,
    });
  }

  // 12. 主名額滿／一般報名。
  if (isMainFull) {
    return buttonState('waitlist', '報名候補', {
      action: 'signup',
      tone: 'waitlist',
      bg: '#7c3aed',
      color: '#fff',
      glow: '#7c3aed',
      glowLight: '#a78bfa',
      hint: '報名候補中',
      glowWrap: true,
    });
  }
  return buttonState('signup', '立即報名', {
    action: 'signup',
    tone: 'primary',
    variant: 'primary',
    glow: 'var(--accent)',
    glowLight: 'var(--accent-hover)',
    hint: '報名中',
    glowWrap: true,
  });
}
