import { describe, expect, it } from 'vitest';
import {
  getEventGenderSignupState,
  getEventGenderRestrictionMessage,
  getEventGenderRibbonText,
  hasEventGenderRestriction,
  getEventAgeSignupState,
  getEventAgeRestrictionButtonText,
  getEventAgeRestrictionMessage,
  isEventEarlyBirdWindow,
  getEventEarlyBirdCost,
  hasAvailableTeamReservationSignup,
} from './signup-restrictions';
import type { SignupProfile } from './signup-profile';

const now = new Date('2026-01-01T00:00:00Z');
const male: SignupProfile = { gender: '男', birthday: '1990/01/01', exp: 100, lineNotifyBound: false };
const female: SignupProfile = { gender: '女', birthday: '1990/01/01', exp: 100, lineNotifyBound: false };
const noGender: SignupProfile = { gender: '', birthday: '1990/01/01', exp: 100, lineNotifyBound: false };

describe('getEventGenderSignupState', () => {
  it('無性別限制 → 不擋', () => {
    expect(getEventGenderSignupState({}, male)).toMatchObject({ restricted: false, canSignup: true });
  });

  it('有性別限制 + 訪客（profile=null）→ requiresLogin、不擋', () => {
    expect(getEventGenderSignupState({ genderRestrictionEnabled: true, allowedGender: '女' }, null))
      .toMatchObject({ restricted: true, requiresLogin: true, canSignup: true, reason: '' });
  });

  it('性別相符 → canSignup', () => {
    expect(getEventGenderSignupState({ genderRestrictionEnabled: true, allowedGender: '女' }, female))
      .toMatchObject({ canSignup: true, requiresLogin: false, reason: '' });
  });

  it('性別不符 → canSignup:false + reason gender_mismatch', () => {
    expect(getEventGenderSignupState({ genderRestrictionEnabled: true, allowedGender: '女' }, male))
      .toMatchObject({ canSignup: false, reason: 'gender_mismatch', requiresLogin: false });
  });

  it('性別未填 → reason missing_gender', () => {
    expect(getEventGenderSignupState({ genderRestrictionEnabled: true, allowedGender: '男' }, noGender))
      .toMatchObject({ canSignup: false, reason: 'missing_gender', requiresLogin: false });
  });
});

describe('getEventGenderRestrictionMessage / RibbonText / hasEventGenderRestriction', () => {
  it('限女：message 依 reason 不同', () => {
    const ev = { genderRestrictionEnabled: true, allowedGender: '女' };
    expect(getEventGenderRestrictionMessage(ev, 'missing_gender')).toBe('限女性報名，請先到個人資料填寫性別');
    expect(getEventGenderRestrictionMessage(ev, 'gender_mismatch')).toBe('限女性報名，目前無法報名');
  });
  it('限男 ribbon', () => {
    expect(getEventGenderRibbonText({ genderRestrictionEnabled: true, allowedGender: '男' })).toBe('男生限定');
  });
  it('no restriction ribbon 空字串', () => {
    expect(getEventGenderRibbonText({})).toBe('');
  });
  it('hasEventGenderRestriction', () => {
    expect(hasEventGenderRestriction({ genderRestrictionEnabled: true, allowedGender: '男' })).toBe(true);
    expect(hasEventGenderRestriction({})).toBe(false);
  });
});

describe('getEventAgeSignupState', () => {
  it('無 minAge → 不擋', () => {
    expect(getEventAgeSignupState({}, male, now)).toMatchObject({ restricted: false, canSignup: true });
  });

  it('有 minAge + 訪客（profile=null）→ requiresLogin、canSignup:false', () => {
    expect(getEventAgeSignupState({ minAge: 18 }, null, now))
      .toMatchObject({ restricted: true, canSignup: false, requiresLogin: true, reason: 'login-required' });
  });

  it('生日格式錯 → birthday-missing', () => {
    expect(getEventAgeSignupState({ minAge: 18 }, { gender: '', birthday: 'oops', exp: 0, lineNotifyBound: false }, now))
      .toMatchObject({ reason: 'birthday-missing', canSignup: false });
    // 非法日期（2010-02-30 會被 rollover 成 3/2）
    expect(getEventAgeSignupState({ minAge: 18 }, { gender: '', birthday: '2010/02/30', exp: 0, lineNotifyBound: false }, now))
      .toMatchObject({ reason: 'birthday-missing' });
  });

  it('生日未填 → birthday-missing', () => {
    expect(getEventAgeSignupState({ minAge: 18 }, { gender: '', birthday: '', exp: 0, lineNotifyBound: false }, now))
      .toMatchObject({ reason: 'birthday-missing' });
  });

  it('足齡 → 不擋', () => {
    expect(getEventAgeSignupState({ minAge: 18 }, { gender: '', birthday: '1990/01/01', exp: 0, lineNotifyBound: false }, now))
      .toMatchObject({ restricted: false, canSignup: true, reason: '' });
  });

  it('不足齡 → underage', () => {
    expect(getEventAgeSignupState({ minAge: 18 }, { gender: '', birthday: '2015/01/01', exp: 0, lineNotifyBound: false }, now))
      .toMatchObject({ reason: 'underage', canSignup: false });
  });

  it('以活動日期為 reference date；活動日足歲即通過', () => {
    const partialProfile: SignupProfile = { gender: '', birthday: '2008/05/15', exp: 0, lineNotifyBound: false };
    // now 2026-01-01 未滿 18，但活動 2026/06/01 已滿 18
    expect(getEventAgeSignupState({ minAge: 18, date: '2026/06/01 10:00' }, partialProfile, now))
      .toMatchObject({ restricted: false, canSignup: true });
    // 活動 2026/05/01 仍不足 18
    expect(getEventAgeSignupState({ minAge: 18, date: '2026/05/01 10:00' }, partialProfile, now))
      .toMatchObject({ reason: 'underage' });
  });
});

