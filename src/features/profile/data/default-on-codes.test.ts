import { describe, expect, it } from 'vitest';
import {
  COMPETITION_HOST_CODE, DEFAULT_ON_CAPABILITY_CODES, DEFAULT_ON_ROLE_CODES, USER_COMPETITION_HOST_CODE,
  canHostCompetition, isDefaultOnCodeEnabled,
} from './default-on-codes';

// 真值表與 functions-cp/test/host-permission.test.ts 同一組（顧問 §3.612）。
describe('isDefaultOnCodeEnabled 真值表', () => {
  const code = COMPETITION_HOST_CODE;
  it.each([
    ['undefined（文件或欄位不存在）', undefined, true],
    ['陣列且含碼', [code], false],
    ['陣列且含碼（夾雜其他值）', ['other', 3, code], false],
    ['陣列且不含碼', ['other.code'], true],
    ['空陣列', [], true],
    ['null', null, false],
    ['字串（即使等於碼）', code, false],
    ['物件', { [code]: true }, false],
    ['數字', 0, false],
    ['布林', false, false],
  ] as const)('%s', (_name, raw, expected) => {
    expect(isDefaultOnCodeEnabled(raw, code)).toBe(expected);
  });
  it('只認完全相同的碼', () => {
    expect(isDefaultOnCodeEnabled([USER_COMPETITION_HOST_CODE], COMPETITION_HOST_CODE)).toBe(true);
    expect(isDefaultOnCodeEnabled([COMPETITION_HOST_CODE], USER_COMPETITION_HOST_CODE)).toBe(true);
  });
  it('碼與清單', () => {
    expect(COMPETITION_HOST_CODE).toBe('competition.host');
    expect(USER_COMPETITION_HOST_CODE).toBe('user.competition.host');
    expect(DEFAULT_ON_ROLE_CODES).toEqual(['competition.host']);
    expect(DEFAULT_ON_CAPABILITY_CODES).toEqual(['user.competition.host']);
  });
});

describe('canHostCompetition 真值表', () => {
  it.each([
    ['沒 uid', { uid: null, role: 'super_admin', permissionSources: {} }, false],
    ['guest', { uid: 'u1', role: 'guest', permissionSources: {} }, false],
    ['空角色', { uid: 'u1', role: '', permissionSources: {} }, false],
    ['super_admin 即使讀取失敗', { uid: 'u1', role: 'super_admin', permissionSources: { disabledCodes: null } }, true],
    ['super_admin 即使被關', { uid: 'u1', role: 'super_admin', permissionSources: { disabledCodes: [COMPETITION_HOST_CODE] } }, true],
    ['user 缺欄位', { uid: 'u1', role: 'user', permissionSources: {} }, true],
    ['user 含 user 碼', { uid: 'u1', role: 'user', permissionSources: { disabledCodes: [USER_COMPETITION_HOST_CODE] } }, false],
    ['user 只含教練碼', { uid: 'u1', role: 'user', permissionSources: { disabledCodes: [COMPETITION_HOST_CODE] } }, true],
    ['user 讀取失敗／壞值', { uid: 'u1', role: 'user', permissionSources: { disabledCodes: null } }, false],
    ['coach 缺欄位', { uid: 'u1', role: 'coach', permissionSources: {} }, true],
    ['coach 空陣列', { uid: 'u1', role: 'coach', permissionSources: { disabledCodes: [] } }, true],
    ['coach 含碼', { uid: 'u1', role: 'coach', permissionSources: { disabledCodes: [COMPETITION_HOST_CODE] } }, false],
    ['coach 只含 user 碼', { uid: 'u1', role: 'coach', permissionSources: { disabledCodes: [USER_COMPETITION_HOST_CODE] } }, true],
    ['admin 含碼（不特別放行）', { uid: 'u1', role: 'admin', permissionSources: { disabledCodes: [COMPETITION_HOST_CODE] } }, false],
    ['admin 讀取失敗', { uid: 'u1', role: 'admin', permissionSources: { disabledCodes: null } }, false],
    ['自訂角色含碼', { uid: 'u1', role: 'custom_role', permissionSources: { disabledCodes: [COMPETITION_HOST_CODE] } }, false],
    ['自訂角色缺欄位', { uid: 'u1', role: 'custom_role', permissionSources: {} }, true],
    ['permissionSources 缺省（測試替身）', { uid: 'u1', role: 'coach' }, true],
  ] as const)('%s', (_name, viewer, expected) => {
    expect(canHostCompetition(viewer)).toBe(expected);
  });
});
