import { describe, expect, it } from 'vitest';
import { getSignupButtonState, type SignupButtonInput } from './signup-state';

const base: SignupButtonInput = {
  event: { id: 'event-a', status: 'open', current: 1, max: 10 },
  viewer: {
    uid: 'u1',
    teamIds: new Set(),
    hasPermission: () => false,
    roleLevel: 0,
  },
  registrations: [],
  now: new Date('2026-01-01T00:00:00Z'),
};

describe('getSignupButtonState', () => {
  it.each([
    ['ended', { event: { ...base.event, status: 'ended' } }, true, 'none', 'muted'],
    ['cancelWaitlist', {
      registrations: [{ userId: 'u1', participantType: 'self', status: 'waitlisted' }],
    }, false, 'cancel', 'warning'],
    ['cancel', {
      registrations: [{ userId: 'u1', participantType: 'self', status: 'confirmed' }],
    }, false, 'cancel', 'danger'],
    ['notOpen', { event: { ...base.event, status: 'upcoming' } }, true, 'none', 'muted'],
    ['teamOnly', {
      event: { ...base.event, teamOnly: true, creatorTeamId: 'team-a' },
    }, true, 'none', 'muted'],
    ['restricted', {
      restriction: {
        labelKey: 'events.detailPage.button.restricted',
        messageKey: 'events.signup.error.genderRestricted',
      },
    }, false, 'explain', 'danger'],
    ['waitlist', { event: { ...base.event, current: 10 } }, false, 'signup', 'waitlist'],
    ['signup', {}, false, 'signup', 'primary'],
  ] as const)('%s', (kind, overrides, disabled, action, tone) => {
    expect(getSignupButtonState({ ...base, ...overrides })).toMatchObject({
      kind, disabled, action, tone,
      labelKey: `events.detailPage.button.${kind}`,
    });
  });

  it('取消活動優先於既有報名', () => {
    expect(getSignupButtonState({
      ...base,
      event: { ...base.event, status: 'cancelled' },
      registrations: [{ userId: 'u1', status: 'confirmed' }],
    }).kind).toBe('ended');
  });

  it('不把其他使用者或已取消報名當成自己的報名', () => {
    expect(getSignupButtonState({
      ...base,
      registrations: [
        { userId: 'u2', status: 'confirmed' },
        { userId: 'u1', status: 'cancelled' },
      ],
    }).kind).toBe('signup');
  });

  it('本人候補優先於同行者正取', () => {
    expect(getSignupButtonState({
      ...base,
      registrations: [
        { userId: 'u1', participantType: 'companion', status: 'confirmed' },
        { userId: 'u1', participantType: 'self', status: 'waitlisted' },
      ],
    }).kind).toBe('cancelWaitlist');
  });

  it('零容量沿用 A 的不以容量擋報名語意', () => {
    expect(getSignupButtonState({
      ...base, event: { ...base.event, max: 0 },
    }).kind).toBe('signup');
  });
});