describe('getEventAgeRestrictionButtonText / Message', () => {
  it('button text', () => {
    expect(getEventAgeRestrictionButtonText({ minAge: 18 }, { restricted: true, canSignup: false, requiresLogin: false, reason: 'underage', minAge: 18, age: 10 })).toBe('18歲以上');
    expect(getEventAgeRestrictionButtonText({ minAge: 18 }, { restricted: true, canSignup: false, requiresLogin: false, reason: 'birthday-missing', minAge: 18, age: null })).toBe('補齊生日');
  });
  it('message', () => {
    expect(getEventAgeRestrictionMessage({ minAge: 18 }, { restricted: true, canSignup: false, requiresLogin: false, reason: 'underage', minAge: 18, age: 10 })).toBe('此活動限 18 歲以上報名');
    expect(getEventAgeRestrictionMessage({ minAge: 18 }, { restricted: true, canSignup: false, requiresLogin: false, reason: 'birthday-missing', minAge: 18, age: null })).toBe('請先補齊生日資料後再報名');
  });
});

describe('isEventEarlyBirdWindow / getEventEarlyBirdCost', () => {
  it('cost 有效範圍 10~500', () => {
    expect(getEventEarlyBirdCost({ earlyBirdEnabled: false, earlyBirdCost: 50 })).toBe(0);
    expect(getEventEarlyBirdCost({ earlyBirdEnabled: true, earlyBirdCost: 5 })).toBe(0);
    expect(getEventEarlyBirdCost({ earlyBirdEnabled: true, earlyBirdCost: 600 })).toBe(0);
    expect(getEventEarlyBirdCost({ earlyBirdEnabled: true, earlyBirdCost: 50 })).toBe(50);
  });

  it('窗口內 → true', () => {
    const event = {
      status: 'open',
      date: '2026/06/01 10:00',
      regOpenTime: '2026-05-01T00:00:00',
      earlyBirdEnabled: true,
      earlyBirdCost: 50,
    };
    expect(isEventEarlyBirdWindow(event, now)).toBe(true);
  });

  it('regOpen 已過 → false', () => {
    const event = {
      status: 'open',
      date: '2026/06/01 10:00',
      regOpenTime: '2025-01-01T00:00:00',
      earlyBirdEnabled: true,
      earlyBirdCost: 50,
    };
    expect(isEventEarlyBirdWindow(event, now)).toBe(false);
  });

  it('活動已開始 → false', () => {
    const event = {
      status: 'open',
      date: '2025/01/01 10:00',
      regOpenTime: '2026-05-01T00:00:00',
      earlyBirdEnabled: true,
      earlyBirdCost: 50,
    };
    expect(isEventEarlyBirdWindow(event, now)).toBe(false);
  });

  it('status ended/cancelled → false', () => {
    const base = {
      date: '2026/06/01 10:00',
      regOpenTime: '2026-05-01T00:00:00',
      earlyBirdEnabled: true,
      earlyBirdCost: 50,
    };
    expect(isEventEarlyBirdWindow({ ...base, status: 'ended' }, now)).toBe(false);
    expect(isEventEarlyBirdWindow({ ...base, status: 'cancelled' }, now)).toBe(false);
  });

  it('無 regOpenTime → false', () => {
    expect(isEventEarlyBirdWindow(
      { status: 'open', date: '2026/06/01 10:00', earlyBirdEnabled: true, earlyBirdCost: 50 },
      now,
    )).toBe(false);
  });

  it('regOpenTime 2026-10-19T09:00：08:59+08 仍在窗口，09:00+08 起不是', () => {
    const event = {
      status: 'open',
      date: '2099/01/01 10:00',
      regOpenTime: '2026-10-19T09:00',
      earlyBirdEnabled: true,
      earlyBirdCost: 50,
    };
    expect(isEventEarlyBirdWindow(event, new Date('2026-10-19T08:59:00+08:00'))).toBe(true);
    expect(isEventEarlyBirdWindow(event, new Date('2026-10-19T09:00:00+08:00'))).toBe(false);
  });

  it('無效 regOpenTime → false', () => {
    expect(isEventEarlyBirdWindow({
      status: 'open',
      date: '2099/01/01 10:00',
      regOpenTime: 'nope',
      earlyBirdEnabled: true,
      earlyBirdCost: 50,
    }, now)).toBe(false);
  });
});

