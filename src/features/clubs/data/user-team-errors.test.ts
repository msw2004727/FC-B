// T-090：createUserTeam／reviewTeamJoin 原因碼 → 使用者文案 key。
// 修正前應失敗的理由：本模組修正前不存在；建立失敗會顯示「儲存失敗：<原始錯誤>」。
import { describe, expect, it } from 'vitest';

import {
  extractCallableReason,
  getUserFacingMessage,
  teamJoinReviewErrorKey,
  UserFacingError,
  userTeamCreateErrorKey,
} from './user-team-errors';

function httpsError(message: string, code = 'functions/failed-precondition'): Error {
  return Object.assign(new Error(message), { code });
}

describe('userTeamCreateErrorKey', () => {
  it.each([
    ['AUTH_REQUIRED', 'clubs.userCreate.error.authRequired'],
    ['INVALID_CALLER_UID', 'clubs.userCreate.error.accountInvalid'],
    ['USER_PROFILE_NOT_FOUND', 'clubs.userCreate.error.accountInvalid'],
    ['USER_IDENTITY_MISMATCH', 'clubs.userCreate.error.accountInvalid'],
    ['INVALID_MEMBERSHIP', 'clubs.userCreate.error.accountInvalid'],
    ['CREATE_USER_TEAM_ROLE_DENIED', 'clubs.userCreate.error.roleDenied'],
    ['CREATE_USER_TEAM_ROLE_UNVERIFIED', 'clubs.userCreate.error.roleUnverified'],
    ['TEAM_CREATE_CAPABILITY_DISABLED', 'clubs.userCreate.error.disabled'],
    ['TEAM_CREATE_CAPABILITY_INVALID', 'clubs.userCreate.error.disabled'],
    ['USER_TEAM_CREATE_LIMIT', 'clubs.userCreate.error.ownLimit'],
    ['TEAM_MEMBERSHIP_LIMIT', 'clubs.userCreate.error.membershipLimit'],
    ['CREATE_USER_TEAM_INVALID_FIELD', 'clubs.userCreate.error.invalid'],
    ['CREATE_USER_TEAM_UNKNOWN_FIELD', 'clubs.userCreate.error.invalid'],
    ['CREATE_USER_TEAM_INVALID_REQUEST_ID', 'clubs.userCreate.error.invalid'],
    // T-090 P2-1：後端將拒絕自建俱樂部選「教學」；修正前此碼會落到通用「建立失敗」（應失敗）。
    ['CREATE_USER_TEAM_TYPE_NOT_ALLOWED', 'clubs.userCreate.error.typeNotAllowed'],
    ['TEAM_ID_COLLISION', 'clubs.userCreate.error.retry'],
    ['CREATE_USER_TEAM_RETRY', 'clubs.userCreate.error.retry'],
    ['CREATE_USER_TEAM_FAILED', 'clubs.userCreate.error.failed'],
  ])('%s → %s', (reason, key) => {
    expect(userTeamCreateErrorKey(httpsError(reason))).toBe(key);
  });

  it('未知或非原因碼訊息一律回通用文案', () => {
    expect(userTeamCreateErrorKey(new Error('TypeError: x is undefined at foo.js:1'))).toBe(
      'clubs.userCreate.error.failed',
    );
    expect(userTeamCreateErrorKey(null)).toBe('clubs.userCreate.error.failed');
    expect(userTeamCreateErrorKey('USER_TEAM_CREATE_LIMIT')).toBe('clubs.userCreate.error.failed');
  });

  it('unauthenticated 錯誤碼視為 AUTH_REQUIRED；details.reason 也可取', () => {
    expect(userTeamCreateErrorKey(httpsError('Unauthenticated', 'functions/unauthenticated'))).toBe(
      'clubs.userCreate.error.authRequired',
    );
    expect(extractCallableReason(
      Object.assign(new Error('bad'), { details: { reason: 'USER_TEAM_CREATE_LIMIT' } }),
    )).toBe('USER_TEAM_CREATE_LIMIT');
  });
});

describe('teamJoinReviewErrorKey', () => {
  it.each([
    ['TEAM_JOIN_REVIEW_DENIED', 'clubs.joinReview.error.denied'],
    ['TEAM_JOIN_REQUEST_NOT_FOUND', 'clubs.joinReview.error.notFound'],
    ['TEAM_JOIN_REQUEST_NOT_PENDING', 'clubs.joinReview.error.notPending'],
    ['TEAM_ID_AMBIGUOUS', 'clubs.joinReview.error.teamInvalid'],
    ['TEAM_JOIN_SELF_REVIEW_DENIED', 'clubs.joinReview.error.selfReview'],
    // T-090 P3：後端交易衝突回 TEAM_JOIN_REVIEW_RETRY；修正前落到通用「審核失敗」（應失敗）。
    ['TEAM_JOIN_REVIEW_RETRY', 'clubs.joinReview.error.retry'],
    ['TEAM_JOIN_REVIEW_FAILED', 'clubs.joinReview.error.failed'],
    ['SOMETHING_ELSE', 'clubs.joinReview.error.failed'],
  ])('%s → %s', (reason, key) => {
    expect(teamJoinReviewErrorKey(httpsError(reason))).toBe(key);
  });

  // T-090 P3：reviewTeamJoin 不會回這兩碼，審核映射已移除（建立映射保留），一律回通用文案。
  it.each(['TEAM_MEMBERSHIP_LIMIT', 'USER_PROFILE_NOT_FOUND'])('%s 不在審核映射', (reason) => {
    expect(teamJoinReviewErrorKey(httpsError(reason))).toBe('clubs.joinReview.error.failed');
  });
});

describe('UserFacingError', () => {
  it('只有 UserFacingError 才取得 userMessage', () => {
    expect(getUserFacingMessage(new UserFacingError('文案'))).toBe('文案');
    expect(getUserFacingMessage(new Error('raw'))).toBeNull();
  });
});
