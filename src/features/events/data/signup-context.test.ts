import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventDoc, ViewerContext } from './types';
import type { SignupProfile } from './signup-profile';

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  history: vi.fn(),
}));

vi.mock('./event-detail', () => ({ loadEventDetail: mocks.detail }));
vi.mock('./viewer-registrations', () => ({
  loadViewerRegistrations: mocks.history,
}));

import {
  canDetailCompanionSignup,
  canDetailTeamSignup,
  createDetailSignupContexts,
  detailCompanionGenderMessage,
} from './signup-context';
import { buildCancelPayload, buildRegisterPayload, SignupError } from './signup';

const now = new Date(2030, 0, 1, 12);
const profile: SignupProfile = {
  gender: '女',
  birthday: '2000/01/01',
  exp: 100,
  lineNotifyBound: false,
};
const viewer: ViewerContext = {
  uid: 'u1',
  teamIds: new Set(['team-a']),
  hasPermission: () => false,
  roleLevel: 0,
};

function setup(event: EventDoc = {}) {
  let currentViewer: ViewerContext | null = viewer;
  let currentProfile: SignupProfile | null = profile;
  mocks.detail.mockResolvedValue({
    eventDocId: 'document-id',
    event: { id: 'wrong-id', date: '2030/02/01 12:00~14:00', ...event },
  });
  const contexts = createDetailSignupContexts({
    getViewer: () => currentViewer,
    generation: 7,
    getProfile: () => currentProfile,
    getCompanionGender: id => id === 'female' ? '女' : '男',
    now: () => now,
  });
  return {
    ...contexts,
    setViewer(value: ViewerContext | null) { currentViewer = value; },
    setProfile(value: SignupProfile | null) { currentProfile = value; },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.history.mockResolvedValue([
    { eventId: 'other-event', userId: 'u1', status: 'cancelled' },
  ]);
});