describe('hasAvailableTeamReservationSignup', () => {
  it('本隊有剩餘 → true', () => {
    expect(hasAvailableTeamReservationSignup(
      { teamReservationSummaries: [{ teamId: 'a', reservedSlots: 5, usedSlots: 2 }] },
      new Set(['a']),
    )).toBe(true);
  });

  it('剩餘用盡 → false', () => {
    expect(hasAvailableTeamReservationSignup(
      { teamReservationSummaries: [{ teamId: 'a', reservedSlots: 5, usedSlots: 5 }] },
      new Set(['a']),
    )).toBe(false);
  });

  it('非本人俱樂部 → false', () => {
    expect(hasAvailableTeamReservationSignup(
      { teamReservationSummaries: [{ teamId: 'a', reservedSlots: 5, usedSlots: 0 }] },
      new Set(['b']),
    )).toBe(false);
  });

  it('無 summaries 或無 teamIds → false', () => {
    expect(hasAvailableTeamReservationSignup({}, new Set(['a']))).toBe(false);
    expect(hasAvailableTeamReservationSignup(
      { teamReservationSummaries: [{ teamId: 'a', reservedSlots: 5, usedSlots: 0 }] },
      new Set(),
    )).toBe(false);
  });

  it('reserved=0 且 used>0 → false（過濾條件保留但不回報可用）', () => {
    expect(hasAvailableTeamReservationSignup(
      { teamReservationSummaries: [{ teamId: 'a', reservedSlots: 0, usedSlots: 2 }] },
      new Set(['a']),
    )).toBe(false);
  });
});

describe('T-054c G1～G4', () => {
  const event = {
    status: 'open', date: '2026/10/19 11:00~13:00',
    regOpenTime: '2026-10-20T09:00', earlyBirdEnabled: true, earlyBirdCost: 50,
  };

  it('G1 regOpen 在未來時，活動起點含等號關閉早鳥窗口', () => {
    expect(isEventEarlyBirdWindow(event, new Date('2026-10-19T10:59:59.999+08:00'))).toBe(true);
    expect(isEventEarlyBirdWindow(event, new Date('2026-10-19T11:00:00+08:00'))).toBe(false);
    expect(isEventEarlyBirdWindow(event, new Date('2026-10-19T11:00:00.001+08:00'))).toBe(false);
    expect(isEventEarlyBirdWindow({ ...event, regOpenTime: '2026-10-19T09:00' }, new Date('2026-10-19T09:00:00+08:00'))).toBe(false);
  });

  it('G2 無活動起點，台北生日當天凌晨已足齡', () => {
    const profile = { ...male, birthday: '2008/10/19' };
    expect(getEventAgeSignupState({ minAge: 18 }, profile, new Date('2026-10-18T16:30:00Z'))).toEqual({
      restricted: false, canSignup: true, requiresLogin: false, reason: '', minAge: 18, age: 18,
    });
    expect(getEventAgeSignupState({ minAge: 18 }, profile, new Date('2026-10-18T23:59:59+08:00'))).toEqual({
      restricted: true, canSignup: false, requiresLogin: false, reason: 'underage', minAge: 18, age: 17,
    });
  });

  it('G3 基準日為活動日：生日當天足齡、前一天不足齡', () => {
    const profile = { ...male, birthday: '2008/10/19' };
    const before = new Date('2026-01-01T00:00:00+08:00');
    expect(getEventAgeSignupState({ minAge: 18, date: '2026/10/19 00:30~02:00' }, profile, before))
      .toEqual({ restricted: false, canSignup: true, requiresLogin: false, reason: '', minAge: 18, age: 18 });
    expect(getEventAgeSignupState({ minAge: 18, date: '2026/10/18 23:30~23:59' }, profile, before))
      .toEqual({ restricted: true, canSignup: false, requiresLogin: false, reason: 'underage', minAge: 18, age: 17 });
  });

  it('G4 非字串 regOpenTime 不開早鳥窗口（P3-2）', () => {
    for (const regOpenTime of [
      Date.parse('2026-10-20T09:00:00+08:00'),
      { toMillis: () => Date.parse('2026-10-20T09:00:00+08:00') },
      { seconds: Date.parse('2026-10-20T09:00:00+08:00') / 1000 },
    ]) {
      expect(isEventEarlyBirdWindow({ ...event, regOpenTime }, new Date('2026-10-19T09:00:00+08:00'))).toBe(false);
    }
  });
});

it('G3 消費端不擴大 ISO 起點，年齡仍採 now 後備', () => {
  expect(getEventAgeSignupState(
    { minAge: 18, date: '2026-10-19T11:00:00+08:00' },
    { ...male, birthday: '2008/10/19' },
    new Date('2026-10-18T12:00:00+08:00'),
  )).toEqual({ restricted: true, canSignup: false, requiresLogin: false, reason: 'underage', minAge: 18, age: 17 });
});
