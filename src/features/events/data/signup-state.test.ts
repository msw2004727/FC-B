// 測試同步更新：照 A（M-084）按鈕分支順序。
import { describe, expect, it } from 'vitest';
import { getSignupButtonState, type SignupButtonInput } from './signup-state';
import type { DetailEvent } from './detail-model';
import type { ViewerContext } from './types';
import type { SignupProfile } from './signup-profile';

interface TestDetailEvent extends DetailEvent {
  genderRestrictionEnabled?: boolean;
  allowedGender?: string;
  minAge?: number;
  earlyBirdEnabled?: boolean;
  earlyBirdCost?: number;
  teamReservationSummaries?: unknown[];
}

const now = new Date('2026-01-01T00:00:00Z');
const baseEvent: DetailEvent = { id: 'event-a', status: 'open', current: 1, max: 10 };
const baseProfile: SignupProfile = { gender: '', birthday: '', exp: 0, lineNotifyBound: false };
const baseViewer: ViewerContext = {
  uid: 'u1',
  teamIds: new Set(),
  hasPermission: () => false,
  roleLevel: 0,
};

const base: SignupButtonInput = {
  event: baseEvent,
  viewer: baseViewer,
  registrations: [],
  now,
  profile: baseProfile,
  profileLoading: false,
  historyFailed: false,
  viewerTeamIds: new Set(),
};

function run(overrides: Partial<SignupButtonInput> = {}) {
  return getSignupButtonState({ ...base, ...overrides });
}

const guestViewer: ViewerContext = { ...baseViewer, uid: null };
const futureDate = '2026/12/31 10:00~12:00';
const earlyBirdEvent: TestDetailEvent = {
  ...baseEvent,
  status: 'upcoming',
  date: futureDate,
  regOpenTime: '2026-01-02T00:00:00.000Z',
  earlyBirdEnabled: true,
  earlyBirdCost: 50,
  current: 1,
  max: 10,
};