describe('createDetailSignupContexts', () => {
  it('每次重新讀活動與完整本人歷史，回傳全部 context 欄位及 public ID', async () => {
    const contexts = setup();
    const result = await contexts.signup.load('public-id', [{ type: 'self' }]);
    expect(result).toEqual({
      event: expect.objectContaining({ id: 'public-id', status: 'open' }),
      viewer,
      registrations: [
        { eventId: 'other-event', userId: 'u1', status: 'cancelled' },
      ],
      profileComplete: true,
      participantCheck: { ok: true },
      earlyBirdWindow: false,
      teamSignupAllowed: true,
      requiresTeamSelection: false,
    });
    await contexts.signup.load('public-id', [{ type: 'self' }]);
    expect(mocks.detail).toHaveBeenCalledTimes(2);
    expect(mocks.history).toHaveBeenNthCalledWith(2, 'u1');
    expect(contexts.signup.getAuth()).toEqual({ uid: 'u1', generation: 7 });
  });

  it.each([
    [{ status: 'cancelled' }, 'cancelled'],
    [{ status: 'ended' }, 'ended'],
    [{ date: '2029/12/31 12:00~13:00' }, 'ended'],
    [{ regOpenTime: '2030-01-20T12:00:00' }, 'upcoming'],
    [{ max: 2, current: 2 }, 'full'],
  ])('同步有效狀態 %j', async (fields, expected) => {
    const contexts = setup(fields as EventDoc);
    const result = await contexts.cancel.load('public-id');
    expect(result.event.id).toBe('public-id');
    expect(result.event.status).toBe(expected);
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it('計算早鳥時窗', async () => {
    const contexts = setup({
      regOpenTime: '2030-01-20T12:00:00',
      earlyBirdEnabled: true,
      earlyBirdCost: 20,
    } as EventDoc);
    expect((await contexts.signup.load('e', [{ type: 'self' }])).earlyBirdWindow)
      .toBe(true);
  });

  it('teamOnly 只允許俱樂部交集', async () => {
    const contexts = setup({ teamOnly: true, creatorTeamIds: ['team-a'] });
    expect((await contexts.signup.load('e', [{ type: 'self' }])).teamSignupAllowed)
      .toBe(true);
    contexts.setViewer({ ...viewer, teamIds: new Set(), roleLevel: 4 });
    expect((await contexts.signup.load('e', [{ type: 'self' }])).teamSignupAllowed)
      .toBe(false);
  });

  it('本人性別不符回 A 訊息', async () => {
    const contexts = setup({
      genderRestrictionEnabled: true, allowedGender: '男',
    } as EventDoc);
    expect((await contexts.signup.load('e', [{ type: 'self' }])).participantCheck)
      .toEqual({
        ok: false,
        reason: 'gender_restricted',
        messageKey: 'event.signup.error.genderRestricted',
        message: '限男性報名，目前無法報名',
      });
  });

  it('讀取失敗的 profile 不繞過性別限制', async () => {
    const contexts = setup({
      genderRestrictionEnabled: true, allowedGender: '女',
    } as EventDoc);
    contexts.setProfile(null);
    expect((await contexts.signup.load('e', [{ type: 'self' }])).participantCheck)
      .toMatchObject({
        ok: false, reason: 'gender_restricted',
        message: '限女性報名，請先到個人資料填寫性別',
      });
  });

  it.each([
    ['2020/01/01', '此活動限 18 歲以上報名'],
    ['', '請先補齊生日資料後再報名'],
  ])('年齡限制使用最新 profile：%s', async (birthday, message) => {
    const contexts = setup({ minAge: 18 } as EventDoc);
    contexts.setProfile({ ...profile, birthday });
    expect((await contexts.signup.load('e', [{ type: 'self' }])).participantCheck)
      .toMatchObject({ ok: false, reason: 'age_restricted', message });
  });

  it('同行者性別從 ID 對應資料取得，不套用本人的性別或年齡', async () => {
    const contexts = setup({
      genderRestrictionEnabled: true, allowedGender: '女', minAge: 100,
    } as EventDoc);
    expect((await contexts.signup.load('e', [{
      type: 'companion', companionId: 'female', companionName: '小花',
    }])).participantCheck).toEqual({ ok: true });
    expect((await contexts.signup.load('e', [{
      type: 'companion', companionId: 'male', companionName: '小明',
    }])).participantCheck).toMatchObject({
      ok: false, reason: 'gender_restricted',
      message: '同行者不符合活動性別限制',
    });
  });

  it('活動不存在時拋 SignupError', async () => {
    const contexts = setup();
    mocks.detail.mockResolvedValue(null);
    await expect(contexts.signup.load('missing', [{ type: 'self' }]))
      .rejects.toBeInstanceOf(SignupError);
    await expect(contexts.cancel.load('missing')).rejects.toMatchObject({
      messageKey: 'events.detailPage.notFound',
    });
  });

  it('卸載後 getAuth 回 null，不能開始新的 load', async () => {
    const contexts = setup();
    contexts.setViewer(null);
    expect(contexts.signup.getAuth()).toEqual({ uid: null, generation: 7 });
    expect(contexts.cancel.getAuth()).toEqual({ uid: null, generation: 7 });
    await expect(contexts.signup.load('e', [{ type: 'self' }]))
      .rejects.toMatchObject({ originalCode: 'LOGIN_REQUIRED' });
    expect(mocks.detail).not.toHaveBeenCalled();
  });
});

describe('詳情資格 helper', () => {
  it('俱樂部 ID 合併、去空白；空限定名單不放行', () => {
    expect(canDetailTeamSignup({}, new Set())).toBe(true);
    expect(canDetailTeamSignup({ teamOnly: true }, new Set(['a']))).toBe(false);
    expect(canDetailTeamSignup({
      teamOnly: true, creatorTeamId: ' a ', creatorTeamIds: ['b'],
    }, new Set(['a']))).toBe(true);
    expect(canDetailTeamSignup({
      teamOnly: true, creatorTeamIds: 'a',
    }, new Set(['a']))).toBe(false);
  });

  it('同行者只接受 A 的男／女值', () => {
    const event = { genderRestrictionEnabled: true, allowedGender: '女' };
    expect(canDetailCompanionSignup(event, '女')).toBe(true);
    expect(canDetailCompanionSignup(event, '男')).toBe(false);
    expect(canDetailCompanionSignup(event, undefined)).toBe(false);
    expect(canDetailCompanionSignup({ allowedGender: '女' }, undefined)).toBe(true);
    expect(detailCompanionGenderMessage(event, '小花'))
      .toBe('同行者不符合活動性別限制');
  });
});

describe('夥伴切換 payload', () => {
  it('加報保留 A 的 companions requestId 與參與者欄位', () => {
    expect(buildRegisterPayload({
      eventId: 'public-id',
      user: { uid: 'u1' },
      participants: [{
        type: 'companion', companionId: 'c1', companionName: '小花',
      }],
      companionToggle: true,
      now: 123,
      randomSuffix: 'abc',
    })).toEqual({
      eventId: 'public-id',
      participants: [{
        userId: 'u1', userName: '使用者', companionId: 'c1', companionName: '小花',
      }],
      requestId: 'u1_public-id_companions_123_abc',
    });
  });

  it('取消使用 companion_toggle reason 與前綴；普通取消不受影響', () => {
    expect(buildCancelPayload({
      eventId: 'public-id', userId: 'u1', registrationIds: ['doc-c1'],
      kind: 'companion', companionToggle: true, now: 123,
    })).toEqual({
      eventId: 'public-id',
      registrationIds: ['doc-c1'],
      reason: 'companion_toggle',
      requestId: 'cancel_companion_toggle_u1_public-id_123',
    });
    expect(buildCancelPayload({
      eventId: 'public-id', userId: 'u1', registrationIds: ['doc-self'],
      kind: 'self', now: 123, randomSuffix: 'abc',
    })).toEqual({
      eventId: 'public-id',
      registrationIds: ['doc-self'],
      reason: 'user_cancel',
      requestId: 'cancel_u1_public-id_123_abc',
    });
  });
});
