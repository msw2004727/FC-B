import { describe, expect, it } from 'vitest';
import { nicknameShapeOk, rosterNameParts, rosterRoleOf } from './names';

describe('rosterNameParts', () => {
  it('新列改過 → main 暱稱、orig 原始', () => {
    expect(rosterNameParts({ displayName: '新暱稱', nickname: '新暱稱', originalName: '原暱稱' })).toEqual({
      main: '新暱稱',
      orig: '原暱稱',
    });
  });

  it('新列沒改 → main 原始、orig null', () => {
    expect(rosterNameParts({ displayName: '原暱稱', nickname: null, originalName: '原暱稱' })).toEqual({
      main: '原暱稱',
      orig: null,
    });
  });

  it('nickname 等於 originalName → orig null', () => {
    expect(rosterNameParts({ displayName: '原暱稱', nickname: '原暱稱', originalName: '原暱稱' })).toEqual({
      main: '原暱稱',
      orig: null,
    });
  });

  it('舊列（沒 originalName）→ main displayName', () => {
    expect(rosterNameParts({ displayName: '舊名字' })).toEqual({ main: '舊名字', orig: null });
  });

  it('未成年／代填（沒 originalName）→ main displayName', () => {
    expect(rosterNameParts({ displayName: '王O明', nickname: null, originalName: null })).toEqual({
      main: '王O明',
      orig: null,
    });
  });

  it('有 originalName 但 nickname 為空字串 → main 原始', () => {
    expect(rosterNameParts({ displayName: '原暱稱', nickname: '', originalName: '原暱稱' })).toEqual({
      main: '原暱稱',
      orig: null,
    });
  });
});

describe('rosterRoleOf', () => {
  it('白名單原樣', () => {
    expect(rosterRoleOf('coach')).toBe('coach');
    expect(rosterRoleOf('captain')).toBe('captain');
    expect(rosterRoleOf('team_leader')).toBe('team_leader');
    expect(rosterRoleOf('venue_owner')).toBe('venue_owner');
    expect(rosterRoleOf('user')).toBe('user');
  });

  it('白名單外與非字串 → user', () => {
    expect(rosterRoleOf('unknown')).toBe('user');
    expect(rosterRoleOf(123)).toBe('user');
    expect(rosterRoleOf(null)).toBe('user');
    expect(rosterRoleOf(undefined)).toBe('user');
    expect(rosterRoleOf({})).toBe('user');
  });

  it('admin／super_admin＋stealth true → user', () => {
    expect(rosterRoleOf('admin', true)).toBe('user');
    expect(rosterRoleOf('super_admin', true)).toBe('user');
  });

  it('admin 沒開隱身 → admin', () => {
    expect(rosterRoleOf('admin', false)).toBe('admin');
    expect(rosterRoleOf('super_admin')).toBe('super_admin');
  });

  it('coach＋stealth true → coach', () => {
    expect(rosterRoleOf('coach', true)).toBe('coach');
  });
});

describe('nicknameShapeOk', () => {
  it('正常字串 true', () => {
    expect(nicknameShapeOk('阿範')).toBe(true);
    expect(nicknameShapeOk('Amy')).toBe(true);
  });

  it('含半形括號 false', () => {
    expect(nicknameShapeOk('阿(範')).toBe(false);
    expect(nicknameShapeOk('阿)範')).toBe(false);
  });

  it('含全形括號 false（NFKC 後也算）', () => {
    expect(nicknameShapeOk('阿（範')).toBe(false);
    expect(nicknameShapeOk('阿）範')).toBe(false);
  });

  it('含換行 false', () => {
    expect(nicknameShapeOk('阿\n範')).toBe(false);
    expect(nicknameShapeOk('阿\r範')).toBe(false);
  });
});