describe('getSignupButtonState', () => {
  it('訪客・球隊限定', () => {
    const state = run({ viewer: guestViewer, event: { ...baseEvent, teamOnly: true } });
    expect(state).toMatchObject({
      kind: 'guestTeamOnly',
      label: '球隊限定',
      disabled: true,
      action: 'none',
      bg: '#64748b',
      opacity: 0.7,
    });
    expect(state.glowWrap).toBe(false);
  });

  it('訪客・報名尚未開放', () => {
    const state = run({ viewer: guestViewer, event: { ...baseEvent, status: 'upcoming' } });
    expect(state).toMatchObject({
      kind: 'guestNotOpen',
      label: '報名尚未開放',
      disabled: true,
      action: 'none',
    });
    expect(state.glowWrap).toBe(false);
  });

  it('訪客・早鳥報名', () => {
    const state = run({ viewer: guestViewer, event: earlyBirdEvent });
    expect(state).toMatchObject({
      kind: 'guestEarlyBird',
      label: '早鳥報名 · 50 積分',
      disabled: false,
      action: 'login',
      subtext: '登入後確認積分並完成報名',
      earlyBirdCost: 50,
    });
    expect(state.glowWrap).toBe(false);
  });

  it('訪客・早鳥名額已滿', () => {
    const state = run({ viewer: guestViewer, event: { ...earlyBirdEvent, current: 10 } });
    expect(state).toMatchObject({
      kind: 'guestEarlyBird',
      label: '早鳥名額已滿',
      disabled: true,
      action: 'none',
      subtext: '正式開放後可依活動狀態候補報名',
    });
    expect(state.glowWrap).toBe(false);
  });

  it('訪客・報名已結束', () => {
    const state = run({ viewer: guestViewer, event: { ...baseEvent, status: 'ended' } });
    expect(state).toMatchObject({
      kind: 'guestEnded',
      label: '報名已結束',
      disabled: true,
      bg: '#333',
      color: '#999',
    });
  });

  it('訪客・報名候補', () => {
    const state = run({ viewer: guestViewer, event: { ...baseEvent, current: 10 } });
    expect(state).toMatchObject({
      kind: 'guestWaitlist',
      label: '登入後候補',
      disabled: false,
      action: 'login',
      bg: '#7c3aed',
    });
  });

  it('訪客・立即報名', () => {
    const state = run({ viewer: guestViewer });
    expect(state).toMatchObject({
      kind: 'guestSignup',
      label: '請先登入',
      disabled: false,
      action: 'login',
      variant: 'primary',
    });
  });

  it('資料載入中（原「用戶資料同步中」）', () => {
    expect(run({ profileLoading: true })).toMatchObject({
      kind: 'syncing',
      label: '資料載入中…',
      disabled: true,
      variant: 'syncing',
    });
  });

  it('報名狀態同步中', () => {
    expect(run({ historyFailed: true })).toMatchObject({
      kind: 'syncIssue',
      label: '報名狀態同步中',
      disabled: true,
      bg: '#64748b',
    });
  });

  it('已結束', () => {
    expect(run({ event: { ...baseEvent, status: 'ended' } })).toMatchObject({
      kind: 'ended',
      label: '已結束',
      disabled: true,
      bg: '#333',
      color: '#999',
    });
  });

  it('開始時間已過視同已結束', () => {
    expect(run({
      event: { ...baseEvent, date: '2025/12/31 10:00~12:00' },
    }).kind).toBe('ended');
  });

  it('本人候補', () => {
    expect(run({
      registrations: [{ userId: 'u1', participantType: 'self', status: 'waitlisted' }],
    })).toMatchObject({
      kind: 'cancelWaitlist',
      label: '取消候補',
      action: 'cancel',
      bg: '#7c3aed',
      glow: '#7c3aed',
      glowLight: '#a78bfa',
      hint: '正在取消候補',
      glowWrap: true,
    });
  });

  it('本人正取', () => {
    expect(run({
      registrations: [{ userId: 'u1', participantType: 'self', status: 'confirmed' }],
    })).toMatchObject({
      kind: 'cancel',
      label: '取消報名',
      action: 'cancel',
      bg: '#dc2626',
      glow: '#dc2626',
      glowLight: '#f87171',
      hint: '正在取消報名',
      glowWrap: true,
    });
  });

  // 測試同步更新：照 A _getCurrentUserEventRegistrationState 排除同行者，只剩同行者時主按鈕是報名鈕（Gemini 審查 P2）。
  it('只剩同行者報名（候補）時主按鈕仍是報名鈕', () => {
    expect(run({
      registrations: [
        { userId: 'u1', participantType: 'companion', status: 'waitlisted' },
      ],
    }).kind).toBe('signup');
  });

  it('只剩同行者報名（正取）時主按鈕仍是報名鈕', () => {
    expect(run({
      registrations: [
        { userId: 'u1', participantType: 'companion', status: 'confirmed' },
      ],
    }).kind).toBe('signup');
  });

  it('早鳥名額已滿', () => {
    expect(run({
      event: { ...earlyBirdEvent, current: 10 },
      profile: { ...baseProfile, exp: 100 },
    })).toMatchObject({
      kind: 'earlyBirdFull',
      label: '早鳥名額已滿',
      disabled: true,
      subtext: '正式開放後可依活動狀態候補報名',
    });
  });

  it('早鳥積分不足', () => {
    expect(run({
      event: earlyBirdEvent,
      profile: { ...baseProfile, exp: 10 },
    })).toMatchObject({
      kind: 'earlyBirdNoPoints',
      label: '積分不足 · 需 50 分',
      disabled: true,
      subtext: '目前積分不足，可等正式開放後報名',
      earlyBirdCost: 50,
    });
  });

  it('早鳥報名', () => {
    expect(run({
      event: earlyBirdEvent,
      profile: { ...baseProfile, exp: 100 },
    })).toMatchObject({
      kind: 'earlyBird',
      label: '早鳥報名 · 50 積分',
      action: 'earlyBird',
      glow: '#d97706',
      glowLight: '#fbbf24',
      hint: '早鳥報名中',
      glowWrap: true,
      earlyBirdCost: 50,
    });
  });

  it('報名尚未開放', () => {
    expect(run({
      event: { ...baseEvent, status: 'upcoming' },
    })).toMatchObject({
      kind: 'notOpen',
      label: '報名尚未開放',
      disabled: true,
      bg: '#64748b',
    });
  });

  it('球隊限定', () => {
    expect(run({
      event: { ...baseEvent, teamOnly: true, creatorTeamId: 'team-a' },
    })).toMatchObject({
      kind: 'teamOnly',
      label: '球隊限定',
      disabled: true,
      bg: '#64748b',
      opacity: 0.7,
    });
  });

  it('性別限制', () => {
    const genderEvent: TestDetailEvent = {
      ...baseEvent,
      genderRestrictionEnabled: true,
      allowedGender: '男',
    };
    expect(run({
      event: genderEvent,
      profile: { ...baseProfile, gender: '女' },
    })).toMatchObject({
      kind: 'genderRestricted',
      label: '男生限定',
      action: 'explain',
      bg: '#dc2626',
      opacity: 0.95,
      messageText: '限男性報名，目前無法報名',
    });
  });

  it('年齡限制', () => {
    const ageEvent: TestDetailEvent = {
      ...baseEvent,
      minAge: 18,
      date: futureDate,
    };
    expect(run({
      event: ageEvent,
      profile: { ...baseProfile, birthday: '2010/01/01' },
    })).toMatchObject({
      kind: 'ageRestricted',
      label: '18歲以上',
      action: 'explain',
      bg: '#dc2626',
      opacity: 0.95,
      messageText: '此活動限 18 歲以上報名',
    });
  });

  it('主名額滿且有可用預留名額', () => {
    const reservedEvent: TestDetailEvent = {
      ...baseEvent,
      current: 10,
      teamReservationSummaries: [
        { teamId: 'team-a', reservedSlots: 5, usedSlots: 0 },
      ],
    };
    expect(run({
      event: reservedEvent,
      viewerTeamIds: new Set(['team-a']),
    })).toMatchObject({
      kind: 'teamReservedSignup',
      label: '立即報名',
      action: 'signup',
      variant: 'primary',
      glow: 'var(--accent)',
      glowLight: 'var(--accent-hover)',
      hint: '報名中',
      glowWrap: true,
    });
  });

  it('主名額滿且無預留名額', () => {
    expect(run({
      event: { ...baseEvent, current: 10 },
    })).toMatchObject({
      kind: 'waitlist',
      label: '報名候補',
      action: 'signup',
      bg: '#7c3aed',
      glow: '#7c3aed',
      glowLight: '#a78bfa',
      hint: '報名候補中',
      glowWrap: true,
    });
  });

  it('一般報名', () => {
    expect(run()).toMatchObject({
      kind: 'signup',
      label: '立即報名',
      disabled: false,
      action: 'signup',
      variant: 'primary',
      glow: 'var(--accent)',
      glowLight: 'var(--accent-hover)',
      hint: '報名中',
      glowWrap: true,
    });
  });

  it('取消活動優先於既有報名', () => {
    expect(run({
      event: { ...baseEvent, status: 'cancelled' },
      registrations: [{ userId: 'u1', status: 'confirmed' }],
    }).kind).toBe('ended');
  });

  it('不把其他使用者或已取消報名當成自己的報名', () => {
    expect(run({
      registrations: [
        { userId: 'u2', status: 'confirmed' },
        { userId: 'u1', status: 'cancelled' },
      ],
    }).kind).toBe('signup');
  });

  it('本人候補優先於同行者正取', () => {
    expect(run({
      registrations: [
        { userId: 'u1', participantType: 'companion', status: 'confirmed' },
        { userId: 'u1', participantType: 'self', status: 'waitlisted' },
      ],
    }).kind).toBe('cancelWaitlist');
  });

  it('零容量沿用 A 的不以容量擋報名語意', () => {
    expect(run({
      event: { ...baseEvent, max: 0 },
    }).kind).toBe('signup');
  });
});

describe('報名鈕就緒鎖與資料未完善（站長 11-18、顧問 §3.268）', () => {
  const missing: SignupProfile = { ...baseProfile, gender: '男', birthday: '2000/01/01', incomplete: true };

  it('登入還原中：LINE 登入中…，不可按', () => {
    expect(run({ viewer: guestViewer, authPending: true })).toMatchObject({
      kind: 'authPending', label: 'LINE 登入中…', disabled: true, variant: 'syncing',
    });
  });

  it('已有 uid 時 authPending 不影響', () => {
    expect(run({ authPending: true }).kind).toBe('signup');
  });

  it('缺欄：可報名狀態改成「請先完善資料」', () => {
    expect(run({ profile: missing })).toMatchObject({
      kind: 'profileIncomplete', label: '請先完善資料', action: 'completeProfile', disabled: false,
    });
  });

  it('缺欄：候補與早鳥也改成「請先完善資料」', () => {
    expect(run({ profile: missing, event: { ...baseEvent, current: 10 } }).kind).toBe('profileIncomplete');
    expect(run({ profile: { ...missing, exp: 100 }, event: earlyBirdEvent }).kind).toBe('profileIncomplete');
  });

  it('缺欄：已結束、尚未開放、取消報名不受影響', () => {
    expect(run({ profile: missing, event: { ...baseEvent, status: 'ended' } }).kind).toBe('ended');
    expect(run({
      profile: missing,
      event: { ...baseEvent, status: 'upcoming', date: futureDate, regOpenTime: '2026-06-01T00:00:00.000Z' },
    }).kind).toBe('notOpen');
    expect(run({
      profile: missing,
      registrations: [{ eventId: 'event-a', userId: 'u1', participantType: 'self', status: 'confirmed' }],
    }).kind).toBe('cancel');
  });

  it('個人資料讀不到（null）或未標缺欄：照原本，交給伺服器裁定', () => {
    expect(run({ profile: null }).kind).toBe('signup');
    expect(run({ profile: { ...missing, incomplete: false } }).kind).toBe('signup');
  });
});

describe('報名／候補／取消三類按鈕在新狀態下顯示正確（站長 11-19）', () => {
  const ok: SignupProfile = { ...baseProfile, gender: '男', birthday: '2000/01/01', incomplete: false };
  const missing: SignupProfile = { ...ok, gender: '', incomplete: true };
  const full = { ...baseEvent, current: 10 };
  const mine = (status: 'confirmed' | 'waitlisted') => [{
    eventId: 'event-a', userId: 'u1', participantType: 'self' as const, status,
  }];

  it('資料完整：未報名＝立即報名、額滿＝報名候補、已報名＝取消報名、候補中＝取消候補', () => {
    expect(run({ profile: ok })).toMatchObject({ kind: 'signup', label: '立即報名', action: 'signup' });
    expect(run({ profile: ok, event: full })).toMatchObject({ kind: 'waitlist', label: '報名候補', action: 'signup' });
    expect(run({ profile: ok, registrations: mine('confirmed') })).toMatchObject({ kind: 'cancel', label: '取消報名', action: 'cancel' });
    expect(run({ profile: ok, event: full, registrations: mine('waitlisted') })).toMatchObject({ kind: 'cancelWaitlist', label: '取消候補', action: 'cancel' });
  });

  it('資料不完整：報名與候補改「請先完善資料」，取消報名與取消候補照常', () => {
    expect(run({ profile: missing }).kind).toBe('profileIncomplete');
    expect(run({ profile: missing, event: full }).kind).toBe('profileIncomplete');
    expect(run({ profile: missing, registrations: mine('confirmed') }).kind).toBe('cancel');
    expect(run({ profile: missing, event: full, registrations: mine('waitlisted') }).kind).toBe('cancelWaitlist');
  });

  it('資料載入中：四種都先顯示「資料載入中…」不可按', () => {
    for (const input of [{}, { event: full }, { registrations: mine('confirmed') }, { event: full, registrations: mine('waitlisted') }]) {
      expect(run({ ...input, profileLoading: true })).toMatchObject({ kind: 'syncing', disabled: true });
    }
  });

  it('訪客：未滿顯示「請先登入」、額滿顯示「登入後候補」，都走登入', () => {
    expect(run({ viewer: guestViewer })).toMatchObject({ label: '請先登入', action: 'login' });
    expect(run({ viewer: guestViewer, event: full })).toMatchObject({ label: '登入後候補', action: 'login', bg: '#7c3aed' });
  });
});

describe('早鳥：讀不到個人資料不當 0 分（Grok 初審 P1）', () => {
  it('profile 為 null 時顯示可按的早鳥報名，交給伺服器裁定積分', () => {
    expect(run({ profile: null, event: earlyBirdEvent })).toMatchObject({ kind: 'earlyBird', action: 'earlyBird', disabled: false });
  });
  it('已讀到且積分不足維持「積分不足」', () => {
    expect(run({ profile: { ...baseProfile, exp: 0 }, event: earlyBirdEvent }).kind).toBe('earlyBirdNoPoints');
  });
});
